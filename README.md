# 🧠 Self-Intelligence

> *"No soy más inteligente que los demás, sólo me quedo con los problemas por más tiempo."*

An engine that **automates exhaustive reasoning** by widening context and mapping the
chain reactions of an idea. It takes a single **idea/thesis** and produces a *map of
cavilations*: proven truths as global context, a recursive fan of **challenges →
whys → competing solutions**, gated by **logical validity**, reconciled **agentically**
into a versioned knowledge base, and distilled into ranked **alternative paths of
action** (the final yield) — exportable as an **Obsidian vault**.

Built on a free **state-of-the-art LLM web-scraper** backend, with pluggable
OpenAI/Ollama backends and a deterministic mock for offline runs.

---

## The idea behind it

Intelligence ≈ *widening context* (what is known + what would happen given an action)
and tracing chain reactions until logical (often counter-intuitive) trajectories
emerge. Creativity is the *exploration* product; intelligence is the *doubt* product
(DeepSeek's "no, but"). This tool delegates the exhaustive part of reasoning:

1. **Global context** — gather *extrinsic, proven* truths (each with **source +
   evidence + confidence**) so the map is grounded, not just confidently hallucinated.
2. **Challenge fan** — generate scored challenge points (**severity × likelihood**)
   that contest an idea's applicability *from first principles* (not as ideology).
3. **Validity gate** — every challenge is checked for **logical validity** (with
   optional **self-consistency voting**) **before** it is allowed to spawn nodes.
4. **Whys → competing solutions** — recurse with chains of *why*, resolved by
   **opposing** first-principles solutions (scored **feasibility × impact**), each
   optionally **red-teamed** ("no, but" falsification).
5. **Agentic CRUD context** — new findings are **reconciled** against present context
   (create / update / delete / **skip**), with **soft-delete** and a **snapshot chain**
   (history). Soft-deleted truths stop being *contextually visible*.
6. **Re-evaluation** — as truths accumulate, earlier challenges are re-judged; ones
   defeated by new context are invalidated and their subtree hidden.
7. **Best-first + dedup + info-gain** — expand the highest-scoring frontier first;
   collapse near-duplicate nodes into **cross-links** (tree → DAG, reveals false
   dichotomies); stop a branch when it stops producing new truths.
8. **Cross-domain jumps** — gather genius analogies from other domains **and their
   vices** (where each analogy breaks).
9. **Final yield** — synthesize distinct **alternative paths of action** with steps,
   tradeoffs, **pre-mortem kill-criteria**, and a **recommended** path chosen by
   **confidence propagation** along the surviving lineages.

> ⚠️ Dependence is the liability: for the cognitively-fit this is a *multiplier*, not a
> crutch. Use **`--training`** mode (below) to reveal only the next *why* and keep your
> own reasoning sharp.

---

## Files

| File | Purpose |
|------|---------|
| `scraperLLM.ts` | Free LLM web-scraper driver (`callLLM`, `resetChat`, `closeBrowser`). |
| `selfIntelligence.ts` | The reasoning engine + CLI (the brain). |
| `mapToObsidian.ts` | Convert a map JSON → Obsidian vault (Mermaid graph, training mode). |
| `diffMaps.ts` | Compare two runs of the same idea over time. |
| `selfIntelligence.test.ts` | Eval harness: pipeline invariants on the mock backend. |
| `runs/` | Output maps. |

---

## Quick start

```bash
# 0) Try it offline first (deterministic mock, no network):
deno run -A selfIntelligence.ts --mock -o runs/demo.json

# 1) Real run — the IDEA is the ONLY required input. Pass it any of these ways:
deno run -A selfIntelligence.ts "Universal basic income increases entrepreneurship"
deno run -A selfIntelligence.ts --idea "My thesis ..."
deno run -A selfIntelligence.ts -f idea.txt          # long idea from a file
echo "My thesis ..." | deno run -A selfIntelligence.ts

# 2) Turn the map into an Obsidian vault:
deno run -A mapToObsidian.ts runs/demo.json --out ./vault
#   ...then "Open folder as vault" in Obsidian and start at _Index.

# 3) Training mode (hides conclusions, reveals only the next why):
deno run -A mapToObsidian.ts runs/demo.json --out ./vault-train --training
```

### Run the tests
```bash
deno test -A selfIntelligence.test.ts
```

---

## CLI options (`selfIntelligence.ts`)

```
Input:
  -i, --idea <text>        The idea/thesis (or pass it positionally)
  -f, --idea-file <path>   Read the idea from a file

Backend / output:
      --backend <name>     gemini | openai | ollama | mock   (default gemini)
                           openai uses OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL
                           ollama uses OLLAMA_BASE_URL (def http://localhost:11434/v1) / OLLAMA_MODEL
  -o, --out <path>         Output JSON (default ./runs/<timestamp>.json)
      --checkpoint         Incrementally write the map to --out as it runs
      --cache <dir>        Cache LLM responses on disk (dedupe identical prompts)
      --memory <file>      Infinite memory: load prior truths at start, save at end

Search shape:
  -d, --max-depth <n>      Recursion cycles            (default 2)
  -b, --breadth <n>        Fan width per generation     (default 3)
      --max-nodes <n>      Node budget                  (default 80)
      --max-llm-calls <n>  LLM call budget              (default 300)
  -c, --concurrency <n>    Parallel LLM calls           (default 1)
      --truths <n>         Initial truths               (default 6)
      --jumps <n>          Cross-domain jumps           (default 4)
      --action-paths <n>   Alternative action paths     (default 4)

Reasoning quality:
      --vote <n>           Self-consistency samples on the validity gate (default 1)
      --retries <n>        JSON repair retries          (default 1)
      --dedup-threshold <f> Jaccard sim to treat nodes as duplicates (default 0.85)
      --no-dedup           Disable semantic dedup (full tree)
      --falsify            "no-but" red-team each solution (prunes weak ones)
      --temperature <f>    Sampling temperature for openai/ollama (default 0.4)
      --no-reeval          Disable context re-evaluation pass
      --no-agentic         Disable agentic CRUD reconciliation
  -m, --mock               Deterministic mock LLM (no network)
      --quiet              Less logging
```

### Backends
```bash
# Free Gemini scraper (default)
deno run -A selfIntelligence.ts "My idea"

# OpenAI (or any OpenAI-compatible endpoint)
OPENAI_API_KEY=sk-... OPENAI_MODEL=gpt-4o-mini \
  deno run -A selfIntelligence.ts --backend openai "My idea"

# Local Ollama
OLLAMA_MODEL=llama3.1 deno run -A selfIntelligence.ts --backend ollama "My idea"
```

---

## The Obsidian vault

- **`_Index`** — MOC with the final action paths (⭐ = recommended), run stats, a
  **Mermaid graph** of the reasoning DAG, and the full reasoning tree.
- **`_Action Paths`** — each path with steps, tradeoffs, risks, **pre-mortem
  kill-criteria**, when-to-prefer, defense score, and links to its source nodes.
- **`_Context (Truths)`** — active truths (source · evidence · confidence) + retired
  (soft-deleted) truths.
- **`_Snapshots`** — the historical snapshot chain (CRUD over context).
- **`_Cross-Domain Jumps`** — analogies and their vices.
- **One note per node** — idea / challenge / why / solution, with YAML `parent`
  property + wikilinks so Obsidian's Graph view renders the whole map.
- **`--training`** — hides solutions / verdicts / action paths and surfaces only the
  next open *why*, so the vault trains your reasoning instead of replacing it.

---

## Comparing runs over time

```bash
deno run -A diffMaps.ts runs/old.json runs/new.json
```
Shows how added evidence shifted truths, action paths, and the recommended route —
useful with `--memory` to watch the map converge as knowledge accumulates.

---

## Programmatic use

```ts
import { runIntelligence, MockLLMClient } from "./selfIntelligence.ts";

const map = await runIntelligence(
  "My idea",
  { maxDepth: 3, breadth: 3, vote: 3, falsify: true },
  new MockLLMClient(), // omit to use the Gemini scraper
);
console.log(map.actionPaths, map.recommendedPathId);
```
```

