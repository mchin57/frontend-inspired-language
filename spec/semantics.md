# AIL semantic core (internal design doc)

This is the implementer's reference — not token-budgeted, never shown to a generating
model. The in-context specs (`spec-T.md`, `spec-I.md`, `spec-R.md`) are derived from it.

## Program model

A program is an unordered set of **declarations**, each with a unique ID. The file is
the canonical serialization: one declaration per line, LF endings, no blank lines, no
comments, declarations sorted by (kind order, then ID). Kind order:
`sig, derive, comp, node, on, act`. The first line is a header: `ail1 T|I|R`
(language version 1 + serialization profile).

IDs match `[a-z][a-z0-9_]*`. `on` declarations are identified by `nodeId.event`
(dots cannot appear in plain IDs, so these never collide).

A node with ID `root` is required; it is mounted into `document.body`.

## Declaration kinds

| kind   | meaning                              | profile-I surface |
|--------|--------------------------------------|-------------------|
| sig    | mutable state cell                   | `sig id init` or `sig id:Type init` (annotation only when init is `[]`) |
| derive | pure computed value                  | `derive id expr` |
| comp   | parameterized display template       | `comp id(p:T ...) (inline-node)` |
| node   | named DOM element                    | `node id tag{attrs} children` |
| on     | event handler (one per node.event)   | `on nodeid.event action` |
| act    | repeating timer                      | `act id ms action` |

## Types

`Int`, `Float`, `Str`, `Bool`, `List<T>`, records `{f:T f:T}` (structural; canonical
field order is sorted by name). No coercion anywhere. Int and Float never mix; `/` and
`%` on Int are integer division/modulo.

Inference: sig type = type of init expression (annotation required exactly when the
init is `[]`, whose element type is unknowable); derive type = type of its expression;
comp param types are always annotated.

## Expressions (pure)

- Literals: `0`, `-3`, `1.5` (Float iff it contains `.`), `"str"`, `true`, `false`,
  list `[e e e]`, record `{f:e f:e}`.
- String templates: `"text {expr} text"`. `{expr}` interpolates Int/Float/Str/Bool.
  Escapes: `\"`, `\\`, `\{`, `\n`.
- References: any sig/derive ID; comp params inside a comp body; `it` (item) and `ix`
  (index, Int) inside an each-template; `val` (Str, event target value) and `key`
  (Str, key name) inside handler scope (`val`: input/change/keydown; `key`: keydown).
- Operators (C precedence): `! - (unary)`, `* / %`, `+ -`, `< <= > >=`, `== !=`,
  `&&`, `||`, ternary `c?a:b`. Arithmetic: Int×Int or Float×Float. `+` is numeric
  only (string building uses templates). `==`/`!=` on any two equal types.
  Comparisons on Int/Float/Str.
- Field access `e.f`, indexing `e[i]` (List<T> × Int → T).
- Builtins: `len(list|str)->Int`, `filter(list pred)->list` where pred is `.f` or
  `!.f` (f a Bool field of the element type), `has(str str)->Bool` (contains),
  `int(str)->Int` (total; non-numeric → 0), `str(any-scalar)->Str`.

## Nodes

`node id tag{attrs} children`

- `{attrs}` omitted when empty. Attrs sorted by name, `name=expr`, space-separated.
- Children: a bracketed space-separated list `[c c c]`; brackets elided when there is
  exactly one child; omitted entirely for none. Child forms:
  - `id` — reference to a named node (each named node may appear as a child at most
    once; every non-root named node must appear exactly once, as a child or as an
    each-template or comp usage).
  - `"template"` — text child.
  - `(tag{attrs} [children])` — inline anonymous node (not addressable, no handlers).
  - `each(listExpr templateNodeId)` — repeat the template node per element.
  - `compid(arg=expr ...)` — component instance.
- Recognized attrs: `s` (style tokens, string literal, validated), `show` (Bool —
  element hidden when false), `value`, `checked`, `disabled`, `placeholder`, `type`,
  `href`, `for`, `name`, `min`, `max`, `step`. `value`/`checked` are one-way bindings
  (state → DOM); the reverse direction is an explicit `on … input/change` handler.
- Tags: any lowercase HTML tag name.

