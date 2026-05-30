/// <reference lib="deno.ns" />
// ============================================================================
// mapToObsidian.ts — convert an IntelligenceMap JSON into an Obsidian vault.
// ----------------------------------------------------------------------------
// One Markdown note per reasoning node (with parent/child wikilinks + YAML
// `parent` property), plus companion notes: global context (truths w/ evidence
// & confidence), snapshot chain, cross-domain jumps, the final ALTERNATIVE
// ACTION PATHS (with a recommended pick + pre-mortems), and an Index/MOC with a
// Mermaid graph of the reasoning DAG.
//
// Usage:
//   deno run -A mapToObsidian.ts <map.json> [--out <vault-dir>] [--training]
//
//   --training  Hide conclusions (solutions/validity verdicts/action paths) and
//               reveal only the next *why* — turns the vault into a thinking aid
//               instead of an answer key (mitigates cognitive dependence).
// ============================================================================

import { parse } from "https://deno.land/std@0.167.0/flags/mod.ts";
import type { ActionPath, CrossDomainJump, IntelligenceMap, MapNode, Snapshot, Truth } from "./selfIntelligence.ts";

const TYPE_EMOJI: Record<string, string> = { idea: "💡", challenge: "⚔️", why: "❓", solution: "🛠️" };

interface ExportOpts { training: boolean }

// ----------------------------------------------------------------------------
// filename / link helpers
// ----------------------------------------------------------------------------

