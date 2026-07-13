# AIL — a token-optimized language for AI-authored web UIs

An experiment: a programming language for web/event-style UIs designed for AI authors,
optimizing **total loop tokens per working feature** — the in-context spec (amortized),
program writes, every re-read during editing, and error/fix iterations. Human
readability is explicitly not a goal.

## Design principles

- **Design against the tokenizer, not character count.** Savings come from deleting
  structure (closing tags, quote pairs, ceremony), not abbreviating words — common
  words are already single BPE tokens.
- **Abstraction is compression.** Components and record types exist because reuse is
  the main mechanism for beating TSX on token count.
- **Infer, don't declare.** The checker is maximally strict via inference; annotations
  appear only where inference is ambiguous.
- **Flat, ID-addressed, canonical.** Order-insensitive declarations with stable IDs,
  exactly one valid serialization, and an ID-addressed edit protocol so edits never
  rewrite whole files.
- **Structured errors.** One-line JSON errors with machine-readable fix candidates
  keep repair loops short.

## The experiment

One shared semantic core (AST, checker, interpreter runtime); three serialization
profiles testing the terseness↔redundancy trade-off:

- **T** — max terse: positional fields, everything inferable elided
- **I** — terse + inferred checks: minimal surface, strict checker via inference
- **R** — redundant: explicit types + effect lists, checked against inference

Evaluation is staged: (1) static token counts vs hand-written React equivalents,
(2) single-shot generation validity with each profile's spec in-context,
(3) full total-loop benchmark of survivors vs a React baseline.

## Layout

- `spec/semantics.md` — internal design doc (AST, types, checker, runtime)
- `spec/spec-{T,I,R}.md` — the in-context specs (~2k tokens each)
- `src/` — compiler: parsers/serializers per profile, checker, runtime embedding, CLI
- `examples/` — programs in all three profiles
- `benchmark/` — token tables, task prompts, results

## CLI

```
npm run ail -- check <file>          # structured JSON errors
npm run ail -- build <file> -o out.html
npm run ail -- convert <file> --to T|I|R
npm run ail -- edit <file> <ops-file>
npm run ail -- tokens <file>         # BPE token count (o200k_base proxy)
```
