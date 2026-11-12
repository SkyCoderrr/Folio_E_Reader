import { expect, it } from 'vitest';
import { TransitionQueue } from './transitionQueue';

it('runs transitions one at a time in order; a failure does not block the next', async () => {
  const q = new TransitionQueue();
  const log: string[] = [];
  let release!: () => void;
  const first = q.run(async () => {
    log.push('swap:start');
    await new Promise<void>((r) => (release = r));
    log.push('swap:end');
  });
  const failing = q.run(async () => {
    log.push('resplit');
    throw new Error('boom');
  });
  const third = q.run(async () => log.push('style'));
  await Promise.resolve();
  expect(log).toEqual(['swap:start']);
  release();
  await first;
  await expect(failing).rejects.toThrow('boom');
  await third;
  expect(log).toEqual(['swap:start', 'swap:end', 'resplit', 'style']);
  q.close();
  expect(await q.run(async () => 'late')).toBeUndefined();
});
