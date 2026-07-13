# TC design decisions

Why the language is the way it is. Each decision records its rationale and its
status: **validated** (we have data), **bet** (reasoned but untested), or
**open** (deliberately deferred).

## The objective function

TC minimizes **total loop tokens per working feature**:

```
spec-in-context (amortized) + program writes + re-reads while editing + error/fix iterations
```

Not "shortest program." A terse language that causes more fix iterations loses
to verbose TSX on this metric. Every decision below traces back to some term of
this sum. Human readability is explicitly not a goal — but see "terse ≠ fewer
tokens" below for why the surface ended up human-legible anyway.

## Decisions

### Design against the tokenizer, not character count — validated
BPE tokenizers make common words single tokens: `sig`, `on`, `button` each cost
1, the same as `s`, `o`, `b`. Savings come from deleting *structure* — closing
tags, quote pairs, `className=`, import/useState ceremony — not from
abbreviating words. **Stage-1 data confirmed this immediately**: profile T
(single-letter keywords) saves only ~2.5% over profile I (622 vs 638 tokens
across the 5 examples). Exotic symbols were rejected for the same reason: `§`
can cost 2–3 tokens where `sig` costs 1.

### Flat, ID-addressed declarations — bet
No nesting for scope, no ordering. Rationale: (a) two edits to different
declarations can never conflict; (b) the compiler sees the whole dataflow graph
and can check things TSX structurally can't; (c) an "insert in the wrong place"
bug is unrepresentable. Cost: ids repeat at the declaration and the placement
site. Inline anonymous nodes exist to cap that cost for structure needing no
identity.

### Exactly one canonical serialization — bet
Fixed sort order, spacing, elision rules. No formatting choices means no wasted
tokens ever, byte-stable diffs, and `serialize(parse(x)) === x` doubles as the
canon checker. Models don't have to *produce* canonical form — the checker's
`canon` errors carry the corrected line as a ready fix.

### Edit protocol instead of text patching — bet
`{"op":"add"/"replace"/"del"}` targeting ids. An edit costs ~1 declaration line
regardless of program size; a naive React loop rewrites the file. This is
probably the biggest single term in the loop-token sum and the least captured
by static counts; stage 3 measures it.

### Infer, don't declare — bet
The checker is maximally strict, but types are inferred from literals;
annotations appear only where inference is impossible (empty-list sigs in
profile I). Redundancy costs tokens on every read and write; strictness is
free. Profile R exists to test the opposite position (see below).

### The three-profile experiment — in progress
The terseness↔redundancy trade-off is an empirical question about model error
rates in a zero-training-data language, so we built it as an experiment rather
than assuming: one AST/checker/runtime, three parser/serializer pairs.
- **T** max terse: 1-char keywords, no annotations, positional args.
- **I** reference: minimal surface, inferred checks.
- **R** redundant: annotations everywhere + declared `r[…] w[…]` effects,
  verified against inference (error-correcting redundancy for the model).
Stage 1: T≈I (T's keywords don't pay), R costs +19%. Stage 2 (single-shot
generation validity) decides whether R's redundancy buys accuracy worth 19%.

### Interpreter, not codegen — bet
`ail build` emits the declaration table as JSON plus one fixed ~300-line
runtime. Per-program codegen bugs are unrepresentable; all runtime behavior
lives in one auditable file; output size is irrelevant because no model ever
reads built HTML. Trade-off accepted: interpretation overhead, unmeasurable at
this app scale.

### Strict checker + structured errors with fixes — bet
Every error is one JSON line `{error, decl, detail, fix}` where `fix` is an
edit-protocol op. The compile loop is a machine-to-machine protocol; each error
caught statically with a cheap fix is a hallucination corrected for a handful
of tokens. Orphans (unused sig, unplaced node) are errors, not warnings,
because dead declarations are pure token cost on every future read.

### Fixed style vocabulary + batteries-included defaults — validated (partially)
No CSS in the language: a ~26-token layout/variant vocabulary, checker-
validated, plus default styling for buttons/inputs (added when stage-1 data
showed `s="btn"` repetition was a top waste source; it moved the React ratio
from 1.8× to 1.9×). Limitation acknowledged: no brand styling in v1. The
planned escalation is a `theme` declaration (global design tokens — reskin
everything for ~10 tokens) rather than per-element CSS, keeping design changes
addressable and single-sited. **Open.**

### Components are display-only in v1 — bet, expected to be revisited
`comp` bodies allow no named nodes, handlers, or local state. Kept minimal
because reuse-as-compression (the reason comps exist at all) doesn't require
interactivity in the benchmark tasks. The benchmark will tell us where this
wall is hit in practice.

### Small fixed capability set — bet
v1 effects: `act` timers only. No fetch/FFI/arbitrary JS — every escape hatch
leaks checkability. Fetch is pre-committed to a *declarative* shape when it
comes (`res` declarations with auto loading/error signals), not callbacks.
**Open.**

### The spec is the primary artifact — bet
A model knows TC only through the ~1.3k-token in-context spec. Specs are
treated like prompts: iterated empirically, tested by generation accuracy
(stage 2), token-budgeted (≤2k). When the language changes, the spec change is
part of the diff.

## Rejected alternatives

- **Novel syntax with exotic symbols** — tokenizer-hostile, zero training-data
  transfer, no measured upside.
- **TS/JSX-adjacent dialect** (the "Svelte strategy") — maximizes prior
  transfer but caps token savings at roughly TSX's floor; contradicts the
  sharpened objective. Worth revisiting only if stage 2 shows models can't
  learn TC from the spec alone.
- **Per-program codegen** — more work, introduces a bug class the interpreter
  makes impossible.
- **Program-as-database** (declaration store, text as export) — attractive
  long-term (edit protocol becomes the only mutation path), deferred because
  git/tooling compatibility is worth more during development.
- **`btn`-style utility tokens for everything** — superseded by defaults +
  smaller vocabulary after stage-1 measurements.

## Current evidence (stage 1, 2026-07-13)

| | tokens (5 apps) | vs React 1222 |
|---|---|---|
| T | 622 | 2.0× |
| I | 638 | 1.9× |
| R | 759 | 1.6× |

Specs: T=1245, I=1235, R=1360 tokens. Stages 2–3 not yet run — see
`benchmark/README.md` for the protocol.

## Open questions

1. Does R's redundancy reduce model error rates enough to justify +19% tokens?
   (stage 2)
2. Does the edit protocol dominate loop costs as predicted? (stage 3)
3. `theme` declaration design for brand styling.
4. Declarative fetch (`res`) design; component interactivity; keyed `each`
   diffing (current wholesale re-render loses input focus inside lists).
5. Should T be dropped? Its token edge is ~2.5% and its inference rules
   (empty-list types from usage) are its most fragile part.
