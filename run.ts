/// <reference lib="deno.ns" />
// ============================================================================
// run.ts — single-entry-point: give it IDEA + CONTEXT, get all output files.
// ----------------------------------------------------------------------------
// Creates a named directory  runs/<name>/  containing:
//
//   map.json          — the full reasoning map (structured data)
//   execution.log     — verbose step-by-step trace of what the engine did
//   vault/            — Obsidian vault (open the folder in Obsidian)
//     _Index.md       ← start here: Mermaid graph + recommended ⭐ path
//     _Action Paths.md
//     _Context (Truths).md
//     _Snapshots.md
//     _Cross-Domain Jumps.md
//     n1 💡 …md       (one note per reasoning node, all wikilinked)
//
// Usage:
//   deno run -A run.ts "Your idea here" --context "Fact 1. Fact 2."
//   deno run -A run.ts "Your idea here" --context ./context.txt --name my-run
//   deno run -A run.ts "Your idea here" --mock          # offline / no network
//   deno run -A run.ts --help
// ============================================================================

import { parse } from "https://deno.land/std@0.167.0/flags/mod.ts";

// ---- helpers ----------------------------------------------------------------

async function run(args: string[], label: string): Promise<boolean> {
    console.log(`\n${"─".repeat(60)}\n▶  ${label}\n${"─".repeat(60)}`);
    const child = new Deno.Command("deno", { args, stdin: "null", stdout: "inherit", stderr: "inherit" });
    const code = (await child.output()).code;
    if (code !== 0) { console.error(`\n❌ ${label} failed (exit ${code})`); }
    return code === 0;
}

async function isFile(p: string): Promise<boolean> {
    try { return (await Deno.stat(p)).isFile; } catch { return false; }
}

// ---- main -------------------------------------------------------------------

