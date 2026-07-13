// ail build: check the program, then emit one self-contained HTML file — the
// declaration table as JSON + the fixed runtime + the style-token stylesheet.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AilDiagnostic } from './ast.js';
import { check } from './check.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const CSS = `
body{font-family:system-ui,sans-serif;margin:0;padding:0;color:#1a1a1a;background:#fafafa}
.s_row{display:flex;flex-direction:row}
.s_col{display:flex;flex-direction:column}
.s_gap1{gap:4px}.s_gap2{gap:8px}.s_gap3{gap:16px}.s_gap4{gap:24px}
.s_p1{padding:4px}.s_p2{padding:8px}.s_p3{padding:16px}.s_p4{padding:24px}
.s_m1{margin:4px}.s_m2{margin:8px}.s_m3{margin:16px}.s_m4{margin:24px}
.s_w_full{width:100%}
.s_flex1{flex:1}
.s_center{align-items:center;justify-content:center}
.s_bold{font-weight:700}
.s_italic{font-style:italic}
.s_small{font-size:12px}
.s_large{font-size:24px}
.s_muted{color:#767676}
.s_card{border:1px solid #ddd;border-radius:8px;padding:16px;background:#fff}
.s_btn{border:1px solid #bbb;border-radius:6px;background:#fff;padding:6px 12px;cursor:pointer;font:inherit}
.s_btn:hover{background:#f0f0f0}
.s_input{border:1px solid #bbb;border-radius:6px;padding:6px 10px;font:inherit}
.s_list{list-style:none;padding:0;margin:0}
input,button,select{font:inherit}
ul{list-style:none;padding:0;margin:0}
`.trim();

export function build(text: string): string {
  const res = check(text);
  const hard = res.errors.filter((e) => e.error !== 'canon');
  if (hard.length > 0 || !res.program) throw new AilDiagnostic(hard[0]!);
  const runtime = readFileSync(join(HERE, 'runtime.js'), 'utf8');
  // </script> can never appear via program text: escape closing tags inside the JSON
  const json = JSON.stringify(res.program).replace(/<\//g, '<\\/');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ail app</title>
<style>${CSS}</style>
</head>
<body>
<script>window.AIL_PROGRAM=${json};</script>
<script>${runtime}</script>
</body>
</html>
`;
}
