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

## Stage 2 — single-shot validity ✅ (2026-07-13)

Protocol in `README.md`. Run as 30 fresh subagent contexts (3 profiles × 5
`tasks/small` × 2 models), each prompted with only the profile spec + one task,
no repo access, one generation, no retries. Outputs in `runs/<model>/<profile>/`.
Score (regenerate): `npx tsx benchmark/score.ts`.

Metric = **checker-valid on first try** (syntax/type/format/effects). This is
*not* functional correctness — a program can pass the checker and still miss the
acceptance criteria; that's Stage 3. Caveats: n=5 per cell is small, and the two
models were run once each.

| profile | model | valid first-try | mean checker errors |
|---|---|---|---|
| T | fable | 5/5 | 0.00 |
| T | opus  | 4/5 | 0.60 |
| I | fable | 5/5 | 0.00 |
| I | opus  | 3/5 | 1.00 |
| R | fable | 5/5 | 0.00 |
| R | opus  | 2/5 | 1.00 |

Headline: **fable 15/15 checker-valid; opus 9/15.** The smaller/faster model was
*more* reliable here — with no checker feedback, single-shot success rewards
literal adherence to the spec's terse idioms, and opus's more inventive
constructions tripped the strict checker. Error taxonomy (opus; fable had none):

- **`bad-style` ×9 — one recurring conceptual miss, repeated across all 3
  profiles.** Every opus `lights` used a *computed* `s=` (e.g.
  `s=phase==0?"large bold":"muted"`) to move the highlight. The language requires
  `s="…"` to be a literal string of style tokens; conditional styling must be
  done by toggling `show=` on variant nodes (which is exactly what fable did).
  This is the expensive kind of error: **no `fix` op** — it needs a structural
  rethink, not a mechanical repair.
- **`canon` ×3 (opus I/R `shop`) — trivially auto-healable.** Handler-body
  spacing / declaration ordering slips; each carries a ready `fix` op the edit
  loop applies in one step.
- **`dup-id` ×1 (opus R `vote`) — declared `total` twice; carries a `fix`.**

Functional defects also exist *behind* checker-valid programs (Stage-3 material,
not counted above): opus T `chars` shipped the "Too long" warning with no `show=`
guard (always visible); opus/fable R `shop` cannot truly sum quantities — profile
R/I have no fold/reduce builtin, so several runs approximated the total with
`len(items)` or a hand-maintained counter. Worth a language note: the missing
aggregation builtin surfaced as a real expressiveness gap on `shop`.

Read on Stage 3: opus's healable errors (canon/dup-id) are cheap in a fix loop;
its one structural error (lights styling) is not. That gap — mechanical vs
conceptual repair — is what Stage 3's loop-token accounting should quantify.

## Stage 3 — full loop vs React ⬜ (not run)

| condition | total tokens | fix iterations | functional defects |
|---|---|---|---|
| AIL (winner profile) | | | |
| React/TSX | | | |
