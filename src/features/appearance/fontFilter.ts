import type { FontFamily } from '@contract/types';

export function filterFonts(fonts: FontFamily[], query: string, cjkOnly: boolean): FontFamily[] {
  const q = query.trim().toLowerCase();
  return fonts.filter(
    (f) =>
      (!cjkOnly || f.cjk) &&
      (!q || [f.family, ...f.localizedFamilies].some((n) => n.toLowerCase().includes(q))),
  );
}