### Each-templates
The template node and its descendants (named or inline) form a scope where `it` and
`ix` are bound. Handlers on named nodes inside the template receive the instance's
`it`/`ix`. A template node must be referenced by exactly one `each` and nowhere else.

### Components
`comp id(p:Type ...) (inline-node-tree)` — a pure display template. The body may
reference params and global sigs/derives. No named nodes, handlers, or local state
inside comp bodies (v1 limitation; interactivity uses named nodes / each-templates).
Instantiated as a child: `id(p=expr ...)`.

## Actions (handler / act bodies)

- Assign: `sig=expr`; compound: `x+=e` (append for List, add for Int/Float),
  `x-=e` (remove-at-index for List, subtract for Int/Float);
  element/field update: `x[i]=e`, `x[i].f=e`.
- Sequence: `a;b` (left to right).
- Guard / branch: `cond ? action` or `cond ? action : action`; group with `(a;b)`.
- Timers: `start(actId)`, `stop(actId)` (acts begin stopped; `start` on a running act
  is a no-op, likewise `stop`).
- Only sigs are assignable. `it`/`ix`-based writes (`todos[ix].done=…`) are allowed in
  template-scoped handlers.

## Style vocabulary (`s` attr)

Fixed validated tokens, mapped to CSS by the runtime stylesheet:
`row col gap1 gap2 gap3 gap4 p1 p2 p3 p4 m1 m2 m3 m4 w_full flex1 center bold italic
small large muted card btn input list`.
Unknown tokens are a checker error.

## Checker rules (each has a stable error code)

- `dup-id` — duplicate declaration ID.
- `no-root` — missing `node root`.
- `bad-ref` — reference to unknown ID (expr ref, child ref, each template, comp, act).
- `type` — any type rule violation (with expected/actual detail).
- `needs-ann` — sig init `[]` without annotation (profiles I/R; T infers from usage,
  and errors only if usage never determines the type).
- `cycle` — derive dependency cycle.
- `orphan` — sig/derive/comp/act never referenced; named non-root node not placed
  exactly once.
- `scope` — `it`/`ix`/`val`/`key` used outside their scope; handler on a node inside a
  comp body; assignment to a non-sig.
- `dup-handler` — two handlers for the same node.event (impossible in canonical form;
  arises via edit ops).
- `bad-attr` / `bad-style` / `bad-event` — unknown attr name / style token / event.
- `canon` — file is parseable but not in canonical form (ordering, spacing, elision).
  Detail carries the canonical rendering of the offending line.
- `effects` (profile R only) — declared `r[…] w[…]` don't match inferred reads/writes.

Every error is one JSON line: `{"error":code,"decl":id,"detail":…,"fix":editOp}` where
`fix`, when present, is an edit-protocol op that resolves the error.

## Edit protocol

Ops (JSON lines): `{"op":"add","decl":"<line>"}`, `{"op":"replace","id":X,"decl":"<line>"}`,
`{"op":"del","id":X}`. The applier parses, applies, re-sorts, re-serializes
canonically, and re-checks. Models should always edit via ops, never by rewriting the
file.

## Serialization profiles

Shared semantics; the surface differs:

- **I** (reference, described above): minimal surface, annotations only where
  inference is impossible.
- **R**: every sig and derive carries `:Type`; every `on` and `act` carries inferred
  effect lists `r[a,b] w[c]` between the event and the action, which the checker
  verifies against inference.
- **T**: keywords shortened to `s d c n o a`; no type annotations anywhere (empty-list
  element types inferred from program-wide usage); comp instance args positional
  (`card("Hi" 3)`); otherwise identical.

`ail convert` maps any profile to any other losslessly (T→I/R may require inference to
materialize annotations).

## Runtime (interpreter)

`ail build` emits one self-contained HTML file: a `<script type="application/json">`
declaration table + the fixed runtime (~300 lines vanilla JS) + the style-token
stylesheet. The runtime: creates signal cells with subscriber sets; evaluates derives
lazily with dependency tracking; renders named/inline nodes once and subscribes each
reactive attr/text hole to its dependencies; re-renders an `each` container wholesale
when its list changes (v1 simplicity); binds handlers, evaluating actions atomically
(all writes applied, then subscribers notified once per changed sig).
