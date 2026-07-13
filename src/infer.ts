// Type and effect inference over the shared AST. All functions throw AilDiagnostic;
// the checker catches per-declaration and accumulates structured errors.

import {
  Action, AilDiagnostic, Decl, Expr, Program, Type,
} from './ast.js';
import { typeToStr } from './serialize.js';

export const INT: Type = { k: 'int' };
export const FLOAT: Type = { k: 'float' };
export const STR: Type = { k: 'str' };
export const BOOL: Type = { k: 'bool' };

export function typeEquals(a: Type, b: Type): boolean {
  if (a.k !== b.k) return false;
  if (a.k === 'list' && b.k === 'list') return typeEquals(a.el, b.el);
  if (a.k === 'rec' && b.k === 'rec') {
    const fa = [...a.fields].sort((x, y) => x.name.localeCompare(y.name));
    const fb = [...b.fields].sort((x, y) => x.name.localeCompare(y.name));
    return fa.length === fb.length
      && fa.every((f, i) => f.name === fb[i]!.name && typeEquals(f.type, fb[i]!.type));
  }
  return true;
}

export interface Scope {
  params?: Map<string, Type>;
  it?: Type; // each-template element type
  ix?: boolean;
  val?: boolean;
  key?: boolean;
}

export interface Env {
  sigs: Map<string, Type>;
  derives: Map<string, Type>;
}

function err(error: string, decl: string | undefined, detail: string): never {
  throw new AilDiagnostic({ error, decl, detail });
}

const isNum = (t: Type) => t.k === 'int' || t.k === 'float';
const isScalar = (t: Type) => t.k === 'int' || t.k === 'float' || t.k === 'str' || t.k === 'bool';

