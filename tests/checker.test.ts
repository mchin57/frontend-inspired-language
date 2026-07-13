import { describe, expect, it } from 'vitest';
import { check } from '../src/check.js';
import { applyOps } from '../src/edit.js';
import { AilError } from '../src/ast.js';

const I = (...lines: string[]) => ['ail1 I', ...lines].join('\n') + '\n';
const R = (...lines: string[]) => ['ail1 R', ...lines].join('\n') + '\n';
const T = (...lines: string[]) => ['ail1 T', ...lines].join('\n') + '\n';

const COUNTER = [
  'sig n 0',
  'node btn button{s="btn"} "Count: {n}"',
  'node root div{s="p4"} btn',
  'on btn.click n=n+1',
];

/** counter with one line replaced/added; lines stay in canonical order per test */
function counterWith(edits: { drop?: string; add?: string[]; swap?: [string, string] }): string {
  let lines = [...COUNTER];
  if (edits.drop) lines = lines.filter((l) => !l.startsWith(edits.drop!));
  if (edits.swap) lines = lines.map((l) => (l === edits.swap![0] ? edits.swap![1] : l));
  if (edits.add) lines = [...lines, ...edits.add];
  return I(...lines);
}

function expectError(text: string, code: string): AilError {
  const res = check(text);
  const found = res.errors.find((e) => e.error === code);
  expect(found, `expected '${code}' in: ${JSON.stringify(res.errors)}`).toBeDefined();
  return found!;
}

/** the emitted fix, applied, must eliminate the error (and ideally everything) */
function expectFixHeals(text: string, code: string): void {
  const err = expectError(text, code);
  expect(err.fix, `'${code}' should carry a fix`).toBeDefined();
  const healed = applyOps(text, [err.fix!]);
  const after = check(healed);
  expect(after.errors.filter((e) => e.error === code)).toEqual([]);
}

describe('checker: happy path', () => {
  it('counter checks clean', () => {
    expect(check(I(...COUNTER)).errors).toEqual([]);
  });
});

describe('checker rules', () => {
  it('parse: garbage line', () => {
    expectError(counterWith({ add: ['sig $$$ 0'] }), 'parse');
  });

  it('parse: bad header', () => {
    expectError('ail1 X\nsig n 0\n', 'parse');
  });

  it('dup-id', () => {
    expectError(counterWith({ add: ['sig n 1'] }), 'dup-id');
  });

  it('dup-id: two handlers for same node.event', () => {
    expectError(counterWith({ add: ['on btn.click n=0'] }), 'dup-id');
  });

  it('no-root', () => {
    expectError(counterWith({ drop: 'node root' }), 'no-root');
  });

  it('bad-ref: unknown sig in expression', () => {
    expectError(counterWith({ swap: ['on btn.click n=n+1', 'on btn.click n=m+1'] }), 'bad-ref');
  });

  it('bad-ref: unknown node child', () => {
    expectError(counterWith({ swap: ['node root div{s="p4"} btn', 'node root div{s="p4"} [btn zzz]'] }), 'bad-ref');
  });

  it('type: Int + Str', () => {
    expectError(counterWith({ swap: ['on btn.click n=n+1', 'on btn.click n=n+"x"'] }), 'type');
  });

  it('type: guard condition not Bool', () => {
    expectError(counterWith({ swap: ['on btn.click n=n+1', 'on btn.click n ? n=0'] }), 'type');
  });

  it('needs-ann (I): empty-list sig; fix annotates from usage', () => {
    const text = I(
      'sig n 0',
      'sig xs []',
      'node btn button{s="btn"} "Count: {n} {len(xs)}"',
      'node root div{s="p4"} btn',
      'on btn.click n=n+1;xs+=n',
    );
    expectFixHeals(text, 'needs-ann');
  });

  it('needs-ann: not determinable at all', () => {
    expectError(counterWith({ add: ['sig xs []'] }), 'needs-ann');
  });

  it('cycle: derive cycle', () => {
    expectError(counterWith({ add: ['derive a b+1', 'derive b a+1'] }), 'cycle');
  });

  it('orphan: unused sig has del fix', () => {
    expectFixHeals(counterWith({ add: ['sig unused 0'] }), 'orphan');
  });

  it('orphan: unplaced node has del fix', () => {
    expectFixHeals(counterWith({ add: ['node stray span "hi"'] }), 'orphan');
  });

  it('orphan: never-started act has del fix', () => {
    expectFixHeals(counterWith({ add: ['act tick 100 n=n+1'] }), 'orphan');
  });

  it('scope: it outside each-template', () => {
    expectError(counterWith({ swap: ['node btn button{s="btn"} "Count: {n}"', 'node btn button{s="btn"} "{ix}"'] }), 'scope');
  });

  it('scope: val in click handler', () => {
    expectError(counterWith({ swap: ['on btn.click n=n+1', 'on btn.click n=len(val)'] }), 'scope');
  });

  it('scope: assigning a derive', () => {
    const text = counterWith({
      swap: ['node btn button{s="btn"} "Count: {n}"', 'node btn button{s="btn"} "Count: {d}"'],
      add: ['derive d n+1', 'on btn.change d=1'],
    });
    expectError(text, 'scope');
  });

  it('scope: component body is display-only', () => {
    const text = I(
      'sig n 0',
      'comp bad() (div btn)',
      'node btn button{s="btn"} "Count: {n}"',
      'node root div{s="p4"} [btn bad()]',
      'on btn.click n=n+1',
    );
    expectError(text, 'scope');
  });

  it('bad-attr', () => {
    expectError(counterWith({ swap: ['node btn button{s="btn"} "Count: {n}"', 'node btn button{zap="x"} "Count: {n}"'] }), 'bad-attr');
  });

  it('bad-style', () => {
    expectError(counterWith({ swap: ['node btn button{s="btn"} "Count: {n}"', 'node btn button{s="zorp"} "Count: {n}"'] }), 'bad-style');
  });

  it('bad-event', () => {
    expectError(counterWith({ swap: ['on btn.click n=n+1', 'on btn.hover n=n+1'] }), 'bad-event');
  });

  it('canon: declaration order', () => {
    const text = I(
      'node btn button{s="btn"} "Count: {n}"',
      'sig n 0', // sigs sort before nodes
      'node root div{s="p4"} btn',
      'on btn.click n=n+1',
    );
    expectError(text, 'canon');
  });

  it('canon: non-canonical spacing; fix rewrites the line', () => {
    expectFixHeals(counterWith({ swap: ['sig n 0', 'sig  n  0'] }), 'canon');
  });

  it('canon: attrs out of order; fix rewrites the line', () => {
    const prog = I(
      'sig n 0',
      'node btn button{s="btn"} "Count: {n}"',
      'node root div{show=n>=0 s="p4"} btn', // s should sort before show
      'on btn.click n=n+1',
    );
    expectFixHeals(prog, 'canon');
  });
});

