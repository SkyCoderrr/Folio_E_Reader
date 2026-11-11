import { describe, expect, it } from 'vitest';
import { deskColors, deskLayers, isDarkTheme } from './deskColors';

const light = { background: '#fbf8f1', foreground: '#2b2b2b' };
const dark = { background: '#1c1c1e', foreground: '#d8d4cc' };

describe('deskColors (PRD §6.7, M6.2)', () => {
  it('detects dark themes by background vs text luminance', () => {
    expect(isDarkTheme(light)).toBe(false);
    expect(isDarkTheme(dark)).toBe(true);
    expect(isDarkTheme({ background: '#000', foreground: 'nonsense' })).toBe(true);
  });

  it('desk = background mixed 5% toward the text colour on every theme (never black)', () => {
    expect(deskColors(dark).desk).toBe('color-mix(in srgb, #d8d4cc 5%, #1c1c1e)');
    expect(deskColors(light).desk).toBe('color-mix(in srgb, #2b2b2b 5%, #fbf8f1)');
  });

  it('page edge = 6% text colour; page = theme background', () => {
    expect(deskColors(light).edge).toBe('color-mix(in srgb, #2b2b2b 6%, #fbf8f1)');
    expect(deskColors(dark).page).toBe('#1c1c1e');
  });

  it('paints the desk on the sides and the gutter only, and a 1 px edge on each page', () => {
    const c = deskColors(light);
    const pages = [
      { x: 100, width: 700 },
      { x: 848, width: 700 },
    ];
    const l = deskLayers(c, pages, 1648, 900);
    const sizes = l.backgroundSize.split(', ');
    const positions = l.backgroundPosition.split(', ');
    // Per page: row band + left edge + right edge; then desk: left side, gutter, right side.
    expect(sizes).toEqual(['700px 900px', '1px 100%', '1px 100%', '700px 900px', '1px 100%', '1px 100%', '100px 100%', '48px 100%', 'calc(100% - 1548px) 100%']);
    expect(positions).toEqual(['100px 0', '100px 0', '799px 0', '848px 0', '848px 0', '1547px 0', '0px 0', '800px 0', '1548px 0']);
    expect(l.backgroundImage.split('linear-gradient').length - 1).toBe(9);
    expect(l.backgroundImage).toContain(`${c.edge} 1px, transparent 1px`);
  });

  it('a full-height single row (paged spread) gets side edges only', () => {
    const l = deskLayers(deskColors(dark), [{ x: 0, width: 500 }], 500, 0);
    expect(l.backgroundSize.split(', ')).toEqual(['1px 100%', '1px 100%']);
  });
});
