// Stage-2 scorer: checks every runs/<model>/<profile>/<task>.ail, records
// valid-on-first-try, error count, and error-code distribution.
// Usage: npx tsx benchmark/score.ts [model]   (model optional: fable|opus)
import { execFileSync } from "node:child_process";
import { readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "runs");
const TASKS = ["chars", "lights", "shop", "temp", "vote"];
const PROFILES = ["T", "I", "R"];

type Row = { model: string; profile: string; task: string; ok: boolean; errs: number; codes: string[] };

function checkFile(f: string): { ok: boolean; errs: number; codes: string[] } {
  let out = "";
  try {
    out = execFileSync("npx", ["tsx", "src/cli.ts", "check", f], {
      cwd: join(import.meta.dirname, ".."), encoding: "utf8", shell: process.platform === "win32",
    });
  } catch (e: any) {
    out = (e.stdout ?? "") + (e.stderr ?? "");
  }
  const lines = out.trim().split("\n").filter(Boolean);
  if (lines.length === 1 && lines[0].includes('"ok":true')) return { ok: true, errs: 0, codes: [] };
  const codes: string[] = [];
  for (const l of lines) {
    try { const j = JSON.parse(l); if (j.error) codes.push(j.error); } catch { codes.push("PARSE_FAIL:" + l.slice(0, 40)); }
  }
  return { ok: false, errs: codes.length, codes };
}

const models = process.argv[2] ? [process.argv[2]] : ["fable", "opus"];
const rows: Row[] = [];
for (const model of models) {
  for (const profile of PROFILES) {
    for (const task of TASKS) {
      const f = join(ROOT, model, profile, task + ".ail");
      if (!existsSync(f)) { rows.push({ model, profile, task, ok: false, errs: -1, codes: ["MISSING"] }); continue; }
      const r = checkFile(f);
      rows.push({ model, profile, task, ...r });
    }
  }
}

// Per-file detail
console.log("## Per-file\n");
console.log("| model | profile | task | valid | errs | codes |");
console.log("|---|---|---|---|---|---|");
for (const r of rows) {
  const valid = r.errs < 0 ? "—" : r.ok ? "✅" : "❌";
  const codes = r.errs < 0 ? "(missing)" : r.codes.join(", ") || "—";
  console.log(`| ${r.model} | ${r.profile} | ${r.task} | ${valid} | ${r.errs < 0 ? "—" : r.errs} | ${codes} |`);
}

// Per model×profile summary
console.log("\n## Summary (valid-first-try / mean errors)\n");
console.log("| model | profile | valid first-try | mean errors |");
console.log("|---|---|---|---|");
for (const model of models) {
  for (const profile of PROFILES) {
    const sub = rows.filter(r => r.model === model && r.profile === profile && r.errs >= 0);
    if (!sub.length) continue;
    const valid = sub.filter(r => r.ok).length;
    const mean = (sub.reduce((a, r) => a + r.errs, 0) / sub.length).toFixed(2);
    console.log(`| ${model} | ${profile} | ${valid}/${sub.length} | ${mean} |`);
  }
}

// Error-code distribution
console.log("\n## Error-code distribution\n");
const dist: Record<string, number> = {};
for (const r of rows) for (const c of r.codes) if (r.errs > 0) dist[c] = (dist[c] ?? 0) + 1;
const sorted = Object.entries(dist).sort((a, b) => b[1] - a[1]);
if (!sorted.length) console.log("_(none)_");
for (const [c, n] of sorted) console.log(`- ${c}: ${n}`);
