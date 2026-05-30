/// <reference lib="deno.ns" />
// ============================================================================
// SELF-INTELLIGENCE — Recursive "map of cavilations" engine (enhanced)
// ----------------------------------------------------------------------------
// Pipeline for an IDEA:
//   1. Gather extrinsic/proven TRUTHS (with evidence + confidence) -> context.
//   2. Generate a fan of scored CHALLENGE points (severity x likelihood).
//   3. Gate each challenge by LOGICAL VALIDITY (self-consistency vote) BEFORE
//      it may spawn nodes.
//   4. Expand valid challenges with a chain of WHYS.
//   5. Resolve whys with competing first-principles SOLUTIONS (feasibility x
//      impact), optionally red-teamed by a "no-but" FALSIFICATION pass.
//   6. New findings are reconciled AGENTICALLY against present context
//      (create/update/delete/skip) -> CRUD w/ soft-delete + snapshot chain.
//   7. Re-evaluate earlier challenges as context grows.
//   8. Recurse BEST-FIRST; stop a branch on information-gain collapse; dedup
//      semantically (tree -> DAG via crossLinks).
//   9. Gather cross-domain JUMPS (+ vices).
//  10. FINAL YIELD: synthesize ranked ALTERNATIVE ACTION PATHS (with kill-
//      criteria / pre-mortem) + a recommended path via confidence propagation.
//
// Backends (swappable via LLMClient): GeminiClient (free scraper), OpenAIClient
// (OpenAI/Ollama/any OpenAI-compatible), MockLLMClient (deterministic, no net).
// Extras: prompt cache, JSON-schema validation + repair-retry, cross-run memory,
// incremental checkpointing.
// ============================================================================

import { callLLM, resetChat, closeBrowser } from "./scraperLLM.ts";
import { parse } from "https://deno.land/std@0.167.0/flags/mod.ts";

// ============================================================================
// TYPES
// ============================================================================

export type NodeType = "idea" | "challenge" | "why" | "solution";

export interface MapNode {
    id: string;
    type: NodeType;
    content: string;
    parentId: string | null;
    children: string[];
    depth: number;
    cycle: number;
    // challenge:
    valid?: boolean;
    validityReason?: string;
    validityConfidence?: number;
    severity?: number; // 0..1 how damaging if true
    likelihood?: number; // 0..1 how likely valid
    rationale?: string;
    // solution:
    firstPrinciples?: string;
    feasibility?: number; // 0..1
    impact?: number; // 0..1
    falsification?: { counter: string; survives: boolean; reason: string };
    weak?: boolean; // failed falsification
    defenseScore?: number; // propagated confidence along lineage
    // shared:
    score?: number; // expansion priority
    resolved?: boolean;
    invalidatedByContext?: boolean;
    crossLinks?: string[]; // semantically-equivalent existing nodes (DAG edges)
    duplicate?: boolean; // a near-duplicate; not expanded
    snapshotAtCreation: number;
    visible: boolean;
    softDeleted: boolean;
    derivedTruthIds?: string[];
}

export interface Truth {
    id: string;
    statement: string;
    source: string;
    evidence?: string; // supporting quote / justification
    confidence?: number; // 0..1 grounding confidence
    derivedFrom: string[];
    snapshot: number;
    deleted: boolean;
    visible: boolean;
}

export interface Snapshot {
    index: number;
    timestamp: string;
    reason: string;
    truths: { id: string; visible: boolean; deleted: boolean }[];
}

export interface CrossDomainJump {
    domain: string;
    analogy: string;
    insight: string;
    vice: string;
}

export interface ReconcileOp {
    op: "create" | "update" | "delete" | "skip";
    statement?: string;
    source?: string;
    evidence?: string;
    confidence?: number;
    targetId?: string;
    reason?: string;
}

export interface ActionPath {
    id: string;
    title: string;
    summary: string;
    steps: string[];
    addresses?: string[];
    tradeoffs?: string;
    risks?: string;
    killCriteria?: string[]; // pre-mortem: what would prove this path wrong
    whenToPrefer?: string;
    supportingTruthIds?: string[];
    sourceNodeIds?: string[];
    defenseScore?: number; // propagated confidence
    recommended?: boolean;
}

export interface IntelligenceMap {
    mainIdea: string;
    createdAt: string;
    backend?: string;
    options: RunOptions;
    rootId: string;
    nodes: MapNode[];
    truths: Truth[];
    snapshots: Snapshot[];
    crossDomainJumps: CrossDomainJump[];
    actionPaths: ActionPath[];
    recommendedPathId?: string;
    stats: {
        nodes: number;
        truths: number;
        snapshots: number;
        llmCalls: number;
        cacheHits: number;
        durationMs: number;
        reevaluatedChallenges: number;
        invalidatedByContext: number;
        duplicatesLinked: number;
        falsified: number;
        agentic: { created: number; updated: number; deleted: number; skipped: number };
    };
}

export interface RunOptions {
    maxDepth: number;
    breadth: number;
    maxNodes: number;
    maxLLMCalls: number;
    concurrency: number;
    truthCount: number;
    jumpCount: number;
    pathCount: number;
    voteSamples: number; // self-consistency on the validity gate
    retries: number; // JSON validation repair retries
    dedupThreshold: number; // 0..1 Jaccard; >=1 disables
    reevaluate: boolean;
    agentic: boolean;
    falsify: boolean; // "no-but" red-team on solutions
    verbose: boolean;
    cachePath?: string; // disk cache dir
    checkpointPath?: string; // incremental map dump
    logPath?: string; // write verbose execution log here (auto: <outPath>.log)
    seedTruths?: { statement: string; source?: string; evidence?: string; confidence?: number }[];
}

export const DEFAULT_OPTIONS: RunOptions = {
    maxDepth: 2,
    breadth: 3,
    maxNodes: 80,
    maxLLMCalls: 300,
    concurrency: 1,
    truthCount: 6,
    jumpCount: 4,
    pathCount: 4,
    voteSamples: 1,
    retries: 1,
    dedupThreshold: 0.85,
    reevaluate: true,
    agentic: true,
    falsify: false,
    verbose: true,
};

// ============================================================================
// LLM CLIENTS
// ============================================================================

export interface LLMClient {
    complete(prompt: string): Promise<string>;
    close(): Promise<void>;
    name?: string;
}

/** Free Gemini scraper. Single global browser => calls serialized via a queue. */
export class GeminiClient implements LLMClient {
    name = "gemini";
    #queue: Promise<unknown> = Promise.resolve();
    #stateless: boolean;
    constructor(opts?: { stateless?: boolean }) {
        this.#stateless = opts?.stateless ?? true;
    }
    complete(prompt: string): Promise<string> {
        const run = this.#queue.then(async () => {
            if (this.#stateless) await resetChat();
            const res = await callLLM(prompt);
            return typeof res === "string" ? res : JSON.stringify(res);
        });
        this.#queue = run.then(() => {}, () => {});
        return run;
    }
    async close(): Promise<void> {
        await closeBrowser();
    }
}

