import type { Locator, ReadingSessionInput } from '@contract/types';

/** A single book's active intervals. Call tick regularly, and before changing visibility. */
export class SessionTracker {
  private last: number;
  private input: number;
  private running = false;
  private visible = true;
  private enabled = true;
  private position?: Locator;
  private session?: ReadingSessionInput;
  private pending: ReadingSessionInput[] = [];
  private flight = Promise.resolve();
  private failed = false;
  private sampleMs = 0;
  private sampleChars = 0;
  private samples: { ms: number; chars: number }[] = [];
  constructor(
    private bookId: string,
    public idleMs: number,
    private save: (session: ReadingSessionInput) => Promise<unknown>,
    private now = Date.now,
    private onSaveError: (reason: unknown) => void = console.warn,
  ) {
    this.last = this.input = now();
  }
  /** Restore the backend's last-30-active-minute aggregate before adding live samples. */
  seed(activeMs: number, chars: number, charsPerMin: number | null) {
    const ms = Math.min(1_800_000, activeMs);
    if (!(ms > 0)) return;
    const advanced = charsPerMin === null ? (chars * ms) / activeMs : (charsPerMin * ms) / 60000;
    this.samples.unshift({ ms, chars: advanced });
    this.sampleMs += ms;
    this.sampleChars += advanced;
    this.trim();
  }
  private trim() {
    while (this.sampleMs > 1_800_000 && this.samples.length) {
      const first = this.samples[0]!;
      const remove = Math.min(first.ms, this.sampleMs - 1_800_000);
      this.sampleChars -= (first.chars * remove) / first.ms;
      first.chars *= (first.ms - remove) / first.ms;
      first.ms -= remove;
      this.sampleMs -= remove;
      if (!first.ms) this.samples.shift();
    }
  }
  tick() {
    const end = this.now();
    const until = this.running ? end : Math.min(end, this.input + this.idleMs);
    const ms = this.visible && this.enabled ? Math.max(0, until - this.last) : 0;
    if (ms) {
      this.session ??= {
        bookId: this.bookId,
        startedAt: this.last,
        endedAt: until,
        activeMs: 0,
        charsRead: 0,
        startProgress: this.position?.progress ?? 0,
        endProgress: this.position?.progress ?? 0,
      };
      this.session.activeMs += ms;
      this.session.endedAt = until;
      const tail = this.samples.at(-1);
      if (tail && tail.ms < 1000 && tail.ms + ms <= 1000) tail.ms += ms;
      else this.samples.push({ ms, chars: 0 });
      this.sampleMs += ms;
      this.trim();
    }
    this.last = end;
    if (!this.running && end >= this.input + this.idleMs) this.split();
  }
  activity() {
    this.tick();
    this.input = this.now();
  }
  autoScroll(running: boolean) {
    this.tick();
    this.running = running;
    // Pausing auto-scroll starts a fresh idle grace period.
    if (!running) this.input = this.now();
  }
  visibility(visible: boolean) {
    if (visible === this.visible) return;
    this.tick();
    this.visible = visible;
    if (!visible) this.split();
    else this.input = this.now();
  }
  configure(enabled: boolean, idleMs: number) {
    this.tick();
    this.enabled = enabled;
    this.idleMs = idleMs;
    if (!enabled) this.split();
  }
  relocate(locator: Locator, screenChars: number, jump = false) {
    this.tick();
    const old = this.position;
    const delta =
      old && old.globalCharOffset !== null && locator.globalCharOffset !== null
        ? locator.globalCharOffset - old.globalCharOffset
        : old?.sectionIndex === locator.sectionIndex
          ? locator.charOffset - old.charOffset
          : 0;
    if (!jump && this.session && delta > 0 && delta <= screenChars) {
      this.session.charsRead += delta;
      const sample = this.samples.at(-1);
      if (sample) {
        sample.chars += delta;
        this.sampleChars += delta;
      }
    }
    this.position = locator;
    if (this.session) this.session.endProgress = locator.progress;
  }
  private split() {
    if (this.session && this.session.activeMs >= 10_000) this.pending.push(this.session);
    this.session = undefined;
  }
  get speed() {
    const ms = this.sampleMs;
    const chars = this.sampleChars;
    return ms >= 300_000 && chars > 0 ? (chars * 60_000) / ms : null;
  }
  flush(): Promise<void> {
    this.tick();
    this.split();
    return this.flushPending();
  }
  flushPending(): Promise<void> {
    this.flight = this.flight
      .catch(() => undefined)
      .then(async () => {
        while (this.pending.length) {
          try {
            await this.save(this.pending[0]!);
            this.failed = false;
          } catch (e) {
            if (!this.failed) this.onSaveError(e);
            this.failed = true;
            throw e;
          }
          this.pending.shift();
        }
      });
    return this.flight;
  }
}

export function readingEstimates(
  speed: number | null,
  chapterChars: number,
  bookChars: number,
  cjk: boolean,
) {
  if (!speed) return {};
  const left = (chars: number, where: string) =>
    `${Math.ceil(Math.max(0, chars) / speed)} min left in ${where}`;
  return {
    speedLabel: `${Math.round(cjk ? speed : speed / 5.5)} ${cjk ? 'chars' : 'words'}/min`,
    timeLeftChapter: left(chapterChars, 'chapter'),
    timeLeftBook: left(bookChars, 'book'),
  };
}
