// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EncodingMenuItems } from './EncodingMenuItems';
import { ChapterDetectionDialog, type ChapterDetectionDialogProps } from './ChapterDetectionDialog';

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
  document.body.innerHTML = '';
});

it('encoding pick calls onPick and checks current', () => {
  const onPick = vi.fn();
  act(() => root.render(<EncodingMenuItems current="big5" detected="gb18030" onPick={onPick} />));
  const rows = [...document.querySelectorAll<HTMLElement>('[role=menuitemradio]')];
  expect(rows[0]!.textContent).toContain('Auto (detected: GB18030');
  expect(rows.find((r) => r.getAttribute('aria-checked') === 'true')!.textContent).toContain(
    'Big5',
  );
  act(() => rows[2]!.click());
  expect(onPick).toHaveBeenCalledWith('utf-16le');
});

const base: ChapterDetectionDialogProps = {
  open: true,
  onOpenChange: () => {},
  value: { chapterRegex: null, headingMaxChars: null, paragraphMode: null },
  defaults: { chapterRegex: '^第.章$', headingMaxChars: 40, paragraphMode: 'auto' },
  preview: { state: 'ok', count: 128, first20: ['第一章 重逢'] },
  onPreview: () => {},
  onApply: () => {},
  onResetToDefaults: () => {},
};
function setValue(el: HTMLTextAreaElement, v: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
const ta = () => document.querySelector<HTMLTextAreaElement>('textarea')!;
const btn = (t: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === t)!;

it('shows the chapter count', () => {
  act(() => root.render(<ChapterDetectionDialog {...base} />));
  expect(document.body.textContent).toContain('128 chapters');
});

it('renders the last valid count and headings alongside a regex error', () => {
  act(() => root.render(<ChapterDetectionDialog {...base} />));
  act(() => setValue(ta(), '['));
  act(() =>
    root.render(
      <ChapterDetectionDialog
        {...base}
        preview={{ ...base.preview, state: 'error', error: 'Invalid regex' }}
      />,
    ),
  );
  expect(document.querySelector('[role=alert]')?.textContent).toBe('Invalid regex');
  expect(document.body.textContent).toContain('128 chapters');
  expect(document.querySelector('[aria-label="Detected chapters"]')?.textContent).toContain(
    base.preview.first20![0],
  );
});

it('hides the regex error until the user edits', () => {
  const onPreview = vi.fn();
  const props = { ...base, onPreview, preview: { state: 'error', error: 'bad' } as const };
  act(() => root.render(<ChapterDetectionDialog {...props} />));
  expect(document.querySelector('[role=alert]')).toBeNull();
  act(() => setValue(ta(), '^卷('));
  expect(onPreview).toHaveBeenCalledWith({
    chapterRegex: '^卷(',
    headingMaxChars: null,
    paragraphMode: null,
  });
  expect(document.querySelector('[role=alert]')!.textContent).toBe('bad');
});

it('Apply passes the edited value', () => {
  const onApply = vi.fn();
  act(() => root.render(<ChapterDetectionDialog {...base} onApply={onApply} />));
  act(() => setValue(ta(), '^卷.$'));
  act(() => btn('Apply').click());
  expect(onApply).toHaveBeenCalledWith({
    chapterRegex: '^卷.$',
    headingMaxChars: null,
    paragraphMode: null,
  });
});
