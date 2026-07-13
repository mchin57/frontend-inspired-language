// Parser for all three profiles. Whitespace-insensitive: canonical-form violations
// are detected by the checker via serialize-and-compare, not here.

import {
  Action, AilDiagnostic, BinOp, Builtin, BUILTINS, Child, Decl, Expr, InlineNode,
  InstArg, LhsStep, Profile, Program, Type,
} from './ast.js';

// ---------------------------------------------------------------- lexer

type Tok = (
  | { t: 'id'; v: string }
  | { t: 'tyid'; v: string } // capitalized: Int, Float, Str, Bool, List
  | { t: 'int'; v: number }
  | { t: 'float'; v: number }
  | { t: 'str'; parts: (string | Tok[])[] } // template parts; holes pre-lexed
  | { t: 'p'; v: string } // punctuation / operator
) & { adj?: boolean }; // no whitespace between this token and the previous one

const PUNCT2 = ['==', '!=', '<=', '>=', '&&', '||', '+=', '-='];
const PUNCT1 = '{}[]()<>=+-*/%!&|?:;.,'.split('');

function lex(src: string, where: string): Tok[] {
  const rawToks: Tok[] = [];
  let i = 0;
  let sawSpace = false;
  // every token records whether it touches the previous one (child-position
  // disambiguation: `panel(…)` is an instance, `disp (…)` is ref + inline sibling)
  const toks = {
    push(t: Tok): void {
      t.adj = rawToks.length > 0 && !sawSpace;
      sawSpace = false;
      rawToks.push(t);
    },
  };
  const fail = (detail: string): never => {
    throw new AilDiagnostic({ error: 'parse', decl: where, detail });
  };
  while (i < src.length) {
    const c = src[i]!;
    if (c === ' ') { i++; sawSpace = true; continue; }
    if (c === '"') {
      // string / template literal
      const parts: (string | Tok[])[] = [];
      let cur = '';
      i++;
      while (true) {
        if (i >= src.length) fail('unterminated string');
        const ch = src[i]!;
        if (ch === '\\') {
          const nxt = src[i + 1];
          if (nxt === 'n') cur += '\n';
          else if (nxt === '"' || nxt === '\\' || nxt === '{') cur += nxt;
          else fail(`bad escape \\${nxt}`);
          i += 2;
        } else if (ch === '"') { i++; break; }
        else if (ch === '{') {
          // hole: scan to matching } tracking nested braces and strings
          let depth = 1; let j = i + 1; let inner = '';
          while (j < src.length && depth > 0) {
            const h = src[j]!;
            if (h === '"') { // nested string: skip it verbatim
              inner += h; j++;
              while (j < src.length && src[j] !== '"') {
                if (src[j] === '\\') { inner += src[j]! + (src[j + 1] ?? ''); j += 2; }
                else { inner += src[j]!; j++; }
              }
              inner += '"'; j++;
              continue;
            }
            if (h === '{') depth++;
            if (h === '}') { depth--; if (depth === 0) break; }
            inner += h; j++;
          }
          if (depth !== 0) fail('unterminated template hole');
          if (cur) { parts.push(cur); cur = ''; }
          parts.push(lex(inner, where));
          i = j + 1;
        } else { cur += ch; i++; }
      }
      if (cur || parts.length === 0) parts.push(cur);
      toks.push({ t: 'str', parts });
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j]!)) j++;
      if (src[j] === '.' && /[0-9]/.test(src[j + 1] ?? '')) {
        j++;
        while (j < src.length && /[0-9]/.test(src[j]!)) j++;
        toks.push({ t: 'float', v: parseFloat(src.slice(i, j)) });
      } else {
        toks.push({ t: 'int', v: parseInt(src.slice(i, j), 10) });
      }
      i = j;
      continue;
    }
    if (/[a-z]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-z0-9_]/.test(src[j]!)) j++;
      toks.push({ t: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Z]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z]/.test(src[j]!)) j++;
      toks.push({ t: 'tyid', v: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (PUNCT2.includes(two)) { toks.push({ t: 'p', v: two }); i += 2; continue; }
    if (PUNCT1.includes(c)) { toks.push({ t: 'p', v: c }); i++; continue; }
    fail(`unexpected character '${c}'`);
  }
  return rawToks;
}

// ---------------------------------------------------------------- parser

class P {
  pos = 0;
  constructor(public toks: Tok[], public where: string) {}

  fail(detail: string): never {
    throw new AilDiagnostic({ error: 'parse', decl: this.where, detail });
  }
  peek(): Tok | undefined { return this.toks[this.pos]; }
  next(): Tok { const t = this.toks[this.pos++]; if (!t) this.fail('unexpected end of line'); return t; }
  atEnd(): boolean { return this.pos >= this.toks.length; }
  isP(v: string): boolean { const t = this.peek(); return !!t && t.t === 'p' && t.v === v; }
  eatP(v: string): boolean { if (this.isP(v)) { this.pos++; return true; } return false; }
  expectP(v: string): void { if (!this.eatP(v)) this.fail(`expected '${v}'`); }
  expectId(): string {
    const t = this.next();
    if (t.t !== 'id') this.fail('expected identifier');
    return t.v;
  }

