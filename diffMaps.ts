/// <reference lib="deno.ns" />
// ============================================================================
// diffMaps.ts — compare two IntelligenceMap JSON runs of the same idea.
// Shows how added evidence/reasoning shifted truths, action paths, and the
// recommended route over time.
//
// Usage:
//   deno run -A diffMaps.ts <old.json> <new.json>
// ============================================================================
import type { IntelligenceMap } from "./selfIntelligence.ts";

function norm(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function diffSets(a: string[], b: string[]) {
    const an = new Map(a.map((x) => [norm(x), x]));
    const bn = new Map(b.map((x) => [norm(x), x]));
    const added = [...bn].filter(([k]) => !an.has(k)).map(([, v]) => v);
    const removed = [...an].filter(([k]) => !bn.has(k)).map(([, v]) => v);
    const kept = [...an].filter(([k]) => bn.has(k)).length;
    return { added, removed, kept };
}

function section(title: string) { console.log(`\n## ${title}`); }
function list(items: string[], prefix: string) { if (!items.length) console.log("  (none)"); for (const i of items) console.log(`  ${prefix} ${i}`); }

async function main() {
    if (Deno.args.length < 2) {
        console.log("Usage: deno run -A diffMaps.ts <old.json> <new.json>");
        Deno.exit(1);
    }
    const [oldPath, newPath] = Deno.args;
    const a = JSON.parse(await Deno.readTextFile(oldPath)) as IntelligenceMap;
    const b = JSON.parse(await Deno.readTextFile(newPath)) as IntelligenceMap;

    console.log(`# Diff: ${oldPath}  →  ${newPath}`);
    console.log(`idea(old): ${a.mainIdea}`);
    console.log(`idea(new): ${b.mainIdea}`);

    section("Stats");
    const sa = a.stats, sb = b.stats;
    const d = (x: number, y: number) => `${x} → ${y} (${y - x >= 0 ? "+" : ""}${y - x})`;
    console.log(`  nodes:     ${d(sa.nodes, sb.nodes)}`);
    console.log(`  truths:    ${d(sa.truths, sb.truths)}`);
    console.log(`  snapshots: ${d(sa.snapshots, sb.snapshots)}`);
    console.log(`  llm calls: ${d(sa.llmCalls, sb.llmCalls)}`);

    section("Active truths");
    const truthDiff = diffSets(
        a.truths.filter((t) => !t.deleted).map((t) => t.statement),
        b.truths.filter((t) => !t.deleted).map((t) => t.statement),
    );
    console.log(`  kept: ${truthDiff.kept}`);
    list(truthDiff.added, "➕");
    list(truthDiff.removed, "➖");

    section("Action paths");
    const pathDiff = diffSets(a.actionPaths.map((p) => p.title), b.actionPaths.map((p) => p.title));
    console.log(`  kept: ${pathDiff.kept}`);
    list(pathDiff.added, "➕");
    list(pathDiff.removed, "➖");

    section("Recommended path");
    const recA = a.actionPaths.find((p) => p.id === a.recommendedPathId)?.title ?? "(none)";
    const recB = b.actionPaths.find((p) => p.id === b.recommendedPathId)?.title ?? "(none)";
    console.log(`  ${recA}  →  ${recB}${norm(recA) !== norm(recB) ? "   ⚠️ changed" : ""}`);
    console.log("");
}

if (import.meta.main) await main();
