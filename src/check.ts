// The checker: parses, builds the typed environment, and enforces every rule from
// spec/semantics.md, accumulating structured {error, decl, detail, fix} diagnostics.

import {
  Action, AilDiagnostic, AilError, ATTRS, Child, Decl, EVENTS, Expr, InlineNode,
  Profile, Program, STYLE_TOKENS, Type, declId, sortDecls,
} from './ast.js';
import { parseDeclLine } from './parse.js';
import { Serializer, literallyTypable, serialize } from './serialize.js';
import {
  BOOL, Env, INT, ProgramEnv, Scope, STR, buildEnv, inferEffects, typeAction, typeExpr, typeEquals,
} from './infer.js';

export interface CheckResult {
  errors: AilError[];
  program?: Program;
  env?: ProgramEnv;
}

export function check(text: string): CheckResult {
  const errors: AilError[] = [];
  const push = (e: unknown): void => {
    if (e instanceof AilDiagnostic) errors.push(e.err);
    else errors.push({ error: 'internal', detail: String(e) });
  };

  // ---- parse line by line so one bad line doesn't hide the rest
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  const header = lines.shift();
  const m = header?.match(/^ail1 ([TIR])$/);
  if (!m) {
    return { errors: [{ error: 'parse', decl: 'header', detail: "first line must be 'ail1 T|I|R'" }] };
  }
  const profile = m[1] as Profile;
  const parsed: { decl: Decl; raw: string }[] = [];
  lines.forEach((raw, i) => {
    try {
      parsed.push({ decl: parseDeclLine(raw, profile, `line:${i + 2}`), raw });
    } catch (e) { push(e); }
  });
  const program: Program = { profile, decls: parsed.map((p) => p.decl) };

  // ---- duplicate ids
  const seen = new Map<string, number>();
  for (const d of program.decls) {
    const id = declId(d);
    seen.set(id, (seen.get(id) ?? 0) + 1);
    if (seen.get(id) === 2) {
      errors.push({ error: 'dup-id', decl: id, detail: 'duplicate declaration id', fix: { op: 'del', id } });
    }
  }
  if (errors.length > 0) return { errors, program };

  // ---- typed environment (sig/derive types)
  let env: ProgramEnv;
  try {
    env = buildEnv(program);
  } catch (e) {
    push(e);
    return { errors, program };
  }

  const nodes = env.nodes;
  const rootDecl = nodes.get('root');
  if (!rootDecl) errors.push({ error: 'no-root', detail: "missing 'node root'" });

  // ---- annotation policy (needs-ann for I/R; R requires annotations everywhere)
  for (const d of program.decls) {
    if (d.kind === 'sig' && !d.ann && !literallyTypable(d.init) && profile !== 'T') {
      const t = env.sigs.get(d.id);
      errors.push({
        error: 'needs-ann', decl: d.id, detail: 'sig with empty-list init requires a type annotation',
        fix: t ? { op: 'replace', id: d.id, decl: declLineWith(program, env, d.id) } : undefined,
      });
    }
    if (profile === 'R' && (d.kind === 'sig' || d.kind === 'derive') && !d.ann) {
      errors.push({
        error: 'needs-ann', decl: d.id, detail: 'profile R requires a type annotation',
        fix: { op: 'replace', id: d.id, decl: declLineWith(program, env, d.id) },
      });
    }
  }

  // ---- component bodies: display-only (params scope; no refs/each/inst children)
  for (const d of program.decls) {
    if (d.kind !== 'comp') continue;
    const scope: Scope = { params: new Map(d.params.map((p) => [p.name, p.type])) };
    checkInline(d.body, env, scope, declId(d), errors);
  }

  // ---- node placement: every named node reachable from root, used exactly once
  const uses = new Map<string, string[]>(); // node id -> using decl ids
  const scopes = new Map<string, Scope>(); // node id -> scope at its use site
  const visitChildren = (children: Child[], scope: Scope, at: string, visiting: Set<string>): void => {
    for (const c of children) {
      if (c.k === 'noderef') {
        record(uses, c.id, at);
        if (!nodes.has(c.id)) {
          errors.push({ error: 'bad-ref', decl: at, detail: `unknown node '${c.id}'` });
          continue;
        }
        descend(c.id, scope, visiting);
      } else if (c.k === 'each') {
        record(uses, c.tpl, at);
        if (!nodes.has(c.tpl)) {
          errors.push({ error: 'bad-ref', decl: at, detail: `unknown each-template '${c.tpl}'` });
          continue;
        }
        try {
          const lt = typeExpr(c.list, env, scope, at);
          if (lt.k !== 'list') {
            errors.push({ error: 'type', decl: at, detail: 'each() needs a List expression' });
            descend(c.tpl, scope, visiting);
          } else {
            descend(c.tpl, { ...scope, it: lt.el, ix: true }, visiting);
          }
        } catch (e) { push(e); }
      } else if (c.k === 'inline') {
        visitChildren(c.node.children, scope, at, visiting);
      }
      // inst children carry no named nodes (comp bodies are display-only)
    }
  };
  const descend = (id: string, scope: Scope, visiting: Set<string>): void => {
    if (visiting.has(id)) {
      errors.push({ error: 'cycle', decl: id, detail: 'node containment cycle' });
      return;
    }
    if (scopes.has(id)) return; // already placed; multi-use reported below
    scopes.set(id, scope);
    const d = nodes.get(id)!;
    visiting.add(id);
    visitChildren(d.children, scope, id, visiting);
    visiting.delete(id);
  };
  if (rootDecl) descend('root', {}, new Set());

  for (const [id, d] of nodes) {
    const useCount = uses.get(id)?.length ?? 0;
    if (id === 'root') {
      if (useCount > 0) errors.push({ error: 'scope', decl: id, detail: 'root cannot be a child' });
      continue;
    }
    if (useCount === 0) {
      errors.push({ error: 'orphan', decl: id, detail: 'node never placed', fix: { op: 'del', id } });
    } else if (useCount > 1) {
      errors.push({ error: 'orphan', decl: id, detail: `node placed ${useCount} times (must be exactly once)` });
    } else if (!scopes.has(id)) {
      errors.push({ error: 'orphan', decl: id, detail: 'node not reachable from root', fix: { op: 'del', id } });
    }
    void d;
  }

  // ---- per-node attr/child typing (with placement scope)
  for (const [id, d] of nodes) {
    const scope = scopes.get(id) ?? {};
    checkAttrsAndChildren({ tag: d.tag, attrs: d.attrs, children: d.children }, env, scope, id, errors, false);
  }

  // ---- handlers
  const actIds = new Set(program.decls.filter((d) => d.kind === 'act').map((d) => declId(d)));
  const referencedActs = new Set<string>();
  const collectTimerRefs = (a: Action): void => {
    if (a.k === 'timer') referencedActs.add(a.act);
    else if (a.k === 'seq') a.items.forEach(collectTimerRefs);
    else if (a.k === 'guard') { collectTimerRefs(a.t); if (a.e) collectTimerRefs(a.e); }
  };
  for (const d of program.decls) {
    if (d.kind === 'on') {
      const at = declId(d);
      if (!nodes.has(d.node)) errors.push({ error: 'bad-ref', decl: at, detail: `unknown node '${d.node}'` });
      if (!(EVENTS as readonly string[]).includes(d.event)) {
        errors.push({ error: 'bad-event', decl: at, detail: `unknown event '${d.event}'` });
      }
      const nscope = scopes.get(d.node) ?? {};
      const scope: Scope = {
        ...nscopeSafe(nscope),
        val: ['input', 'change', 'keydown'].includes(d.event),
        key: d.event === 'keydown',
      };
      try { typeAction(d.action, env, scope, env.acts, at); } catch (e) { push(e); }
      collectTimerRefs(d.action);
      checkEffects(d, env, program, errors);
    }
    if (d.kind === 'act') {
      const at = d.id;
      if (d.ms <= 0) errors.push({ error: 'type', decl: at, detail: 'act interval must be positive' });
      try { typeAction(d.action, env, {}, env.acts, at); } catch (e) { push(e); }
      collectTimerRefs(d.action);
      checkEffects(d, env, program, errors);
    }
  }
  for (const id of actIds) {
    if (!referencedActs.has(id)) {
      errors.push({ error: 'orphan', decl: id, detail: 'act never started/stopped', fix: { op: 'del', id } });
    }
  }

  // ---- sig/derive/comp orphans (any mention counts: read, write, instantiation)
  const mentioned = collectMentions(program);
  for (const d of program.decls) {
    if (d.kind === 'sig' || d.kind === 'derive' || d.kind === 'comp') {
      if (!mentioned.has(d.id)) {
        errors.push({ error: 'orphan', decl: d.id, detail: `${d.kind} never used`, fix: { op: 'del', id: d.id } });
      }
    }
  }

  // ---- canonical form (only meaningful once everything else passes)
  if (errors.length === 0) {
    const annotated = annotate(program, env);
    const ser = new Serializer(annotated, profile);
    const sorted = sortDecls(annotated.decls);
    const sortedIds = sorted.map(declId);
    const parsedIds = parsed.map((p) => declId(p.decl));
    if (JSON.stringify(sortedIds) !== JSON.stringify(parsedIds)) {
      errors.push({ error: 'canon', detail: `declarations must be sorted: ${sortedIds.join(' ')}` });
    }
    const byId = new Map(sorted.map((d) => [declId(d), d]));
    for (const p of parsed) {
      const canonical = ser.declToStr(byId.get(declId(p.decl))!);
      if (canonical !== p.raw) {
        errors.push({
          error: 'canon', decl: declId(p.decl), detail: 'not in canonical form',
          fix: { op: 'replace', id: declId(p.decl), decl: canonical },
        });
      }
    }
  }

  return { errors, program, env };
}

