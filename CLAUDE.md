# TC (Token Cheater) — token-optimized AI language experiment

A web-UI language minimizing **total loop tokens** (spec + writes + re-reads +
fix loops) for AI authors. CLI/headers use the historical name `ail`.

## Read first
- `docs/codebase.md` — architecture, invariants, and the "when you change X,
  also update Y" lists. **Follow those lists**; examples/specs/tests drift
  silently otherwise.
- `docs/writing-tc.md` — how to write TC programs.
- `docs/design-decisions.md` — rationale + current evidence; check before
  relitigating a decision.
- `benchmark/README.md` + `RESULTS.md` — evaluation protocol and status
  (stage 1 done: 1.9× vs React; stages 2–3 not run).

## Commands
```
npm test                            # 79 vitest tests (~2s): roundtrip, checker, jsdom e2e
npm run typecheck
npm run ail -- check|build|convert|edit|tokens <file>
npx tsx benchmark/tokens.ts > benchmark/tokens.md   # regenerate token report
```

## Hard rules
- `serialize(parse(x)) === x` defines canonical form; syntax changes touch
  parse.ts + serialize.ts together, then regenerate `examples/*.{t,r}.ail` via
  `ail convert` (roundtrip tests enforce freshness).
- Every checker error with a mechanical repair must carry a `fix` edit op, and
  `tests/checker.test.ts` must prove it heals.
- AST stays plain JSON (runtime.js interprets it verbatim). `build()` must run
  `check()` first (typing marks `fdiv` on the AST).
- The specs `spec/spec-{T,I,R}.md` are part of any language change's diff;
  keep each ≤2k tokens (`ail tokens` them).
- **Every syntax decision is an A/B test**: measure with `benchmark/tokens.ts`
  before/after and say what it cost.
- Windows: use bash (not PowerShell pipes) for anything writing program text;
  `.ail` files are LF.