/** OpenAI-compatible client (OpenAI, Ollama via /v1, vLLM, etc.). */
export class OpenAIClient implements LLMClient {
    name: string;
    #url: string;
    #key: string;
    #model: string;
    #temperature: number;
    constructor(opts?: { baseUrl?: string; apiKey?: string; model?: string; temperature?: number; name?: string }) {
        this.#url = (opts?.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
        this.#key = opts?.apiKey ?? "";
        this.#model = opts?.model ?? "gpt-4o-mini";
        this.#temperature = opts?.temperature ?? 0.4;
        this.name = opts?.name ?? "openai";
    }
    async complete(prompt: string): Promise<string> {
        const res = await fetch(`${this.#url}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(this.#key ? { Authorization: `Bearer ${this.#key}` } : {}) },
            body: JSON.stringify({ model: this.#model, temperature: this.#temperature, messages: [{ role: "user", content: prompt }] }),
        });
        if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const j = await res.json();
        return j?.choices?.[0]?.message?.content ?? "";
    }
    close(): Promise<void> {
        return Promise.resolve();
    }
}

/** Deterministic mock; exercises the whole pipeline with no network. */
export class MockLLMClient implements LLMClient {
    name = "mock";
    #counter = 0;
    #reconcileCalls = 0;
    async complete(prompt: string): Promise<string> {
        await new Promise((r) => setTimeout(r, 30 + Math.floor(Math.random() * 30)));
        const cycle = Number(prompt.match(/Recursion cycle:\s*(\d+)/)?.[1] ?? 0);
        return "```json\n" + JSON.stringify(this.#decide(prompt, cycle), null, 2) + "\n```";
    }
    close(): Promise<void> {
        return Promise.resolve();
    }
    #decide(prompt: string, cycle: number): unknown {
        if (/extrinsic, proven|proven truths|broadly-accepted truths/i.test(prompt)) {
            return {
                truths: [
                    { statement: "Established principle relevant to the idea.", source: "mock/textbook", evidence: "Standard result in the field.", confidence: 0.9 },
                    { statement: "Empirical finding that constrains the idea.", source: "mock/study", evidence: "Replicated meta-analysis.", confidence: 0.75 },
                    { statement: "Operational definition framing the terms.", source: "mock/encyclopedia", evidence: "Consensus definition.", confidence: 0.95 },
                ],
            };
        }
        if (/logical validity/i.test(prompt)) {
            const valid = (this.#counter++ % 3) !== 0;
            return { valid, reason: valid ? "Sound: targets a load-bearing assumption without fallacy." : "Invalid: strawman; contests a claim not made.", confidence: valid ? 0.82 : 0.41 };
        }
        if (/challenge points/i.test(prompt)) {
            const n = Math.max(0, 2 - cycle);
            const themes = ["measurement", "incentive", "scaling", "ethics", "feedback", "latency", "adversarial", "sampling", "fairness", "governance"];
            return {
                challenges: Array.from({ length: n }, (_, i) => {
                    const a = themes[(cycle * 3 + i) % themes.length];
                    const b = themes[(cycle * 3 + i + 4) % themes.length];
                    return {
                        statement: `The ${a} assumption collapses whenever ${b} pressure dominates the operating regime.`,
                        rationale: `Under heavy ${a}, the ${b} effect breaks the claimed applicability.`,
                        severity: 0.85 - i * 0.18,
                        likelihood: 0.7 - i * 0.12,
                    };
                }),
            };
        }
        if (/chain of whys|list of why questions/i.test(prompt)) {
            const m = prompt.match(/The (\w+) assumption collapses whenever (\w+)/i);
            const a = m?.[1] ?? "core", b = m?.[2] ?? "edge";
            return { whys: [{ question: `Why is the ${a} assumption treated as holding a priori?` }, { question: `Why would ${b} not dominate once the system scales?` }] };
        }
        if (/strongest counter|red-team|falsif/i.test(prompt)) {
            const k = this.#counter++;
            const survives = k % 2 === 0;
            return { counter: "Strongest counter: the proposed fix may not hold under adversarial inputs.", survives, reason: survives ? "Counter is addressed by the invariant." : "Counter defeats the solution as stated." };
        }
        if (/reconcile/i.test(prompt)) {
            const ids = [...prompt.matchAll(/\((t\d+)\)/g)].map((m) => m[1]);
            const finding = "Derived truth: scope-restriction preserves the core invariant.";
            const k = this.#reconcileCalls++;
            let op: Record<string, unknown>;
            if (ids.length === 0) op = { op: "create", statement: finding, source: "derived", evidence: "Follows from the invariant.", confidence: 0.7, reason: "novel" };
            else if (k === 0) op = { op: "update", targetId: ids[0], statement: finding + " (refined v2)", source: "derived", evidence: "Sharper version.", confidence: 0.75, reason: "refines existing truth" };
            else if (k === 1) op = { op: "delete", targetId: ids[ids.length - 1], reason: "obsoletes a superseded truth" };
            else op = { op: "skip", targetId: ids[0], reason: "duplicate; already entailed" };
            return { operations: [op] };
        }
        if (/competing|opposing solutions/i.test(prompt)) {
            return {
                solutions: [
                    { statement: "Solution X: restrict scope so the invariant is restored.", firstPrinciples: "Conservation of the core invariant.", feasibility: 0.8, impact: 0.7, newTruths: [{ statement: "Derived truth: scope-restriction preserves the core invariant.", source: "derived", evidence: "Direct corollary.", confidence: 0.7 }] },
                    { statement: "Solution Y: reject the premise; the challenge dissolves under measurement.", firstPrinciples: "Operationalize the variable.", feasibility: 0.5, impact: 0.6, newTruths: [] },
                ],
            };
        }
        if (/alternative paths of action|final synthesis/i.test(prompt)) {
            const nodeIds = [...new Set([...prompt.matchAll(/\b(n\d+)\b/g)].map((m) => m[1]))].slice(0, 3);
            const truthIds = [...new Set([...prompt.matchAll(/\b(t\d+)\b/g)].map((m) => m[1]))].slice(0, 2);
            return {
                paths: [
                    { title: "Path A — Narrow-scope pilot", summary: "Restrict scope to where the invariant provably holds, ship a pilot, then widen.", steps: ["Define invariant + success metric", "Constrain scope to safe regime", "Ship minimal pilot", "Instrument and measure", "Widen only where invariant holds"], addresses: ["boundary-condition challenges"], tradeoffs: "Slower coverage; lower blast radius.", risks: "Premature generalization.", killCriteria: ["Pilot metric flat after 2 cycles", "Invariant violated outside regime"], whenToPrefer: "When downside risk is high.", supportingTruthIds: truthIds, sourceNodeIds: nodeIds },
                    { title: "Path B — Measurement-first reframing", summary: "Operationalize the contested variable; let measurement select the route.", steps: ["Operationalize the variable", "Build measurement harness", "Run approaches as A/B", "Adopt route the data favors"], addresses: ["unfalsifiable-premise challenges"], tradeoffs: "Upfront instrumentation cost.", risks: "Goodhart on the proxy metric.", killCriteria: ["No measurable difference between routes"], whenToPrefer: "When the disagreement is empirical.", supportingTruthIds: truthIds, sourceNodeIds: nodeIds },
                ],
            };
        }
        if (/cross-domain/i.test(prompt)) {
            return {
                jumps: [
                    { domain: "thermodynamics", analogy: "idea-spread as entropy", insight: "adoption homogenizes variance", vice: "ignores agency; overpredicts equilibrium" },
                    { domain: "evolutionary biology", analogy: "ideas as replicators", insight: "selection favors transmissible simplifications", vice: "fitness ≠ truth" },
                ],
            };
        }
        return { note: "unrecognized prompt" };
    }
}

// ============================================================================
// JSON EXTRACTION + small utils
// ============================================================================

function findBalancedObject(text: string): string | null {
    const start = text.indexOf("{");
    if (start === -1) return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
            if (esc) esc = false;
            else if (ch === "\\") esc = true;
            else if (ch === '"') inStr = false;
        } else {
            if (ch === '"') inStr = true;
            else if (ch === "{") depth++;
            else if (ch === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
        }
    }
    return null;
}

function extractJsonObject(text: string): string | null {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) { const obj = findBalancedObject(fence[1]); if (obj) return obj; }
    const dash = text.match(/---\s*([\s\S]*?)\s*---/);
    if (dash) { const obj = findBalancedObject(dash[1]); if (obj) return obj; }
    return findBalancedObject(text);
}

function parseJsonLoose<T>(raw: string): T {
    const js = extractJsonObject(raw);
    if (!js) throw new Error("No JSON object found in LLM response: " + raw.slice(0, 200));
    try { return JSON.parse(js) as T; } catch { return JSON.parse(js.replace(/,\s*([}\]])/g, "$1")) as T; }
}