function nscopeSafe(s: Scope): Scope { return { params: s.params, it: s.it, ix: s.ix }; }

function record(map: Map<string, string[]>, key: string, val: string): void {
  const arr = map.get(key) ?? [];
  arr.push(val);
  map.set(key, arr);
}

const ATTR_TYPES: Record<string, 'bool' | 'str' | 'scalar' | 'style'> = {
  s: 'style', show: 'bool', checked: 'bool', disabled: 'bool',
  value: 'str', placeholder: 'str', type: 'str', href: 'str', for: 'str', name: 'str',
  min: 'scalar', max: 'scalar', step: 'scalar',
};

function checkAttrsAndChildren(
  n: InlineNode, env: ProgramEnv, scope: Scope, at: string, errors: AilError[], compBody: boolean,
): void {
  const push = (e: unknown): void => {
    if (e instanceof AilDiagnostic) errors.push(e.err);
    else errors.push({ error: 'internal', decl: at, detail: String(e) });
  };
  for (const a of n.attrs) {
    if (!(ATTRS as readonly string[]).includes(a.name)) {
      errors.push({ error: 'bad-attr', decl: at, detail: `unknown attr '${a.name}'` });
      continue;
    }
    const kind = ATTR_TYPES[a.name]!;
    try {
      if (kind === 'style') {
        if (a.val.k !== 'str') {
          errors.push({ error: 'bad-style', decl: at, detail: 's must be a string literal of style tokens' });
        } else {
          for (const tok of a.val.v.split(' ').filter(Boolean)) {
            if (!(STYLE_TOKENS as readonly string[]).includes(tok)) {
              errors.push({ error: 'bad-style', decl: at, detail: `unknown style token '${tok}'` });
            }
          }
        }
      } else if (kind === 'bool') {
        typeExpr(a.val, env, scope, at, BOOL);
      } else if (kind === 'str') {
        typeExpr(a.val, env, scope, at, STR);
      } else {
        const t = typeExpr(a.val, env, scope, at);
        if (!['int', 'float', 'str'].includes(t.k)) {
          errors.push({ error: 'type', decl: at, detail: `attr '${a.name}' must be Int/Float/Str` });
        }
      }
    } catch (e) { push(e); }
  }
  for (const c of n.children) {
    if (c.k === 'text') {
      try { typeExpr(c.tpl, env, scope, at, STR); } catch (e) { push(e); }
    } else if (c.k === 'inline') {
      checkAttrsAndChildren(c.node, env, scope, at, errors, compBody);
    } else if (c.k === 'inst') {
      const comp = env.comps.get(c.comp);
      if (!comp) {
        errors.push({ error: 'bad-ref', decl: at, detail: `unknown component '${c.comp}'` });
        continue;
      }
      // resolve positional args (profile T) to named, in place
      if (c.args.some((a) => a.name === '')) {
        if (c.args.length !== comp.params.length) {
          errors.push({ error: 'type', decl: at, detail: `${c.comp} takes ${comp.params.length} args` });
          continue;
        }
        c.args.forEach((a, i) => { a.name = comp.params[i]!.name; });
      }
      const byName = new Map(c.args.map((a) => [a.name, a.val]));
      if (byName.size !== c.args.length) {
        errors.push({ error: 'type', decl: at, detail: `duplicate args for ${c.comp}` });
      }
      for (const p of comp.params) {
        const arg = byName.get(p.name);
        if (!arg) {
          errors.push({ error: 'type', decl: at, detail: `missing arg '${p.name}' for ${c.comp}` });
          continue;
        }
        try { typeExpr(arg, env, scope, at, p.type); } catch (e) { push(e); }
        byName.delete(p.name);
      }
      for (const extra of byName.keys()) {
        errors.push({ error: 'type', decl: at, detail: `unknown arg '${extra}' for ${c.comp}` });
      }
    } else if (compBody && (c.k === 'noderef' || c.k === 'each')) {
      errors.push({ error: 'scope', decl: at, detail: 'component bodies are display-only: no node refs or each()' });
    }
  }
}