export function typeExpr(e: Expr, env: Env, scope: Scope, at?: string, expected?: Type): Type {
  const check = (t: Type): Type => {
    if (expected && !typeEquals(t, expected)) {
      err('type', at, `expected ${typeToStr(expected)}, got ${typeToStr(t)}`);
    }
    return t;
  };
  switch (e.k) {
    case 'int': return check(INT);
    case 'float': return check(FLOAT);
    case 'str': return check(STR);
    case 'bool': return check(BOOL);
    case 'tpl': {
      for (const p of e.parts) {
        if (typeof p === 'string') continue;
        const t = typeExpr(p, env, scope, at);
        if (!isScalar(t)) err('type', at, `template hole must be scalar, got ${typeToStr(t)}`);
      }
      return check(STR);
    }
    case 'ref': {
      if (scope.params?.has(e.id)) return check(scope.params.get(e.id)!);
      if (e.id === 'it') {
        if (!scope.it) err('scope', at, "'it' used outside an each-template");
        return check(scope.it);
      }
      if (e.id === 'ix') {
        if (!scope.ix) err('scope', at, "'ix' used outside an each-template");
        return check(INT);
      }
      if (e.id === 'val') {
        if (!scope.val) err('scope', at, "'val' only available in input/change/keydown handlers");
        return check(STR);
      }
      if (e.id === 'key') {
        if (!scope.key) err('scope', at, "'key' only available in keydown handlers");
        return check(STR);
      }
      const t = env.sigs.get(e.id) ?? env.derives.get(e.id);
      if (!t) err('bad-ref', at, `unknown reference '${e.id}'`);
      return check(t);
    }
    case 'list': {
      const expEl = expected?.k === 'list' ? expected.el : undefined;
      if (e.items.length === 0) {
        if (!expEl) err('type', at, 'cannot infer empty list element type');
        return { k: 'list', el: expEl };
      }
      const el = typeExpr(e.items[0]!, env, scope, at, expEl);
      for (const item of e.items.slice(1)) typeExpr(item, env, scope, at, el);
      return check({ k: 'list', el });
    }
    case 'rec': {
      const expFields = expected?.k === 'rec'
        ? new Map(expected.fields.map((f) => [f.name, f.type]))
        : undefined;
      const fields = [...e.fields]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => ({ name: f.name, type: typeExpr(f.val, env, scope, at, expFields?.get(f.name)) }));
      return check({ k: 'rec', fields });
    }
    case 'un': {
      const t = typeExpr(e.e, env, scope, at);
      if (e.op === '!') {
        if (t.k !== 'bool') err('type', at, `! needs Bool, got ${typeToStr(t)}`);
        return check(BOOL);
      }
      if (!isNum(t)) err('type', at, `unary - needs Int/Float, got ${typeToStr(t)}`);
      return check(t);
    }
    case 'bin': {
      const l = typeExpr(e.l, env, scope, at);
      switch (e.op) {
        case '+': case '-': case '*': case '/': case '%': {
          if (!isNum(l)) err('type', at, `${e.op} needs Int/Float, got ${typeToStr(l)}`);
          typeExpr(e.r, env, scope, at, l);
          // mark float division on the AST so the runtime (which sees only values,
          // where 2.0 === 2) knows not to truncate
          if (e.op === '/' && l.k === 'float') (e as Expr & { fdiv?: boolean }).fdiv = true;
          return check(l);
        }
        case '<': case '<=': case '>': case '>=': {
          if (!isNum(l) && l.k !== 'str') err('type', at, `${e.op} needs Int/Float/Str, got ${typeToStr(l)}`);
          typeExpr(e.r, env, scope, at, l);
          return check(BOOL);
        }
        case '==': case '!=': {
          typeExpr(e.r, env, scope, at, l);
          return check(BOOL);
        }
        case '&&': case '||': {
          if (l.k !== 'bool') err('type', at, `${e.op} needs Bool, got ${typeToStr(l)}`);
          typeExpr(e.r, env, scope, at, BOOL);
          return check(BOOL);
        }
      }
      break;
    }
    case 'tern': {
      typeExpr(e.c, env, scope, at, BOOL);
      const t = typeExpr(e.t, env, scope, at, expected);
      typeExpr(e.e, env, scope, at, t);
      return t;
    }
    case 'field': {
      const t = typeExpr(e.e, env, scope, at);
      if (t.k !== 'rec') err('type', at, `field access on non-record ${typeToStr(t)}`);
      const f = t.fields.find((x) => x.name === e.f);
      if (!f) err('type', at, `no field '${e.f}' on ${typeToStr(t)}`);
      return check(f.type);
    }
    case 'index': {
      const t = typeExpr(e.e, env, scope, at);
      if (t.k !== 'list') err('type', at, `indexing non-list ${typeToStr(t)}`);
      typeExpr(e.i, env, scope, at, INT);
      return check(t.el);
    }
    case 'call': {
      const arity = { len: 1, filter: 2, has: 2, int: 1, str: 1 }[e.fn];
      if (e.args.length !== arity) err('type', at, `${e.fn} takes ${arity} args`);
      switch (e.fn) {
        case 'len': {
          const t = typeExpr(e.args[0]!, env, scope, at);
          if (t.k !== 'list' && t.k !== 'str') err('type', at, `len needs List/Str, got ${typeToStr(t)}`);
          return check(INT);
        }
        case 'filter': {
          const t = typeExpr(e.args[0]!, env, scope, at);
          if (t.k !== 'list') err('type', at, `filter needs a List, got ${typeToStr(t)}`);
          const pred = e.args[1]!;
          if (pred.k !== 'pred') err('type', at, 'filter predicate must be .field or !.field');
          if (t.el.k !== 'rec') err('type', at, `filter predicate needs record elements, got ${typeToStr(t.el)}`);
          const f = t.el.fields.find((x) => x.name === pred.f);
          if (!f) err('type', at, `no field '${pred.f}' on ${typeToStr(t.el)}`);
          if (f.type.k !== 'bool') err('type', at, `predicate field '${pred.f}' must be Bool`);
          return check(t);
        }
        case 'has': {
          typeExpr(e.args[0]!, env, scope, at, STR);
          typeExpr(e.args[1]!, env, scope, at, STR);
          return check(BOOL);
        }
        case 'int': {
          typeExpr(e.args[0]!, env, scope, at, STR);
          return check(INT);
        }
        case 'str': {
          const t = typeExpr(e.args[0]!, env, scope, at);
          if (!isScalar(t)) err('type', at, `str needs a scalar, got ${typeToStr(t)}`);
          return check(STR);
        }
      }
      break;
    }
    case 'pred':
      err('scope', at, 'predicate (.field) only valid as filter() argument');
  }
  err('internal', at, 'unhandled expression');
}

// ---------------------------------------------------------------- actions

