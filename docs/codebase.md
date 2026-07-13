# TC codebase guide

For anyone (human or model) modifying the compiler/toolchain. Language docs are
in `writing-tc.md`; rationale in `design-decisions.md`; precise semantics in
`spec/semantics.md`.

## Layout

```
spec/semantics.md      implementer's reference (not token-budgeted)
spec/spec-{T,I,R}.md   in-context specs — the model-facing language definition
src/ast.ts             AST types + constants (attrs, events, style tokens) + sort order
src/parse.ts           lexer + recursive-descent parser, all profiles
src/serialize.ts       canonical serializer, all profiles
src/infer.ts           type & effect inference (typeExpr/typeAction/buildEnv)
src/check.ts           checker orchestration, structured errors, annotate(), convert()
src/edit.ts            edit-protocol op parsing/application
src/build.ts           HTML emission (embeds program JSON + runtime + stylesheet)
src/runtime.js         the fixed browser interpreter (plain JS, embedded verbatim)
src/tokens.ts          BPE token counting (gpt-tokenizer, o200k_base proxy)
src/cli.ts             ail check|build|convert|edit|tokens
tests/roundtrip.test.ts  parse↔serialize identity, cross-profile conversion
tests/checker.test.ts    every rule tripped + every fix op heals
tests/e2e.test.ts        built HTML driven in jsdom (clicks, typing, timers)
examples/<app>.{i,t,r}.ail  5 apps × 3 profiles (t/r are generated from i)
benchmark/             React equivalents, token report, task prompts, results
```

## Data flow

```
text ──parse.ts──► Program {profile, decls[]}          (whitespace-insensitive)
Program ──infer.buildEnv──► ProgramEnv (sig/derive types, comps, nodes, acts)
Program+Env ──check.ts──► AilError[] {error, decl, detail, fix}
Program ──serialize.ts──► canonical text                (canon check = compare to input)
Program+Env ──check.annotate──► Program with ann/eff filled  (for R output & fixes)
Program(JSON) + runtime.js + CSS ──build.ts──► self-contained HTML
```

## Invariants — break these and things fail in non-obvious ways

1. **The AST is plain JSON.** `runtime.js` interprets the same objects
   `JSON.stringify` embeds. No classes, functions, Maps, or cycles in AST nodes.
2. **Canonical form is defined by the serializer.** `serialize(parse(x)) === x`
   *is* the canon check; there is no separate formatter. If you change any
   output detail, every stored example and spec code block changes with it.
3. **Every checker fix must heal.** `tests/checker.test.ts` `expectFixHeals`
   applies emitted fixes and re-checks. A fix that doesn't resolve its error is
   a test failure by design.
4. **Parser accepts loosely, serializer defines strictly.** The parser ignores
   spacing and accepts optional commas; canon errors surface the difference.
   Keep it that way — it makes fixes cheap (parse the sloppy input, emit the
   canonical line).
5. **`typeExpr` marks the AST.** Float division sets `fdiv` on bin nodes during
   checking (the runtime can't tell 2.0 from 2). Programs must be *checked*
   before being built or the mark is missing — `build()` runs `check()` first;
   don't bypass it.
6. **Effects/annotations are filled by `annotate()`,** not stored in source for
   profiles T/I. The serializer throws if asked to emit R without them.
7. **Adjacency matters in child position only.** `panel(…)` (instance) vs
   `disp (…)` (ref + inline sibling) is distinguished by the lexer's `adj` flag
   on `(`. Expressions never use juxtaposition.

## How to make common changes

Everything on each list, or tests/spec drift silently.

**Add a builtin function**
1. `ast.ts` BUILTINS; 2. `infer.ts` typeExpr `call` case (arity + types);
3. `runtime.js` evalE `call` case; 4. all three `spec/spec-*.md` + `semantics.md`;
5. a use in an example or checker test.

**Add an attr or style token**
`ast.ts` (ATTRS/STYLE_TOKENS) → `check.ts` ATTR_TYPES (attrs only) →
`runtime.js` render (if special behavior) → `build.ts` CSS (styles only) →
specs.

**Add a checker rule**
`check.ts` (+ `infer.ts` if type-level) with a stable error code; emit a `fix`
op whenever the repair is mechanical; add a broken-variant test in
`checker.test.ts` (use `expectFixHeals` if it has a fix); document the code in
`semantics.md` and mention it in the specs' checker section if models will hit it.

**Change syntax**
`parse.ts` + `serialize.ts` in the same change; run `npm test` — round-trip
tests catch asymmetry; regenerate examples (`.i.ail` are hand-maintained,
then `ail convert` regenerates `.t.ail`/`.r.ail` — see below); update all three
specs and `semantics.md`; re-run `npx tsx benchmark/tokens.ts > benchmark/tokens.md`
to see the token cost of the change. That last step is the point of the project:
**syntax changes are A/B tests, run them.**

**Change the runtime**
`runtime.js` only; it must stay dependency-free, ES5-ish plain JS. Behavior is
specified by `tests/e2e.test.ts` — extend it for new behavior.

## Regenerating derived files

```
# after editing examples/<app>.i.ail:
npx tsx src/cli.ts convert examples/<app>.i.ail --to T > examples/<app>.t.ail
npx tsx src/cli.ts convert examples/<app>.i.ail --to R > examples/<app>.r.ail
# token report:
npx tsx benchmark/tokens.ts > benchmark/tokens.md
# demo pages (gitignored):
npx tsx src/cli.ts build examples/<app>.i.ail -o examples/<app>.out.html
```

Round-trip tests verify the on-disk `.t.ail`/`.r.ail` match fresh conversion,
so a stale regeneration fails CI-style.

## Testing

`npm test` (vitest, ~2s). Three suites, three philosophies:
- **roundtrip** — the serializer/parser contract, mechanical and exhaustive
  over the example corpus.
- **checker** — adversarial: one broken program per rule; fixes must heal.
- **e2e** — behavioral: build real HTML, drive it in jsdom (`runScripts:
  'dangerously'`), assert on the DOM. Named nodes carry `data-ail="<id>"`
  attributes solely for these tests/debugging.

`npm run typecheck` for tsc. No lint config yet.

## Known limitations / sharp edges

- `each` re-renders its whole block on any list change: input focus inside
  rows is lost; O(n) per keystroke if a row contains a bound input. Keyed
  diffing is future work.
- Comp bodies are display-only (checker-enforced); no local state anywhere but
  sigs (global).
- Profile T's empty-list inference scans `+=`/`=` usages and gives up
  otherwise (`needs-ann` with no in-profile fix).
- `parse.ts` uses backtracking in action position (assignment vs guard vs
  paren-group); if you add action forms, check the backtrack points.
- Windows: PowerShell pipelines mangle multi-line stdout (`Out-File -NoNewline`
  concatenates lines). Use bash or `ail build`-style file output for anything
  that must round-trip. `.gitattributes` forces LF for `.ail` sources —
  canonical form assumes LF.
- npm audit reports vulnerabilities in dev-dependency chains (vitest/esbuild);
  no runtime exposure (the built HTML has zero dependencies), revisit when
  bumping vitest.