  // ---- types

  parseType(): Type {
    const t = this.next();
    if (t.t === 'tyid') {
      switch (t.v) {
        case 'Int': return { k: 'int' };
        case 'Float': return { k: 'float' };
        case 'Str': return { k: 'str' };
        case 'Bool': return { k: 'bool' };
        case 'List': {
          this.expectP('<');
          const el = this.parseType();
          this.expectP('>');
          return { k: 'list', el };
        }
        default: this.fail(`unknown type ${t.v}`);
      }
    }
    if (t.t === 'p' && t.v === '{') {
      const fields: { name: string; type: Type }[] = [];
      while (!this.eatP('}')) {
        const name = this.expectId();
        this.expectP(':');
        fields.push({ name, type: this.parseType() });
      }
      return { k: 'rec', fields };
    }
    this.fail('expected type');
  }

  // ---- expressions (precedence climbing)

  parseExpr(): Expr { return this.parseTernary(); }

  parseTernary(): Expr {
    const c = this.parseBin(0);
    if (this.eatP('?')) {
      const t = this.parseTernary();
      this.expectP(':');
      const e = this.parseTernary();
      return { k: 'tern', c, t, e };
    }
    return c;
  }

  static LEVELS: BinOp[][] = [
    ['||'], ['&&'], ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%'],
  ];

  parseBin(level: number): Expr {
    if (level >= P.LEVELS.length) return this.parseUnary();
    let l = this.parseBin(level + 1);
    while (true) {
      const t = this.peek();
      if (t && t.t === 'p' && P.LEVELS[level]!.includes(t.v as BinOp)) {
        this.pos++;
        const r = this.parseBin(level + 1);
        l = { k: 'bin', op: t.v as BinOp, l, r };
      } else return l;
    }
  }

  parseUnary(): Expr {
    if (this.isP('!')) {
      // could be a negated predicate !.f
      const save = this.pos;
      this.pos++;
      if (this.isP('.')) {
        this.pos++;
        const f = this.expectId();
        return { k: 'pred', f, neg: true };
      }
      this.pos = save;
      this.pos++;
      return { k: 'un', op: '!', e: this.parseUnary() };
    }
    if (this.isP('-')) { this.pos++; return { k: 'un', op: 'neg', e: this.parseUnary() }; }
    if (this.isP('.')) { this.pos++; const f = this.expectId(); return { k: 'pred', f, neg: false }; }
    return this.parsePostfix();
  }

  parsePostfix(): Expr {
    let e = this.parsePrimary();
    while (true) {
      if (this.isP('.')) {
        this.pos++;
        e = { k: 'field', e, f: this.expectId() };
      } else if (this.isP('[')) {
        this.pos++;
        const i = this.parseExpr();
        this.expectP(']');
        e = { k: 'index', e, i };
      } else return e;
    }
  }

  parsePrimary(): Expr {
    const t = this.next();
    if (t.t === 'int') return { k: 'int', v: t.v };
    if (t.t === 'float') return { k: 'float', v: t.v };
    if (t.t === 'str') return exprFromStrTok(t, this.where);
    if (t.t === 'id') {
      if (t.v === 'true') return { k: 'bool', v: true };
      if (t.v === 'false') return { k: 'bool', v: false };
      if (this.isP('(')) {
        if (!(BUILTINS as string[]).includes(t.v)) this.fail(`unknown function ${t.v}`);
        this.pos++;
        const args: Expr[] = [];
        while (!this.eatP(')')) {
          if (args.length) this.eatP(',');
          args.push(this.parseExpr());
        }
        return { k: 'call', fn: t.v as Builtin, args };
      }
      return { k: 'ref', id: t.v };
    }
    if (t.t === 'p' && t.v === '(') {
      const e = this.parseExpr();
      this.expectP(')');
      return e;
    }
    if (t.t === 'p' && t.v === '[') {
      const items: Expr[] = [];
      while (!this.eatP(']')) {
        if (items.length) this.eatP(',');
        items.push(this.parseExpr());
      }
      return { k: 'list', items };
    }
    if (t.t === 'p' && t.v === '{') {
      const fields: { name: string; val: Expr }[] = [];
      while (!this.eatP('}')) {
        const name = this.expectId();
        this.expectP(':');
        fields.push({ name, val: this.parseExpr() });
      }
      return { k: 'rec', fields };
    }
    this.fail(`unexpected token in expression`);
  }

  // ---- actions