export function typeAction(a: Action, env: Env, scope: Scope, acts: Set<string>, at?: string): void {
  switch (a.k) {
    case 'assign': {
      const sigT = env.sigs.get(a.sig);
      if (!sigT) {
        if (env.derives.has(a.sig)) err('scope', at, `cannot assign to derive '${a.sig}'`);
        err('bad-ref', at, `unknown sig '${a.sig}'`);
      }
      let target: Type = sigT;
      for (const s of a.steps) {
        if (s.k === 'index') {
          if (target.k !== 'list') err('type', at, `indexing non-list ${typeToStr(target)}`);
          typeExpr(s.i, env, scope, at, INT);
          target = target.el;
        } else {
          if (target.k !== 'rec') err('type', at, `field access on non-record ${typeToStr(target)}`);
          const f = target.fields.find((x) => x.name === s.f);
          if (!f) err('type', at, `no field '${s.f}' on ${typeToStr(target)}`);
          target = f.type;
        }
      }
      if (a.op === '=') {
        typeExpr(a.e, env, scope, at, target);
      } else if (a.op === '+=') {
        if (target.k === 'list') typeExpr(a.e, env, scope, at, target.el);
        else if (isNum(target)) typeExpr(a.e, env, scope, at, target);
        else err('type', at, `+= needs List or Int/Float target, got ${typeToStr(target)}`);
      } else {
        if (target.k === 'list') typeExpr(a.e, env, scope, at, INT); // remove-at-index
        else if (isNum(target)) typeExpr(a.e, env, scope, at, target);
        else err('type', at, `-= needs List or Int/Float target, got ${typeToStr(target)}`);
      }
      return;
    }
    case 'seq':
      for (const item of a.items) typeAction(item, env, scope, acts, at);
      return;
    case 'guard':
      typeExpr(a.c, env, scope, at, BOOL);
      typeAction(a.t, env, scope, acts, at);
      if (a.e) typeAction(a.e, env, scope, acts, at);
      return;
    case 'timer':
      if (!acts.has(a.act)) err('bad-ref', at, `unknown act '${a.act}'`);
      return;
  }
}

// ---------------------------------------------------------------- effects

function exprRefs(e: Expr, out: Set<string>): void {
  switch (e.k) {
    case 'ref': out.add(e.id); return;
    case 'tpl': e.parts.forEach((p) => { if (typeof p !== 'string') exprRefs(p, out); }); return;
    case 'list': e.items.forEach((x) => exprRefs(x, out)); return;
    case 'rec': e.fields.forEach((f) => exprRefs(f.val, out)); return;
    case 'un': exprRefs(e.e, out); return;
    case 'bin': exprRefs(e.l, out); exprRefs(e.r, out); return;
    case 'tern': exprRefs(e.c, out); exprRefs(e.t, out); exprRefs(e.e, out); return;
    case 'field': exprRefs(e.e, out); return;
    case 'index': exprRefs(e.e, out); exprRefs(e.i, out); return;
    case 'call': e.args.forEach((x) => exprRefs(x, out)); return;
    default: return;
  }
}

/** Inferred effects: r = sigs/derives read; w = sigs written. Sorted. */
export function inferEffects(a: Action, env: Env): { r: string[]; w: string[] } {
  const reads = new Set<string>();
  const writes = new Set<string>();
  const walk = (x: Action): void => {
    switch (x.k) {
      case 'assign': {
        writes.add(x.sig);
        const refs = new Set<string>();
        exprRefs(x.e, refs);
        x.steps.forEach((s) => { if (s.k === 'index') exprRefs(s.i, refs); });
        // an update through a path also reads the current value
        if (x.steps.length > 0 || x.op !== '=') refs.add(x.sig);
        refs.forEach((r) => reads.add(r));
        return;
      }
      case 'seq': x.items.forEach(walk); return;
      case 'guard': {
        const refs = new Set<string>();
        exprRefs(x.c, refs);
        refs.forEach((r) => reads.add(r));
        walk(x.t);
        if (x.e) walk(x.e);
        return;
      }
      case 'timer': return;
    }
  };
  walk(a);
  const known = (id: string) => env.sigs.has(id) || env.derives.has(id);
  return {
    r: [...reads].filter(known).sort(),
    w: [...writes].filter((w) => env.sigs.has(w)).sort(),
  };
}

