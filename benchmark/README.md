# Benchmark

Objective: measure **total loop tokens per working feature** — in-context spec
(amortized) + program writes + re-reads while editing + error/fix iterations —
for AIL (profiles T/I/R) against a React/TSX baseline.

## Stage 1 — static token counts (automated)

`npx tsx benchmark/tokens.ts > benchmark/tokens.md`

Compares the 5 hand-written examples in all three profiles against idiomatic
React equivalents (`benchmark/react/`). Gate: ≥2× fewer source tokens than
React or the syntax needs rework.

## Stage 2 — single-shot generation validity (semi-manual)

For each profile × each task in `tasks/small/`:
1. Fresh model context. Prompt = the profile's spec (`spec/spec-*.md`) + the task.
2. One generation, no retries. Save to `runs/<profile>/<task>.ail`.
3. `npx tsx src/cli.ts check <file>` — record error count and codes.

Metrics: valid-on-first-try rate; mean checker errors per generation; error-code
distribution (which rules do models trip?). Purpose: prune the weakest profile
before paying for stage 3.

## Stage 3 — full loop (semi-manual)

Surviving profile(s) + React baseline on `tasks/medium/dashboard.md`:
1. Same prompt structure; model produces the program.
2. AIL: run `check`; feed the JSON errors back verbatim; model replies with edit
   ops; `ail edit` applies them. Repeat until clean or 5 iterations.
   React: run `tsc`; feed errors back; model replies with a full revised file.
3. When clean, verify behavior manually against the task's acceptance checklist.
4. Count: total tokens sent+received (including spec and every re-read), fix
   iterations, remaining functional defects.

Record everything in `RESULTS.md`.
