/// <reference lib="deno.ns" />
import { Builder, Browser, By, until, WebElement } from "npm:selenium-webdriver";
import { Options } from "npm:selenium-webdriver/chrome.js";
import { parse } from "https://deno.land/std@0.167.0/flags/mod.ts";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type Role = "system" | "user" | "assistant";

export interface Message {
    role: Role;
    content: string;
}

export interface CompletionRequest {
    messages: Message[];
    fields?: string[]; // Optional: If omitted, returns raw text
}

// ============================================================================
// GLOBAL STATE
// ============================================================================

let driverInstance: any = null;

// ============================================================================
// BROWSER LIFECYCLE
// ============================================================================

export async function initBrowser() {
    if (!driverInstance) {
        console.log("🚀 Initializing Chrome WebDriver...");
        const options = new Options();
        
        // Window size is still important for responsive UI elements even in headless mode
        options.addArguments("--window-size=1200,1000");
        options.addArguments("--disable-blink-features=AutomationControlled");
        
        // ---------------------------------------------------------
        // REQUIRED FOR PRODUCTION / HEADLESS LINUX / DOCKER ENVIRONMENTS
        // ---------------------------------------------------------
        options.addArguments("--headless=new"); // Runs Chrome without a GUI
        options.addArguments("--no-sandbox"); // Bypasses OS security model (required on many Linux servers)
        options.addArguments("--disable-dev-shm-usage"); // Overcomes limited resource problems in Docker
        options.addArguments("--disable-gpu"); // Applicable for older headless implementations
        // ---------------------------------------------------------

        options.excludeSwitches("enable-automation");

        driverInstance = await new Builder()
            .forBrowser(Browser.CHROME)
            .setChromeOptions(options)
            .build();

        console.log("🌐 Navigating to Gemini...");
        await driverInstance.get("https://gemini.google.com/app");
        
        console.log("✋ Waiting for Chat Box to appear. Please log in if prompted...");
        await waitForElement(driverInstance, "div.ql-editor", 60000);
        console.log("🔓 Chat box found. System ready.\n");
    }
    return driverInstance;
}

export async function closeBrowser() {
    if (driverInstance) {
        console.log("🛑 Closing Chrome WebDriver...");
        await driverInstance.quit();
        driverInstance = null;
    }
}

export async function resetChat() {
    const driver = await initBrowser();
    console.log("🧹 Resetting chat context (New Chat)...");
    // Navigating directly to the app root forces a new session in the UI
    await driver.get("https://gemini.google.com/app");
    await waitForElement(driver, "div.ql-editor", 60000);
}

// ============================================================================
// UTILITIES
// ============================================================================

async function waitForElement(driver: any, selector: string, timeoutMs = 60000): Promise<WebElement> {
    const element = await driver.wait(until.elementLocated(By.css(selector)), timeoutMs);
    await driver.wait(until.elementIsVisible(element), timeoutMs);
    return element;
}

async function waitForAndExtractGeminiResponse(driver: any): Promise<string> {
    console.log("⏳ Waiting for Gemini to finish typing...");

    let previousText = "";
    let stableCount = 0;
    let attempt = 0;

    // Wait 3 seconds initially to allow the new response block to mount in the DOM
    await new Promise(r => setTimeout(r, 3000));

    while (true) {
        try {
            // Target the response blocks
            const responseElements = await driver.findElements(By.css("message-content, .markdown, .model-response-text"));
            
            if (responseElements.length > 0) {
                const lastResponse = responseElements[responseElements.length - 1];
                const currentText = await lastResponse.getText();

                if (currentText && currentText.length > 0) {
                    if (currentText === previousText) {
                        stableCount++;
                    } else {
                        stableCount = 0; // Text is still growing, reset counter
                        previousText = currentText;
                    }

                    // If the text hasn't changed for 3 consecutive checks (~4.5 seconds), it's done.
                    if (stableCount >= 3) {
                        console.log("✅ Gemini response finished.");
                        return currentText;
                    }
                }
            }
        } catch (error) {
            // Ignore stale element reference errors while the DOM updates
        }

        attempt++;
        if (attempt > 80) { // Timeout after ~2 minutes
            console.warn("⚠️ Timed out waiting for Gemini text to stabilize. Attempting to parse what we have.");
            return previousText;
        }

        await new Promise(r => setTimeout(r, 1500));
    }
}

function extractJsonFromDashBlock(text: string): string | null {
    // Looks for the specific `--- \n { ... } \n ---` block
    const dashMatch = text.match(/---\s*(\{[\s\S]*?\})\s*---/);
    if (dashMatch && dashMatch[1]) {
        return dashMatch[1];
    }
    
    // Fallback: standard json extraction
    const jsonRegex = /\{(?:[^{}]|R)*\}/;
    const match = text.match(jsonRegex);
    return match ? match[0] : null;
}

function compileMessages(messages: Message[]): string {
    let compiledString = "Please read the following conversation history and strictly adopt the persona defined in the SYSTEM instructions. Then, respond to the final USER message.\n\n";
    
    compiledString += "=== CONVERSATION HISTORY ===\n";
    
    for (const msg of messages) {
        const roleHeader = msg.role.toUpperCase();
        compiledString += `[${roleHeader}]: ${msg.content}\n\n`;
    }
    
    compiledString += "=== END HISTORY ===\n\n";
    compiledString += "Now, generate the next response as the ASSISTANT.";
    
    return compiledString;
}

// ============================================================================
// CORE EXECUTION
// ============================================================================