  parseActionSeq(): Action {
    const items = [this.parseAction()];
    while (this.eatP(';')) items.push(this.parseAction());
    return items.length === 1 ? items[0]! : { k: 'seq', items };
  }

  parseAction(): Action {
    const t = this.peek();
    if (!t) this.fail('expected action');
    // start(id) / stop(id)
    if (t.t === 'id' && (t.v === 'start' || t.v === 'stop') && this.toks[this.pos + 1]?.t === 'p'
      && (this.toks[this.pos + 1] as { v: string }).v === '(') {
      this.pos += 2;
      const act = this.expectId();
      this.expectP(')');
      return { k: 'timer', which: t.v as 'start' | 'stop', act };
    }
    // parenthesized action group — unless it turns out to be an expr guard
    if (t.t === 'p' && t.v === '(') {
      const save = this.pos;
      try {
        this.pos++;
        const grp = this.parseActionSeq();
        this.expectP(')');
        if (!this.isP('?')) return grp;
      } catch { /* fall through to guard */ }
      this.pos = save;
    }
    // assignment?
    if (t.t === 'id') {
      const save = this.pos;
      try {
        const sig = this.expectId();
        const steps: LhsStep[] = [];
        while (true) {
          if (this.isP('[')) {
            this.pos++;
            const i = this.parseExpr();
            this.expectP(']');
            steps.push({ k: 'index', i });
          } else if (this.isP('.')) {
            this.pos++;
            steps.push({ k: 'field', f: this.expectId() });
          } else break;
        }
        const op = this.peek();
        if (op && op.t === 'p' && (op.v === '=' || op.v === '+=' || op.v === '-=')) {
          this.pos++;
          const e = this.parseExpr();
          return { k: 'assign', sig, steps, op: op.v as '=' | '+=' | '-=', e };
        }
      } catch { /* not an assignment */ }
      this.pos = save;
    }
    // guard: expr ? action [: action] — condition parsed below ternary level so the
    // guard's own '?' isn't swallowed (ternary conditions must be parenthesized)
    const c = this.parseBin(0);
    this.expectP('?');
    const tAct = this.parseAction();
    if (this.eatP(':')) return { k: 'guard', c, t: tAct, e: this.parseAction() };
    return { k: 'guard', c, t: tAct };
  }

  // ---- nodes / children

  parseAttrs(): { name: string; val: Expr }[] {
    const attrs: { name: string; val: Expr }[] = [];
    if (!this.eatP('{')) return attrs;
    while (!this.eatP('}')) {
      const name = this.expectId();
      this.expectP('=');
      attrs.push({ name, val: this.parseExpr() });
    }
    return attrs;
  }

  parseChildren(stopP?: string): Child[] {
    if (this.isP('[')) {
      this.pos++;
      const kids: Child[] = [];
      while (!this.eatP(']')) kids.push(this.parseChild());
      return kids;
    }
    if (this.atEnd() || (stopP && this.isP(stopP))) return [];
    return [this.parseChild()];
  }

  parseChild(): Child {
    const t = this.peek()!;
    if (t.t === 'str') { this.pos++; return { k: 'text', tpl: exprFromStrTok(t, this.where) }; }
    if (t.t === 'p' && t.v === '(') {
      this.pos++;
      const node = this.parseInlineNode();
      this.expectP(')');
      return { k: 'inline', node };
    }
    if (t.t === 'id') {
      const nxt = this.toks[this.pos + 1];
      // a call only when the paren touches the name: `panel(…)` is an instance,
      // `disp (…)` is a node ref followed by an inline sibling
      const isCall = nxt && nxt.t === 'p' && nxt.v === '(' && nxt.adj === true;
      if (t.v === 'each' && isCall) {
        this.pos += 2;
        const list = this.parseExpr();
        this.eatP(',');
        const tpl = this.expectId();
        this.expectP(')');
        return { k: 'each', list, tpl };
      }
      if (isCall) {
        // component instance: named (a=1 b=2) or positional (profile T)
        this.pos += 2;
        const args: InstArg[] = [];
        while (!this.eatP(')')) {
          if (args.length) this.eatP(',');
          const a = this.peek();
          const b = this.toks[this.pos + 1];
          if (a && a.t === 'id' && b && b.t === 'p' && b.v === '=') {
            this.pos += 2;
            args.push({ name: a.v, val: this.parseExpr() });
          } else {
            args.push({ name: '', val: this.parseExpr() });
          }
        }
        return { k: 'inst', comp: t.v, args };
      }
      this.pos++;
      return { k: 'noderef', id: t.v };
    }
    this.fail('expected child');
  }

  parseInlineNode(): InlineNode {
    const tagTok = this.next();
    if (tagTok.t !== 'id') this.fail('expected tag name');
    const attrs = this.parseAttrs();
    const children = this.parseChildren(')');
    return { tag: tagTok.v, attrs, children };
  }