function hashStr(s: string): string {
    let h = 5381;
    for (let i = 0; i < s.length; i++) { h = ((h << 5) + h) ^ s.charCodeAt(i); h |= 0; }
    return (h >>> 0).toString(16);
}

function tokenize(s: string): Set<string> {
    return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    return inter / (a.size + b.size - inter);
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
    if (limit <= 1) { const out: R[] = []; for (let i = 0; i < items.length; i++) out.push(await fn(items[i], i)); return out; }
    const results: R[] = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) { const i = cursor++; if (i >= items.length) break; results[i] = await fn(items[i], i); }
    });
    await Promise.all(workers);
    return results;
}

const num01 = (v: unknown, d = 0.5): number => (typeof v === "number" && isFinite(v) ? Math.max(0, Math.min(1, v)) : d);

// ============================================================================
// REASONER
// ============================================================================

export class Reasoner {
    client: LLMClient;
    opts: RunOptions;
    map: IntelligenceMap;
    llmCalls = 0;
    cacheHits = 0;
    logBuffer: string[] = []; // every log line, regardless of verbose flag
    private idSeq = 0;
    private truthSeq = 0;
    private reevaluated = 0;
    private duplicatesLinked = 0;
    private falsified = 0;
    private agenticOps = { created: 0, updated: 0, deleted: 0, skipped: 0 };
    private memCache = new Map<string, string>();
    private seen: { id: string; type: NodeType; tokens: Set<string> }[] = [];

    constructor(client: LLMClient, opts: Partial<RunOptions> = {}) {
        this.client = client;
        this.opts = { ...DEFAULT_OPTIONS, ...opts };
        this.map = {
            mainIdea: "",
            createdAt: new Date().toISOString(),
            backend: client.name,
            options: this.opts,
            rootId: "",
            nodes: [],
            truths: [],
            snapshots: [],
            crossDomainJumps: [],
            actionPaths: [],
            stats: {
                nodes: 0, truths: 0, snapshots: 0, llmCalls: 0, cacheHits: 0, durationMs: 0,
                reevaluatedChallenges: 0, invalidatedByContext: 0, duplicatesLinked: 0, falsified: 0,
                agentic: { created: 0, updated: 0, deleted: 0, skipped: 0 },
            },
        };
    }

    // ---- LLM plumbing: cache + validation + repair-retry --------------------

    private async cachedComplete(prompt: string): Promise<string> {
        const key = hashStr(prompt);
        if (this.memCache.has(key)) { this.cacheHits++; return this.memCache.get(key)!; }
        if (this.opts.cachePath) {
            try {
                const disk = await Deno.readTextFile(`${this.opts.cachePath}/${key}.txt`);
                this.memCache.set(key, disk);
                this.cacheHits++;
                return disk;
            } catch { /* miss */ }
        }
        this.llmCalls++;
        const raw = await this.client.complete(prompt);
        this.memCache.set(key, raw);
        if (this.opts.cachePath) {
            try { await Deno.mkdir(this.opts.cachePath, { recursive: true }); await Deno.writeTextFile(`${this.opts.cachePath}/${key}.txt`, raw); } catch { /* ignore */ }
        }
        return raw;
    }

    private async llm<T>(instruction: string, schemaHint: string, cycle: number, label: string, depth: number, requiredKeys: string[] = [], sampleTag = ""): Promise<T> {
        const base = `${instruction}\nRecursion cycle: ${cycle}.${sampleTag}\nRespond with ONLY a single JSON object (no prose) inside a \`\`\`json fenced block, matching exactly this shape:\n${schemaHint}`;
        let prompt = base;
        for (let attempt = 0; attempt <= this.opts.retries; attempt++) {
            this.log(depth, `↳ [${label}]${attempt ? " retry" : ""}`);
            const raw = await this.cachedComplete(prompt);
            try {
                const obj = parseJsonLoose<Record<string, unknown>>(raw);
                const missing = requiredKeys.filter((k) => !(k in obj));
                if (missing.length && attempt < this.opts.retries) { prompt = base + `\nYour previous reply was missing required keys: ${missing.join(", ")}. Return a corrected, complete JSON object.`; continue; }
                return obj as T;
            } catch (e) {
                if (attempt < this.opts.retries) { prompt = base + `\nYour previous reply was not valid JSON. Return ONLY a single valid JSON object.`; continue; }
                throw e;
            }
        }
        throw new Error("unreachable");
    }

    private budgetExhausted(): boolean {
        return this.map.nodes.length >= this.opts.maxNodes || this.llmCalls >= this.opts.maxLLMCalls;
    }

    private log(depth: number, msg: string): void {
        const line = `${"  ".repeat(Math.max(0, depth))}${msg}`;
        this.logBuffer.push(line); // always capture, regardless of verbose
        if (this.opts.verbose) console.log(line);
    }

    // ---- bookkeeping --------------------------------------------------------

    private newNode(type: NodeType, content: string, parent: MapNode | null, cycle: number, extra: Partial<MapNode> = {}): MapNode {
        const node: MapNode = {
            id: `n${++this.idSeq}`, type, content, parentId: parent ? parent.id : null, children: [],
            depth: parent ? parent.depth + 1 : 0, cycle,
            snapshotAtCreation: Math.max(0, this.map.snapshots.length - 1), visible: true, softDeleted: false, ...extra,
        };
        this.map.nodes.push(node);
        if (parent) parent.children.push(node.id);
        return node;
    }

    /** Returns an existing node id if `content` is ~duplicate of a seen node of same type. */
    private findDuplicate(type: NodeType, content: string): string | null {
        if (this.opts.dedupThreshold >= 1) return null;
        const toks = tokenize(content);
        let best = 0, bestId: string | null = null;
        for (const s of this.seen) {
            if (s.type !== type) continue;
            const sim = jaccard(toks, s.tokens);
            if (sim > best) { best = sim; bestId = s.id; }
        }
        return best >= this.opts.dedupThreshold ? bestId : null;
    }

