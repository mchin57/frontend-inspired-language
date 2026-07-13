// ID-addressed edit protocol: models mutate programs via ops, never text patches.
// Ops file: one JSON object per line — {"op":"add","decl":"<line>"} |
// {"op":"replace","id":"x","decl":"<line>"} | {"op":"del","id":"x"}

import { AilDiagnostic, Decl, EditOp, Program, declId } from './ast.js';
import { parseDeclLine } from './parse.js';
import { parseProgram } from './parse.js';
import { serialize } from './serialize.js';

export function parseOps(text: string): EditOp[] {
  return text.split(/\r?\n/).filter((l) => l.trim()).map((l, i) => {
    let o: unknown;
    try { o = JSON.parse(l); } catch {
      throw new AilDiagnostic({ error: 'edit', decl: `op:${i + 1}`, detail: 'not valid JSON' });
    }
    const op = o as EditOp;
    if (op.op !== 'add' && op.op !== 'replace' && op.op !== 'del') {
      throw new AilDiagnostic({ error: 'edit', decl: `op:${i + 1}`, detail: `unknown op '${(op as { op?: string }).op}'` });
    }
    return op;
  });
}

/** Apply ops and return the re-canonicalized program text (not yet checked). */
export function applyOps(text: string, ops: EditOp[]): string {
  const program: Program = parseProgram(text);
  const decls = new Map<string, Decl>(program.decls.map((d) => [declId(d), d]));
  for (const op of ops) {
    if (op.op === 'del') {
      if (!decls.delete(op.id)) {
        throw new AilDiagnostic({ error: 'edit', decl: op.id, detail: 'del: no such declaration' });
      }
      continue;
    }
    const d = parseDeclLine(op.decl, program.profile, `op:${op.op}`);
    const id = declId(d);
    if (op.op === 'add') {
      if (decls.has(id)) {
        throw new AilDiagnostic({ error: 'edit', decl: id, detail: 'add: id already exists (use replace)' });
      }
      decls.set(id, d);
    } else {
      if (!decls.has(op.id)) {
        throw new AilDiagnostic({ error: 'edit', decl: op.id, detail: 'replace: no such declaration' });
      }
      if (id !== op.id) decls.delete(op.id); // replace may rename
      decls.set(id, d);
    }
  }
  return serialize({ profile: program.profile, decls: [...decls.values()] });
}
