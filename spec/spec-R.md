# AIL (profile R) — complete language spec

AIL is a declarative language for browser UIs. A program is a flat set of
single-line declarations with unique ids, compiled to one HTML file. No imports,
no user functions, no JS.

## File format
Line 1: `ail1 R`. Then one declaration per line, sorted by kind
(sig, derive, comp, node, on, act), then alphabetically by id (`on` ids are
`node.event`). No blank lines, no comments, single spaces. Ids: `[a-z][a-z0-9_]*`.
The compiler enforces exactly this formatting; every error is one JSON line and
usually carries a ready-to-apply `fix` op.

## Declarations
- `sig id:Type init` — mutable state. Type annotation is required and must match
  the init literal (refs forbidden in init).
- `derive id:Type expr` — computed value; annotation required; auto-updates.
- `node id tag{attrs} children` — DOM element. Omit `{attrs}` if empty.
- `comp id(p:Type ...) (tag{attrs} children)` — reusable display template.
  Body may use params and sigs/derives, but no named nodes, each(), or handlers.
- `on nodeid.event r[reads] w[writes] action` — handler; one per node+event.
  Events: click input change submit keydown. `r[…]` lists every sig/derive the
  action's expressions reference; `w[…]` lists every sig it assigns — both
  alphabetical, comma-separated, empty as `r[]`/`w[]`. A path or compound
  assignment (`x[i].f=…`, `x+=…`) also reads x. The compiler verifies these
  against the action.
- `act id ms r[reads] w[writes] action` — repeating timer, initially stopped.

## Types
`Int Float Str Bool List<T> {field:Type ...}` (rec fields alphabetical).
Strict: no coercion, Int and Float never mix, Int/Int division truncates.
Records are structural.

## Children (of node / comp / inline element)
One child: bare after the tag. Several: `[a b c]`. None: omit.
- `name` — place a named node (every named node except root is placed exactly once)
- `"text {expr} text"` — text with interpolation (scalar exprs only)
- `(tag{attrs} children)` — inline anonymous element
- `each(listExpr,tplnode)` — repeat template node per element; inside the
  template and its handlers: `it` = element, `ix` = index (Int)
- `compid(p=expr ...)` — component instance (named args)

## Attrs
`{name=expr name=expr}`, alphabetical order. Allowed: `s show value checked
disabled placeholder type href for name min max step`. Bool: show/checked/
disabled. `value=sig` is one-way (state→DOM); write back with `on x.input sig=val`.
Buttons and inputs are pre-styled — no `s=` needed for them. `s="…"` = layout
and variants from these tokens only:
`row col gap1 gap2 gap3 gap4 p1 p2 p3 p4 m1 m2 m3 m4 w_full flex1 center bold
italic small large muted card btn input list`

## Expressions
Literals: `1 1.5 "s" true false [1,2] {f:1 g:2}` (list args comma-separated,
rec fields space-separated). Operators, C precedence: `! -` `* / %` `+ -`
`< <= > >=` `== !=` `&&` `||` `c?a:b`. Access: `x.field` `x[i]`.
Builtins (args comma-separated): `len(listOrStr)` `filter(list,.boolfield)`
`filter(list,!.f)` `has(str,sub)` `int(str)` `str(scalar)`.
Handler-only refs: `val` (Str, event target value; input/change/keydown),
`key` (Str, keydown).

## Actions
- `sig=expr` · `sig+=expr` (append / add) · `sig-=expr` (remove-at-index / subtract)
- paths: `todos[ix].done=!todos[ix].done`
- sequence `a;b` · guard `cond ? a` or `cond ? a : b` (parenthesize seq branches: `(a;b)`)
- `start(actid)` `stop(actid)`

## Checker (all are errors)
Unused sig/derive/comp/act; unplaced or multiply-placed named node; missing
`node root`; unknown ref/attr/style token/event; any type mismatch; declared
r[]/w[] not matching the action; `it ix val key` outside their scope;
non-canonical formatting or ordering.

## Edits
Never rewrite the file — send ops, one JSON object per line:
`{"op":"add","decl":"<line>"}` `{"op":"replace","id":"x","decl":"<line>"}`
`{"op":"del","id":"x"}` (handler ids look like `"btn.click"`)

## Complete example
```
ail1 R
sig draft:Str ""
sig todos:List<{done:Bool text:Str}> []
derive left:Int len(filter(todos,!.done))
node add button "Add"
node del button{s="small"} "x"
node inp input{placeholder="Add todo" value=draft}
node list ul{s="col gap1"} each(todos,row)
node root div{s="col gap2 p4"} [ttl (div{s="row gap2"} [inp add]) list "{left} left"]
node row li{s="row gap2"} [tgl "{it.text}" del]
node tgl input{checked=it.done type="checkbox"}
node ttl h1 "Todos"
on add.click r[draft,todos] w[draft,todos] draft!="" ? (todos+={done:false text:draft};draft="")
on del.click r[todos] w[todos] todos-=ix
on inp.input r[] w[draft] draft=val
on tgl.change r[todos] w[todos] todos[ix].done=!todos[ix].done
```