function slug(text: string, maxLen = 60): string {
    return text
        .replace(/[\[\]#\^\|\/\\:*?"<>]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLen)
        .trim()
        .replace(/[ .]+$/g, "");
}

function nodeBasename(node: MapNode): string {
    const s = slug(node.content) || node.type;
    return `${node.id} ${TYPE_EMOJI[node.type] ?? ""} ${s}`.replace(/\s+/g, " ").trim();
}

function wikilink(basename: string, alias?: string): string {
    return alias ? `[[${basename}|${alias}]]` : `[[${basename}]]`;
}

function yamlString(v: string): string {
    return JSON.stringify(v);
}

function mermaidLabel(node: MapNode): string {
    const text = node.content.replace(/"/g, "'").slice(0, 40);
    return `${node.id}["${TYPE_EMOJI[node.type] ?? ""} ${text}"]`;
}

// ----------------------------------------------------------------------------
// note builders
// ----------------------------------------------------------------------------

function buildNodeNote(node: MapNode, byId: Map<string, MapNode>, ex: ExportOpts): string {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    const parentBase = parent ? nodeBasename(parent) : undefined;
    const children = node.children.map((id) => byId.get(id)).filter(Boolean) as MapNode[];
    const hideConclusions = ex.training && (node.type === "solution");

    const fm: string[] = ["---"];
    fm.push(`id: ${node.id}`);
    fm.push(`type: ${node.type}`);
    fm.push(`cycle: ${node.cycle}`);
    fm.push(`depth: ${node.depth}`);
    if (typeof node.score === "number" && isFinite(node.score)) fm.push(`score: ${node.score}`);
    if (node.type === "challenge") {
        fm.push(`valid: ${node.valid === true}`);
        if (typeof node.validityConfidence === "number") fm.push(`confidence: ${node.validityConfidence}`);
        if (typeof node.severity === "number") fm.push(`severity: ${node.severity}`);
        if (typeof node.likelihood === "number") fm.push(`likelihood: ${node.likelihood}`);
    }
    if (node.type === "solution") {
        if (typeof node.feasibility === "number") fm.push(`feasibility: ${node.feasibility}`);
        if (typeof node.impact === "number") fm.push(`impact: ${node.impact}`);
        if (typeof node.defenseScore === "number") fm.push(`defense: ${node.defenseScore}`);
        if (node.weak) fm.push(`weak: true`);
    }
    if (node.duplicate) fm.push(`duplicate: true`);
    if (node.resolved !== undefined) fm.push(`resolved: ${!!node.resolved}`);
    if (node.invalidatedByContext) fm.push(`invalidatedByContext: true`);
    fm.push(`visible: ${node.visible}`);
    fm.push(`softDeleted: ${node.softDeleted}`);
    if (parentBase) fm.push(`parent: ${yamlString(wikilink(parentBase))}`);
    const tags = ["self-intelligence", node.type];
    if (node.type === "challenge") tags.push(node.valid ? "valid" : "invalid");
    if (node.invalidatedByContext) tags.push("invalidated");
    if (node.duplicate) tags.push("duplicate");
    if (node.weak) tags.push("weak");
    fm.push(`tags: [${tags.join(", ")}]`);
    fm.push("---", "");

    const body: string[] = [];
    body.push(`# ${TYPE_EMOJI[node.type] ?? ""} ${node.type.toUpperCase()} ${node.id}`, "");
    if (parentBase) body.push(`**⬆️ Parent::** ${wikilink(parentBase)}`, "");
    else body.push(`*(root idea — no parent)*`, "");

    if (hideConclusions) {
        body.push("## 🧪 Training mode", "", "> A solution exists here, but it's hidden. Try to derive it yourself from the parent *why* before revealing.", "");
    } else {
        body.push("## Statement", "", `> ${node.content.replace(/\n/g, "\n> ")}`, "");
    }

    if (node.duplicate && node.crossLinks?.length) {
        const dl = node.crossLinks.map((id) => { const n = byId.get(id); return n ? wikilink(nodeBasename(n)) : `\`${id}\``; });
        body.push(`> ♊ Near-duplicate (cross-linked) of: ${dl.join(", ")}`, "");
    }

    if (node.rationale) body.push("## Rationale", "", node.rationale, "");

    if (node.type === "challenge") {
        body.push("## Scoring", "", `- **severity:** ${node.severity ?? "?"} | **likelihood:** ${node.likelihood ?? "?"} | **priority:** ${typeof node.score === "number" ? node.score.toFixed(2) : "?"}`, "");
        if (!ex.training) {
            body.push("## Validity", "");
            body.push(`- **valid:** ${node.valid === true ? "✅ yes" : "❌ no"}`);
            if (typeof node.validityConfidence === "number") body.push(`- **confidence:** ${node.validityConfidence}`);
            if (node.validityReason) body.push(`- **reason:** ${node.validityReason}`);
            if (node.invalidatedByContext) body.push(`- ⚠️ *invalidated by later context*`);
            body.push("");
        }
    }

    if (node.type === "solution" && !ex.training) {
        body.push("## Scoring", "", `- **feasibility:** ${node.feasibility ?? "?"} | **impact:** ${node.impact ?? "?"} | **defense:** ${node.defenseScore ?? "?"}`, "");
        if (node.firstPrinciples) body.push("## First principles", "", node.firstPrinciples, "");
        if (node.falsification) {
            body.push("## 🧪 Falsification (no-but)", "");
            body.push(`- **counter:** ${node.falsification.counter}`);
            body.push(`- **survives:** ${node.falsification.survives ? "✅ yes" : "❌ no (weak)"}`);
            if (node.falsification.reason) body.push(`- **reason:** ${node.falsification.reason}`);
            body.push("");
        }
        if (node.derivedTruthIds?.length) {
            body.push("## Truths introduced", "");
            for (const tid of node.derivedTruthIds) body.push(`- \`${tid}\` (see ${wikilink("_Context (Truths)")})`);
            body.push("");
        }
    }

    if (children.length) {
        body.push("## Children", "");
        for (const c of children) {
            let note = "";
            if (c.type === "challenge" && c.valid === false) note = " *(invalid — dead end)*";
            if (c.duplicate) note = " *(duplicate — cross-linked)*";
            if (c.weak) note = " *(weak — failed falsification)*";
            body.push(`- ${wikilink(nodeBasename(c))}${note}`);
        }
        body.push("");
    } else if (node.resolved) {
        body.push("## Status", "", "🏁 **Resolved** — no remaining valid challenges given the context.", "");
    }

    return fm.join("\n") + body.join("\n") + "\n";
}

function buildContextNote(map: IntelligenceMap): string {
    const active: Truth[] = map.truths.filter((t) => !t.deleted);
    const retired: Truth[] = map.truths.filter((t) => t.deleted);
    const out: string[] = [];
    out.push("---", "type: context", "tags: [self-intelligence, context]", "---", "");
    out.push("# 🌍 Global Context (Truths)", "");
    out.push(`Top idea: ${wikilink(nodeBasename(map.nodes.find((n) => n.id === map.rootId)!))}`, "");
    out.push("## Active truths", "");
    if (active.length === 0) out.push("*(none)*");
    for (const t of active) {
        out.push(`- \`${t.id}\` — ${t.statement}`);
        out.push(`    - *source:* ${t.source}${typeof t.confidence === "number" ? ` · *confidence:* ${t.confidence}` : ""}${t.derivedFrom.length ? ` · *from:* ${t.derivedFrom.join(", ")}` : ""}`);
        if (t.evidence) out.push(`    - *evidence:* ${t.evidence}`);
    }
    out.push("");
    if (retired.length) {
        out.push("## 🗑️ Retired truths (soft-deleted, contextually invisible)", "");
        for (const t of retired) out.push(`- ~~\`${t.id}\` — ${t.statement}~~  *[source: ${t.source}]*`);
        out.push("");
    }
    return out.join("\n") + "\n";
}

function buildSnapshotsNote(map: IntelligenceMap): string {
    const truthById = new Map(map.truths.map((t) => [t.id, t]));
    const out: string[] = [];
    out.push("---", "type: snapshots", "tags: [self-intelligence, snapshots]", "---", "");
    out.push("# 🕰️ Snapshot chain", "", `${map.snapshots.length} snapshots — each captures the contextual state of all truths after a CRUD change.`, "");
    for (const s of map.snapshots as Snapshot[]) {
        out.push(`## Snapshot ${s.index}`, "");
        out.push(`- **when:** ${s.timestamp}`);
        out.push(`- **reason:** ${s.reason}`);
        const visible = s.truths.filter((t) => t.visible && !t.deleted).map((t) => t.id);
        const hidden = s.truths.filter((t) => !t.visible || t.deleted).map((t) => t.id);
        out.push(`- **visible:** ${visible.length ? visible.map((id) => `\`${id}\``).join(" ") : "—"}`);
        out.push(`- **hidden/retired:** ${hidden.length ? hidden.map((id) => `\`${id}\``).join(" ") : "—"}`);
        for (const ts of s.truths) {
            const t = truthById.get(ts.id);
            if (!t) continue;
            const mark = ts.deleted ? "🗑️" : ts.visible ? "•" : "·";
            out.push(`    ${mark} \`${ts.id}\` ${t.statement.slice(0, 80)}`);
        }
        out.push("");
    }
    return out.join("\n") + "\n";
}