    private registerSeen(node: MapNode): void {
        this.seen.push({ id: node.id, type: node.type, tokens: tokenize(node.content) });
    }

    private contextString(): string {
        const visible = this.map.truths.filter((t) => t.visible && !t.deleted).slice(-25);
        if (visible.length === 0) return "(no established truths yet)";
        return visible.map((t) => `- (${t.id}) ${t.statement} [src: ${t.source}; conf ${t.confidence ?? "?"}]`).join("\n");
    }

    private snapshot(reason: string): void {
        this.map.snapshots.push({ index: this.map.snapshots.length, timestamp: new Date().toISOString(), reason, truths: this.map.truths.map((t) => ({ id: t.id, visible: t.visible, deleted: t.deleted })) });
    }

    private addTruth(t: { statement: string; source?: string; evidence?: string; confidence?: number }, derivedFrom: string[]): string {
        const id = `t${++this.truthSeq}`;
        this.map.truths.push({ id, statement: t.statement, source: t.source || "derived", evidence: t.evidence, confidence: num01(t.confidence, 0.6), derivedFrom, snapshot: this.map.snapshots.length, deleted: false, visible: true });
        return id;
    }

    private integrateTruths(newTruths: { statement: string; source?: string; evidence?: string; confidence?: number }[], retireIds: string[], reason: string, derivedFrom: string[]): string[] {
        let changed = false;
        for (const rid of retireIds || []) {
            const t = this.map.truths.find((x) => x.id === rid && !x.deleted);
            if (t) { t.deleted = true; t.visible = false; changed = true; this.log(2, `🗑️  soft-deleted ${t.id}`); }
        }
        const created: string[] = [];
        for (const nt of newTruths || []) {
            if (!nt || !nt.statement) continue;
            created.push(this.addTruth(nt, derivedFrom));
            changed = true;
            this.log(2, `➕ ${created[created.length - 1]}: ${nt.statement.slice(0, 60)}`);
        }
        if (changed) this.snapshot(reason);
        return created;
    }

    /** Agentic CRUD. Returns {affected ids, novel: created/updated/deleted happened}. */
    private async agenticIntegrate(findings: { statement: string; source?: string; evidence?: string; confidence?: number }[], producedBy: string): Promise<{ ids: string[]; novel: boolean }> {
        const valid = (findings || []).filter((f) => f && f.statement);
        if (valid.length === 0) return { ids: [], novel: false };
        const before = this.agenticOps.created + this.agenticOps.updated + this.agenticOps.deleted;
        const existing = this.map.truths.filter((t) => t.visible && !t.deleted);
        if (existing.length === 0) {
            const created = this.integrateTruths(valid, [], `agentic seed from ${producedBy}`, [producedBy]);
            this.agenticOps.created += created.length;
            return { ids: created, novel: created.length > 0 };
        }
        const ops = await this.reconcileFindings(valid, producedBy);
        const ids = this.applyReconcileOps(ops, valid, producedBy);
        const after = this.agenticOps.created + this.agenticOps.updated + this.agenticOps.deleted;
        return { ids, novel: after > before };
    }

    private async reconcileFindings(findings: { statement: string; source?: string }[], producedBy: string): Promise<ReconcileOp[]> {
        const list = findings.map((f, i) => `${i + 1}. ${f.statement}`).join("\n");
        const res = await this.llm<{ operations: ReconcileOp[] }>(
            `You maintain a knowledge base of demonstrated TRUTHS. New FINDINGS were produced (from ${producedBy}). RECONCILE each by cross-referencing the present context, choosing ONE op: "create" (new), "update" (refines an existing truth -> targetId + improved statement), "delete" (obsoletes one -> targetId), "skip" (duplicate -> targetId). Include evidence + confidence when creating/updating.\nFINDINGS:\n${list}\nPRESENT CONTEXT:\n${this.contextString()}`,
            `{ "operations": [ { "op": "create|update|delete|skip", "statement": "...", "source": "...", "evidence": "...", "confidence": 0.0, "targetId": "t1", "reason": "..." } ] }`,
            0, "reconcile-crud", 2, ["operations"],
        );
        return res.operations || [];
    }

    private applyReconcileOps(ops: ReconcileOp[], fallback: { statement: string; source?: string; evidence?: string; confidence?: number }[], producedBy: string): string[] {
        if (!ops.length) { const c = this.integrateTruths(fallback, [], `agentic create from ${producedBy}`, [producedBy]); this.agenticOps.created += c.length; return c; }
        let changed = false;
        const affected: string[] = [];
        const summary: string[] = [];
        for (const op of ops) {
            const kind = (op.op || "create").toLowerCase();
            const target = op.targetId ? this.map.truths.find((x) => x.id === op.targetId && !x.deleted) : undefined;
            if (kind === "skip") { this.agenticOps.skipped++; if (target) affected.push(target.id); summary.push(`skip→${op.targetId ?? "?"}`); this.log(2, `⏭️  skip (dup of ${op.targetId ?? "?"})`); continue; }
            if (kind === "delete") {
                if (target) { target.deleted = true; target.visible = false; changed = true; this.agenticOps.deleted++; summary.push(`delete ${target.id}`); this.log(2, `🗑️  delete ${target.id}`); }
                if (op.statement) { affected.push(this.addTruth({ statement: op.statement, source: op.source, evidence: op.evidence, confidence: op.confidence }, [producedBy, target?.id ?? ""].filter(Boolean))); changed = true; }
                continue;
            }
            if (kind === "update") {
                if (target) { target.deleted = true; target.visible = false; changed = true; }
                const id = this.addTruth({ statement: op.statement || fallback[0]?.statement || "", source: op.source, evidence: op.evidence, confidence: op.confidence }, [producedBy, target?.id ?? ""].filter(Boolean));
                affected.push(id); changed = true; this.agenticOps.updated++; summary.push(`update ${op.targetId ?? "?"}→${id}`); this.log(2, `✏️  update ${op.targetId ?? "?"} -> ${id}`);
                continue;
            }
            const id = this.addTruth({ statement: op.statement || fallback[0]?.statement || "", source: op.source, evidence: op.evidence, confidence: op.confidence }, [producedBy]);
            affected.push(id); changed = true; this.agenticOps.created++; summary.push(`create ${id}`); this.log(2, `➕ create ${id}`);
        }
        if (changed) this.snapshot(`agentic CRUD from ${producedBy}: ${summary.join(", ")}`);
        return affected;
    }

    // ---- generation ---------------------------------------------------------

    private async gatherGlobalContext(idea: string): Promise<void> {
        this.log(0, "🌍 Gathering grounded truths -> global context...");
        const res = await this.llm<{ truths: { statement: string; source?: string; evidence?: string; confidence?: number }[] }>(
            `List up to ${this.opts.truthCount} EXTRINSIC, PROVEN, broadly-accepted truths relevant to evaluating this IDEA. For EACH include a concrete "source", a one-line "evidence" justification, and a 0..1 "confidence". No opinions, no restating the idea.\nIDEA: """${idea}"""`,
            `{ "truths": [ { "statement": "...", "source": "...", "evidence": "...", "confidence": 0.0 } ] }`,
            0, "gather-truths", 0, ["truths"],
        );
        this.integrateTruths((res.truths || []).slice(0, this.opts.truthCount), [], "initial global context", []);
    }

