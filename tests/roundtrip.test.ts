import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseProgram } from '../src/parse.js';
import { serialize } from '../src/serialize.js';
import { check, convert } from '../src/check.js';

const EX = join(__dirname, '..', 'examples');
const files = readdirSync(EX).filter((f) => f.endsWith('.ail'));

describe('examples', () => {
  it('found all 15 example files', () => {
    expect(files.length).toBe(15);
  });

  for (const f of files) {
    const text = readFileSync(join(EX, f), 'utf8').replace(/\r\n/g, '\n');

    it(`${f}: checks clean`, () => {
      expect(check(text).errors).toEqual([]);
    });

    it(`${f}: parse → serialize is identity`, () => {
      expect(serialize(parseProgram(text))).toBe(text);
    });
  }

  for (const f of files.filter((x) => x.endsWith('.i.ail'))) {
    const text = readFileSync(join(EX, f), 'utf8').replace(/\r\n/g, '\n');

    it(`${f}: convert round-trips through every profile`, () => {
      const t = convert(text, 'T');
      const r = convert(text, 'R');
      expect(convert(t, 'I')).toBe(text);
      expect(convert(r, 'I')).toBe(text);
      expect(convert(convert(t, 'R'), 'I')).toBe(text);
      // and the generated T/R files on disk match fresh conversion
      const base = f.replace('.i.ail', '');
      expect(readFileSync(join(EX, `${base}.t.ail`), 'utf8').replace(/\r\n/g, '\n')).toBe(t);
      expect(readFileSync(join(EX, `${base}.r.ail`), 'utf8').replace(/\r\n/g, '\n')).toBe(r);
    });
  }
});
