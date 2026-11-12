// Dev-only demo driver: launches the built exe with an ISOLATED profile and WebView2 remote debugging,
// opens fixture books through the <input type=file>, and saves screenshots. Never uses the real profile.
// Usage: node scripts/demo-run.mjs (fresh profile), then node scripts/demo-run2.mjs --keep-profile [outDir]
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const outDir = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? path.join(repo, 'docs', 'screenshots'));
const profile = path.resolve(process.env.E_READER_PROFILE_DIR ?? path.join(repo, '.test-profile', 'demo'));
if (!profile.startsWith(path.join(repo, '.test-profile') + path.sep)) {
  throw new Error('Demo profiles must stay under the repo .test-profile directory');
}
const exe = process.env.E_READER_EXE ? path.resolve(process.env.E_READER_EXE) : path.join(repo, 'src-tauri', 'target', 'release', 'e-reader.exe');
const port = Number(process.env.E_READER_CDP_PORT ?? 9333);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fresh = !process.argv.includes('--keep-profile');
if (fresh) rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });
mkdirSync(outDir, { recursive: true });

export async function launch() {
  const child = spawn(exe, [], {
    env: { ...process.env, E_READER_PROFILE_DIR: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}${process.env.E_READER_EXTRA_BROWSER_ARGS ? ' ' + process.env.E_READER_EXTRA_BROWSER_ARGS : ''}` },
    stdio: 'ignore',
  });
  console.log('isolated app', child.pid, profile);
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch {}
  }
  if (!target) { child.kill(); throw new Error('no CDP target'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map(); const listeners = new Set();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else { for (const listener of listeners) listener(m); } });
  const send = (method, params = {}) => new Promise((res, rej) => { const n = ++id; pending.set(n, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result))); ws.send(JSON.stringify({ id: n, method, params })); });
  return { child, send, onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); }, close: () => { ws.close(); } };
}

export async function shot(send, name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  const f = path.join(outDir, name); writeFileSync(f, Buffer.from(data, 'base64')); console.log('saved', f); return f;
}

export async function evaluate(send, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
}

// Imports a fixture through the library_import IPC (the library has no <input type=file>; import uses the
// native dialog) and opens it by double-clicking its library card. Refuses to run outside a test profile.
export async function openFixture(send, file) {
  const invoke = (cmd, args) => evaluate(send, `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`);
  for (let i = 0; i < 40 && !(await evaluate(send, '!!window.__TAURI_INTERNALS__')); i++) await sleep(250);
  const info = await invoke('app_info', {});
  if (!info?.isTestProfile) throw new Error('not a test profile');
  await invoke('library_import', { jobId: 'fixture-' + Date.now(), paths: [path.join(repo, 'tests', 'fixtures', file)] });
  const word = JSON.stringify(path.basename(file).split(/[-_.]/)[0].toLowerCase());
  for (let i = 0; i < 40; i++) {
    const opened = await evaluate(send, `(() => { const cards=[...document.querySelectorAll('[data-book-id]')]; const c=cards.find(e=>e.textContent.toLowerCase().includes(${word})) ?? (cards.length===1 ? cards[0] : null); if(!c) return false; c.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); return true; })()`);
    if (opened) return;
    await sleep(250);
  }
  throw new Error('fixture card not found in library: ' + file);
}
export async function key(send, keyName, code, modifiers = 0, vk = 0) {
  for (const type of ['rawKeyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: keyName, code, modifiers, windowsVirtualKeyCode: vk });
}

export { repo, profile, outDir, sleep };
