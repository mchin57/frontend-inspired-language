// Canonical serializer. serialize(parse(text)) === text defines canonical form;
// the checker reports `canon` errors from any mismatch. Sorting (decls, attrs, rec
// fields, effects) happens here, so non-canonical order round-trips to sorted output
// and surfaces as a canon diagnostic with the corrected line as the fix.

import {
  Action, AilDiagnostic, Child, Decl, Expr, InlineNode, Profile, Program, Type,
  declId, sortDecls,
} from './ast.js';

// precedence: tern=1, ||=2, &&=3, eq=4, cmp=5, add=6, mul=7, unary=8, postfix=9
const BIN_PREC: Record<string, number> = {
  '||': 2, '&&': 3, '==': 4, '!=': 4, '<': 5, '<=': 5, '>': 5, '>=': 5,
  '+': 6, '-': 6, '*': 7, '/': 7, '%': 7,
};

function escStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\{/g, '\\{').replace(/\n/g, '\\n');
}

export function typeToStr(t: Type): string {
  switch (t.k) {
    case 'int': return 'Int';
    case 'float': return 'Float';
    case 'str': return 'Str';
    case 'bool': return 'Bool';
    case 'list': return `List<${typeToStr(t.el)}>`;
    case 'rec': {
      const fields = [...t.fields].sort((a, b) => a.name.localeCompare(b.name));
      return `{${fields.map((f) => `${f.name}:${typeToStr(f.type)}`).join(' ')}}`;
    }
  }
}

export function exprToStr(e: Expr, prec = 0): string {
  const wrap = (own: number, s: string) => (own < prec ? `(${s})` : s);
  switch (e.k) {
    case 'int': return String(e.v);
    case 'float': return Number.isInteger(e.v) ? `${e.v}.0` : String(e.v);
    case 'str': return `"${escStr(e.v)}"`;
    case 'bool': return String(e.v);
    case 'tpl':
      return `"${e.parts.map((p) => (typeof p === 'string' ? escStr(p) : `{${exprToStr(p)}}`)).join('')}"`;
    case 'ref': return e.id;
    case 'list': return `[${e.items.map((x) => exprToStr(x)).join(',')}]`;
    case 'rec': {
      const fields = [...e.fields].sort((a, b) => a.name.localeCompare(b.name));
      return `{${fields.map((f) => `${f.name}:${exprToStr(f.val)}`).join(' ')}}`;
    }
    case 'un':
      return wrap(8, (e.op === '!' ? '!' : '-') + exprToStr(e.e, 8));
    case 'bin': {
      const own = BIN_PREC[e.op]!;
      return wrap(own, `${exprToStr(e.l, own)}${e.op}${exprToStr(e.r, own + 1)}`);
    }
    case 'tern':
      return wrap(1, `${exprToStr(e.c, 2)}?${exprToStr(e.t)}:${exprToStr(e.e, 1)}`);
    case 'field': return wrap(9, `${exprToStr(e.e, 9)}.${e.f}`);
    case 'index': return wrap(9, `${exprToStr(e.e, 9)}[${exprToStr(e.i)}]`);
    case 'call': return `${e.fn}(${e.args.map((a) => exprToStr(a)).join(',')})`;
    case 'pred': return `${e.neg ? '!' : ''}.${e.f}`;
  }
}

export function actionToStr(a: Action): string {
  switch (a.k) {
    case 'assign': {
      const steps = a.steps
        .map((s) => (s.k === 'index' ? `[${exprToStr(s.i)}]` : `.${s.f}`))
        .join('');
      return `${a.sig}${steps}${a.op}${exprToStr(a.e)}`;
    }
    case 'seq': return a.items.map(actionToStr).join(';');
    case 'guard': {
      // branch actions that are seqs or guards must be parenthesized to re-parse
      const br = (x: Action) => (x.k === 'seq' || x.k === 'guard' ? `(${actionToStr(x)})` : actionToStr(x));
      return `${exprToStr(a.c, 2)} ? ${br(a.t)}${a.e ? ` : ${br(a.e)}` : ''}`;
    }
    case 'timer': return `${a.which}(${a.act})`;
  }
}

/** Can this expression's type be determined bottom-up from literals alone?
 * (Used by profile I to decide whether a sig annotation is required.) */
export function literallyTypable(e: Expr): boolean {
  switch (e.k) {
    case 'list': return e.items.length > 0 && e.items.every(literallyTypable);
    case 'rec': return e.fields.every((f) => literallyTypable(f.val));
    case 'un': return literallyTypable(e.e);
    case 'bin': return literallyTypable(e.l) && literallyTypable(e.r);
    case 'tern': return literallyTypable(e.t) && literallyTypable(e.e);
    default: return true; // literals, refs (resolved from env), calls, etc.
  }
}