function buildCrossDomainNote(map: IntelligenceMap): string {
    const out: string[] = [];
    out.push("---", "type: cross-domain", "tags: [self-intelligence, cross-domain]", "---", "");
    out.push("# 🧭 Genius cross-domain jumps (and their vices)", "");
    if (!map.crossDomainJumps.length) out.push("*(none gathered)*");
    for (const j of map.crossDomainJumps as CrossDomainJump[]) {
        out.push(`## ${j.domain}`, "");
        out.push(`- **analogy:** ${j.analogy}`);
        out.push(`- **insight:** ${j.insight}`);
        out.push(`- **⚠️ vice:** ${j.vice}`);
        out.push("");
    }
    return out.join("\n") + "\n";
}

function buildActionPathsNote(map: IntelligenceMap, byId: Map<string, MapNode>, ex: ExportOpts): string {
    const out: string[] = [];
    out.push("---", "type: action-paths", "tags: [self-intelligence, action-paths]", "---", "");
    out.push("# 🎯 Alternative paths of action (final yield)", "");
    out.push(`> Toward: ${map.mainIdea.replace(/\n/g, "\n> ")}`, "");
    if (ex.training) {
        out.push("🧪 **Training mode:** action paths are hidden. Work the reasoning tree and derive your own routes first.", "");
        return out.join("\n") + "\n";
    }
    if (!map.actionPaths.length) { out.push("*(none synthesized)*"); return out.join("\n") + "\n"; }
    for (const p of map.actionPaths as ActionPath[]) {
        const star = p.recommended || p.id === map.recommendedPathId ? " ⭐ recommended" : "";
        out.push(`## ${p.id} — ${p.title}${star}`, "");
        if (typeof p.defenseScore === "number") out.push(`*defense score: ${p.defenseScore}*`, "");
        if (p.summary) out.push(p.summary, "");
        if (p.steps?.length) { out.push("**Steps**", ""); p.steps.forEach((s, i) => out.push(`${i + 1}. ${s}`)); out.push(""); }
        if (p.addresses?.length) out.push(`- **overcomes:** ${p.addresses.join("; ")}`);
        if (p.tradeoffs) out.push(`- **tradeoffs:** ${p.tradeoffs}`);
        if (p.risks) out.push(`- **⚠️ risk/vice:** ${p.risks}`);
        if (p.whenToPrefer) out.push(`- **prefer when:** ${p.whenToPrefer}`);
        if (p.killCriteria?.length) { out.push(`- **🪦 pre-mortem / kill-criteria:**`); for (const k of p.killCriteria) out.push(`    - ${k}`); }
        if (p.supportingTruthIds?.length) out.push(`- **supporting truths:** ${p.supportingTruthIds.map((t) => `\`${t}\``).join(" ")} (see ${wikilink("_Context (Truths)")})`);
        if (p.sourceNodeIds?.length) {
            const links = p.sourceNodeIds.map((id) => { const n = byId.get(id); return n ? wikilink(nodeBasename(n)) : `\`${id}\``; });
            out.push(`- **derives from:** ${links.join(" · ")}`);
        }
        out.push("");
    }
    return out.join("\n") + "\n";
}