/**
 * Sends a prompt to Gemini via Selenium. 
 * If fieldsArray is provided, returns a strictly mapped JSON object.
 * If fieldsArray is omitted, returns the raw string response.
 */
export async function callLLM(userInput: string, fieldsArray?: string[]): Promise<Record<string, string> | string> {
    const driver = await initBrowser();
    
    const requiresJson = fieldsArray && fieldsArray.length > 0;
    
    // Dynamically build the prompt enforcing the user's specific format if requested
    let finalPrompt = userInput;
    if (requiresJson) {
        finalPrompt = `${userInput}\n\nExpected response format should be only like this without prefix or suffix other than surrounded by ---...--- something like this:\n---\n{\n${fieldsArray!.map(field => `"${field}": "Your ${field} response value"`).join(",\n")}\n}\n---`;
    }

    try {
        const textArea = await waitForElement(driver, "div.ql-editor", 60000);

        if (requiresJson) {
            console.log(`🤖 Executing payload... Expecting JSON fields: [${fieldsArray!.join(", ")}]`);
        } else {
            console.log(`🤖 Executing payload... Expecting raw text response.`);
        }

        // Inject the prompt text into the text area
        // @ts-ignore: HTMLElement not available in Deno — runs in browser context via Selenium
        await driver.executeScript((el: HTMLElement, text: string) => {
            el.focus();
            el.innerText = text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }, textArea, finalPrompt);

        // Brief delay to ensure UI picks up the injected text
        await new Promise(r => setTimeout(r, 2000));
        
        // Find and click the send button
        const sendBtn = await waitForElement(driver, "button[aria-label*='Send']");
        await sendBtn.click();

        // Extract raw string
        const rawAiResponse = await waitForAndExtractGeminiResponse(driver);
        
        if (!rawAiResponse) {
            throw new Error("Failed to extract text from the UI.");
        }

        // If JSON was not requested, just return the raw text
        if (!requiresJson) {
            return rawAiResponse;
        }

        // Parse and validate JSON if it was requested
        const extractedJsonString = extractJsonFromDashBlock(rawAiResponse);
        if (!extractedJsonString) {
            console.error("Raw response dump:", rawAiResponse);
            throw new Error("Could not find valid JSON block surrounded by --- in the response.");
        }

        const parsedData = JSON.parse(extractedJsonString);

        // Optional: Ensure all requested fields are actually present
        const missingFields = fieldsArray!.filter(field => !(field in parsedData));
        if (missingFields.length > 0) {
            console.warn(`⚠️ Warning: LLM omitted requested fields: ${missingFields.join(", ")}`);
        }

        return parsedData;

    } catch (error) {
        console.error("❌ Error in execution:", error);
        throw error;
    }
}

// ============================================================================
// SDK ADAPTER CLASS
// ============================================================================

export class GeminiWebAdapter {
    /**
     * Mimics standard Chat Completions APIs (Stateless)
     */
    async createCompletion(request: CompletionRequest): Promise<Record<string, string> | string> {
        // 1. Flatten the array into a single prompt string
        const masterPrompt = compileMessages(request.messages);
        
        // 2. Force a new chat to prevent context bleed from previous calls
        await resetChat(); 

        // 3. Pass to the executor
        return await callLLM(masterPrompt, request.fields);
    }
}

// ============================================================================
// CLI EXECUTION
// ============================================================================

if (import.meta.main) {
    const args = parse(Deno.args, {
        string: ["prompt", "fields", "system"],
        boolean: ["adapter-test"],
        alias: { p: "prompt", f: "fields", s: "system", a: "adapter-test", h: "help" },
    });

    if (args.help) {
        console.log(`
Usage: deno run -A script.ts [options]

Options:
  -p, --prompt        The input message for the LLM (Required unless testing adapter)
  -f, --fields        (Optional) Comma-separated list of JSON keys you want returned
  -s, --system        (Optional) System prompt to set behavior
  -a, --adapter-test  Run the SDK Adapter class demo instead of raw callLLM
  -h, --help          Show this help message
        `);
        Deno.exit(0);
    }

    try {
        // Handle optional fields parsing
        const parsedFields = args.fields ? args.fields.split(",").map((f: string) => f.trim()) : undefined;

        if (args["adapter-test"]) {
            // --- SDK Adapter Test Mode ---
            console.log("🧪 Running Adapter Class Demo...\n");
            const client = new GeminiWebAdapter();
            
            const conversation: Message[] = [
                { 
                    role: "system", 
                    content: args.system || "You are a grumpy mechanic." 
                },
                { 
                    role: "user", 
                    content: args.prompt || "Explain why my car won't start." 
                }
            ];
            
            const result = await client.createCompletion({
                messages: conversation,
                fields: parsedFields
            });

            console.log("\n🎯 Final Output:\n", typeof result === "string" ? result : JSON.stringify(result, null, 2));

        } else if (args.prompt) {
            // --- Raw callLLM Mode ---
            const finalPrompt = args.system ? `System: ${args.system}\nUser: ${args.prompt}` : args.prompt;
            
            const result = await callLLM(finalPrompt, parsedFields);
            console.log("\n🎯 Final Output:\n", typeof result === "string" ? result : JSON.stringify(result, null, 2));
            
        } else {
            console.log("❌ Missing required arguments. Use -p to provide a prompt, or use -h for help.");
            Deno.exit(1);
        }
    } catch (e) {
        console.error("\n❌ CLI Execution failed.");
    } finally {
        await closeBrowser();
        Deno.exit(0);
    }
}