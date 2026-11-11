/**
 * t28u/t30u (fb3): the owner saw a grey strip along the bottom of the reading surface when the window
 * was maximized or in F11. Live measurement (scripts/fb3-probe.mjs, every flow x pages mode,
 * windowed / maximized / fullscreen, 100 % and 150 %) found the WebView filling the client to the
 * last pixel and nothing painted there: the strip was the native non-client band below a maximized
 * client (window rect runs to the monitor bottom while the client stops at the work area; fixed in
 * src-tauri). These guards keep the web side from ever adding one: the reading area fills the frame,
 * and the footer is a zero-footprint overlay that is neither painted nor hit-tested while hidden.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./ReaderChrome.module.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Declarations of the rule whose selector list is exactly `selector` (whitespace-normalised). */
function rule(selector: string): Record<string, string> {
  const want = selector.replace(/\s+/g, ' ').trim();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.replace(/\s+/g, ' ').trim() !== want) continue;
    const out: Record<string, string> = {};
    for (const d of m[2]!.split(';')) {
      const i = d.indexOf(':');
      if (i > 0)
        out[d.slice(0, i).trim()] = d
          .slice(i + 1)
          .trim()
          .replace(/\s+/g, ' ');
    }
    return out;
  }
  throw new Error(`no rule ${selector}`);
}

describe('reader frame bottom edge (fb3: no strip below the text)', () => {
  it('the frame is exactly the viewport and the reading area fills it to the bottom', () => {
    const frame = rule('.frame');
    expect(frame.height).toBe('100dvh');
    expect(frame.overflow).toBe('hidden');
    expect(frame.background).toBe('var(--reader-bg)');
    const reading = rule('.reading');
    expect(reading.position).toBe('absolute');
    expect(reading.inset).toBe('0');
    expect(reading.background).toBe('var(--reader-bg)');
    for (const r of [frame, reading]) {
      for (const k of [
        'padding',
        'padding-bottom',
        'margin-bottom',
        'min-height',
        'max-height',
        'bottom',
        'border-bottom',
      ]) {
        expect(r[k], k).toBeUndefined();
      }
    }
  });

  it('the footer is an overlay: absolutely placed, so it never reserves height in any window state', () => {
    const shared = rule('.top, .footer');
    expect(shared.position).toBe('absolute');
    expect(rule('.footer').bottom).toBe('0');
    expect(rule('.chrome').position).toBe('absolute');
    expect(rule('.chrome').inset).toBe('0');
  });

  it('a hidden footer paints nothing and takes no input; only visible chrome or the pin shows it', () => {
    const hidden = rule('.top, .footer');
    expect(hidden.opacity).toBe('0');
    expect(hidden.visibility).toBe('hidden');
    expect(rule('.chrome')['pointer-events']).toBe('none');
    const shown = rule(".chrome[data-visible='true'] .top, .chrome[data-visible='true'] .footer");
    expect(shown.opacity).toBe('1');
    expect(shown.visibility).toBe('visible');
    // The footer background is applied only through the .footer rule; nothing else at the bottom
    // edge carries a fill of its own (no media query or window-state selector re-showing it).
    const showsFooter = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
      (m) => /\.footer\b/.test(m[1]!) && /(opacity:\s*1|visibility:\s*visible)/.test(m[2]!),
    );
    expect(showsFooter.map((m) => m[1]!.replace(/\s+/g, ' ').trim())).toEqual([
      ".chrome[data-visible='true'] .top, .chrome[data-visible='true'] .footer",
    ]);
  });
});
