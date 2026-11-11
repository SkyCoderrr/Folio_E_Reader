// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Settings, SettingsPane } from '@contract/types';
import defaults from '../../../contract/settings.defaults.json';
import { AppearancePanel } from '../appearance/AppearancePanel';
vi.mock('../../ipc/commands', () => ({ invoke: vi.fn(async () => []) }));
import { SettingsPage, type SettingsPageProps } from './SettingsPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const keymap: SettingsPageProps['keymap'] = [
  {
    actionId: 'scroll.down',
    label: 'Scroll down',
    scope: 'reader',
    chords: ['ArrowDown'],
    defaults: ['ArrowDown'],
  },
  { actionId: 'toc.toggle', label: 'Contents', scope: 'reader', chords: ['T'], defaults: ['T'] },
  {
    actionId: 'layout.toggleFlow',
    label: 'Toggle flow',
    scope: 'reader',
    chords: ['M'],
    defaults: ['M'],
  },
];

function mount(over: Partial<SettingsPageProps> = {}) {
  const props: SettingsPageProps = {
    settings: structuredClone(defaults) as unknown as Settings,
    pane: 'keyboard',
    onPaneChange: vi.fn(),
    onPatch: vi.fn(),
    onBack: vi.fn(),
    bossStatus: null,
    onBossShortcut: vi.fn().mockResolvedValue(undefined),
    onBossEnabled: vi.fn(),
    libraryDir: 'C:\\Docs\\E_Reader Library',
    onPickLibraryFolder: vi.fn(),
    onResetLibraryFolder: vi.fn(),
    appVersion: '0.1.0',
    contractVersion: '0.3.0',
    keymap,
    onRebind: vi.fn(),
    onResetBinding: vi.fn(),
    onResetAllBindings: vi.fn(),
    ...over,
  };
  act(() => root.render(<SettingsPage {...props} />));
  return props;
}
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).click());
const byLabel = (l: string) => host.querySelector(`[aria-label="${l}"]`);
const button = (text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === text);
const press = (init: KeyboardEventInit) =>
  act(
    () =>
      void window.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
      ),
  );

it('recording a chord calls onRebind with the appended chord', () => {
  const p = mount();
  click(byLabel('Add shortcut for Scroll down'));
  press({ code: 'KeyJ', ctrlKey: true });
  expect(p.onRebind).toHaveBeenCalledWith('scroll.down', ['ArrowDown', 'Ctrl+J']);
});

it('shows a conflict message and Replace frees the other action', () => {
  const p = mount();
  click(byLabel('Add shortcut for Contents'));
  press({ code: 'KeyM' });
  expect(p.onRebind).not.toHaveBeenCalled();
  expect(host.textContent).toContain('already used by “Toggle flow”');
  click(button('Replace'));
  expect(p.onRebind).toHaveBeenCalledWith('layout.toggleFlow', []);
  expect(p.onRebind).toHaveBeenCalledWith('toc.toggle', ['T', 'M']);
});

it('rejects a boss key of "B" alone and accepts Ctrl+Alt+J', () => {
  const p = mount();
  click(button('Record'));
  press({ code: 'KeyB' });
  expect(p.onBossShortcut).not.toHaveBeenCalled();
  expect(host.textContent).toContain('needs Ctrl, Alt or Shift');
  click(button('Record'));
  press({ code: 'KeyJ', ctrlKey: true, altKey: true });
  expect(p.onBossShortcut).toHaveBeenCalledWith('Ctrl+Alt+J');
});

it('shows the registration banner when the boss key is enabled but not registered', () => {
  mount({
    bossStatus: {
      enabled: true,
      shortcut: 'Ctrl+Alt+B',
      registered: false,
      error: { code: 'SHORTCUT_IN_USE', message: 'x' } as never,
    },
  });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'Another app is already using Ctrl+Alt+B',
  );
});