    private async generateChallenges(node: MapNode, round: number): Promise<{ statement: string; rationale?: string; severity?: number; likelihood?: number }[]> {
        const res = await this.llm<{ challenges: { statement: string; rationale?: string; severity?: number; likelihood?: number }[] }>(
            `Generate a fan of CHALLENGE POINTS contesting the APPLICABILITY/validity of the STATEMENT from first principles (do not defend it). For each, rate "severity" (0..1 how damaging if true) and "likelihood" (0..1 how likely it is valid).\nSTATEMENT: """${node.content}"""\nGLOBAL CONTEXT:\n${this.contextString()}\nReturn up to ${this.opts.breadth} distinct challenges.`,
            `{ "challenges": [ { "statement": "...", "rationale": "...", "severity": 0.0, "likelihood": 0.0 } ] }`,
            round, "challenges", node.depth, ["challenges"],
        );
        return (res.challenges || []).slice(0, this.opts.breadth);
    }

    private async evaluateValidityOnce(challenge: MapNode, against: string, sampleTag: string): Promise<{ valid: boolean; reason: string; confidence: number }> {
        const res = await this.llm<{ valid: boolean; reason: string; confidence: number }>(
            `Evaluate the LOGICAL VALIDITY of the CHALLENGE against the STATEMENT given CONTEXT. Valid only if logically sound and non-fallacious (no strawman/begging-the-question/category error) and not already defeated by context.\nSTATEMENT: """${against}"""\nCHALLENGE: """${challenge.content}"""\nGLOBAL CONTEXT:\n${this.contextString()}`,
            `{ "valid": true, "reason": "...", "confidence": 0.0 }`,
            challenge.cycle, "validity-gate", challenge.depth, ["valid"], sampleTag,
        );
        return { valid: !!res.valid, reason: res.reason || "", confidence: num01(res.confidence, 0) };
    }

    /** Self-consistency: sample N times, majority vote, mean confidence. */
    private async evaluateValidity(challenge: MapNode, against: string): Promise<{ valid: boolean; reason: string; confidence: number }> {
        const n = Math.max(1, this.opts.voteSamples);
        const samples = await mapLimited(Array.from({ length: n }, (_, i) => i), this.opts.concurrency, (i) => this.evaluateValidityOnce(challenge, against, n > 1 ? `\n(independent sample ${i + 1})` : ""));
        const yes = samples.filter((s) => s.valid);
        const valid = yes.length * 2 >= n; // majority (ties -> valid)
        const pool = (valid ? yes : samples.filter((s) => !s.valid));
        const confidence = pool.reduce((a, s) => a + s.confidence, 0) / Math.max(1, pool.length);
        return { valid, reason: (pool[0]?.reason) || samples[0]?.reason || "", confidence };
    }

    private async generateWhys(challenge: MapNode): Promise<{ question: string }[]> {
        const res = await this.llm<{ whys: { question: string }[] }>(
            `For the VALID CHALLENGE, produce a CHAIN OF WHYS probing WHY it is claimed valid (do not defend it). Each "why" should expose a load-bearing assumption.\nCHALLENGE: """${challenge.content}"""\nGLOBAL CONTEXT:\n${this.contextString()}\nReturn up to ${this.opts.breadth} why questions.`,
            `{ "whys": [ { "question": "..." } ] }`,
            challenge.cycle, "whys", challenge.depth, ["whys"],
        );
        return (res.whys || []).slice(0, this.opts.breadth);
    }

    private async generateSolutions(why: MapNode): Promise<{ statement: string; firstPrinciples?: string; feasibility?: number; impact?: number; newTruths?: { statement: string; source?: string; evidence?: string; confidence?: number }[] }[]> {
        const res = await this.llm<{ solutions: { statement: string; firstPrinciples?: string; feasibility?: number; impact?: number; newTruths?: { statement: string; source?: string; evidence?: string; confidence?: number }[] }[] }>(
            `For the WHY, generate COMPETING / OPPOSING SOLUTIONS from FIRST PRINCIPLES. For each rate "feasibility" (0..1) and "impact" (0..1). If a solution establishes a new demonstrated truth, include it in "newTruths" with source/evidence/confidence.\nWHY: """${why.content}"""\nGLOBAL CONTEXT:\n${this.contextString()}\nReturn up to ${this.opts.breadth} competing solutions.`,
            `{ "solutions": [ { "statement": "...", "firstPrinciples": "...", "feasibility": 0.0, "impact": 0.0, "newTruths": [ { "statement": "...", "source": "...", "evidence": "...", "confidence": 0.0 } ] } ] }`,
            why.cycle, "solutions", why.depth, ["solutions"],
        );
        return (res.solutions || []).slice(0, this.opts.breadth);
    }

    private async falsifySolution(sn: MapNode): Promise<void> {
        const res = await this.llm<{ counter: string; survives: boolean; reason: string }>(
            `Red-team the SOLUTION with a "no, but" pass: state the STRONGEST COUNTER and decide whether the solution SURVIVES it given context.\nSOLUTION: """${sn.content}"""\nFIRST PRINCIPLES: ${sn.firstPrinciples ?? "(none)"}\nGLOBAL CONTEXT:\n${this.contextString()}`,
            `{ "counter": "...", "survives": true, "reason": "..." }`,
            sn.cycle, "falsify", sn.depth, ["survives"],
        );
        sn.falsification = { counter: res.counter || "", survives: !!res.survives, reason: res.reason || "" };
        this.falsified++;
        if (!res.survives) { sn.weak = true; this.log(sn.depth, `   🧪 ${sn.id} fails falsification (weak): ${res.reason?.slice(0, 60)}`); }
    }

    private async gatherCrossDomainJumps(idea: string): Promise<CrossDomainJump[]> {
        this.log(0, "🧭 Gathering cross-domain jumps (+ vices)...");
        const res = await this.llm<{ jumps: CrossDomainJump[] }>(
            `Identify GENIUS CROSS-DOMAIN JUMPS for the IDEA: analogies from unrelated domains unlocking non-obvious insight. For EACH name its VICE (where the analogy breaks).\nIDEA: """${idea}"""\nGLOBAL CONTEXT:\n${this.contextString()}\nReturn up to ${this.opts.jumpCount} jumps.`,
            `{ "jumps": [ { "domain": "...", "analogy": "...", "insight": "...", "vice": "..." } ] }`,
            0, "cross-domain", 0, ["jumps"],
        );
        return (res.jumps || []).slice(0, this.opts.jumpCount);
    }