function checkInline(n: InlineNode, env: ProgramEnv, scope: Scope, at: string, errors: AilError[]): void {
  checkAttrsAndChildren(n, env, scope, at, errors, true);
}

function checkEffects(
  d: Extract<Decl, { kind: 'on' | 'act' }>, env: ProgramEnv, program: Program, errors: AilError[],
): void {
  if (program.profile !== 'R' || !d.eff) return;
  const inferred = inferEffects(d.action, env);
  const norm = (xs: string[]) => [...new Set(xs)].sort().join(',');
  if (norm(d.eff.r) !== norm(inferred.r) || norm(d.eff.w) !== norm(inferred.w)) {
    const fixed: Decl = { ...d, eff: inferred };
    const ser = new Serializer(annotate(program, env), 'R');
    errors.push({
      error: 'effects', decl: declId(d),
      detail: `declared r[${norm(d.eff.r)}] w[${norm(d.eff.w)}] but inferred r[${norm(inferred.r)}] w[${norm(inferred.w)}]`,
      fix: { op: 'replace', id: declId(d), decl: ser.declToStr(fixed) },
    });
  }
}

/** Render one declaration's canonical line with annotations filled from env. */
function declLineWith(program: Program, env: ProgramEnv, id: string): string {
  const annotated = annotate(program, env);
  const d = annotated.decls.find((x) => declId(x) === id)!;
  return new Serializer(annotated, program.profile === 'T' ? 'I' : program.profile).declToStr(d);
}

