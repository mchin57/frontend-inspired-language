// ail CLI: check | build | convert | edit | tokens
import { readFileSync, writeFileSync } from 'node:fs';
import { AilDiagnostic, Profile } from './ast.js';
import { check, convert } from './check.js';
import { applyOps, parseOps } from './edit.js';
import { build } from './build.js';
import { tokenCount } from './tokens.js';

function usage(): never {
  console.error(
    'usage: ail check <file>\n' +
    '       ail build <file> -o <out.html>\n' +
    '       ail convert <file> --to T|I|R\n' +
    '       ail edit <file> <ops-file>\n' +
    '       ail tokens <file>',
  );
  process.exit(2);
}

const [cmd, ...args] = process.argv.slice(2);
const read = (p: string | undefined): string => {
  if (!p) usage();
  return readFileSync(p, 'utf8');
};

try {
  switch (cmd) {
    case 'check': {
      const res = check(read(args[0]));
      for (const e of res.errors) console.log(JSON.stringify(e));
      if (res.errors.length === 0) console.log('{"ok":true}');
      process.exit(res.errors.length === 0 ? 0 : 1);
      break;
    }
    case 'build': {
      const oIdx = args.indexOf('-o');
      if (oIdx === -1 || !args[oIdx + 1]) usage();
      const out = args[oIdx + 1]!;
      const html = build(read(args[0]));
      writeFileSync(out, html);
      console.log(JSON.stringify({ ok: true, out }));
      break;
    }
    case 'convert': {
      const tIdx = args.indexOf('--to');
      const to = args[tIdx + 1];
      if (tIdx === -1 || !to || !['T', 'I', 'R'].includes(to)) usage();
      process.stdout.write(convert(read(args[0]), to as Profile));
      break;
    }
    case 'edit': {
      const file = args[0];
      const next = applyOps(read(file), parseOps(read(args[1])));
      writeFileSync(file!, next);
      const res = check(next);
      for (const e of res.errors) console.log(JSON.stringify(e));
      if (res.errors.length === 0) console.log('{"ok":true}');
      process.exit(res.errors.length === 0 ? 0 : 1);
      break;
    }
    case 'tokens': {
      const text = read(args[0]);
      console.log(JSON.stringify({ tokens: tokenCount(text), chars: text.length }));
      break;
    }
    default:
      usage();
  }
} catch (e) {
  if (e instanceof AilDiagnostic) {
    console.log(JSON.stringify(e.err));
    process.exit(1);
  }
  throw e;
}
