/**
 * One section document in its own auto-height iframe (PRD §10.4 steps 2, 3, 7).
 * sandbox="allow-same-origin" only: no scripts run inside the book. The parent attaches listeners
 * and a ResizeObserver to the same-origin document; Chromium runs those parent-realm callbacks even
 * without `allow-scripts` (foliate-js needs allow-scripts only for a WebKit bug, ADR-001).
 */
import { consumePress } from '../../input/pressArbiter';
import { buildSectionText, type SectionText } from './sectionText';

const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const LOAD_TIMEOUT_MS = 15000;
/** More content resizes than this within one second = feedback loop (e.g. `100vh` content). */
const RUNAWAY_RESIZES_PER_SEC = 24;

export interface FrameHooks {
  /** The document's content height may have changed (fonts, images, reflow). */
  onContentResize(frame: SectionFrame): void;
  onKey(e: KeyboardEvent): void;
  onWheel(e: WheelEvent): void;
  /** A link was clicked; navigation inside the iframe has already been prevented. */
  onLink(frame: SectionFrame, rawHref: string): void;
}

export class SectionFrame {
  readonly index: number;
  readonly iframe: HTMLIFrameElement;
  doc: Document | null = null;
  ready = false;
  #hooks: FrameHooks;
  #ro: ResizeObserver | null = null;
  #off: Array<() => void> = [];
  #text: SectionText | null = null;
  #baseEl: HTMLStyleElement | null = null;
  #styleEl: HTMLStyleElement | null = null;
  #abort: ((e: Error) => void) | null = null;
  #resizeTimes: number[] = [];
  #destroyed = false;

  constructor(index: number, hooks: FrameHooks) {
    this.index = index;
    this.#hooks = hooks;
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-same-origin');
    f.setAttribute('scrolling', 'no');
    f.setAttribute('tabindex', '-1');
    f.title = `Section ${index + 1}`;
    Object.assign(f.style, {
      display: 'block',
      border: '0',
      margin: '0 auto',
      padding: '0',
      background: 'transparent',
      visibility: 'hidden',
      overflow: 'hidden',
    });
    this.iframe = f;
  }

  /** Navigate to `url` (must be same-origin), inject CSS, wire listeners. Rejects if destroyed. */
  load(url: string, widthPx: number, baseCss: string, styleCss: string): Promise<Document> {
    this.setWidth(widthPx);
    return new Promise<Document>((resolve, reject) => {
      const f = this.iframe;
      let timer = 0;
      const done = (err: Error | null, doc?: Document): void => {
        f.removeEventListener('load', onLoad);
        window.clearTimeout(timer);
        this.#abort = null;
        if (err) reject(err);
        else resolve(doc!);
      };
      const onLoad = (): void => {
        let doc: Document | null = null;
        try {
          doc = f.contentDocument;
        } catch {
          doc = null;
        }
        if (doc && doc.URL === 'about:blank') return; // initial empty document, keep waiting
        if (!doc || !doc.documentElement) {
          done(new Error(`section ${this.index}: document not accessible (cross-origin URL?)`));
          return;
        }
        try {
          this.#setup(doc, baseCss, styleCss);
        } catch (e) {
          done(e instanceof Error ? e : new Error(String(e)));
          return;
        }
        done(null, doc);
      };
      this.#abort = (e) => done(e);
      f.addEventListener('load', onLoad);
      timer = window.setTimeout(
        () => done(new Error(`section ${this.index}: load timeout`)),
        LOAD_TIMEOUT_MS,
      );
      f.src = url;
    });
  }

  #setup(doc: Document, baseCss: string, styleCss: string): void {
    this.doc = doc;
    const root = doc.documentElement;
    let found = doc.head ?? root.querySelector('head');
    if (!found) {
      found = doc.createElementNS(XHTML_NS, 'head') as HTMLHeadElement;
      root.insertBefore(found, root.firstChild);
    }
    const head: HTMLHeadElement = found;
    const mk = (id: string): HTMLStyleElement => {
      const s = doc.createElementNS(XHTML_NS, 'style') as HTMLStyleElement;
      s.id = id;
      head.append(s);
      return s;
    };
    this.#baseEl = mk('er-base');
    this.#styleEl = mk('er-style'); // stays the last style element (PRD §10.4 step 3)
    this.applyCss(baseCss, styleCss);

