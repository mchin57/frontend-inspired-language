// Shared AST for all serialization profiles. Plain JSON-able objects: the runtime
// interprets this structure directly, so nothing here may hold functions or classes.

export type Profile = 'T' | 'I' | 'R';

export type Type =
  | { k: 'int' }
  | { k: 'float' }
  | { k: 'str' }
  | { k: 'bool' }
  | { k: 'list'; el: Type }
  | { k: 'rec'; fields: { name: string; type: Type }[] }; // sorted by name

export type Expr =
  | { k: 'int'; v: number }
  | { k: 'float'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'tpl'; parts: (string | Expr)[] } // template string; string parts are raw text
  | { k: 'ref'; id: string } // sig/derive/param/it/ix/val/key
  | { k: 'list'; items: Expr[] }
  | { k: 'rec'; fields: { name: string; val: Expr }[] } // sorted by name
  | { k: 'un'; op: '!' | 'neg'; e: Expr }
  | { k: 'bin'; op: BinOp; l: Expr; r: Expr }
  | { k: 'tern'; c: Expr; t: Expr; e: Expr }
  | { k: 'field'; e: Expr; f: string }
  | { k: 'index'; e: Expr; i: Expr }
  | { k: 'call'; fn: Builtin; args: Expr[] }
  | { k: 'pred'; f: string; neg: boolean }; // .f / !.f — only valid as filter() arg

export type BinOp =
  | '*' | '/' | '%'
  | '+' | '-'
  | '<' | '<=' | '>' | '>='
  | '==' | '!='
  | '&&' | '||';

export type Builtin = 'len' | 'filter' | 'has' | 'int' | 'str';
export const BUILTINS: Builtin[] = ['len', 'filter', 'has', 'int', 'str'];

export type LhsStep = { k: 'index'; i: Expr } | { k: 'field'; f: string };

export type Action =
  | { k: 'assign'; sig: string; steps: LhsStep[]; op: '=' | '+=' | '-='; e: Expr }
  | { k: 'seq'; items: Action[] }
  | { k: 'guard'; c: Expr; t: Action; e?: Action }
  | { k: 'timer'; which: 'start' | 'stop'; act: string };

export type Child =
  | { k: 'noderef'; id: string }
  | { k: 'text'; tpl: Expr } // tpl or str expr
  | { k: 'inline'; node: InlineNode }
  | { k: 'each'; list: Expr; tpl: string }
  | { k: 'inst'; comp: string; args: InstArg[] };

// Positional args (profile T) parse with name '' and are resolved against the comp
// declaration during checking; canonical AST after check always has names.
export type InstArg = { name: string; val: Expr };

export interface InlineNode {
  tag: string;
  attrs: { name: string; val: Expr }[]; // sorted by name
  children: Child[];
}

export type Effects = { r: string[]; w: string[] }; // sorted

export type Decl =
  | { kind: 'sig'; id: string; ann?: Type; init: Expr }
  | { kind: 'derive'; id: string; ann?: Type; expr: Expr }
  | { kind: 'comp'; id: string; params: { name: string; type: Type }[]; body: InlineNode }
  | { kind: 'node'; id: string; tag: string; attrs: { name: string; val: Expr }[]; children: Child[] }
  | { kind: 'on'; node: string; event: string; eff?: Effects; action: Action }
  | { kind: 'act'; id: string; ms: number; eff?: Effects; action: Action };

export interface Program {
  profile: Profile;
  decls: Decl[];
}

export const KIND_ORDER = ['sig', 'derive', 'comp', 'node', 'on', 'act'] as const;

/** The sort/identity key of a declaration. */
export function declId(d: Decl): string {
  return d.kind === 'on' ? `${d.node}.${d.event}` : d.id;
}

export function sortDecls(decls: Decl[]): Decl[] {
  return [...decls].sort((a, b) => {
    const ka = KIND_ORDER.indexOf(a.kind);
    const kb = KIND_ORDER.indexOf(b.kind);
    if (ka !== kb) return ka - kb;
    return declId(a) < declId(b) ? -1 : declId(a) > declId(b) ? 1 : 0;
  });
}

export const EVENTS = ['click', 'input', 'change', 'submit', 'keydown'] as const;

export const ATTRS = [
  's', 'show', 'value', 'checked', 'disabled', 'placeholder', 'type',
  'href', 'for', 'name', 'min', 'max', 'step',
] as const;

export const STYLE_TOKENS = [
  'row', 'col', 'gap1', 'gap2', 'gap3', 'gap4',
  'p1', 'p2', 'p3', 'p4', 'm1', 'm2', 'm3', 'm4',
  'w_full', 'flex1', 'center', 'bold', 'italic', 'small', 'large',
  'muted', 'card', 'btn', 'input', 'list',
] as const;

export interface AilError {
  error: string;
  decl?: string;
  detail?: string;
  fix?: EditOp;
}

export type EditOp =
  | { op: 'add'; decl: string }
  | { op: 'replace'; id: string; decl: string }
  | { op: 'del'; id: string };

export class AilDiagnostic extends Error {
  constructor(public err: AilError) {
    super(`${err.error}${err.decl ? ` @${err.decl}` : ''}: ${err.detail ?? ''}`);
  }
}