    private survivingSolutionLineages(max = 30): string {
        const byId = new Map(this.map.nodes.map((n) => [n.id, n]));
        const sols = this.map.nodes.filter((n) => n.type === "solution" && n.visible && !n.softDeleted && !n.weak && !n.duplicate);
        const lines: string[] = [];
        for (const s of sols.slice(0, max)) {
            const chain: string[] = [];
            let cur: MapNode | undefined = s;
            while (cur) { chain.unshift(`${cur.id}[${cur.type}] ${cur.content}`); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
            lines.push(`- (defense ${s.defenseScore?.toFixed(2) ?? "?"}) ${chain.join("  →  ")}`);
        }
        return lines.length ? lines.join("\n") : "(no surviving solution lineages)";
    }

    /** Propagate validity confidence down each lineage onto solution nodes. */
    private computeDefenseScores(): void {
        const byId = new Map(this.map.nodes.map((n) => [n.id, n]));
        for (const s of this.map.nodes) {
            if (s.type !== "solution") continue;
            const confs: number[] = [];
            let cur: MapNode | undefined = s;
            while (cur) { if (cur.type === "challenge" && typeof cur.validityConfidence === "number") confs.push(cur.validityConfidence); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
            const base = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0.5;
            const fis = ((s.feasibility ?? 0.5) + (s.impact ?? 0.5)) / 2;
            s.defenseScore = Math.round((0.6 * base + 0.4 * fis) * 100) / 100;
        }
    }

    private async synthesizeActionPaths(idea: string): Promise<ActionPath[]> {
        this.log(0, "🧩 Synthesizing alternative action paths (final yield)...");
        const jumps = this.map.crossDomainJumps.map((j) => `- [${j.domain}] ${j.insight} (vice: ${j.vice})`).join("\n") || "(none)";
        const res = await this.llm<{ paths: ActionPath[] }>(
            `FINAL synthesis. From the PROPOSED IDEA, the surviving SOLUTION LINEAGES (root→challenge→why→solution, with a defense score), the CONTEXT, and CROSS-DOMAIN jumps, distill the distinct ALTERNATIVE PATHS OF ACTION toward realizing the idea. Each path = ordered CONCRETE actions. Make routes genuinely different (include counter-intuitive ones the map supports). For each: which challenges it "addresses", "tradeoffs", "risks", a pre-mortem "killCriteria" (what would prove it wrong), "whenToPrefer", "supportingTruthIds", and "sourceNodeIds".\nPROPOSED IDEA: """${idea}"""\nSURVIVING SOLUTION LINEAGES:\n${this.survivingSolutionLineages()}\nESTABLISHED CONTEXT:\n${this.contextString()}\nCROSS-DOMAIN JUMPS:\n${jumps}\nReturn up to ${this.opts.pathCount} action paths, best-first.`,
            `{ "paths": [ { "title": "...", "summary": "...", "steps": ["..."], "addresses": ["..."], "tradeoffs": "...", "risks": "...", "killCriteria": ["..."], "whenToPrefer": "...", "supportingTruthIds": ["t1"], "sourceNodeIds": ["n5"] } ] }`,
            0, "action-paths", 0, ["paths"],
        );
        const byId = new Map(this.map.nodes.map((n) => [n.id, n]));
        const paths: ActionPath[] = (res.paths || []).slice(0, this.opts.pathCount).map((p, i) => {
            const src = (p.sourceNodeIds || []).map((id) => byId.get(id)).filter(Boolean) as MapNode[];
            const defenses = src.map((n) => n.defenseScore).filter((x): x is number => typeof x === "number");
            const defenseScore = defenses.length ? Math.round((defenses.reduce((a, b) => a + b, 0) / defenses.length) * 100) / 100 : 0.5;
            return {
                id: `p${i + 1}`, title: p.title || `Path ${i + 1}`, summary: p.summary || "",
                steps: Array.isArray(p.steps) ? p.steps : [], addresses: p.addresses, tradeoffs: p.tradeoffs, risks: p.risks,
                killCriteria: p.killCriteria, whenToPrefer: p.whenToPrefer, supportingTruthIds: p.supportingTruthIds, sourceNodeIds: p.sourceNodeIds, defenseScore,
            };
        });
        if (paths.length) {
            const best = paths.reduce((a, b) => ((b.defenseScore ?? 0) > (a.defenseScore ?? 0) ? b : a));
            best.recommended = true;
            this.map.recommendedPathId = best.id;
        }
        for (const p of paths) this.log(0, `   🧭 ${p.id}: ${p.title} (${p.steps.length} steps, defense ${p.defenseScore})${p.recommended ? " ⭐" : ""}`);
        return paths;
    }

    // ---- checkpoint ---------------------------------------------------------

    private async checkpoint(): Promise<void> {
        if (!this.opts.checkpointPath) return;
        try {
            this.refreshStats(0);
            await Deno.writeTextFile(this.opts.checkpointPath, JSON.stringify(this.map, null, 2));
        } catch { /* best-effort */ }
    }

    private refreshStats(startedMs: number): void {
        this.map.stats = {
            nodes: this.map.nodes.length, truths: this.map.truths.length, snapshots: this.map.snapshots.length,
            llmCalls: this.llmCalls, cacheHits: this.cacheHits, durationMs: startedMs ? Date.now() - startedMs : this.map.stats.durationMs,
            reevaluatedChallenges: this.reevaluated, invalidatedByContext: this.map.nodes.filter((n) => n.invalidatedByContext).length,
            duplicatesLinked: this.duplicatesLinked, falsified: this.falsified, agentic: { ...this.agenticOps },
        };
    }

    // ---- orchestration ------------------------------------------------------

    async run(idea: string): Promise<IntelligenceMap> {
        const started = Date.now();
        this.map.mainIdea = idea;
        this.log(0, `\n🧠 SELF-INTELLIGENCE [${this.client.name ?? "?"}]\n   idea: ${idea}\n   depth=${this.opts.maxDepth} breadth=${this.opts.breadth} vote=${this.opts.voteSamples} dedup=${this.opts.dedupThreshold} falsify=${this.opts.falsify} concurrency=${this.opts.concurrency}\n`);

        if (this.opts.seedTruths?.length) {
            this.integrateTruths(this.opts.seedTruths, [], `loaded ${this.opts.seedTruths.length} truths from memory`, []);
            this.log(0, `🧠 seeded ${this.opts.seedTruths.length} truths from memory`);
        }

        await this.gatherGlobalContext(idea);

        const root = this.newNode("idea", idea, null, 0, { score: Infinity });
        this.map.rootId = root.id;
        this.registerSeen(root);

        const frontier: MapNode[] = [root];
        while (frontier.length > 0) {
            if (this.budgetExhausted()) { this.log(0, "⛔ budget exhausted."); break; }
            // best-first: highest score node next
            frontier.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
            const node = frontier.shift()!;
            const round = node.type === "idea" ? node.cycle : node.cycle + 1;
            if (round > this.opts.maxDepth) continue;

            this.log(node.depth, `\n🔎 Challenging ${node.type} ${node.id} (round ${round}, score ${node.score === Infinity ? "∞" : (node.score ?? 0).toFixed(2)}): ${node.content.slice(0, 70)}`);
            const specs = await this.generateChallenges(node, round);
            if (this.budgetExhausted()) break;

            const challengeNodes: MapNode[] = [];
            for (const c of specs) {
                if (this.map.nodes.length >= this.opts.maxNodes) break;
                const dup = this.findDuplicate("challenge", c.statement);
                const severity = num01(c.severity, 0.5), likelihood = num01(c.likelihood, 0.5);
                const cn = this.newNode("challenge", c.statement, node, round, { rationale: c.rationale, severity, likelihood, score: severity * likelihood });
                if (dup) { cn.duplicate = true; cn.crossLinks = [dup]; cn.resolved = true; this.duplicatesLinked++; this.log(cn.depth, `   ♊ ${cn.id} ~duplicate of ${dup} (cross-linked, not expanded)`); continue; }
                this.registerSeen(cn);
                challengeNodes.push(cn);
            }

            // GATE before expansion (self-consistency vote, parallel-capable)
            await mapLimited(challengeNodes, this.opts.concurrency, async (cn) => {
                const v = await this.evaluateValidity(cn, node.content);
                cn.valid = v.valid; cn.validityReason = v.reason; cn.validityConfidence = v.confidence;
                this.log(cn.depth, `   ${v.valid ? "✅ valid" : "❌ invalid"} ${cn.id} (conf ${v.confidence.toFixed(2)})`);
                if (!v.valid) cn.resolved = true;
            });

            const valid = challengeNodes.filter((c) => c.valid).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
            node.resolved = valid.length === 0;
            if (node.resolved) this.log(node.depth, `   🏁 ${node.id} resolved — no valid challenges.`);

            for (const cn of valid) {
                if (this.budgetExhausted()) break;
                const whys = await this.generateWhys(cn);
                for (const w of whys) {
                    if (this.map.nodes.length >= this.opts.maxNodes) break;
                    const wdup = this.findDuplicate("why", w.question);
                    const wn = this.newNode("why", w.question, cn, cn.cycle);
                    if (wdup) { wn.duplicate = true; wn.crossLinks = [wdup]; this.duplicatesLinked++; continue; }
                    this.registerSeen(wn);
                    if (this.budgetExhausted()) break;
                    const sols = await this.generateSolutions(wn);
                    for (const s of sols) {
                        if (this.map.nodes.length >= this.opts.maxNodes) break;
                        const sdup = this.findDuplicate("solution", s.statement);
                        const feasibility = num01(s.feasibility, 0.5), impact = num01(s.impact, 0.5);
                        const sn = this.newNode("solution", s.statement, wn, cn.cycle, { firstPrinciples: s.firstPrinciples, feasibility, impact, score: feasibility * impact });
                        if (sdup) { sn.duplicate = true; sn.crossLinks = [sdup]; this.duplicatesLinked++; this.log(sn.depth, `   ♊ ${sn.id} ~duplicate of ${sdup} (cross-linked)`); continue; }
                        this.registerSeen(sn);
                        const { ids, novel } = this.opts.agentic
                            ? await this.agenticIntegrate(s.newTruths || [], sn.id)
                            : { ids: this.integrateTruths(s.newTruths || [], [], `from ${sn.id}`, [sn.id]), novel: (s.newTruths || []).length > 0 };
                        if (ids.length) sn.derivedTruthIds = ids;
                        if (this.opts.falsify) await this.falsifySolution(sn);
                        // information-gain stopping + falsification: recurse only on
                        // novel, surviving solutions within depth budget.
                        if (novel && !sn.weak && sn.cycle + 1 <= this.opts.maxDepth) frontier.push(sn);
                        else if (!novel) this.log(sn.depth, `   📉 ${sn.id} low info-gain (no new truth) — not expanded.`);
                    }
                }
            }
            await this.checkpoint();
        }

        if (this.opts.reevaluate) await this.reevaluate();
        if (!this.budgetExhausted()) this.map.crossDomainJumps = await this.gatherCrossDomainJumps(idea);
        this.computeDefenseScores();
        this.map.actionPaths = await this.synthesizeActionPaths(idea);

        this.refreshStats(started);
        await this.checkpoint();
        this.log(0, `\n✅ done — ${this.map.stats.nodes} nodes, ${this.map.stats.truths} truths, ${this.map.stats.snapshots} snapshots, ${this.map.stats.llmCalls} calls (+${this.cacheHits} cache hits), ${this.duplicatesLinked} dups linked in ${this.map.stats.durationMs}ms`);
        return this.map;
    }

    private async reevaluate(): Promise<void> {
        const latest = this.map.snapshots.length - 1;
        const cands = this.map.nodes.filter((n) => n.type === "challenge" && n.valid === true && !n.invalidatedByContext && n.snapshotAtCreation < latest);
        if (!cands.length) return;
        this.log(0, `\n♻️  Re-evaluating ${cands.length} challenges vs updated context...`);
        for (const cn of cands) {
            if (this.llmCalls >= this.opts.maxLLMCalls) break;
            const parent = this.map.nodes.find((p) => p.id === cn.parentId);
            const v = await this.evaluateValidity(cn, parent ? parent.content : this.map.mainIdea);
            this.reevaluated++;
            if (!v.valid) { cn.valid = false; cn.resolved = true; cn.invalidatedByContext = true; cn.validityReason = `Invalidated by updated context: ${v.reason}`; this.softDeleteSubtree(cn); this.log(cn.depth, `   ❌ ${cn.id} invalidated — subtree hidden.`); }
        }
    }

    private softDeleteSubtree(root: MapNode): void {
        const stack = [...root.children];
        while (stack.length) {
            const id = stack.pop()!;
            const n = this.map.nodes.find((x) => x.id === id);
            if (!n) continue;
            n.softDeleted = true; n.visible = false; stack.push(...n.children);
        }
    }
}

// ============================================================================
// PUBLIC API
// ============================================================================

export async function runIntelligence(idea: string, opts: Partial<RunOptions> = {}, client?: LLMClient): Promise<IntelligenceMap> {
    const llm = client ?? new GeminiClient();
    const reasoner = new Reasoner(llm, opts);
    try { return await reasoner.run(idea); } finally { if (!client) await llm.close(); }
}

// ============================================================================
// CLI
// ============================================================================

function makeClient(backend: string, temperature: number): LLMClient {
    switch (backend) {
        case "mock": return new MockLLMClient();
        case "openai": return new OpenAIClient({ apiKey: Deno.env.get("OPENAI_API_KEY") ?? "", baseUrl: Deno.env.get("OPENAI_BASE_URL") ?? undefined, model: Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini", temperature, name: "openai" });
        case "ollama": return new OpenAIClient({ apiKey: "", baseUrl: Deno.env.get("OLLAMA_BASE_URL") ?? "http://localhost:11434/v1", model: Deno.env.get("OLLAMA_MODEL") ?? "llama3.1", temperature, name: "ollama" });
        default: return new GeminiClient();
    }
}

if (import.meta.main) {
    const args = parse(Deno.args, {
        string: ["idea", "idea-file", "context", "out", "backend", "max-depth", "breadth", "max-nodes", "max-llm-calls", "concurrency", "truths", "jumps", "action-paths", "vote", "retries", "dedup-threshold", "temperature", "cache", "memory"],
        boolean: ["mock", "verbose", "no-reeval", "no-agentic", "no-dedup", "falsify", "checkpoint", "help", "quiet"],
        alias: { i: "idea", f: "idea-file", o: "out", d: "max-depth", b: "breadth", c: "concurrency", m: "mock", h: "help" },
        default: { verbose: true },
    });

    // ---- resolve the IDEA (positional > --idea > --idea-file > stdin) -------
    let idea = (args.idea as string) || "";
    if (!idea && args["idea-file"]) idea = (await Deno.readTextFile(args["idea-file"] as string)).trim();
    if (!idea && args._.length) idea = args._.map(String).join(" ").trim();
    if (!idea && !args.help && !Deno.stdin.isTerminal()) idea = (await new Response(Deno.stdin.readable).text()).trim();
    const backend = (args.backend as string) || (args.mock ? "mock" : "gemini");
    if (!idea && backend === "mock") idea = "Intelligence can be automated by widening context and mapping chain reactions.";

    if (args.help || !idea) {
        console.log(`
Self-Intelligence — recursive map-of-cavilations engine

Set the IDEA (only required input) any of these ways:
  deno run -A selfIntelligence.ts "<your idea>"            # positional (easiest)
  deno run -A selfIntelligence.ts --idea "<your idea>"     # flag
  deno run -A selfIntelligence.ts -f idea.txt              # from a text file
  echo "<your idea>" | deno run -A selfIntelligence.ts     # from stdin

Input:
  -i, --idea <text>        The idea/thesis to map
  -f, --idea-file <path>   Read the idea from a file (good for long ideas)

Backend / output:
      --backend <name>     gemini | openai | ollama | mock   (default gemini; --mock = mock)
                           openai  uses OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL
                           ollama  uses OLLAMA_BASE_URL (default http://localhost:11434/v1) / OLLAMA_MODEL
  -o, --out <path>         Output JSON (default ./runs/<timestamp>.json)
      --checkpoint         Incrementally write the map to --out as it runs
      --cache <dir>        Cache LLM responses on disk (dedupe identical prompts)
      --memory <file>      Load prior truths from this file at start, save active truths at end

Search shape:
  -d, --max-depth <n>      Recursion cycles          (default ${DEFAULT_OPTIONS.maxDepth})
  -b, --breadth <n>        Fan width per generation   (default ${DEFAULT_OPTIONS.breadth})
      --max-nodes <n>      Node budget                (default ${DEFAULT_OPTIONS.maxNodes})
      --max-llm-calls <n>  LLM call budget            (default ${DEFAULT_OPTIONS.maxLLMCalls})
  -c, --concurrency <n>    Parallel LLM calls         (default ${DEFAULT_OPTIONS.concurrency})
      --truths <n>         Initial truths             (default ${DEFAULT_OPTIONS.truthCount})
      --jumps <n>          Cross-domain jumps         (default ${DEFAULT_OPTIONS.jumpCount})
      --action-paths <n>   Alternative action paths   (default ${DEFAULT_OPTIONS.pathCount})

Reasoning quality:
      --vote <n>           Self-consistency samples on validity gate (default ${DEFAULT_OPTIONS.voteSamples})
      --retries <n>        JSON repair retries        (default ${DEFAULT_OPTIONS.retries})
      --dedup-threshold <f>Jaccard sim to treat nodes as duplicates (default ${DEFAULT_OPTIONS.dedupThreshold})
      --no-dedup           Disable semantic dedup (full tree)
      --falsify            "no-but" red-team each solution (prunes weak ones)
      --temperature <f>    Sampling temperature for openai/ollama (default 0.4)
      --no-reeval          Disable context re-evaluation pass
      --no-agentic         Disable agentic CRUD reconciliation
  -m, --mock               Use the deterministic mock LLM (no network)
      --quiet              Less logging
  -h, --help               Show this help

Then convert to an Obsidian vault:
  deno run -A mapToObsidian.ts <map.json> --out <vault-dir> [--training]
`);
        Deno.exit(0);
    }

    const n = (v: string | undefined, d: number) => (v !== undefined && v !== "" ? Number(v) : d);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outPath = (args.out as string) || `./runs/${stamp}.json`;

    // cross-run memory: load prior truths as seed context
    let seedTruths: RunOptions["seedTruths"] = undefined;
    if (args.memory) {
        try { seedTruths = JSON.parse(await Deno.readTextFile(args.memory as string)); } catch { seedTruths = []; }
    }

    // --context: inject free-text background knowledge as seed truths
    // Accepts either inline text or a path to a plain-text / markdown file.
    // Each line (or bullet) becomes one seed truth visible to the whole run.
    if (args.context) {
        let raw = args.context as string;
        try { await Deno.stat(raw as string); raw = await Deno.readTextFile(raw as string); } catch { /* treat as inline text */ }
        const lines = raw.split(/\n|(?<=[.!?])\s+/)
            .map((l: string) => l.replace(/^[-*•>\s]+/, "").trim())
            .filter((l: string) => l.length > 10);
        const ctxTruths: NonNullable<RunOptions["seedTruths"]> = lines.map((l: string) => ({ statement: l, source: "user-context", confidence: 0.85 }));
        seedTruths = [...(seedTruths ?? []), ...ctxTruths];
        console.log(`📥 injected ${ctxTruths.length} context truths into seed`);
    }

    const opts: Partial<RunOptions> = {
        maxDepth: n(args["max-depth"], DEFAULT_OPTIONS.maxDepth),
        breadth: n(args["breadth"], DEFAULT_OPTIONS.breadth),
        maxNodes: n(args["max-nodes"], DEFAULT_OPTIONS.maxNodes),
        maxLLMCalls: n(args["max-llm-calls"], DEFAULT_OPTIONS.maxLLMCalls),
        concurrency: n(args["concurrency"], DEFAULT_OPTIONS.concurrency),
        truthCount: n(args["truths"], DEFAULT_OPTIONS.truthCount),
        jumpCount: n(args["jumps"], DEFAULT_OPTIONS.jumpCount),
        pathCount: n(args["action-paths"], DEFAULT_OPTIONS.pathCount),
        voteSamples: n(args["vote"], DEFAULT_OPTIONS.voteSamples),
        retries: n(args["retries"], DEFAULT_OPTIONS.retries),
        dedupThreshold: args["no-dedup"] ? 1 : n(args["dedup-threshold"], DEFAULT_OPTIONS.dedupThreshold),
        reevaluate: !args["no-reeval"],
        agentic: !args["no-agentic"],
        falsify: !!args.falsify,
        verbose: !args.quiet,
        cachePath: (args.cache as string) || undefined,
        checkpointPath: args.checkpoint ? outPath : undefined,
        seedTruths,
    };

    const client = makeClient(backend, n(args["temperature"], 0.4));
    const reasoner = new Reasoner(client, opts);
    let map: IntelligenceMap;
    try {
        map = await reasoner.run(idea);
    } catch (e) {
        console.error("❌ run failed:", e);
        await client.close();
        Deno.exit(1);
    }

    const dir = outPath.includes("/") ? outPath.slice(0, outPath.lastIndexOf("/")) : ".";
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(outPath, JSON.stringify(map, null, 2));
    // always write execution log alongside the JSON
    const logPath = outPath.replace(/\.json$/i, ".log");
    await Deno.writeTextFile(logPath, reasoner.logBuffer.join("\n"));
    console.log(`\n💾 wrote ${outPath}`);
    console.log(`📋 wrote execution log: ${logPath}`);

    // persist memory (active truths) for the next run
    if (args.memory) {
        const active = map.truths.filter((t) => !t.deleted).map((t) => ({ statement: t.statement, source: t.source, evidence: t.evidence, confidence: t.confidence }));
        await Deno.writeTextFile(args.memory as string, JSON.stringify(active, null, 2));
        console.log(`🧠 saved ${active.length} truths to memory: ${args.memory}`);
    }
    console.log(`   next: deno run -A mapToObsidian.ts ${outPath} --out ./vault`);

    await client.close();
    Deno.exit(0);
}
