# AIL (profile T) — complete language spec

AIL is a declarative language for browser UIs. A program is a flat set of
single-line declarations with unique ids, compiled to one HTML file. No imports,
no user functions, no JS.

## File format
Line 1: `ail1 T`. Then one declaration per line, sorted by kind
(s, d, c, n, o, a), then alphabetically by id (`o` ids are `node.event`).
No blank lines, no comments, single spaces. Ids: `[a-z][a-z0-9_]*`.
The compiler enforces exactly this formatting; every error is one JSON line and
usually carries a ready-to-apply `fix` op.

## Declarations
- `s id init` — mutable state. Type inferred from the init literal (refs
  forbidden in init). No type annotations exist in this profile: a sig starting
  as `[]` gets its type from a later `+=` append — make sure one exists.
- `d id expr` — computed value; auto-updates when its inputs change.
- `n id tag{attrs} children` — DOM element. Omit `{attrs}` if empty.
- `c id(p:Type ...) (tag{attrs} children)` — reusable display template.
  Body may use params and sigs/derives, but no named nodes, each(), or handlers.
- `o nodeid.event action` — handler; one per node+event.
  Events: click input change submit keydown.
- `a id ms action` — repeating timer (ms interval), initially stopped.

## Types
`Int Float Str Bool List<T> {field:Type ...}` (appear only in comp params).
Strict: no coercion, Int and Float never mix, Int/Int division truncates.
Records are structural.

## Children (of node / comp / inline element)
One child: bare after the tag. Several: `[a b c]`. None: omit.
- `name` — place a named node (every named node except root is placed exactly once)
- `"text {expr} text"` — text with interpolation (scalar exprs only)
- `(tag{attrs} children)` — inline anonymous element
- `each(listExpr,tplnode)` — repeat template node per element; inside the
  template and its handlers: `it` = element, `ix` = index (Int)
- `compid(expr,expr)` — component instance (positional args, comma-separated,
  in param order)

## Attrs
`{name=expr name=expr}`, alphabetical order. Allowed: `s show value checked
disabled placeholder type href for name min max step`. Bool: show/checked/
disabled. `value=sig` is one-way (state→DOM); write back with `o x.input sig=val`.
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
`n root`; unknown ref/attr/style token/event; any type mismatch; `it ix val
key` outside their scope; non-canonical formatting or ordering.

## Edits
Never rewrite the file — send ops, one JSON object per line:
`{"op":"add","decl":"<line>"}` `{"op":"replace","id":"x","decl":"<line>"}`
`{"op":"del","id":"x"}` (handler ids look like `"btn.click"`)

## Complete example
```
ail1 T
s draft ""
s todos []
d left len(filter(todos,!.done))
n add button "Add"
n del button{s="small"} "x"
n inp input{placeholder="Add todo" value=draft}
n list ul{s="col gap1"} each(todos,row)
n root div{s="col gap2 p4"} [ttl (div{s="row gap2"} [inp add]) list "{left} left"]
n row li{s="row gap2"} [tgl "{it.text}" del]
n tgl input{checked=it.done type="checkbox"}
n ttl h1 "Todos"
o add.click draft!="" ? (todos+={done:false text:draft};draft="")
o del.click todos-=ix
o inp.input draft=val
o tgl.change todos[ix].done=!todos[ix].done
```