function buildMermaid(map: IntelligenceMap, byId: Map<string, MapNode>): string {
    const lines: string[] = ["```mermaid", "graph TD"];
    const visible = map.nodes.filter((n) => !n.softDeleted).slice(0, 120);
    const ids = new Set(visible.map((n) => n.id));
    for (const n of visible) {
        if (n.parentId && ids.has(n.parentId)) lines.push(`    ${n.parentId} --> ${mermaidLabel(n)}`);
        else lines.push(`    ${mermaidLabel(n)}`);
        for (const cl of n.crossLinks ?? []) if (ids.has(cl)) lines.push(`    ${n.id} -.dup.-> ${cl}`);
    }
    // light styling by type
    lines.push("    classDef challenge fill:#fde,stroke:#b36;");
    lines.push("    classDef solution fill:#dfe,stroke:#3a6;");
    lines.push("    classDef idea fill:#def,stroke:#36b;");
    for (const n of visible) if (n.type === "challenge" || n.type === "solution" || n.type === "idea") lines.push(`    class ${n.id} ${n.type};`);
    lines.push("```");
    return lines.join("\n");
}

function buildIndexNote(map: IntelligenceMap, byId: Map<string, MapNode>, ex: ExportOpts): string {
    const out: string[] = [];
    out.push("---", "type: index", "tags: [self-intelligence, MOC]", "---", "");
    out.push("# 🧠 Self-Intelligence Map", "");
    out.push(`> ${map.mainIdea.replace(/\n/g, "\n> ")}`, "");

    out.push("## 🎯 Alternative paths of action (final yield)", "");
    if (ex.training) {
        out.push("🧪 *Training mode — conclusions hidden. See the reasoning tree below and the next open question.*");
    } else if (map.actionPaths.length) {
        for (const p of map.actionPaths) {
            const star = p.recommended || p.id === map.recommendedPathId ? " ⭐" : "";
            out.push(`- **${p.id} — ${p.title}**${star} *(defense ${p.defenseScore ?? "?"})* — ${p.summary}  → ${wikilink("_Action Paths")}`);
        }
    } else out.push(`- *(none)* — see ${wikilink("_Action Paths")}`);
    out.push("");

    out.push("## Stats", "");
    out.push(`- backend: ${map.backend ?? "?"} | created: ${map.createdAt}`);
    out.push(`- nodes: ${map.stats.nodes} | truths: ${map.stats.truths} | snapshots: ${map.stats.snapshots} | llm calls: ${map.stats.llmCalls} (+${map.stats.cacheHits} cache hits)`);
    out.push(`- re-evaluated: ${map.stats.reevaluatedChallenges} | invalidated by context: ${map.stats.invalidatedByContext} | duplicates linked: ${map.stats.duplicatesLinked} | falsified: ${map.stats.falsified}`);
    out.push(`- agentic CRUD — created: ${map.stats.agentic.created}, updated: ${map.stats.agentic.updated}, deleted: ${map.stats.agentic.deleted}, skipped: ${map.stats.agentic.skipped}`);
    out.push(`- options: depth=${map.options.maxDepth} breadth=${map.options.breadth} vote=${map.options.voteSamples} dedup=${map.options.dedupThreshold} falsify=${map.options.falsify}`);
    out.push("");

    out.push("## Companion notes", "");
    out.push(`- ${wikilink("_Action Paths")}`);
    out.push(`- ${wikilink("_Context (Truths)")}`);
    out.push(`- ${wikilink("_Snapshots")}`);
    out.push(`- ${wikilink("_Cross-Domain Jumps")}`);
    out.push("");

    out.push("## Reasoning graph", "", buildMermaid(map, byId), "");

    out.push("## Reasoning tree", "");
    const root = byId.get(map.rootId);
    if (root) {
        const walk = (node: MapNode, depth: number) => {
            const indent = "    ".repeat(depth);
            const flags: string[] = [];
            if (node.type === "challenge") flags.push(node.valid ? "✅" : "❌");
            if (node.invalidatedByContext) flags.push("⚠️invalidated");
            if (node.duplicate) flags.push("♊dup");
            if (node.weak) flags.push("🧪weak");
            if (node.resolved && node.children.length === 0 && node.type !== "challenge") flags.push("🏁");
            const suffix = flags.length ? `  ${flags.join(" ")}` : "";
            out.push(`${indent}- ${wikilink(nodeBasename(node))}${suffix}`);
            for (const cid of node.children) { const c = byId.get(cid); if (c) walk(c, depth + 1); }
        };
        walk(root, 0);
    }
    out.push("");

    if (ex.training) {
        const openQ = map.nodes.find((n) => n.type === "why" && !n.softDeleted);
        out.push("## 🧪 Next open question", "", openQ ? `> ${openQ.content}\n\nTry to answer it from first principles before revealing the solutions.` : "*(no open whys)*", "");
    }
    return out.join("\n") + "\n";
}

