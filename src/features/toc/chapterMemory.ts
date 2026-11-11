/**
 * Chapter visit memory (owner t28u/t29u). A chapter is "read" once the reader's position has
 * actually been inside it for a short dwell (its text was on screen) - not because earlier
 * chapters were skipped. Marks go through chapter_mark_read, one write in flight per book.
 */
export interface ChapterReadApi {
  get(bookId: string): Promise<string[]>;
  mark(bookId: string, chapterKey: string): Promise<string[]>;
}

/** A held-key glide through many chapters must not mark them: only a dwell counts. */
export const VISIT_DWELL_MS = 1000;

export class ChapterMemory {
  private keys = new Set<string>();
  /** keys already sent (or queued) this session: dedupe */
  private requested = new Set<string>();
  private queue: string[] = [];
  private draining = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private candidate: string | null = null;
  private disposed = false;
  private listeners = new Set<() => void>();
  private snapshot: ReadonlySet<string> = new Set();

  constructor(
    private readonly bookId: string,
    private readonly api: ChapterReadApi,
    private readonly dwellMs = VISIT_DWELL_MS,
    private readonly onError: (e: unknown) => void = () => undefined,
  ) {}

  getSnapshot = (): ReadonlySet<string> => this.snapshot;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  private publish() {
    this.snapshot = new Set(this.keys);
    this.listeners.forEach((fn) => fn());
  }

  private merge(list: readonly string[]) {
    let changed = false;
    for (const k of list) {
      this.requested.add(k);
      if (!this.keys.has(k)) {
        this.keys.add(k);
        changed = true;
      }
    }
    if (changed) this.publish();
  }

  /** (Re)activate and load the persisted set; safe to call again after dispose(). */
  start(): void {
    this.disposed = false;
    void this.load();
  }

  async load(): Promise<void> {
    try {
      const list = await this.api.get(this.bookId);
      if (!this.disposed) this.merge(list);
    } catch (e) {
      this.onError(e);
    }
  }

  /** Report the chapter the reader is in now (null = none / not reading). */
  visit(chapterKey: string | null): void {
    if (this.disposed || chapterKey === this.candidate) return;
    this.candidate = chapterKey;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (chapterKey === null || this.requested.has(chapterKey)) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.commit(chapterKey);
    }, this.dwellMs);
  }

  private commit(chapterKey: string) {
    if (this.disposed || this.requested.has(chapterKey)) return;
    this.requested.add(chapterKey);
    this.keys.add(chapterKey);
    this.publish();
    this.queue.push(chapterKey);
    void this.drain();
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length && !this.disposed) {
        const key = this.queue.shift()!;
        try {
          this.merge(await this.api.mark(this.bookId, key));
        } catch (e) {
          this.requested.delete(key); // retried on a later visit; stays marked locally meanwhile
          this.onError(e);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.candidate = null;
  }
}
