// Scroll smoothness measurement (release build, isolated .test-profile/demo).
// Records the reader scroll container's scrollTop on every animation frame while
// (a) Down arrow is held with OS-like key repeat (500 ms delay, then every 33 ms) for 2 s,
// (b) Down arrow is tapped once, (c) Page Down is pressed once.
// Usage: node scripts/measure-scroll.mjs <label>   -> writes docs/measurements/scroll-<label>.json
import { launch, evaluate, openFixture, sleep, repo } from './demo-driver.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const label = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'run';
const { child, send, close } = await launch();
const ev = (type, key, code, vk, extra = {}) => send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, ...extra });
const startRec = `(() => {
  const els = [...document.querySelectorAll('*')].filter(e => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 50; });
  const el = els.sort((a,b) => b.clientHeight - a.clientHeight)[0];
  const gen = (window.__gen = (window.__gen || 0) + 1); window.__rec = { t: [], y: [], el };
  
  const f = (ts) => { window.__rec.t.push(ts); window.__rec.y.push(el.scrollTop); if (window.__gen === gen) requestAnimationFrame(f); };
  requestAnimationFrame(f); return !!el; })()`;
const stopRec = `(() => { window.__gen++; return { t: window.__rec.t, y: window.__rec.y }; })()`;
function analyse(name, r) {
  const d = []; for (let i = 1; i < r.y.length; i++) d.push(+(r.y[i] - r.y[i - 1]).toFixed(3));
  const dt = []; for (let i = 1; i < r.t.length; i++) dt.push(+(r.t[i] - r.t[i - 1]).toFixed(2));
  const moving = d.map((x, i) => [x, i]).filter(([x]) => x !== 0);
  const first = moving.length ? moving[0][1] : 0, last = moving.length ? moving[moving.length - 1][1] : 0;
  const window_ = d.slice(first, last + 1);
  const zeroInside = window_.filter((x) => x === 0).length;
  const nz = window_.filter((x) => x !== 0);
  const mean = nz.reduce((a, b) => a + b, 0) / (nz.length || 1);
  // steady part: middle 50% of the motion window
  const mid = window_.slice(Math.floor(window_.length * 0.25), Math.ceil(window_.length * 0.75));
  const mm = mid.reduce((a, b) => a + b, 0) / (mid.length || 1);
  const sd = Math.sqrt(mid.reduce((a, b) => a + (b - mm) ** 2, 0) / (mid.length || 1));
  const maxJump = Math.max(0, ...window_.map(Math.abs));
  const meanDt = dt.reduce((a, b) => a + b, 0) / (dt.length || 1);
  const s = { name, frames: d.length, frameMs: +meanDt.toFixed(2), motionFrames: window_.length, zeroDeltaFramesDuringMotion: zeroInside, maxDeltaPx: maxJump, meanNonZeroDeltaPx: +mean.toFixed(2), steadyMeanPx: +mm.toFixed(2), steadyStdDevPx: +sd.toFixed(2), steadyCV: +(sd / (Math.abs(mm) || 1)).toFixed(3), totalPx: +(r.y.at(-1) - r.y[0]).toFixed(1), deltas: window_ };
  console.log(name, JSON.stringify({ ...s, deltas: window_.slice(0, 40) }));
  return s;
}
const out = { label, when: new Date().toISOString(), results: [] };
try {
  await send('Page.enable'); await send('Runtime.enable'); await sleep(1500);
  await openFixture(send, 'pride-and-prejudice.epub'); await sleep(4000);
  // move into body text
  await ev('rawKeyDown', 'PageDown', 'PageDown', 34); await ev('keyUp', 'PageDown', 'PageDown', 34); await sleep(800);
  // (a) hold
  await evaluate(send, startRec); await sleep(200);
  await ev('rawKeyDown', 'ArrowDown', 'ArrowDown', 40); await sleep(500);
  for (let i = 0; i < 45; i++) { await ev('rawKeyDown', 'ArrowDown', 'ArrowDown', 40, { autoRepeat: true }); await sleep(33); }
  await ev('keyUp', 'ArrowDown', 'ArrowDown', 40); await sleep(700);
  out.results.push(analyse('hold-down-2s', await evaluate(send, stopRec)));
  // (b) tap
  await evaluate(send, startRec); await sleep(200);
  await ev('rawKeyDown', 'ArrowDown', 'ArrowDown', 40); await sleep(60); await ev('keyUp', 'ArrowDown', 'ArrowDown', 40); await sleep(700);
  out.results.push(analyse('tap-down', await evaluate(send, stopRec)));
  // (c) page down
  await evaluate(send, startRec); await sleep(200);
  await ev('rawKeyDown', 'PageDown', 'PageDown', 34); await ev('keyUp', 'PageDown', 'PageDown', 34); await sleep(700);
  out.results.push(analyse('pagedown', await evaluate(send, stopRec)));
} finally { close(); await sleep(300); child.kill(); await sleep(800); }
mkdirSync(path.join(repo, 'docs', 'measurements'), { recursive: true });
writeFileSync(path.join(repo, 'docs', 'measurements', `scroll-${label}.json`), JSON.stringify(out, null, 1));

