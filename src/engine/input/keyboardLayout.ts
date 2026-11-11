/** Labels only: persistence and routing continue to use KeyboardEvent.code. */
export interface KeyboardLayoutAPI {
  getLayoutMap(): Promise<ReadonlyMap<string, string>>;
  addEventListener?(type: 'layoutchange', listener: () => void): void;
  removeEventListener?(type: 'layoutchange', listener: () => void): void;
}
let map: ReadonlyMap<string, string> = new Map();
export function layoutKey(key: string): string | undefined {
  const code = /^[A-Z]$/.test(key) ? 'Key' + key : /^\d$/.test(key) ? 'Digit' + key : key;
  const label = map.get(code);
  return label && label.trim() ? (/^[a-z]$/i.test(label) ? label.toUpperCase() : label) : undefined;
}
/** Re-query on keyboard-layout changes; rejected/absent APIs use the stable fallback. */
export function watchKeyboardLayout(changed: () => void, api = (navigator as Navigator & { keyboard?: KeyboardLayoutAPI }).keyboard): () => void {
  let alive = true;
  let revision = 0;
  const refresh = () => {
    const token = ++revision;
    void Promise.resolve().then(() => api?.getLayoutMap()).then((next) => {
      if (!alive || token !== revision) return;
      map = next ?? new Map();
      changed();
    }).catch(() => {
      if (!alive || token !== revision) return;
      map = new Map();
      changed();
    });
  };
  refresh();
  api?.addEventListener?.('layoutchange', refresh);
  return () => { alive = false; api?.removeEventListener?.('layoutchange', refresh); };
}
