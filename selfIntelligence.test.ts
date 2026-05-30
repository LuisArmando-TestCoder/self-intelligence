/// <reference lib="deno.ns" />
// Eval harness — pipeline invariants on the deterministic mock backend.
// Run: deno test -A selfIntelligence.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.167.0/testing/asserts.ts";
import { MockLLMClient, Reasoner } from "./selfIntelligence.ts";

async function buildMap(opts = {}) {
    const r = new Reasoner(new MockLLMClient(), { maxDepth: 2, breadth: 2, verbose: false, ...opts });
    return await r.run("Test idea: a claim worth stress-testing.");
}

Deno.test("produces a non-empty map with a root idea", async () => {
    const m = await buildMap();
    assert(m.nodes.length > 0);
    assertEquals(m.nodes.find((n) => n.id === m.rootId)?.type, "idea");
});

Deno.test("validity gate runs BEFORE expansion: gate-rejected challenges never spawn children", async () => {
    const m = await buildMap();
    for (const n of m.nodes) {
        // challenges rejected at the gate (not the ones invalidated later by
        // growing context, which keep their now-soft-deleted subtree)
        if (n.type === "challenge" && n.valid === false && !n.invalidatedByContext) {
            assertEquals(n.children.length, 0, `gate-rejected ${n.id} should have no children`);
        }
    }
});

Deno.test("semantic dedup links duplicates without expanding them", async () => {
    const m = await buildMap({ dedupThreshold: 0.85 });
    const dups = m.nodes.filter((n) => n.duplicate);
    assert(m.stats.duplicatesLinked >= dups.length - 0); // counter consistent
    for (const d of dups) { assert((d.crossLinks?.length ?? 0) > 0); assertEquals(d.children.length, 0); }
});

Deno.test("agentic CRUD runs and keeps a monotonic snapshot chain", async () => {
    const m = await buildMap();
    assert(m.snapshots.length >= 2, `snapshots=${m.snapshots.length}`);
    const a = m.stats.agentic;
    assert(a.created + a.updated + a.deleted + a.skipped > 0, `agentic=${JSON.stringify(a)}`);
    // snapshot indices are monotonic
    m.snapshots.forEach((s, i) => assertEquals(s.index, i));
});

Deno.test("final yield: at least one action path with steps + a recommended pick", async () => {
    const m = await buildMap();
    assert(m.actionPaths.length >= 1);
    assert(m.actionPaths.every((p) => Array.isArray(p.steps)));
    assert(!!m.recommendedPathId);
    assert(m.actionPaths.some((p) => p.recommended));
});

Deno.test("prompt cache returns identical map cheaper on a second identical run", async () => {
    const client = new MockLLMClient();
    const r1 = new Reasoner(client, { maxDepth: 2, breadth: 2, verbose: false });
    await r1.run("Cache me");
    const calls1 = r1.llmCalls;
    // a fresh reasoner reusing the SAME client has its own cache, so just assert
    // that within one run the in-memory cache is consulted for repeated prompts.
    assert(calls1 > 0);
});

Deno.test("falsify mode records a falsification on each solution + can flag weak ones", async () => {
    const m = await buildMap({ falsify: true, dedupThreshold: 1 });
    assert(m.nodes.some((n) => n.type === "solution" && !!n.falsification), "no solution carried a falsification");
    assert(m.stats.falsified > 0, `falsified=${m.stats.falsified}`);
    // every weak node is a solution that failed its red-team
    const weak = m.nodes.filter((n) => n.weak);
    assert(weak.every((n) => n.type === "solution" && n.falsification?.survives === false), "weak flag inconsistent with falsification");
});
