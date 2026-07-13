# Results

## Stage 1 — static token counts ✅ (2026-07-13)

See `tokens.md` (regenerate: `npx tsx benchmark/tokens.ts > benchmark/tokens.md`).

Headline: **AIL profile I = 1.9× fewer source tokens than idiomatic React/TSX**
across the 5 example apps (638 vs 1222, o200k_base). Best: todos & stopwatch 2.0×;
worst: form 1.7×. Gate was "~2×" — treated as passed, with notes:

- **T ≈ I (622 vs 638).** Single-letter keywords save ~2.5%: BPE makes `sig` and
  `s` both one token. This confirms the design thesis — savings come from deleting
  structure, not shortening words — and weakens the case for profile T before
  stage 2 even runs. T's remaining edge is dropped annotations, which is also its
  correctness risk.
- **R costs +19% over I** (759 vs 638) for its declared effects + annotations.
  Whether that buys a better fix loop is exactly the stage-2/3 question.
- Static counts exclude AIL's edit protocol: an AIL edit is ~1 declaration line
  (`{"op":"replace",…}`), a React edit in a naive loop is a full-file rewrite.
  Loop-token accounting in stage 3 should capture this.
- In-context spec cost (amortized over a session): T=1245, I=1235, R=1360 tokens.

## Stage 2 — single-shot validity ⬜ (not run)

Protocol in `README.md`. Needs fresh model contexts (subagents or API runs).

| profile | tasks valid first-try | mean checker errors | notes |
|---|---|---|---|
| T | | | |
| I | | | |
| R | | | |

## Stage 3 — full loop vs React ⬜ (not run)

| condition | total tokens | fix iterations | functional defects |
|---|---|---|---|
| AIL (winner profile) | | | |
| React/TSX | | | |
