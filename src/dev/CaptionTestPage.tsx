import { useEffect, useRef, useState } from 'react';
import type { CaptionButton, CaptionRects, CaptionStatePayload } from '@contract/types';
import { invoke } from '../ipc/commands';
import { listen } from '../ipc/events';

const buttons: CaptionButton[] = ['minimize', 'maximize', 'close'];

/** DEV ONLY: native-frame probe; the production TitleBar belongs to Claude Code. */
export default function CaptionTestPage() {
  const refs = useRef<Partial<Record<CaptionButton, HTMLButtonElement>>>({});
  const [caption, setCaption] = useState<CaptionStatePayload>({ hovered: null, pressed: null });
  const [error, setError] = useState('');
  const [hidden, setHidden] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [native, setNative] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const sequence = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let disposed = false;
    const stops: (() => void)[] = [];
    const fail = (reason: unknown) => {
      if (!disposed) setError(JSON.stringify(reason));
    };
    const enqueue = (rects: CaptionRects | null) => {
      sequence.current = sequence.current
        .catch(() => {})
        .then(() => {
          if (rects === null || !disposed) return invoke('window_set_caption_rects', { rects });
        })
        .catch(fail);
    };
    const send = () => {
      if (disposed) return;
      if (hidden || fullscreen || native) {
        enqueue(null);
        return;
      }
      const rects = {} as CaptionRects;
      for (const button of buttons) {
        const element = refs.current[button];
        if (!element) return;
        const { x, y, width, height } = element.getBoundingClientRect();
        rects[button] = { x, y, width, height };
      }
      enqueue(rects);
    };
    const register = async () => {
      for (const pending of [
        listen('window://caption-state', setCaption),
        listen('window://state-changed', (state) => {
          setFullscreen(state.fullscreen);
          setMaximized(state.maximized);
          requestAnimationFrame(send);
        }),
        listen('app://close-requested', () => {
          void invoke('app_quit', {}).catch(fail);
        }),
      ]) {
        const stop = await pending;
        if (disposed) stop();
        else stops.push(stop);
      }
      const info = await invoke('app_info', {});
      const state = await invoke('window_get_state', {});
      if (!disposed) {
        setNative(info.titleBarMode === 'native');
        setFullscreen(state.fullscreen);
        setMaximized(state.maximized);
        send();
      }
    };
    void register().catch(fail);
    const observer = new ResizeObserver(send);
    observer.observe(document.documentElement);
    window.addEventListener('resize', send);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'F11') {
        event.preventDefault();
        void invoke('window_set_fullscreen', { fullscreen: !fullscreen }).catch(fail);
      } else if (event.key === 'Escape' && fullscreen) {
        void invoke('window_set_fullscreen', { fullscreen: false }).catch(fail);
      }
    };
    window.addEventListener('keydown', keydown);
    return () => {
      disposed = true;
      observer.disconnect();
      stops.forEach((stop) => stop());
      window.removeEventListener('resize', send);
      window.removeEventListener('keydown', keydown);
      enqueue(null);
    };
  }, [hidden, fullscreen, native]);

  return (
    <main>
      <div
        style={{ position: 'fixed', inset: '0 138px auto 6px', height: 40 }}
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          void invoke(
            event.detail === 2 ? 'window_toggle_maximize' : 'window_start_drag',
            {},
          ).catch((reason: unknown) => setError(JSON.stringify(reason)));
        }}
      >
        Caption test — drag / double-click here
      </div>
      {!hidden && !fullscreen && !native && (
        <div style={{ position: 'fixed', top: 0, right: 0, display: 'flex' }}>
          {buttons.map((button) => (
            <button
              key={button}
              type="button"
              aria-label={button}
              ref={(element) => {
                if (element) refs.current[button] = element;
                else delete refs.current[button];
              }}
              style={{ width: 46, height: 40, padding: 0, boxSizing: 'border-box' }}
              onClick={(event) => {
                // Native HWND owns pointer clicks. detail=0 retains keyboard/AT activation.
                if (event.detail !== 0) return;
                const command =
                  button === 'minimize'
                    ? 'window_minimize'
                    : button === 'maximize'
                      ? 'window_toggle_maximize'
                      : 'app_quit';
                void invoke(command, {}).catch((reason: unknown) =>
                  setError(JSON.stringify(reason)),
                );
              }}
            >
              {button === 'maximize' && maximized ? 'restore' : button}
            </button>
          ))}
        </div>
      )}
      <div style={{ marginTop: 48 }}>
        <p>DEV frame probe: 46 × 40 CSS px buttons; Rust owns pointer activation.</p>
        <p>
          hovered={caption.hovered ?? 'null'} pressed={caption.pressed ?? 'null'}
        </p>
        <button onClick={() => setHidden(!hidden)}>Toggle caption visibility</button>
        <button
          onClick={() => {
            void invoke('window_set_fullscreen', { fullscreen: !fullscreen }).catch(
              (reason: unknown) => setError(JSON.stringify(reason)),
            );
          }}
        >
          Toggle fullscreen
        </button>
        <p>F11 / Escape; resize all edges and corners; hover maximize for Snap Layouts.</p>
        {native && <p>Native title-bar fallback active; overlay disabled.</p>}
        <output>{error}</output>
      </div>
    </main>
  );
}