    const on = <K extends keyof DocumentEventMap>(
      type: K,
      fn: (e: DocumentEventMap[K]) => void,
      opts: AddEventListenerOptions,
    ): void => {
      doc.addEventListener(type, fn as EventListener, opts);
      this.#off.push(() => doc.removeEventListener(type, fn as EventListener, opts));
    };
    on(
      'pointermove',
      () => this.iframe.dispatchEvent(new Event('reader-pointer-activity', { bubbles: true })),
      { passive: true },
    );
    for (const type of ['wheel', 'pointerdown', 'touchstart'] as const)
      on(
        type,
        () => this.iframe.dispatchEvent(new Event('reader-manual-input', { bubbles: true })),
        { passive: true, capture: true },
      );
    // t24u: a press inside the book never reaches the host document (separate document), so the
    // host cannot close its open popovers/panels on an outside click. Tell it; if it closed
    // something (detail.consumed) this press must not also turn a page, follow a link or select.
    on(
      'pointerdown',
      (e) => {
        if (e.button !== 0) return;
        const press = new CustomEvent<{ consumed: boolean }>('reader-pointer-down', {
          bubbles: true,
          detail: { consumed: false },
        });
        this.iframe.dispatchEvent(press);
        if (press.detail.consumed && doc.defaultView) consumePress(doc.defaultView);
      },
      { passive: true, capture: true },
    );
    on('keydown', (e) => this.#hooks.onKey(e), { capture: true });
    on('keyup', (e) => this.#hooks.onKey(e), { capture: true });
    // Passive: plain wheel scrolling bubbles natively to the parent scroller (compositor path).
    on('wheel', (e) => this.#hooks.onWheel(e), { passive: true, capture: true });
    on(
      'click',
      (e) => {
        const t = e.target as Element | null;
        const a = t && typeof t.closest === 'function' ? t.closest('a[href], area[href]') : null;
        if (!a) return;
        e.preventDefault();
        this.#hooks.onLink(this, a.getAttribute('href') ?? '');
      },
      { capture: true },
    );

    this.#ro = new ResizeObserver(() => this.#onResize());
    this.#ro.observe(root);
    void doc.fonts?.ready.then(() => {
      if (!this.#destroyed && this.ready) this.#hooks.onContentResize(this);
    });
  }

  #onResize(): void {
    if (this.#destroyed || !this.ready) return;
    const now = performance.now();
    this.#resizeTimes = this.#resizeTimes.filter((t) => now - t < 1000);
    this.#resizeTimes.push(now);
    if (this.#resizeTimes.length > RUNAWAY_RESIZES_PER_SEC) {
      console.warn(
        `[FlowRenderer] section ${this.index}: resize feedback loop, freezing its height`,
      );
      this.#ro?.disconnect();
      return;
    }
    this.#hooks.onContentResize(this);
  }

  applyCss(baseCss: string, styleCss: string): void {
    if (this.#baseEl) this.#baseEl.textContent = baseCss;
    if (this.#styleEl) this.#styleEl.textContent = styleCss;
  }

  setWidth(px: number): void {
    this.iframe.style.width = `${Math.max(1, Math.round(px))}px`;
  }

  setHeight(px: number): void {
    this.iframe.style.height = `${Math.max(0, Math.round(px))}px`;
  }

  /** Content height in CSS px (forces layout of this document). */
  measure(): number {
    const root = this.doc?.documentElement;
    if (!root) return 0;
    return Math.max(1, Math.ceil(root.getBoundingClientRect().height));
  }

  show(): void {
    this.ready = true;
    this.iframe.style.visibility = 'visible';
  }

  /** Text-node offset table for Locator.charOffset (built once; book documents are static). */
  text(): SectionText | null {
    if (!this.doc) return null;
    return (this.#text ??= buildSectionText(this.doc));
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.ready = false;
    this.#abort?.(new Error(`section ${this.index}: unmounted`));
    this.#ro?.disconnect();
    this.#ro = null;
    for (const off of this.#off) off();
    this.#off = [];
    this.#text = null;
    this.doc = null;
    this.iframe.remove();
  }
}
