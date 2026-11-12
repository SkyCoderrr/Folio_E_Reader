// @vitest-environment jsdom
import { act, useLayoutEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { Menu } from './Menu';
import { closeFocus, fromKeyboard } from './closeFocus';

/** A press; `pointerType` 'mouse' marks it as a mouse gesture for Base UI's close type (jsdom leaves it empty). */
const press = (el: Element, pointerType = '') => {
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
    el.dispatchEvent(
      new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        detail: 1,
        pointerType,
      }),
    );
};
const item = (label: string) =>
  [...document.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent?.startsWith(label)) as HTMLElement;
/** A menu that is open and visible (not closing: `data-ending-style` is instant, kit.module.css). */
const openMenus = () => document.querySelectorAll('[role="menu"][data-open]:not([data-ending-style])').length;

let root: Root | null = null;
afterEach(async () => {
  await act(async () => new Promise((r) => setTimeout(r, 300))); // Base UI's pending close work
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});
async function mount(ui: React.ReactNode) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(ui));
  return container;
}

it('G-PM5: one click on Settings runs the command once and the menu is gone in the frame Settings appears', async () => {
  const seenWithSettings: number[] = [];
  const other = vi.fn();
  const settings = vi.fn();
  function Settings() {
    // The first frame that paints Settings (rAF runs before that paint): no menu may be left in it.
    useLayoutEffect(() => void requestAnimationFrame(() => seenWithSettings.push(openMenus())), []);
    return <div data-testid="settings" />;
  }
  function App() {
    const [screen, setScreen] = useState(false);
    return (
      <>
        <Menu
          items={[
            {
              label: 'Settings',
              onSelect: () => {
                settings();
                setScreen(true);
              },
            },
            { label: 'Appearance', onSelect: other },
          ]}
          trigger={<button type="button" aria-label="More" />}
        />
        {screen && <Settings />}
      </>
    );
  }
  const container = await mount(<App />);
  await act(async () => press(container.querySelector('[aria-label="More"]')!));
  expect(openMenus()).toBe(1);
  // One synchronous act: no close-complete callback, timeout or animation is waited for.
  act(() => press(item('Settings'), 'mouse'));
  expect(openMenus()).toBe(0);
  expect(settings).toHaveBeenCalledTimes(1);
  expect(other).not.toHaveBeenCalled();
  expect(container.querySelector('[data-testid="settings"]')).not.toBeNull();
  await act(async () => new Promise((r) => setTimeout(r, 50)));
  expect(seenWithSettings).toEqual([0]);
  expect(settings).toHaveBeenCalledTimes(1);
});

it('G-PM5 (fb4): command menus have no exit fade', () => {
  const css = readFileSync('src/ui/kit.module.css', 'utf8');
  expect(css).toMatch(/\.menuPopup\[data-ending-style\]\s*\{\s*transition:\s*none;/);
  expect(readFileSync('src/ui/Menu.tsx', 'utf8')).not.toMatch(/onOpenChangeComplete|setTimeout/);
});

it('G0: closeFocus - pointer involved: home; opened and closed by keyboard: trigger; a command that took focus keeps it', () => {
  const popup = document.createElement('div');
  const inside = document.createElement('button');
  popup.append(inside);
  const trigger = document.createElement('button');
  const home = document.createElement('div');
  const settings = document.createElement('input');
  document.body.append(popup, trigger, home, settings);
  let keyboardOpen = false;
  const rule = (closeType: string) =>
    closeFocus({ closeType, popup, trigger, openedByKeyboard: keyboardOpen, home: () => home });
  inside.focus();
  expect(rule('mouse')).toBe(home);
  expect(rule('keyboard')).toBe(home); // opened with the mouse, closed with Escape: still the text
  keyboardOpen = true;
  expect(rule('keyboard')).toBe(true); // Base UI: the trigger
  expect(rule('mouse')).toBe(home);
  trigger.focus(); // Base UI may already have moved focus to the trigger
  expect(rule('mouse')).toBe(home);
  settings.focus(); // the command opened something that took focus
  expect(rule('mouse')).toBe(false);
  expect(rule('keyboard')).toBe(false);
  inside.focus();
  expect(closeFocus({ closeType: 'mouse', popup, trigger, openedByKeyboard: true })).toBe(true); // no home
});

it('fromKeyboard: keys and key-made clicks (detail 0) are keyboard; pointer presses are not', () => {
  expect(fromKeyboard(new KeyboardEvent('keydown'))).toBe(true);
  expect(fromKeyboard(new MouseEvent('click', { detail: 0 }))).toBe(true);
  expect(fromKeyboard(new MouseEvent('click', { detail: 1 }))).toBe(false);
  expect(fromKeyboard(new MouseEvent('mousedown', { detail: 1 }))).toBe(false);
  expect(fromKeyboard(new Event('pointerdown'))).toBe(false);
  expect(fromKeyboard(undefined)).toBe(false);
});