  // ---- effects (profile R)

  parseEffects(): { r: string[]; w: string[] } {
    const rd: string[] = [];
    const wr: string[] = [];
    for (const [label, arr] of [['r', rd], ['w', wr]] as const) {
      const t = this.peek();
      if (!(t && t.t === 'id' && t.v === label)) this.fail(`expected ${label}[...]`);
      this.pos++;
      this.expectP('[');
      while (!this.eatP(']')) {
        if (arr.length) this.expectP(',');
        arr.push(this.expectId());
      }
    }
    return { r: rd, w: wr };
  }
}

function exprFromStrTok(t: Tok & { t: 'str' }, where: string): Expr {
  if (t.parts.length === 1 && typeof t.parts[0] === 'string') {
    return { k: 'str', v: t.parts[0] };
  }
  const parts: (string | Expr)[] = t.parts.map((p) => {
    if (typeof p === 'string') return p;
    const sub = new P(p, where);
    const e = sub.parseExpr();
    if (!sub.atEnd()) sub.fail('trailing tokens in template hole');
    return e;
  });
  return { k: 'tpl', parts };
}

// ---------------------------------------------------------------- declarations

const KEYWORDS: Record<Profile, Record<string, Decl['kind']>> = {
  I: { sig: 'sig', derive: 'derive', comp: 'comp', node: 'node', on: 'on', act: 'act' },
  R: { sig: 'sig', derive: 'derive', comp: 'comp', node: 'node', on: 'on', act: 'act' },
  T: { s: 'sig', d: 'derive', c: 'comp', n: 'node', o: 'on', a: 'act' },
};

export function parseDeclLine(line: string, profile: Profile, where: string): Decl {
  const p = new P(lex(line, where), where);
  const kw = p.expectId();
  const kind = KEYWORDS[profile][kw];
  if (!kind) p.fail(`unknown declaration keyword '${kw}' for profile ${profile}`);
  switch (kind) {
    case 'sig': {
      const id = p.expectId();
      let ann: Type | undefined;
      if (p.eatP(':')) {
        if (profile === 'T') p.fail('profile T forbids type annotations');
        ann = p.parseType();
      }
      const init = p.parseExpr();
      if (!p.atEnd()) p.fail('trailing tokens');
      return { kind: 'sig', id, ann, init };
    }
    case 'derive': {
      const id = p.expectId();
      let ann: Type | undefined;
      if (p.eatP(':')) {
        if (profile !== 'R') p.fail(`profile ${profile} forbids derive annotations`);
        ann = p.parseType();
      }
      const expr = p.parseExpr();
      if (!p.atEnd()) p.fail('trailing tokens');
      return { kind: 'derive', id, ann, expr };
    }
    case 'comp': {
      const id = p.expectId();
      p.expectP('(');
      const params: { name: string; type: Type }[] = [];
      while (!p.eatP(')')) {
        const name = p.expectId();
        p.expectP(':');
        params.push({ name, type: p.parseType() });
      }
      p.expectP('(');
      const body = p.parseInlineNode();
      p.expectP(')');
      if (!p.atEnd()) p.fail('trailing tokens');
      return { kind: 'comp', id, params, body };
    }
    case 'node': {
      const id = p.expectId();
      const tagTok = p.next();
      const tag = tagTok.t === 'id' ? tagTok.v : p.fail('expected tag name');
      const attrs = p.parseAttrs();
      const children = p.parseChildren();
      if (!p.atEnd()) p.fail('trailing tokens');
      return { kind: 'node', id, tag, attrs, children };
    }
    case 'on': {
      const node = p.expectId();
      p.expectP('.');
      const event = p.expectId();
      const eff = profile === 'R' ? p.parseEffects() : undefined;
      const action = p.parseActionSeq();
      if (!p.atEnd()) p.fail('trailing tokens');
      return { kind: 'on', node, event, eff, action };
    }
    case 'act': {
      const id = p.expectId();
      const msTok = p.next();
      const ms = msTok.t === 'int' ? msTok.v : p.fail('expected interval ms');
      const eff = profile === 'R' ? p.parseEffects() : undefined;
      const action = p.parseActionSeq();
      if (!p.atEnd()) p.fail('trailing tokens');
      return { kind: 'act', id, ms, eff, action };
    }
  }
  return p.fail(`unknown declaration keyword '${kw}'`);
}

export function parseProgram(text: string): Program {
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  const header = lines.shift();
  const m = header?.match(/^ail1 ([TIR])$/);
  if (!m) throw new AilDiagnostic({ error: 'parse', decl: 'header', detail: "first line must be 'ail1 T|I|R'" });
  const profile = m[1] as Profile;
  const decls = lines.map((line, i) => parseDeclLine(line, profile, `line:${i + 2}`));
  return { profile, decls };
}