// ---------------------------------------------------------------- program env

export interface ProgramEnv extends Env {
  comps: Map<string, Extract<Decl, { kind: 'comp' }>>;
  acts: Set<string>;
  nodes: Map<string, Extract<Decl, { kind: 'node' }>>;
  /** sigs whose type had to be inferred from usage (profile T empty lists) */
  usageInferred: Map<string, Type>;
}

const EMPTY_ENV: Env = { sigs: new Map(), derives: new Map() };

/**
 * Build the typed environment: sig types (annotation, literal inference, or — for
 * profile T — usage inference from += / = assignments), then derives in dependency
 * order (cycle → 'cycle'). Throws on the first unresolvable declaration.
 */
export function buildEnv(program: Program): ProgramEnv {
  const env: ProgramEnv = {
    sigs: new Map(),
    derives: new Map(),
    comps: new Map(),
    acts: new Set(),
    nodes: new Map(),
    usageInferred: new Map(),
  };
  for (const d of program.decls) {
    if (d.kind === 'comp') env.comps.set(d.id, d);
    if (d.kind === 'act') env.acts.add(d.id);
    if (d.kind === 'node') env.nodes.set(d.id, d);
  }

  // sigs: annotated or literally-typable first
  const pending: Extract<Decl, { kind: 'sig' }>[] = [];
  for (const d of program.decls) {
    if (d.kind !== 'sig') continue;
    if (d.ann) {
      // init typed against annotation, with refs forbidden (empty env)
      typeExpr(d.init, EMPTY_ENV, {}, d.id, d.ann);
      env.sigs.set(d.id, d.ann);
    } else {
      try {
        env.sigs.set(d.id, typeExpr(d.init, EMPTY_ENV, {}, d.id));
      } catch (e) {
        if (e instanceof AilDiagnostic && e.err.error === 'bad-ref') throw e; // ref in init: real error
        pending.push(d); // empty-list init: try usage inference below
      }
    }
  }
  // usage inference for un-annotated empty-list sigs (profile T)
  for (const d of pending) {
    let found: Type | undefined;
    for (const dd of program.decls) {
      if (dd.kind !== 'on' && dd.kind !== 'act') continue;
      const tryAssign = (a: Action): void => {
        if (found) return;
        if (a.k === 'seq') { a.items.forEach(tryAssign); return; }
        if (a.k === 'guard') { tryAssign(a.t); if (a.e) tryAssign(a.e); return; }
        if (a.k !== 'assign' || a.sig !== d.id || a.steps.length > 0) return;
        try {
          if (a.op === '+=') {
            const el = typeExpr(a.e, env, { it: undefined, ix: true, val: true, key: true }, d.id);
            found = { k: 'list', el };
          } else if (a.op === '=' && !(a.e.k === 'list' && a.e.items.length === 0)) {
            const t = typeExpr(a.e, env, { ix: true, val: true, key: true }, d.id);
            if (t.k === 'list') found = t;
          }
        } catch { /* this usage didn't determine it; keep looking */ }
      };
      tryAssign(dd.action);
    }
    if (!found) {
      throw new AilDiagnostic({
        error: 'needs-ann', decl: d.id,
        detail: 'empty-list sig type not determinable (annotate, or add a += that fixes the element type)',
      });
    }
    env.sigs.set(d.id, found);
    env.usageInferred.set(d.id, found);
  }

  // derives: topological order over derive→derive refs
  const derives = program.decls.filter((d): d is Extract<Decl, { kind: 'derive' }> => d.kind === 'derive');
  const byId = new Map(derives.map((d) => [d.id, d]));
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (d: Extract<Decl, { kind: 'derive' }>): void => {
    const s = state.get(d.id);
    if (s === 'done') return;
    if (s === 'visiting') throw new AilDiagnostic({ error: 'cycle', decl: d.id, detail: 'derive dependency cycle' });
    state.set(d.id, 'visiting');
    const refs = new Set<string>();
    exprRefs(d.expr, refs);
    for (const r of refs) {
      const dep = byId.get(r);
      if (dep) visit(dep);
    }
    const t = typeExpr(d.expr, env, {}, d.id, d.ann);
    env.derives.set(d.id, t);
    state.set(d.id, 'done');
  };
  derives.forEach(visit);

  return env;
}