describe('profile R', () => {
  const RCOUNTER = [
    'sig n:Int 0',
    'node btn button{s="btn"} "Count: {n}"',
    'node root div{s="p4"} btn',
    'on btn.click r[n] w[n] n=n+1',
  ];

  it('checks clean with correct annotations and effects', () => {
    expect(check(R(...RCOUNTER)).errors).toEqual([]);
  });

  it('effects mismatch; fix rewrites with inferred effects', () => {
    const text = R(...RCOUNTER.map((l) => (l.startsWith('on') ? 'on btn.click r[] w[n] n=n+1' : l)));
    expectFixHeals(text, 'effects');
  });

  it('missing annotation; fix annotates', () => {
    const text = R(...RCOUNTER.map((l) => (l.startsWith('sig') ? 'sig n 0' : l)));
    expectFixHeals(text, 'needs-ann');
  });
});

describe('profile T', () => {
  it('usage inference types an un-annotated empty list', () => {
    const text = T(
      's n 0',
      's xs []',
      'n btn button{s="btn"} "Count: {n} {len(xs)}"',
      'n root div{s="p4"} btn',
      'o btn.click n=n+1;xs+=n',
    );
    expect(check(text).errors).toEqual([]);
  });

  it('annotations are forbidden', () => {
    const text = T(
      's n:Int 0',
      'n root div{s="p4"} "hi"',
    );
    expectError(text, 'parse');
  });
});

describe('edit protocol', () => {
  const base = I(...COUNTER);

  it('add + replace place a new node', () => {
    const next = applyOps(base, [
      { op: 'add', decl: 'node lbl span "total {n}"' },
      { op: 'replace', id: 'root', decl: 'node root div{s="p4"} [btn lbl]' },
    ]);
    expect(check(next).errors).toEqual([]);
  });

  it('add of existing id fails', () => {
    expect(() => applyOps(base, [{ op: 'add', decl: 'sig n 1' }])).toThrow();
  });

  it('replace of missing id fails', () => {
    expect(() => applyOps(base, [{ op: 'replace', id: 'zzz', decl: 'sig zzz 0' }])).toThrow();
  });

  it('del of missing id fails', () => {
    expect(() => applyOps(base, [{ op: 'del', id: 'zzz' }])).toThrow();
  });

  it('handlers are addressable as node.event; result re-checks clean', () => {
    const next = applyOps(base, [
      { op: 'add', decl: 'act tick 500 n=n+1' },
      { op: 'replace', id: 'btn.click', decl: 'on btn.click start(tick)' },
    ]);
    expect(check(next).errors).toEqual([]);
  });
});
