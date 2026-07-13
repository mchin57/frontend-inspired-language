// Stage-1 report: token counts for every example in every profile vs the
// hand-written React equivalent. Run: npx tsx benchmark/tokens.ts > benchmark/tokens.md
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tokenCount } from '../src/tokens.js';

const ROOT = join(import.meta.dirname, '..');
const APPS = ['counter', 'todos', 'tabs', 'form', 'stopwatch'];

const count = (p: string) => tokenCount(readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n'));

const rows = APPS.map((app) => {
  const t = count(`examples/${app}.t.ail`);
  const i = count(`examples/${app}.i.ail`);
  const r = count(`examples/${app}.r.ail`);
  const react = count(`benchmark/react/${app}.tsx`);
  return { app, t, i, r, react, ratio: react / i };
});

const specs = (['T', 'I', 'R'] as const).map((p) => ({
  p, tokens: count(`spec/spec-${p}.md`),
}));

console.log('# Stage 1 — static token counts (o200k_base)');
console.log('');
console.log('| app | T | I | R | React/TSX | React ÷ I |');
console.log('|---|---|---|---|---|---|');
let sums = { t: 0, i: 0, r: 0, react: 0 };
for (const r of rows) {
  console.log(`| ${r.app} | ${r.t} | ${r.i} | ${r.r} | ${r.react} | ${r.ratio.toFixed(1)}× |`);
  sums = { t: sums.t + r.t, i: sums.i + r.i, r: sums.r + r.r, react: sums.react + r.react };
}
console.log(`| **total** | **${sums.t}** | **${sums.i}** | **${sums.r}** | **${sums.react}** | **${(sums.react / sums.i).toFixed(1)}×** |`);
console.log('');
console.log('In-context spec sizes: ' + specs.map((s) => `${s.p}=${s.tokens}`).join(', ') + ' tokens.');
console.log('');
console.log('Stage-1 gate (plan): AIL must beat React source tokens by ≥2× on the examples.');
