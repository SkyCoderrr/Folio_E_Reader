// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { Menu } from './Menu';

const press = (el: Element) => {
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
    el.dispatchEvent(
      new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        detail: 1,
      }),
    );
};

it('t41u: one click on a menu item runs its command exactly once and the menu closes', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const settings = vi.fn();
  const other = vi.fn();
  await act(async () =>
    root.render(
      <Menu
        restoreFocus={false}
        items={[
          { label: 'Settings', onSelect: settings },
          { label: 'Appearance', onSelect: other },
        ]}
        trigger={<button type="button" aria-label="More" />}
      />,
    ),
  );
  await act(async () => press(container.querySelector('[aria-label="More"]')!));
  const item = [...document.querySelectorAll('[role="menuitem"]')].find((e) =>
    e.textContent?.startsWith('Settings'),
  )!;
  expect(item).toBeTruthy();
  await act(async () => press(item));
  expect(settings).toHaveBeenCalledTimes(1);
  expect(other).not.toHaveBeenCalled();
  await act(async () => new Promise((r) => setTimeout(r, 50)));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  root.unmount();
});

it('t41u: the menu popup has no fade-out, so it cannot hang over the screen a command opens', () => {
  const css = readFileSync('src/ui/kit.module.css', 'utf8');
  expect(css).toMatch(/\.menuPopup\[data-ending-style\]\s*\{\s*transition:\s*none;/);
  const menu = readFileSync('src/ui/Menu.tsx', 'utf8');
  expect(menu).toContain('styles.menuPopup');
});
