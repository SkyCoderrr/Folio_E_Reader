// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Settings } from '@contract/types';
import defaults from '../../../contract/settings.defaults.json';

const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../ipc/commands', () => ({ invoke: ipc.invoke }));

import { useSettings } from '../../state/settingsStore';
import { AppearancePanel } from './AppearancePanel';
import { filterFonts } from './fontFilter';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const realActions = { ...useSettings.getState() };

beforeEach(async () => {
  useSettings.setState({ patchStyle: realActions.patchStyle, selectPreset: realActions.selectPreset });
  ipc.invoke.mockReset();
  ipc.invoke.mockResolvedValue([]);
  const base = structuredClone(defaults) as Settings;
  base.presets = [
    {
      id: 'custom.a',
      name: 'Mine',
      builtIn: false,
      style: structuredClone(useSettings.getState().effectiveStyle),
      updatedAt: 1,
    },
  ];
  useSettings.setState({
    settings: base,
    presetsList: [...useSettings.getState().presetsList.filter((p) => p.builtIn), ...base.presets],
    effectiveStyle: useSettings.getState().effectiveStyle,
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<AppearancePanel open onClose={() => undefined} />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const q = (sel: string) => host.querySelector<HTMLElement>(sel);

it('renders all sections in order', () => {
  const titles = [...host.querySelectorAll('section')].map((s) => s.getAttribute('aria-label'));
  expect(titles).toEqual(['Presets', 'Colours', 'Fonts', 'Size & Spacing', 'Layout', 'CJK']);
});

it('a numeric field commit calls patchStyle with the clamped value', async () => {
  const patchStyle = vi.fn();
  useSettings.setState({ patchStyle });
  const input = q('input[aria-label="Size value"]') as HTMLInputElement;
  await act(async () => {
    input.focus();
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(input, '500');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.blur();
  });
  expect(patchStyle).toHaveBeenCalledWith({ font: { size: 72 } });
});

it('the reset dot follows isOverridden', async () => {
  expect(q('button[aria-label="Reset Size"]')).toBeNull();
  await act(async () => useSettings.getState().patchStyle({ font: { size: 30 } }));
  expect(q('button[aria-label="Reset Size"]')).not.toBeNull();
  await act(async () => useSettings.getState().resetStyleKey('font.size'));
  expect(q('button[aria-label="Reset Size"]')).toBeNull();
});

it('clicking a preset chip calls selectPreset', async () => {
  const selectPreset = vi.fn();
  useSettings.setState({ selectPreset });
  const sepia = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Sepia')!;
  await act(async () => sepia.click());
  expect(selectPreset).toHaveBeenCalledWith('builtin.sepia');
});

it('built-in chips have no options menu; custom ones do', () => {
  expect(q('button[aria-label="Dark options"]')).toBeNull();
  expect(q('button[aria-label="Sepia options"]')).toBeNull();
  expect(q('button[aria-label="Mine options"]')).not.toBeNull();
});

it('font filter matches localized names and CJK-only', () => {
  const fonts = [
    { family: 'Microsoft YaHei', localizedFamilies: ['微软雅黑'], cjk: true, weights: [400] },
    { family: 'Sitka Text', localizedFamilies: [], cjk: false, weights: [400] },
  ];
  expect(filterFonts(fonts, '雅黑', false).map((f) => f.family)).toEqual(['Microsoft YaHei']);
  expect(filterFonts(fonts, '', true)).toHaveLength(1);
  expect(filterFonts(fonts, 'sitka', false)).toHaveLength(1);
});
