# ⚡ Quickstart — one command to run the whole pipeline

You only need to fill in two things:

| Slot | What to put |
|------|-------------|
| `IDEA` | Your thesis, decision, or hypothesis (one sentence is enough) |
| `CONTEXT` | Background knowledge the LLM should take as given — paste key facts, constraints, numbers, or point to a text file |

---

## The one-liner

```bash
IDEA="Your thesis or decision here" && \
CONTEXT="Fact one. Fact two. Constraint three." && \
deno run -A selfIntelligence.ts "$IDEA" \
  --context "$CONTEXT" \
  -o runs/my-idea.json \
  && deno run -A mapToObsidian.ts runs/my-idea.json --out ./vault
```

**Then open the `vault/` folder as an Obsidian vault and start at `_Index.md`.**

---

## Live example (copy-paste ready, no network needed)

```bash
IDEA="Mandatory competitive coding in schools closes the cognitive-skill gap faster than tutoring" && \
CONTEXT="Working memory capacity is trainable with deliberate practice. \
Transfer of cognitive skills depends on structural similarity between training and target tasks. \
RCT studies show coding improves logical but not verbal reasoning. \
Current curricula allocate <2% of time to computational thinking." && \
deno run -A selfIntelligence.ts "$IDEA" \
  --context "$CONTEXT" \
  --mock \
  -o runs/coding-education.json \
  && deno run -A mapToObsidian.ts runs/coding-education.json --out ./vault-coding
```

---

## Context from a file (for long briefs)

Write your background as plain text — one fact/bullet per line:

```
# context.txt
Working memory capacity is trainable with deliberate practice.
Transfer of cognitive skills depends on structural similarity between training and target tasks.
RCT studies show coding improves logical but not verbal reasoning.
Current curricula allocate less than 2% of time to computational thinking.
```

Then pass the file path instead of inline text:

```bash
deno run -A selfIntelligence.ts "Your idea" \
  --context ./context.txt \
  -o runs/output.json \
  && deno run -A mapToObsidian.ts runs/output.json --out ./vault
```

---

## With a real LLM (Gemini scraper, no key needed)

```bash
deno run -A selfIntelligence.ts "Your idea" \
  --context "Fact 1. Fact 2." \
  -o runs/output.json \
  && deno run -A mapToObsidian.ts runs/output.json --out ./vault
```

> Gemini is the default backend. It uses the free `scraperLLM.ts` browser scraper.
> No API key needed.

---

## With OpenAI / Ollama

```bash
# OpenAI
OPENAI_API_KEY=sk-... deno run -A selfIntelligence.ts "Your idea" \
  --backend openai --context "Fact 1. Fact 2." -o runs/output.json \
  && deno run -A mapToObsidian.ts runs/output.json --out ./vault

# Local Ollama (e.g. llama3.1 running on localhost)
OLLAMA_MODEL=llama3.1 deno run -A selfIntelligence.ts "Your idea" \
  --backend ollama --context "Fact 1. Fact 2." -o runs/output.json \
  && deno run -A mapToObsidian.ts runs/output.json --out ./vault
```

---

## Add quality flags

Append any combination of these to the engine command:

| Flag | Effect |
|------|--------|
| `--falsify` | Red-team every solution ("no, but" pass). Prunes weak ones. +12% calls. |
| `--vote 3` | Majority-vote the validity gate 3 times. Reduces false positives. |
| `-d 3 -b 4` | Deeper (3 cycles) and wider (4 challenges each). More exhaustive. |
| `--checkpoint` | Save progress to `--out` incrementally (resume-safe on long runs). |
| `--memory memory.json` | Persist truths across runs — context accumulates over time. |
| `--cache .cache` | Cache LLM responses on disk — free on repeated/similar prompts. |

Example with all quality flags:

```bash
IDEA="My decision here" && \
CONTEXT="Key fact 1. Key fact 2." && \
deno run -A selfIntelligence.ts "$IDEA" \
  --context "$CONTEXT" \
  --falsify --vote 3 \
  -d 3 -b 3 \
  --checkpoint \
  --memory memory.json \
  --cache .cache \
  -o runs/output.json \
  && deno run -A mapToObsidian.ts runs/output.json --out ./vault
```

---

## Training mode (don't show me the answers)

```bash
deno run -A mapToObsidian.ts runs/output.json --out ./vault --training
```

Hides solutions, validity verdicts, and action paths. The vault surfaces only the
next open *why* so **you reason first**, then reveal the map's route.

---

## What you get

After the command runs you have:

```
vault/
├── _Index.md          ← start here — Mermaid DAG + recommended ⭐ action path
├── _Action Paths.md   ← all paths, steps, pre-mortem kill-criteria
├── _Context (Truths).md  ← evidence-grounded truths + CRUD history
├── _Snapshots.md      ← versioned context chain
├── _Cross-Domain Jumps.md  ← analogies + their vices
└── n1 💡 ...md        ← one note per node, wikilinked
```
