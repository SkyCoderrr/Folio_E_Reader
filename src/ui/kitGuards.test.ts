import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('no hex colour literals outside tokens.css', () => {
  it('src has none (test files and readingStyle.ts preset data allowed)', () => {
    const re = /#[0-9a-fA-F]{3,8}\b/;
    const bad = walk(SRC)
      .map((f) => relative(SRC, f).split(sep).join('/'))
      .filter((f) => /\.(tsx?|css)$/.test(f))
      .filter((f) => f !== 'ui/tokens.css' && f !== 'engine/style/readingStyle.ts')
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => re.test(readFileSync(join(SRC, f), 'utf8')));
    expect(bad).toEqual([]);
  });
});

function token(css: string, name: string): string {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
  if (!m) throw new Error(`missing token ${name}`);
  return m[1]!.trim();
}
function rgb(v: string): [number, number, number, number] {
  const h = /^#([0-9a-f]{6})$/i.exec(v);
  if (h) {
    const n = parseInt(h[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(v);
  if (!m) throw new Error(`unparsed colour ${v}`);
  return [+m[1]!, +m[2]!, +m[3]!, m[4] === undefined ? 1 : +m[4]];
}
function lum([r, g, b]: number[]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
}
const ratio = (a: number[], b: number[]) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('tint contrast', () => {
  const css = readFileSync(join(SRC, 'ui/tokens.css'), 'utf8');
  const over = (fg: ReturnType<typeof rgb>, bg: ReturnType<typeof rgb>) =>
    [0, 1, 2].map((i) => fg[i]! * fg[3] + bg[i]! * (1 - fg[3]));
  it('--text-1 on --accent-tint over --surface-0 is >= 7:1', () => {
    const bg = over(rgb(token(css, '--accent-tint')), rgb(token(css, '--surface-0')));
    expect(ratio(rgb(token(css, '--text-1')), bg)).toBeGreaterThanOrEqual(7);
  });
  it('--text-1 on --active-tint and --danger-tint over --surface-1 is >= 7:1', () => {
    for (const t of ['--active-tint', '--danger-tint']) {
      const bg = over(rgb(token(css, t)), rgb(token(css, '--surface-1')));
      expect(ratio(rgb(token(css, '--text-1')), bg)).toBeGreaterThanOrEqual(7);
    }
  });
});