/**
 * Fill sig/derive annotations and handler effects from the typed environment
 * (shallow copies; expressions are shared). Used for R serialization and fixes.
 */
export function annotate(program: Program, env: ProgramEnv): Program {
  const decls = program.decls.map((d): Decl => {
    if (d.kind === 'sig') return { ...d, ann: d.ann ?? env.sigs.get(d.id) };
    if (d.kind === 'derive') return { ...d, ann: d.ann ?? env.derives.get(d.id) };
    if (d.kind === 'on' || d.kind === 'act') return { ...d, eff: inferEffects(d.action, env) };
    return d;
  });
  return { profile: program.profile, decls };
}

// ---------------------------------------------------------------- mentions

function collectMentions(program: Program): Set<string> {
  const out = new Set<string>();
  const expr = (e: Expr): void => {
    switch (e.k) {
      case 'ref': out.add(e.id); return;
      case 'tpl': e.parts.forEach((p) => { if (typeof p !== 'string') expr(p); }); return;
      case 'list': e.items.forEach(expr); return;
      case 'rec': e.fields.forEach((f) => expr(f.val)); return;
      case 'un': expr(e.e); return;
      case 'bin': expr(e.l); expr(e.r); return;
      case 'tern': expr(e.c); expr(e.t); expr(e.e); return;
      case 'field': expr(e.e); return;
      case 'index': expr(e.e); expr(e.i); return;
      case 'call': e.args.forEach(expr); return;
      default: return;
    }
  };
  const action = (a: Action): void => {
    if (a.k === 'assign') { out.add(a.sig); a.steps.forEach((s) => { if (s.k === 'index') expr(s.i); }); expr(a.e); }
    else if (a.k === 'seq') a.items.forEach(action);
    else if (a.k === 'guard') { expr(a.c); action(a.t); if (a.e) action(a.e); }
  };
  const children = (cs: Child[]): void => {
    for (const c of cs) {
      if (c.k === 'text') expr(c.tpl);
      else if (c.k === 'each') expr(c.list);
      else if (c.k === 'inline') { c.node.attrs.forEach((a) => expr(a.val)); children(c.node.children); }
      else if (c.k === 'inst') { out.add(c.comp); c.args.forEach((a) => expr(a.val)); }
    }
  };
  for (const d of program.decls) {
    if (d.kind === 'sig') expr(d.init);
    else if (d.kind === 'derive') expr(d.expr);
    else if (d.kind === 'comp') { d.body.attrs.forEach((a) => expr(a.val)); children(d.body.children); }
    else if (d.kind === 'node') { d.attrs.forEach((a) => expr(a.val)); children(d.children); }
    else action(d.action);
  }
  return out;
}

// ---------------------------------------------------------------- convert

export function convert(text: string, to: Profile): string {
  const res = check(text);
  const hard = res.errors.filter((e) => e.error !== 'canon');
  if (hard.length > 0 || !res.program || !res.env) {
    throw new AilDiagnostic(hard[0] ?? { error: 'internal', detail: 'unparseable program' });
  }
  return serialize(annotate(res.program, res.env), to);
}