// ----------------------------------------------------------------------------
// main
// ----------------------------------------------------------------------------

async function main(): Promise<void> {
    const args = parse(Deno.args, {
        string: ["in", "out"],
        boolean: ["help", "training"],
        alias: { i: "in", o: "out", h: "help", t: "training" },
    });

    const inputPath = (args.in as string) || (args._[0] as string | undefined);
    if (args.help || !inputPath) {
        console.log(`
mapToObsidian.ts — convert an IntelligenceMap JSON into an Obsidian vault.

Usage:
  deno run -A mapToObsidian.ts <map.json> [--out <vault-dir>] [--training]

Options:
  -i, --in <path>    Input map JSON (or pass as first positional arg)
  -o, --out <dir>    Output vault directory (default: <map-dir>/<map-name>-vault)
  -t, --training     Training mode: hide conclusions, reveal only the next why
  -h, --help         Show this help
`);
        Deno.exit(inputPath ? 0 : 1);
    }

    const ex: ExportOpts = { training: !!args.training };
    const raw = await Deno.readTextFile(inputPath);
    const map = JSON.parse(raw) as IntelligenceMap;

    const base = inputPath.replace(/\.json$/i, "");
    const outDir = (args.out as string) || `${base}-vault`;
    await Deno.mkdir(outDir, { recursive: true });

    const byId = new Map<string, MapNode>(map.nodes.map((n) => [n.id, n]));

    let written = 0;
    for (const node of map.nodes) {
        await Deno.writeTextFile(`${outDir}/${nodeBasename(node)}.md`, buildNodeNote(node, byId, ex));
        written++;
    }

    await Deno.writeTextFile(`${outDir}/_Context (Truths).md`, buildContextNote(map));
    await Deno.writeTextFile(`${outDir}/_Snapshots.md`, buildSnapshotsNote(map));
    await Deno.writeTextFile(`${outDir}/_Cross-Domain Jumps.md`, buildCrossDomainNote(map));
    await Deno.writeTextFile(`${outDir}/_Action Paths.md`, buildActionPathsNote(map, byId, ex));
    await Deno.writeTextFile(`${outDir}/_Index.md`, buildIndexNote(map, byId, ex));

    console.log(`📓 Obsidian vault written to: ${outDir}${ex.training ? " (training mode)" : ""}`);
    console.log(`   ${written} node notes + 5 companion notes (_Index, _Action Paths, _Context, _Snapshots, _Cross-Domain Jumps)`);
    console.log(`   Open the folder as an Obsidian vault and start at _Index.`);
}

if (import.meta.main) {
    await main();
}