const KW: Record<Profile, Record<string, string>> = {
  I: { sig: 'sig', derive: 'derive', comp: 'comp', node: 'node', on: 'on', act: 'act' },
  R: { sig: 'sig', derive: 'derive', comp: 'comp', node: 'node', on: 'on', act: 'act' },
  T: { sig: 's', derive: 'd', comp: 'c', node: 'n', on: 'o', act: 'a' },
};

export class Serializer {
  private comps = new Map<string, { name: string }[]>();

  constructor(private program: Program, private profile: Profile = program.profile) {
    for (const d of program.decls) {
      if (d.kind === 'comp') this.comps.set(d.id, d.params.map((p) => ({ name: p.name })));
    }
  }

  attrsToStr(attrs: { name: string; val: Expr }[]): string {
    if (attrs.length === 0) return '';
    const sorted = [...attrs].sort((a, b) => a.name.localeCompare(b.name));
    return `{${sorted.map((a) => `${a.name}=${exprToStr(a.val)}`).join(' ')}}`;
  }

  childToStr(c: Child): string {
    switch (c.k) {
      case 'noderef': return c.id;
      case 'text': return exprToStr(c.tpl);
      case 'inline': return `(${this.inlineToStr(c.node)})`;
      case 'each': return `each(${exprToStr(c.list)},${c.tpl})`;
      case 'inst': {
        if (this.profile === 'T') {
          const params = this.comps.get(c.comp);
          const ordered = params
            ? params.map((p) => c.args.find((a) => a.name === p.name) ?? c.args[params.indexOf(p)])
            : c.args;
          return `${c.comp}(${ordered.map((a) => (a ? exprToStr(a.val) : '')).join(',')})`;
        }
        const sorted = [...c.args].sort((a, b) => a.name.localeCompare(b.name));
        return `${c.comp}(${sorted.map((a) => `${a.name}=${exprToStr(a.val)}`).join(' ')})`;
      }
    }
  }

  childrenToStr(children: Child[]): string {
    if (children.length === 0) return '';
    if (children.length === 1) return ` ${this.childToStr(children[0]!)}`;
    return ` [${children.map((c) => this.childToStr(c)).join(' ')}]`;
  }

  inlineToStr(n: InlineNode): string {
    return `${n.tag}${this.attrsToStr(n.attrs)}${this.childrenToStr(n.children)}`;
  }

  effToStr(eff: { r: string[]; w: string[] } | undefined, at: string): string {
    if (this.profile !== 'R') return '';
    if (!eff) throw new AilDiagnostic({ error: 'internal', decl: at, detail: 'profile R requires effects on the AST (run convert/infer first)' });
    const r = [...eff.r].sort();
    const w = [...eff.w].sort();
    return ` r[${r.join(',')}] w[${w.join(',')}]`;
  }

  declToStr(d: Decl): string {
    const kw = KW[this.profile];
    switch (d.kind) {
      case 'sig': {
        let ann = '';
        if (this.profile === 'R') {
          if (!d.ann) throw new AilDiagnostic({ error: 'internal', decl: d.id, detail: 'profile R requires sig annotation on the AST' });
          ann = `:${typeToStr(d.ann)}`;
        } else if (this.profile === 'I' && d.ann && !literallyTypable(d.init)) {
          ann = `:${typeToStr(d.ann)}`;
        }
        return `${kw.sig} ${d.id}${ann} ${exprToStr(d.init)}`;
      }
      case 'derive': {
        let ann = '';
        if (this.profile === 'R') {
          if (!d.ann) throw new AilDiagnostic({ error: 'internal', decl: d.id, detail: 'profile R requires derive annotation on the AST' });
          ann = `:${typeToStr(d.ann)}`;
        }
        return `${kw.derive} ${d.id}${ann} ${exprToStr(d.expr)}`;
      }
      case 'comp': {
        const params = d.params.map((p) => `${p.name}:${typeToStr(p.type)}`).join(' ');
        return `${kw.comp} ${d.id}(${params}) (${this.inlineToStr(d.body)})`;
      }
      case 'node':
        return `${kw.node} ${d.id} ${d.tag}${this.attrsToStr(d.attrs)}${this.childrenToStr(d.children)}`;
      case 'on':
        return `${kw.on} ${d.node}.${d.event}${this.effToStr(d.eff, declId(d))} ${actionToStr(d.action)}`;
      case 'act':
        return `${kw.act} ${d.id} ${d.ms}${this.effToStr(d.eff, d.id)} ${actionToStr(d.action)}`;
    }
  }

  serialize(): string {
    const lines = sortDecls(this.program.decls).map((d) => this.declToStr(d));
    return [`ail1 ${this.profile}`, ...lines].join('\n') + '\n';
  }
}

export function serialize(program: Program, profile?: Profile): string {
  return new Serializer(program, profile ?? program.profile).serialize();
}
