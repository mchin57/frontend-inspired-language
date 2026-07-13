# Writing TC code

TC ("Token Cheater", historical name AIL — the toolchain still uses `ail` in
headers and commands) is a declarative language for browser UIs, designed so an
AI can author and edit programs with the fewest possible tokens. This guide is
the long-form companion to the in-context specs (`spec/spec-I.md` etc.), for
humans and for models doing deeper work on the language itself.

Profile I is used throughout; see [Profiles](#profiles) for T and R.

## Mental model

A program is a **flat, unordered set of one-line declarations**, each with a
unique id. There is no statement sequencing, no nesting for scope, no imports.
Three graphs emerge from the declarations, and the compiler sees all of them
whole:

1. **State graph** — `sig` (mutable cells) feed `derive` (pure computed values).
2. **DOM tree** — `node` declarations reference each other by id to form the
   tree rooted at `root`.
3. **Event wiring** — `on` handlers mutate sigs; everything downstream updates
   automatically. `act` timers do the same on an interval.

You never write render logic, effects, subscriptions, or update code. You
declare what exists and how it's wired; the runtime keeps the DOM in sync.

## A program, line by line

```
ail1 I
sig n 0
node btn button "Count: {n}"
node root div{s="p4"} btn
on btn.click n=n+1
```

- `ail1 I` — version + profile header. Always line 1.
- `sig n 0` — a state cell. Its type (Int) is inferred from the literal.
- `node btn button "Count: {n}"` — a button whose text re-renders whenever `n`
  changes. `{…}` interpolates any scalar expression.
- `node root div{s="p4"} btn` — the required root; `btn` is placed as its child.
- `on btn.click n=n+1` — the wiring.

Note what's absent: no closing tags, no quotes around attr names, no imports,
no `useState`, no re-render reasoning. That's where the token savings live.

## The six declaration kinds

| decl | form | notes |
|---|---|---|
| sig | `sig id init` | mutable state; init must be a literal (no refs) |
| derive | `derive id expr` | pure computed value; auto-updates |
| comp | `comp id(p:Type …) (tag{attrs} kids)` | reusable display template |
| node | `node id tag{attrs} kids` | named DOM element |
| on | `on nodeid.event action` | one handler per node+event |
| act | `act id ms action` | repeating timer, starts stopped |

## State and types

Types: `Int Float Str Bool List<T> {field:Type …}`. Everything is inferred from
literals; the one place an annotation is required is an empty-list sig, whose
element type is unknowable:

```
sig todos:List<{done:Bool text:Str}> []
```

The checker is strict: no coercion, Int and Float never mix, `Int/Int`
truncates. Records are structural — `{done:false text:"x"}` is a
`{done:Bool text:Str}` wherever one is expected.

`derive` is how you avoid recomputing things in multiple places:

```
derive left len(filter(todos,!.done))
```

Any node text or attr that references `left` updates when `todos` changes.

## Building the DOM

Children of a node: none (omit), one (bare), or several (`[a b c]`):

```
node root div{s="col gap2 p4"} [ttl (div{s="row gap2"} [inp add]) list "{left} left"]
```

Child forms, by example:
- `ttl` — a **named node**, declared elsewhere. Name a node when it needs an
  event handler or you expect to edit it later. Every named node (except root)
  must be placed exactly once — an unplaced node is an error, not a warning.
- `(div{s="row gap2"} [inp add])` — an **inline anonymous element**. Use these
  for structure that needs no identity: wrappers, static text containers.
- `"{left} left"` — a **text child** with interpolation.
- `each(todos,row)` — **list rendering**: repeat the `row` template node once
  per element. Inside `row`, its descendants, and their handlers, `it` is the
  element and `ix` its index.
- `panel(i=0 txt="Home page")` — a **component instance**.

## Events and actions

Events: `click input change submit keydown`. In `input`/`change`/`keydown`
handlers, `val` is the target's current value (Str); in `keydown`, `key` is the
key name.

Actions compose from a tiny set:

```
on inp.input draft=val
on add.click draft!="" ? (todos+={done:false text:draft};draft="")
on del.click todos-=ix
on tgl.change todos[ix].done=!todos[ix].done
on go.click run ? (stop(tick);run=false) : (start(tick);run=true)
```

- `sig=expr` assigns; `+=` appends (list) or adds (number); `-=` removes at
  index (list) or subtracts (number).
- Paths drill into structures: `todos[ix].done=…`.
- `;` sequences, `cond ? a : b` branches (`: b` optional). Parenthesize a
  sequence used as a branch: `cond ? (a;b)`.
- `start(id)`/`stop(id)` control `act` timers.

The two-way-binding pattern is always explicit: `value=draft` pushes state to
the DOM, `on inp.input draft=val` pushes the DOM back to state. There is no
magic binding to debug.

## Components

`comp` is a parameterized display template:

```
comp panel(i:Int txt:Str) (div{s="card" show=tab==i} "{txt}")
```

Bodies may reference params and any sig/derive, but are **display-only**: no
named nodes, no `each`, no handlers inside. Anything interactive stays at the
top level as named nodes. (This is a v1 restriction.)

## Styling

Buttons and inputs are pre-styled by the runtime stylesheet — a bare
`node add button "Add"` looks fine. `s="…"` adds layout and variants from a
fixed vocabulary (anything else is a checker error):

```
row col gap1-4 p1-4 m1-4 w_full flex1 center bold italic small large muted card btn input list
```

There is deliberately no arbitrary CSS in v1.

## The workflow: check, fix, build

```
npm run ail -- check examples/todos.i.ail     # errors as one-line JSON
npm run ail -- build examples/todos.i.ail -o todos.html
npm run ail -- tokens examples/todos.i.ail    # BPE token count
npm run ail -- convert examples/todos.i.ail --to R
```

Errors carry machine-applicable fixes:

```json
{"error":"canon","decl":"root","detail":"not in canonical form",
 "fix":{"op":"replace","id":"root","decl":"node root div{s=\"p4\"} btn"}}
```

Edits go through the **edit protocol** — never rewrite the file. Ops, one JSON
object per line, applied with `npm run ail -- edit <file> <ops-file>`:

```json
{"op":"add","decl":"node lbl span \"total {n}\""}
{"op":"replace","id":"root","decl":"node root div{s=\"p4\"} [btn lbl]"}
{"op":"del","id":"lbl"}
```

Handler ids are `node.event` (e.g. `"btn.click"`). The applier re-sorts,
re-canonicalizes, and re-checks — you cannot produce a mis-ordered file through
ops.

## Canonical form

Every program has exactly one valid serialization: declarations sorted by kind
(sig, derive, comp, node, on, act) then id; attrs and record fields
alphabetical; single spaces; list/call args comma-separated; brackets elided
for single children. Don't memorize the details — write something close and
apply the `canon` fixes the checker hands back.

## Pitfalls

- **Orphans are errors.** An unused sig, an unplaced node, a never-started act
  all fail the check (each with a `del` fix). Clean as you go.
- **One placement, one handler.** A named node appears as a child exactly once;
  a node+event pair has at most one `on`.
- **Guard vs ternary.** `cond ? action` is an action guard; `c?a:b` inside an
  expression is a ternary. A ternary used as a guard condition needs parens.
- **`val` has a scope.** It exists only in input/change/keydown handlers;
  `it`/`ix` only under an each-template.
- **Sig inits are literals.** `sig m n+1` is an error — use a `derive`.
- **Int vs Float.** `1` and `1.0` are different types and never mix.

## Profiles

Same semantics, three surfaces:

- **I** (this guide): annotations only where inference is impossible.
- **T**: keywords `s d c n o a`; no annotations ever (an empty-list sig gets its
  type from some `+=` elsewhere — one must exist); positional comp args
  `panel(0,"Home page")`.
- **R**: every sig/derive annotated (`sig n:Int 0`); every on/act declares its
  effects between event and action — `on add.click r[draft,todos] w[draft,todos] …`
  — verified against the action by the checker.

`ail convert --to X` translates losslessly between all three.
