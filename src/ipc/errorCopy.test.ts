import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { errorCopy, bossKeyFailureCopy } from './errorCopy';
it('matches the DRM and fixed-layout contract strings', () => {
  const contract = readFileSync('contract/errors.md', 'utf8');
  for (const code of ['BOOK_DRM_PROTECTED', 'BOOK_FIXED_LAYOUT'] as const) {
    const copy = errorCopy({ code, message: 'private log message' });
    expect(contract).toContain('UI copy: "' + copy + '"');
  }
});
it('names the conflicted boss chord and its Settings recovery path without backend copy', () => {
  expect(bossKeyFailureCopy('Ctrl+Alt+J', { code: 'SHORTCUT_IN_USE', message: 'raw native failure' }))
    .toBe('Boss key Ctrl+Alt+J is in use by another app. Choose another in Settings › Keyboard.');
  expect(bossKeyFailureCopy('Ctrl+Alt+J', { code: 'SHORTCUT_REGISTER_FAILED', message: 'raw native failure' })).not.toContain('raw native');
});