if (import.meta.main) {
    const args = parse(Deno.args, {
        string: ["context", "name", "backend", "max-depth", "breadth", "max-nodes", "max-llm-calls", "concurrency", "truths", "jumps", "action-paths", "vote", "retries", "dedup-threshold", "temperature", "memory"],
        boolean: ["mock", "falsify", "no-reeval", "no-agentic", "no-dedup", "training", "help", "quiet", "no-vault"],
        alias: { h: "help", m: "mock", t: "training", q: "quiet" },
    });

    // ---- resolve the IDEA ---------------------------------------------------
    let idea = (args._.length ? args._.map(String).join(" ") : "").trim();
    if (!idea && !args.help && !Deno.stdin.isTerminal()) idea = (await new Response(Deno.stdin.readable).text()).trim();
    const backend = (args.backend as string) || (args.mock ? "mock" : "gemini");
    if (!idea && backend === "mock") idea = "Intelligence can be automated by widening context and mapping chain reactions.";

    if (args.help || !idea) {
        console.log(`
run.ts — single-command pipeline: idea + context → reasoning map + Obsidian vault

Usage:
  deno run -A run.ts "Your idea here" [options]
  echo "Your idea" | deno run -A run.ts [options]

Outputs everything to  runs/<name>/
  map.json         structured reasoning map
  execution.log    verbose trace of every step
  vault/           Obsidian vault → open in Obsidian, start at _Index.md

Input:
  First positional arg (or stdin)   The idea/thesis to map

Key options:
      --context <text|path>   Background facts (inline text or a .txt/.md file)
                              Each sentence/bullet becomes a seed truth.
      --name <slug>           Run name (default: derived from the idea)
      --backend <name>        gemini | openai | ollama | mock  (default gemini)
  -m, --mock                  Offline deterministic mock (no browser, no network)
      --falsify               "no-but" red-team on every solution
      --vote <n>              Self-consistency votes on the validity gate
  -d, --max-depth <n>         Recursion depth            (default 2)
  -b, --breadth <n>           Fan width                  (default 3)
      --memory <file>         Cross-run memory (load truths at start, save at end)
      --training              Export the vault in training mode (hide conclusions)
      --no-vault              Skip the Obsidian vault export
  -q, --quiet                 Less terminal output
  -h, --help                  Show this help

Examples:
  # Offline / offline mock — no browser needed
  deno run -A run.ts "UBI increases entrepreneurship" --mock

  # Real Gemini run with inline context
  deno run -A run.ts "Time is the exhaust of the sorting process" \\
    --context "Second law of thermodynamics: entropy increases in isolated systems. \\
               Boltzmann showed macrostates emerge from microstates by counting. \\
               Irreversibility is defined by entropy gradient, not by energy loss."

  # Context from a file + all quality flags
  deno run -A run.ts "My thesis" --context ./context.txt \\
    --falsify --vote 3 --max-depth 3 --breadth 3 --memory memory.json
`);
        Deno.exit(idea ? 0 : 1);
    }

    // ---- derive run name ----------------------------------------------------
    const rawName = (args.name as string) || idea.replace(/[^a-zA-Z0-9 ]/g, "").trim().split(/\s+/).slice(0, 6).join("-").toLowerCase() || "run";
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
    const runName = `${rawName}-${stamp}`;
    const runDir = `runs/${runName}`;
    const mapPath = `${runDir}/map.json`;
    const vaultDir = `${runDir}/vault`;

    // ---- resolve context path -----------------------------------------------
    let contextArg: string[] = [];
    if (args.context) {
        const ctx = args.context as string;
        contextArg = ["--context", await isFile(ctx) ? ctx : ctx];
    }

    // ---- build engine command -----------------------------------------------
    const engineArgs: string[] = ["run", "-A", "selfIntelligence.ts", idea, "--out", mapPath];
    if (args.mock) engineArgs.push("--mock");
    if (args.backend) engineArgs.push("--backend", args.backend as string);
    if (contextArg.length) engineArgs.push(...contextArg);
    if (args.falsify) engineArgs.push("--falsify");
    if (args["max-depth"]) engineArgs.push("--max-depth", args["max-depth"] as string);
    if (args["breadth"]) engineArgs.push("--breadth", args["breadth"] as string);
    if (args["max-nodes"]) engineArgs.push("--max-nodes", args["max-nodes"] as string);
    if (args["max-llm-calls"]) engineArgs.push("--max-llm-calls", args["max-llm-calls"] as string);
    if (args.concurrency) engineArgs.push("--concurrency", args["concurrency"] as string);
    if (args.truths) engineArgs.push("--truths", args["truths"] as string);
    if (args.jumps) engineArgs.push("--jumps", args["jumps"] as string);
    if (args["action-paths"]) engineArgs.push("--action-paths", args["action-paths"] as string);
    if (args.vote) engineArgs.push("--vote", args["vote"] as string);
    if (args.retries) engineArgs.push("--retries", args["retries"] as string);
    if (args["dedup-threshold"]) engineArgs.push("--dedup-threshold", args["dedup-threshold"] as string);
    if (args.temperature) engineArgs.push("--temperature", args["temperature"] as string);
    if (args.memory) engineArgs.push("--memory", args["memory"] as string);
    if (args["no-reeval"]) engineArgs.push("--no-reeval");
    if (args["no-agentic"]) engineArgs.push("--no-agentic");
    if (args["no-dedup"]) engineArgs.push("--no-dedup");
    if (args.quiet) engineArgs.push("--quiet");

    // ---- banner -------------------------------------------------------------
    await Deno.mkdir(runDir, { recursive: true });
    console.log(`\n🧠 Self-Intelligence Run`);
    console.log(`   idea   : ${idea}`);
    console.log(`   dir    : ${runDir}`);
    console.log(`   backend: ${backend}`);

    // ---- 1. Engine ----------------------------------------------------------
    const engineOk = await run(engineArgs, "🔬 Engine — reasoning map");
    if (!engineOk) { console.error("Run aborted: engine failed."); Deno.exit(1); }

    // ---- rename the auto-written .log alongside the JSON to execution.log ---
    const autoLog = mapPath.replace(/\.json$/i, ".log");
    const execLog = `${runDir}/execution.log`;
    try {
        if (await isFile(autoLog)) await Deno.rename(autoLog, execLog);
    } catch { /* best-effort */ }

    // ---- 2. Obsidian export -------------------------------------------------
    if (!args["no-vault"]) {
        const vaultArgs = ["run", "-A", "mapToObsidian.ts", mapPath, "--out", vaultDir];
        if (args.training) vaultArgs.push("--training");
        await run(vaultArgs, `📓 Export — Obsidian vault${args.training ? " (training mode)" : ""}`);
    }

    // ---- 3. Summary ---------------------------------------------------------
    console.log(`
${"═".repeat(60)}
✅  Run complete: ${runDir}/

  📄 map.json       — structured reasoning map
  📋 execution.log  — full step-by-step trace
  📓 vault/         — open as Obsidian vault → start at _Index.md

Tip: run this to compare with a previous run:
  deno run -A diffMaps.ts <old-dir>/map.json ${mapPath}
${"═".repeat(60)}`);
}
