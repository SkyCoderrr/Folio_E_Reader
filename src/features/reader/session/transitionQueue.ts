/**
 * One queue for every reader transition (N6): open, layout swap, TXT re-split and style writes
 * run one after another, so a remount never overlaps another remount or writes to a renderer that
 * is being replaced. A task's failure is reported to its caller and never blocks the next task.
 */
export class TransitionQueue {
  #tail: Promise<void> = Promise.resolve();
  #closed = false;

  run<T>(task: () => Promise<T>): Promise<T | undefined> {
    const result = this.#tail.then(() => (this.#closed ? undefined : task()));
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Tasks not started yet are skipped. */
  close(): void {
    this.#closed = true;
  }
}
