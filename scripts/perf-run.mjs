// Run OUTSIDE the sandbox. Never installs an app; only launches the release exe.
// node scripts/perf-run.mjs [--exe <release.exe>] [--epub <5MB.epub>] [--hz 144] [--port 9349]
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const repo = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing ${name} value`);
  return args[i + 1];
};
if (args.includes('--help')) {
  console.log(
    'node scripts/perf-run.mjs [--exe <release.exe>] [--epub <5MB.epub>] [--hz 144] [--port 9349]\nFresh run profile under .test-profile/perf; JSON + Markdown saved there. Run at 60, 120 and 144 Hz.',
  );
  process.exit(0);
}
const exe = path.resolve(option('--exe', 'src-tauri/target/release/e-reader.exe'));
const epub = path.resolve(option('--epub', 'tests/fixtures/pride-and-prejudice.epub'));
const hz = Number(option('--hz', '60'));
const port = Number(option('--port', '9349'));
if (!(hz > 0 && hz <= 500) || !Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid --hz / --port');
if (!existsSync(exe) || !existsSync(epub))
  throw new Error('Build release exe and supply an existing EPUB');
// Unique directories avoid deleting any profile or colliding with an earlier live benchmark.
const out = path.join(
  repo,
  '.test-profile',
  'perf',
  new Date().toISOString().replace(/[:.]/g, '-'),
);
const profile = path.join(out, 'profile');
mkdirSync(profile, { recursive: true });
const fixtures = path.join(out, 'fixtures');
execFileSync(
  'powershell.exe',
  ['-NoProfile', '-File', path.join(repo, 'scripts/make-txt-fixtures.ps1'), '-OutputDir', fixtures],
  { stdio: 'inherit' },
);
// Repeat complete GB18030 source blocks; no partial multibyte sequence at EOF.
const block = readFileSync(path.join(fixtures, 'xiyouji-gb18030.txt'));
const txt = path.join(fixtures, 'gb18030-10mb.txt');
const copies = Math.ceil(10_000_000 / block.length);
writeFileSync(txt, Buffer.concat(Array.from({ length: copies }, () => block)));
const report = {
  when: new Date().toISOString(),
  exe,
  profile,
  hz,
  fixtures: { epub, epubBytes: statSync(epub).size, txt, txtBytes: statSync(txt).size },
  results: [],
  observations: {},
};
const add = (metric, value, limit, unit = 'ms', note = '', inclusive = false) => {
  report.results.push({
    metric,
    value,
    limit,
    unit,
    status:
      value == null ? 'UNMEASURED' : (inclusive ? value <= limit : value < limit) ? 'PASS' : 'FAIL',
    note,
  });
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let child, ws;
const pending = new Map();
let nextId = 0;
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 30_000);
    pending.set(id, (m) => {
      clearTimeout(timer);
      m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails)
    throw new Error(
      r.exceptionDetails.text + ': ' + (r.exceptionDetails.exception?.description ?? expression),
    );
  return r.result?.value;
}
async function until(expression, timeout = 30_000) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    if (await evaluate(expression)) return;
    await sleep(10);
  }
  throw new Error('Timed out waiting for ' + expression);
}
const libraryReady = `!![...document.querySelectorAll('h1')].find(e => e.textContent === 'Library') && !![...document.querySelectorAll('button')].find(e => !e.disabled && /Add Books/i.test(e.textContent + e.getAttribute('aria-label')))`;
const textReady = `!![...document.querySelectorAll('.reader-mount iframe')].find(f => { const r = f.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(f).visibility !== 'hidden' && (f.contentDocument?.body?.textContent.trim().length > 20 || (f.contentDocument?.images?.length ?? 0) > 0); })`;
const ipc = (command, data = {}) =>
  evaluate(
    `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(data)})`,
  );
async function key(code, key, vk, modifiers = 0, type) {
  for (const t of type ? [type] : ['rawKeyDown', 'keyUp'])
    await send('Input.dispatchKeyEvent', {
      type: t,
      code,
      key,
      windowsVirtualKeyCode: vk,
      modifiers,
    });
}
async function openBook(id) {
  const start = performance.now();
  await evaluate(
    `(() => { const card = document.querySelector('[data-book-id="${id}"]'); if (!card) throw Error('Book card missing'); card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })()`,
  );
  await until(textReady);
  // Cross a frame boundary before declaring text presented; CDP polling is a conservative upper bound.
  await evaluate('new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))');
  return performance.now() - start;
}
async function back() {
  await key('KeyW', 'w', 87, 2);
  await until(libraryReady);
}
try {
  // Refuse an occupied debugging endpoint, so we never attach to another app/profile.
  try {
    await fetch(`http://127.0.0.1:${port}/json/list`);
    throw new Error(`Debug port ${port} already in use`);
  } catch (e) {
    if (e.message.includes('already in use')) throw e;
  }
  const start = performance.now();
  child = spawn(exe, [], {
    cwd: repo,
    env: {
      ...process.env,
      E_READER_PROFILE_DIR: profile,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  let spawnError;
  child.on('error', (e) => {
    spawnError = e;
  });
  let target;
  while (performance.now() - start < 30_000 && !target) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`Release app exited ${child.exitCode}`);
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(
        (t) => t.type === 'page',
      );
    } catch {}
    if (!target) await sleep(10);
  }
  if (!target) throw new Error('No WebView2 CDP target');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', (event) => {
    const m = JSON.parse(event.data);
    const cb = pending.get(m.id);
    if (cb) {
      pending.delete(m.id);
      cb(m);
    }
  });
  await send('Runtime.enable');
  await until(libraryReady);
  add('Cold launch → empty library interactive (CDP upper bound)', performance.now() - start, 1000);
  await evaluate(
    `(() => { const original = window.__TAURI_INTERNALS__.invoke; window.__txtTimes = []; window.__TAURI_INTERNALS__.invoke = async function(cmd, ...rest) { const t = performance.now(); const value = await original.call(this, cmd, ...rest); if (cmd === 'txt_prepare') window.__txtTimes.push(performance.now() - t); return value; }; })()`,
  );
  await ipc('library_import', { jobId: 'perf-import', paths: [epub, txt] });
  const books = await (async () => {
    await until(`document.querySelectorAll('[data-book-id]').length === 2`);
    return ipc('library_list');
  })();
  const epubBook = books.find((b) => b.format === 'epub');
  const txtBook = books.find((b) => b.format === 'txt');
  // Save an actual reading position and reopen, matching the saved-position requirement.
  await openBook(epubBook.id);
  await key('PageDown', 'PageDown', 34);
  await sleep(300);
  await back();
  const epubMs = await openBook(epubBook.id);
  if (report.fixtures.epubBytes < 4_500_000 || report.fixtures.epubBytes > 5_500_000) {
    report.observations.epubSmokeMs = epubMs;
    add(
      '5 MB EPUB → first text at saved position',
      null,
      800,
      'ms',
      'Bundled fixture is not 5 MB; use --epub with a representative 5 MB book. Saved-position line accuracy needs native inspection.',
    );
  } else
    add(
      '5 MB EPUB → first text at saved position',
      epubMs,
      800,
      'ms',
      'Presentation timing only; verify saved-position line accuracy separately.',
    );
  await back();
  add('10 MB GB18030 TXT first open → first text', await openBook(txtBook.id), 1200);
  const prepare = await evaluate('window.__txtTimes.at(-1)');
  add(
    '10 MB Rust prepare IPC upper bound',
    prepare,
    400,
    'ms',
    'Includes IPC + cache writes, so failure is inconclusive for decode/split alone.',
  );
  await back();
  add('10 MB GB18030 TXT cached reopen → first text', await openBook(txtBook.id), 500);
  await key('Home', 'Home', 36, 2);
  await sleep(300);
  await evaluate(`(() => {
    const el = document.querySelector('.er-flow'); if (!el || el.scrollHeight <= el.clientHeight) throw Error('No scrollable content');
    window.__scrollPerf = { samples: [], tasks: [], keyAt: null, firstFrame: null, firstMs: null, running: true, frame: 0 };
    const p = window.__scrollPerf; let y = el.scrollTop;
    const obs = new PerformanceObserver(list => { for (const e of list.getEntries()) if (p.keyAt !== null && e.startTime >= p.keyAt) p.tasks.push({ start: e.startTime, duration: e.duration }); });
    obs.observe({ type: 'longtask' }); p.observer = obs;
    window.addEventListener('keydown', e => { if (e.code === 'ArrowDown') p.keyAt = performance.now(); }, { capture: true, once: true });
    const frame = t => { p.frame++; p.samples.push(t); if (el.scrollTop !== y && p.firstFrame === null) { p.firstFrame = p.frame; p.firstMs = performance.now() - p.keyAt; } y = el.scrollTop; if (p.running) requestAnimationFrame(frame); };
    // This bubble listener is installed after the reader router, so its rAF observes the
    // scroll writer in the same frame rather than artificially reporting a second frame.
    window.addEventListener('keydown', e => { if (e.code === 'ArrowDown') requestAnimationFrame(frame); }, { once: true });
  })()`);
  await key('ArrowDown', 'ArrowDown', 40, 0, 'rawKeyDown');
  await sleep(10_000);
  // Stop the measurement before release/deceleration.
  report.observations.scroll = await evaluate(
    `(() => { const p = window.__scrollPerf; p.running = false; p.observer.disconnect(); return { samples: p.samples, tasks: p.tasks, firstFrame: p.firstFrame, firstMs: p.firstMs }; })()`,
  );
  await key('ArrowDown', 'ArrowDown', 40, 0, 'keyUp');
  const s = report.observations.scroll;
  const dt = s.samples.slice(1).map((t, i) => t - s.samples[i]);
  const late = dt.filter((t) => t > (1000 / hz) * 1.1).length;
  add(
    'Arrow first movement',
    s.firstFrame,
    1,
    'frames',
    'Frame index observed from app rAF; firstMs retained in JSON.',
    true,
  );
  add(
    `Arrow frames late at ${hz} Hz (10% scheduling tolerance)`,
    dt.length ? (100 * late) / dt.length : null,
    1,
    '%',
    'Run on a display actually configured to --hz, foreground and unobscured.',
    true,
  );
  add(
    'Arrow long tasks > 50 ms',
    s.tasks.filter((t) => t.duration > 50).length,
    0,
    'tasks',
    '',
    true,
  );
  await key('KeyM', 'm', 77);
  await until(`!!document.querySelector('.er-paged') && (${textReady})`);
  await sleep(300);
  report.observations.pageTurns = [];
  for (let i = 0; i < 10; i++) {
    await evaluate(`(() => {
      const root = document.querySelector('.er-paged');
      const signature = () => [...root.querySelectorAll('iframe')].filter(f => getComputedStyle(f).visibility !== 'hidden').map(f => f.style.transform + f.src).join('|');
      const initial = signature(); window.__turn = { at: null, ms: null };
      window.addEventListener('keydown', e => { if (e.code === 'PageDown') { window.__turn.at = performance.now(); const until = performance.now() + 3000; const f = () => { if (signature() !== initial) requestAnimationFrame(() => setTimeout(() => { window.__turn.ms = performance.now() - window.__turn.at; }, 0)); else if (performance.now() < until) requestAnimationFrame(f); }; requestAnimationFrame(f); } }, { capture: true, once: true });
    })()`);
    await key('PageDown', 'PageDown', 34);
    await until('window.__turn.ms !== null', 4000);
    report.observations.pageTurns.push(await evaluate('window.__turn.ms'));
  }
  add(
    'Paged turn presentation (worst of 10)',
    Math.max(...report.observations.pageTurns),
    50,
    'ms',
    'DOM change followed by a paint opportunity; confirm with a native presentation trace if close to limit.',
    true,
  );
  for (const metric of [
    '2,000-book startup/search',
    'PgDn completion',
    'Style repaint / locator drift',
    'Layout switch / locator drift',
    'Boss hide / restore',
    'Title-bar edge reveal',
    'EPUB import throughput',
    'Process-tree working set',
  ])
    add(
      metric,
      null,
      null,
      '',
      'Separate native scenario / artifact check; no passing claim from this run.',
    );
  const installer = path.join(
    path.dirname(exe),
    'bundle',
    'nsis',
    'Folio_1.0.0-rc.1_x64-setup.exe',
  );
  report.observations.installer = installer;
  add(
    'Installer size',
    existsSync(installer) ? statSync(installer).size / 1_000_000 : null,
    15,
    'MB',
  );
} catch (error) {
  report.error = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  ws?.close();
  if (child && child.exitCode === null) child.kill();
  for (const cb of pending.values()) cb({ error: { message: 'Benchmark closed' } });
  pending.clear();
  const table = [
    '| Metric | Result | Limit | Status |',
    '| --- | ---: | ---: | --- |',
    ...report.results.map(
      (r) =>
        `| ${r.metric} | ${r.value == null ? '—' : r.value.toFixed(2)} ${r.unit} | ${r.limit ?? '—'} ${r.unit} | ${r.status} |`,
    ),
  ].join('\n');
  writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(path.join(out, 'results.md'), table + '\n' + (report.error ?? ''));
  console.log(table + '\n' + path.join(out, 'results.json'));
  if (report.error) console.error(report.error);
  if (report.results.some((r) => r.status === 'FAIL')) process.exitCode = 1;
}