it('changing pane calls onPaneChange', () => {
  const p = mount({ pane: 'general' });
  click([...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'Scrolling'));
  expect(p.onPaneChange).toHaveBeenCalledWith('scrolling');
});

it('audits every contract default key against a reachable UI control or documented internal exception', () => {
  const internal: Record<string, string> = {
    version: 'Schema version is owned by migrations.',
    'library.storageMode':
      'The contract only permits copy in v1; Library displays this fixed value.',
  };
  const controls: Record<string, [SettingsPane | 'appearance' | 'reader', string]> = {
    activePresetId: ['appearance', 'Presets'],
    presets: ['appearance', 'Save as Preset'],
    styleOverrides: ['appearance', 'Size'],
    'reader.flow': ['reading', 'Reading flow'],
    'reader.pagesPerView': ['reading', 'Pages per view'],
    'layout.minSpreadWidthPx': ['reading', 'Minimum width for two pages'],
    'epub.styleOverride': ['reading', 'Publisher styles in EPUB'],
    'chrome.autoHideDelayMs': ['reading', 'Hide toolbar after'],
    'chrome.footerProgress': ['reading', 'Reading progress'],
    'cursor.autoHideDelayMs': ['reading', 'Hide cursor after'],
    'scroll.arrowSpeed': ['scrolling', 'Speed'],
    'scroll.startRampMs': ['scrolling', 'Start ramp'],
    'scroll.acceleration': ['scrolling', 'Speed up while a key is held'],
    'scroll.accelMax': ['scrolling', 'Top speed multiplier'],
    'scroll.accelRampMs': ['scrolling', 'Time to top speed'],
    'scroll.stopDecelMs': ['scrolling', 'Stop easing'],
    'scroll.tapLines': ['scrolling', 'Lines per tap'],
    'scroll.pageOverlapLines': ['scrolling', 'Page overlap'],
    'autoscroll.speed': ['scrolling', 'Speed'],
    'autoscroll.step': ['scrolling', 'Faster / slower step'],
    'autoscroll.pauseOnBlur': ['scrolling', 'Pause when the window loses focus'],
    'txt.chapterRegex': ['txtCjk', 'Chapter heading pattern'],
    'txt.headingMaxChars': ['txtCjk', 'Longest heading'],
    'txt.fallbackChunkChars': ['txtCjk', 'Section size without chapters'],
    'txt.paragraphMode': ['txtCjk', 'Paragraph breaks'],
    'library.folder': ['library', 'Change'],
    'library.view': ['library', 'View'],
    'library.sort': ['library', 'Sort by'],
    'library.sortDir': ['library', 'Sort direction'],
    'library.filter': ['library', 'Show'],
    'window.titleBar': ['general', 'Title bar'],
    'bossKey.enabled': ['keyboard', 'Enabled'],
    'bossKey.shortcut': ['keyboard', 'Record'],
    'stats.enabled': ['stats', 'Track reading time'],
    'stats.idleTimeoutSec': ['stats', 'Stop counting after idle'],
    keybindings: ['keyboard', 'Shortcuts'],
    'ui.settingsLastPane': ['general', 'General'],
    'ui.tocOpen': ['reader', 'Contents'],
  };
  const leaves = (value: unknown, path = ''): string[] => {
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length)
      return Object.entries(value).flatMap(([key, item]) =>
        leaves(item, path ? path + '.' + key : key),
      );
    return [path];
  };
  expect(Object.keys({ ...internal, ...controls }).sort()).toEqual(leaves(defaults).sort());
  for (const [path, [pane, label]] of Object.entries(controls)) {
    if (pane === 'reader') continue; // ReaderView integration tests exercise the Contents button and T.
    if (pane === 'appearance')
      act(() => root.render(<AppearancePanel open onClose={() => undefined} />));
    else mount({ pane });
    const text =
      host.textContent +
      [...host.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')).join(' ');
    expect(text, path + ' must have a UI editor').toContain(label);
    expect(host.querySelector('button, input, textarea'), path).not.toBeNull();
  }
});
