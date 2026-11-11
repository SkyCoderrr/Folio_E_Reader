// Consistency checks for E_Reader contract v0. Usage: node tmp/contract_check/check.mjs <repo_root>
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] ?? '.';
const c = path.join(root, 'contract');
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };
const read = (p) => fs.readFileSync(p, 'utf8');
const load = (p) => JSON.parse(read(p));
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return v;
}
const clone = (v) => JSON.parse(JSON.stringify(v));

// 1. JSON
const defaults = load(path.join(c, 'settings.defaults.json'));
const schema = load(path.join(c, 'settings.schema.json'));
const examples = {};
for (const f of fs.readdirSync(path.join(c, 'examples'))) examples[f.replace(/\.json$/, '')] = load(path.join(c, 'examples', f));
const eventsEx = examples._events; delete examples._events;

// 2. Regex == PRD
const prd = read(path.join(root, 'docs', 'PRD.md'));
const prdRx = /Default `txt.chapterRegex`:\n```\n(.*?)\n```/s.exec(prd)[1];
check(defaults.txt.chapterRegex === prdRx, 'defaults chapterRegex != PRD');
check(schema.properties.txt.properties.chapterRegex.default === prdRx, 'schema regex default != PRD');
for (const n of ['settings_get', 'settings_patch']) check(examples[n].result.txt.chapterRegex === prdRx, `${n} regex != PRD`);
check(examples.settings_set.args.settings.txt.chapterRegex === prdRx, 'settings_set regex');
check(eventsEx['settings://changed'][0].settings.txt.chapterRegex === prdRx, 'event regex');

// 3. Mini JSON Schema validator (keywords used by settings.schema.json)
function resolve(ref) {
  if (!ref.startsWith('#/$defs/')) throw new Error('ref ' + ref);
  return schema.$defs[ref.slice(8)];
}
const known = new Set(['$schema', '$id', 'title', 'description', 'default', 'type', 'enum', 'const', 'minimum', 'maximum',
  'minLength', 'maxLength', 'pattern', 'required', 'additionalProperties', 'properties', 'items', 'maxItems', 'uniqueItems',
  'propertyNames', '$ref', 'anyOf', 'allOf', '$defs']);
function typeOk(t, v) {
  switch (t) {
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'integer': return Number.isInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case 'null': return v === null;
  }
  throw new Error('type ' + t);
}
function validate(s, v, p, errs) {
  for (const k of Object.keys(s)) if (!known.has(k) && !k.startsWith('x-')) errs.push(`${p}: unsupported keyword ${k}`);
  if (s.$ref) validate(resolve(s.$ref), v, p, errs);
  if (s.type) { const ts = [].concat(s.type); if (!ts.some((t) => typeOk(t, v))) { errs.push(`${p}: type`); return; } }
  if ('const' in s && !eq(s.const, v)) errs.push(`${p}: const`);
  if (s.enum && !s.enum.some((e) => eq(e, v))) errs.push(`${p}: enum`);
  if (typeof v === 'number') {
    if ('minimum' in s && v < s.minimum) errs.push(`${p}: minimum`);
    if ('maximum' in s && v > s.maximum) errs.push(`${p}: maximum`);
  }
  if (typeof v === 'string') {
    const len = [...v].length;
    if ('minLength' in s && len < s.minLength) errs.push(`${p}: minLength`);
    if ('maxLength' in s && len > s.maxLength) errs.push(`${p}: maxLength`);
    if (s.pattern && !new RegExp(s.pattern, 'u').test(v)) errs.push(`${p}: pattern`);
  }
  if (Array.isArray(v)) {
    if ('maxItems' in s && v.length > s.maxItems) errs.push(`${p}: maxItems`);
    if (s.uniqueItems && new Set(v.map((x) => JSON.stringify(canon(x)))).size !== v.length) errs.push(`${p}: uniqueItems`);
    if (s.items) v.forEach((x, i) => validate(s.items, x, `${p}[${i}]`, errs));
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const r of s.required ?? []) if (!(r in v)) errs.push(`${p}: missing ${r}`);
    for (const [k, x] of Object.entries(v)) {
      if (s.propertyNames) validate(s.propertyNames, k, `${p}{${k}}`, errs);
      if (s.properties && k in s.properties) validate(s.properties[k], x, `${p}.${k}`, errs);
      else if (s.additionalProperties === false) errs.push(`${p}: additional ${k}`);
      else if (typeof s.additionalProperties === 'object') validate(s.additionalProperties, x, `${p}.${k}`, errs);
    }
  }
  if (s.anyOf && !s.anyOf.some((sub) => { const e = []; validate(sub, v, p, e); return e.length === 0; })) errs.push(`${p}: anyOf`);
  for (const sub of s.allOf ?? []) validate(sub, v, p, errs);
}
const valErrs = (v) => { const e = []; validate(schema, v, '$', e); return e; };
const val = (v, label) => { for (const e of valErrs(v)) fails.push(`schema ${label}: ${e}`); };
val(defaults, 'defaults');
val(examples.settings_get.result, 'settings_get.result');
val(examples.settings_patch.result, 'settings_patch.result');
val(examples.settings_set.args.settings, 'settings_set.args');
val(examples.settings_set.result, 'settings_set.result');
eventsEx['settings://changed'].forEach((p, i) => val(p.settings, `settings://changed[${i}]`));
// presets/styleOverrides of examples against defs (covered above); negative tests:
const variant = (keys, value) => { const d = clone(defaults); let o = d; for (const k of keys.slice(0, -1)) o = o[k]; o[keys.at(-1)] = value; return d; };
const neg = [
  [['reader', 'pagesPerView'], 3, false],
  [['reader', 'pagesPerView'], 2, true],
  [['bossKey', 'shortcut'], 'B', false],
  [['bossKey', 'shortcut'], 'F13', true],
  [['bossKey', 'shortcut'], 'F12', false],
  [['bossKey', 'shortcut'], 'Shift+Pause', true],
  [['bossKey', 'shortcut'], 'Alt+Ctrl+B', false],
  [['bossKey', 'shortcut'], 'Ctrl+Alt+KeyB', false],
  [['keybindings'], { 'nope.action': ['A'] }, false],
  [['keybindings'], { 'chapter.next': ['BracketRight'] }, false],
  [['keybindings'], { 'chapter.prev': ['BracketLeft'] }, false],
  [['keybindings'], { 'page.next': ['A', 'B', 'C', 'D'] }, false],
  [['keybindings'], { 'page.next': ['A', 'A'] }, false],
  [['keybindings'], { 'page.next': [] }, true],
  [['styleOverrides'], { layout: { maxLineWidthEm: 10 } }, false],
  [['styleOverrides'], { layout: { maxLineWidthEm: 0 } }, true],
  [['styleOverrides'], { font: { size: 9 } }, false],
  [['styleOverrides'], { font: { size: 20.5 } }, false],
  [['styleOverrides'], { bogus: {} }, false],
  [['styleOverrides'], { colors: { text: '#ABC' } }, false],
  [['styleOverrides'], { colors: { text: '#AABBCCDD' } }, true],
  [['library', 'folder'], 'relative\\path', false],
  [['library', 'folder'], 'D:\\Books', true],
  [['library', 'folder'], '\\\\nas\\books', true],
  [['cursor', 'autoHideDelayMs'], 0, true],
  [['cursor', 'autoHideDelayMs'], 100, false],
  [['activePresetId'], 'builtin.paper', false],
  [['activePresetId'], 'custom.abc-123', true],
  [['version'], 2, false],
  [['extraKey'], 1, false],
];
for (const [keys, value, ok] of neg) check((valErrs(variant(keys, value)).length === 0) === ok, `schema ${keys.join('.')}=${JSON.stringify(value)} expected valid=${ok}`);
const badPreset = clone(examples.settings_get.result); badPreset.presets[0].builtIn = true;
check(valErrs(badPreset).length > 0, 'schema accepts builtIn:true preset');
const blankName = clone(examples.settings_get.result); blankName.presets[0].name = '   ';
check(valErrs(blankName).length > 0, 'schema accepts blank preset name');

// 4. Schema defaults == defaults.json
for (const [k, prop] of Object.entries(schema.properties)) {
  if ('default' in prop) check(eq(prop.default, defaults[k]), `schema default ${k}`);
  else for (const [kk, pp] of Object.entries(prop.properties)) check(eq(pp.default, defaults[k][kk]), `schema default ${k}.${kk}`);
}
check(eq(schema.required, Object.keys(defaults)), 'schema.required != defaults keys (order)');
// ReadingStyle defaults == builtin.dark table in settings.md
const rsDefs = schema.$defs.ReadingStyle.properties;
const darkFromSchema = Object.fromEntries(Object.entries(rsDefs).map(([g, s]) => [g, Object.fromEntries(Object.entries(s.properties).map(([k, x]) => [k, x.default]))]));
check(eq(darkFromSchema, {
  colors: { background: '#17181B', text: '#D6D1C7', accent: '#D9A55B', selection: '#D9A55B52' },
  font: { latin: 'Sitka Text', cjk: 'Microsoft YaHei', fallback: 'serif', size: 20, weight: 400 },
  text: { lineHeight: 1.75, letterSpacing: 0, paragraphSpacing: 0.5, indentMode: 'publisher', indentSize: 2, align: 'justify' },
  layout: { marginX: 48, marginY: 40, maxLineWidthEm: 36, pageGap: 48 },
  cjk: { punctuationTrim: true, autospace: true },
}), 'ReadingStyle schema defaults != Dark');
// patch def has the same keys as the full def
for (const g of Object.keys(rsDefs)) check(eq(Object.keys(rsDefs[g].properties), Object.keys(schema.$defs.ReadingStylePatch.properties[g].properties)), `patch keys ${g}`);

// 5. Keymap chords
const chordRx = new RegExp(schema.$defs.Chord.pattern, 'u');
const smd = read(path.join(c, 'settings.md'));
const km = smd.split('## 9. Default keymap')[1].split('Reserved chords')[0];
const kmActions = [];
for (const line of km.split('\n')) {
  if (!/^\| (reader|library|app)/.test(line)) continue;
  for (const m of line.matchAll(/`([a-zA-Z.]+)` → ((?:`[^`]+`(?:, )?)+)/g)) {
    kmActions.push(m[1]);
    for (const ch of m[2].matchAll(/`([^`]+)`/g)) check(chordRx.test(ch[1]), `keymap chord invalid ${m[1]} ${ch[1]}`);
  }
}

// 6. Action ids
const ts = read(path.join(c, 'types.ts'));
const tsConst = (name) => [...new RegExp(`export const ${name} = \\[(.*?)\\] as const`, 's').exec(ts)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const tsActions = tsConst('ACTION_IDS');
const rs = read(path.join(c, 'rust-types.md'));
const version = /export const CONTRACT_VERSION = '([^']+)'/.exec(ts)[1];
check(version === '0.8.0', 'CONTRACT_VERSION expected 0.8.0');
check(rs.includes(`pub const CONTRACT_VERSION: &str = "${version}";`), 'Rust contract version != TS');
check(examples.app_info.result.contractVersion === version, 'app_info contract version != TS');
const rustBlock = rs.split(/```rust\r?\n/)[1].split(/\r?\n```/)[0] + '\n';
check(read(path.join(root, 'src-tauri', 'src', 'contract', 'mod.rs')) === rustBlock, 'Rust mirror != rust-types.md block');
const rsActions = [...rs.split('pub enum ActionId')[1].split('\n}')[0].matchAll(/#\[serde\(rename = "([a-zA-Z.]+)"\)\] [A-Z]\w+,/g)].map((m) => m[1]);
check(eq(tsActions, schema.$defs.ActionId.enum), 'ActionId TS != schema');
check(eq(tsActions, rsActions), `ActionId TS != Rust (${tsActions.length} vs ${rsActions.length})`);
check(eq([...tsActions].sort(), [...kmActions].sort()), `ActionId != keymap: ${tsActions.filter((a) => !kmActions.includes(a))} | ${kmActions.filter((a) => !tsActions.includes(a))}`);
check(tsActions.length === 34, 'ActionId count');
check(eq(tsConst('SETTINGS_PANES'), schema.properties.ui.properties.settingsLastPane.enum), 'panes');
check(eq(tsConst('BUILTIN_PRESET_IDS'), ['builtin.dark', 'builtin.sepia', 'builtin.light', 'builtin.night']), 'builtin ids');

// 7. Error codes
const tsCodes = tsConst('ERROR_CODES');
const rsCodes = [...rs.split('pub enum ErrorCode')[1].split('\n}')[0].matchAll(/^\s+([A-Z]\w+),/gm)].map((m) => m[1].replace(/(?<!^)(?=[A-Z])/g, '_').toUpperCase());
const mdCodes = [...read(path.join(c, 'errors.md')).matchAll(/^\| `([A-Z_]+)` \|/gm)].map((m) => m[1]);
check(eq(tsCodes, rsCodes), `ErrorCode TS != Rust ${tsCodes} ${rsCodes}`);
check(eq(tsCodes, mdCodes), 'ErrorCode TS != errors.md');
const allText = ['commands.md', 'events.md', 'settings.md', 'README.md', 'db-schema.md', 'file-layout.md'].map((f) => read(path.join(c, f))).join('\n');
const okUpper = new Set(['STRICT', 'HTMAXBUTTON', 'HTMINBUTTON', 'HTCLOSE', 'E_READER_PROFILE_DIR', 'CONTRACT_VERSION', 'ERROR_CODES', 'SCREAMING_SNAKE_CASE']);
for (const m of allText.matchAll(/`([A-Z][A-Z_]{4,})`/g)) if (!okUpper.has(m[1])) check(tsCodes.includes(m[1]), `unknown code referenced ${m[1]}`);
const allEx = JSON.stringify([examples, eventsEx]);
for (const m of allEx.matchAll(/"code":"([A-Z_]+)"/g)) check(tsCodes.includes(m[1]), `example code ${m[1]}`);

// 8. Commands
const cmdBlock = ts.split('export interface Commands {')[1].split('\n}\n')[0];
const tsCmds = [...cmdBlock.matchAll(/^\s+(\w+): \{ args: (\w+); result: ([^}]+?) \};/gm)].map((m) => [m[1], m[2], m[3]]);
const cmdMd = read(path.join(c, 'commands.md'));
const readme = read(path.join(c, 'README.md'));
const idx = [...cmdMd.matchAll(/^\| `(\w+)` \| (M\d) \| ([^|]+) \|/gm)].map((m) => [m[1], m[2]]);
check(eq(idx.map((x) => x[0]), tsCmds.map((x) => x[0])), 'commands.md index != TS Commands');
const early = idx.filter(([, m]) => ['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M7', 'M8'].includes(m)).map(([n]) => n);
check(eq([...early].sort(), Object.keys(examples).sort()), `examples != M0-M8: ${early.filter((n) => !examples[n])} | ${Object.keys(examples).filter((n) => !early.includes(n))}`);
check(tsCmds.length === 39 && early.length === 39, `counts ${tsCmds.length} ${early.length}`);
for (const [n] of tsCmds) {
  check(cmdMd.includes('### `' + n + '`'), `no section ${n}`);
  check(readme.includes('`' + n + '`'), `README map misses ${n}`);
}
const rsHas = (t) => new RegExp(`pub (struct|enum|type) ${t}\\b`).test(rs);
for (const [n, a, r] of tsCmds) for (const t of [a, ...(r.match(/\b[A-Z]\w+\b/g) ?? [])]) if (!['EmptyArgs', 'JsonValue', 'AbsPath'].includes(t)) check(rsHas(t), `Rust missing ${t} (${n})`);
const helpers = new Set(['MergePatch', 'Commands', 'CommandName', 'CommandArgs', 'CommandResult', 'Events', 'EventName', 'EventPayload', 'BuiltinPresetId']);
for (const m of ts.matchAll(/^export (?:interface|type) (\w+)/gm)) if (!helpers.has(m[1])) check(rsHas(m[1]), `TS ${m[1]} has no Rust item`);
const tsFields = (iface) => { const m = new RegExp(`export interface ${iface} \\{(.*?)\\n\\}`, 's').exec(ts); return m ? [...m[1].matchAll(/^\s+(\w+)\??:/gm)].map((x) => x[1]) : null; };
for (const [n, a] of tsCmds) {
  if (!examples[n]) continue;
  if (a === 'EmptyArgs') check(eq(examples[n].args, {}), `${n} args`);
  else check(eq(Object.keys(examples[n].args).sort(), tsFields(a).sort()), `${n} args keys != ${a}`);
}
for (const [name, iface, value] of [
  ['stats_session_save', 'ReadingSessionInput', examples.stats_session_save.args.session],
  ...examples.stats_query.result.days.map((v) => ['stats_query.day', 'StatsDay', v]),
  ...examples.stats_query.result.books.map((v) => ['stats_query.book', 'StatsBook', v]),
  ['stats_query', 'StatsQueryResult', examples.stats_query.result],
  ['stats_query.totals', 'StatsTotals', examples.stats_query.result.totals],
]) check(eq(Object.keys(value).sort(), tsFields(iface).sort()), name + ' keys != ' + iface);
const bookFields = tsFields('BookRecord');
for (const b of [...examples.library_list.result, examples.book_get.result, examples.book_open.result.book, ...eventsEx['import://item'].map((p) => p.book).filter(Boolean)]) check(eq(Object.keys(b), bookFields) && JSON.stringify(Object.keys(b)) === JSON.stringify(bookFields), 'BookRecord keys/order');
check(JSON.stringify(Object.keys(examples.app_info.result)) === JSON.stringify(tsFields('AppInfo')), 'AppInfo keys');
check(JSON.stringify(Object.keys(examples.window_get_state.result)) === JSON.stringify(tsFields('WindowState')), 'WindowState keys');
check(JSON.stringify(Object.keys(examples.book_open.result)) === JSON.stringify(tsFields('BookOpenResult')), 'BookOpenResult keys');
check(JSON.stringify(Object.keys(examples.library_remove.result)) === JSON.stringify(tsFields('LibraryRemoveResult')), 'LibraryRemoveResult keys');
const locFields = tsFields('Locator');
for (const l of [examples.kv_get.result, examples.kv_set.args.value, examples.position_get.result, examples.position_save.args.locator, examples.book_open.result.locator]) check(JSON.stringify(Object.keys(l)) === JSON.stringify(locFields), 'Locator keys');
for (const p of eventsEx['import://item']) check(JSON.stringify(Object.keys(p)) === JSON.stringify(tsFields('ImportItemPayload')), 'ImportItemPayload keys');
check(JSON.stringify(Object.keys(eventsEx['import://done'][0])) === JSON.stringify(tsFields('ImportDonePayload')), 'ImportDonePayload keys');
check(eq(eventsEx['import://item'].map((p) => p.index), [0, 1, 2, 3]), 'import item order');
const done = eventsEx['import://done'][0], items = eventsEx['import://item'];
check(done.added === items.filter((i) => i.outcome === 'added').length && done.duplicates === items.filter((i) => i.outcome === 'duplicate').length && done.failed.length === items.filter((i) => i.outcome === 'failed').length && done.unsupported.length === items.filter((i) => i.outcome === 'unsupported').length && done.total === items.length, 'import done summary != items');
for (const [name, ex] of Object.entries(examples)) {
  const visit = (v) => { if (!v || typeof v !== 'object') return; for (const [k, x] of Object.entries(v)) { if (k === 'bookId') check(/^[0-9a-f]{32}$/.test(x), 'bad bookId ' + name); if (k === 'bookmarkId' || (k === 'id' && 'locator' in v)) check(/^[1-9][0-9]*$/.test(x), 'bad bookmark id ' + name); else if (k === 'id' && !('locator' in v) && !String(x).startsWith('custom.')) check(/^[0-9a-f]{32}$/.test(x), 'bad book id ' + name); visit(x); } }; visit(ex);
}
const jobRx = /^[A-Za-z0-9_-]{1,64}$/; check(jobRx.test(examples.library_import.args.jobId), 'jobId pattern');
check(/^[A-Za-z0-9._:-]{1,128}$/.test(examples.kv_get.args.key), 'kv key pattern');
// settings_patch example result == settings_get result with the patch applied (RFC 7396 + prune empty overrides)
function mergePatch(t, p) { if (p === null || typeof p !== 'object' || Array.isArray(p)) return p; const o = (t && typeof t === 'object' && !Array.isArray(t)) ? clone(t) : {}; for (const [k, v] of Object.entries(p)) { if (v === null) delete o[k]; else o[k] = mergePatch(o[k], v); } return o; }
const patched = mergePatch(examples.settings_get.result, examples.settings_patch.args.patch);
for (const [g, v] of Object.entries(patched.styleOverrides)) if (Object.keys(v).length === 0) delete patched.styleOverrides[g];
check(eq(patched, examples.settings_patch.result), 'settings_patch example result != merge(settings_get, patch)');
check(eq(examples.settings_set.args.settings, examples.settings_set.result), 'settings_set result != args');

for (const name of ['txt_prepare', 'txt_preview_split', 'txt_prefs_set', 'bookmarks_list', 'bookmark_add', 'bookmark_remove', 'stats_session_save', 'stats_query', 'book_set_total_chars']) {
  const row = cmdMd.split('\n').find((line) => line.startsWith('| `' + name + '` |'));
  check(row?.includes('| stable |'), 'new command is not stable: ' + name);
  check(cmdMd.split('\n').some((line) => line.startsWith('### `' + name + '`') && line.endsWith('stable')), 'section is not stable: ' + name);
}
// 9. Inline examples
const inline = [...cmdMd.matchAll(/Example \(`examples\/(\w+)\.json`\):\n```json\n(.*?)\n```/gs)];
for (const m of inline) check(eq(JSON.parse(m[2]), examples[m[1]]), `inline example differs ${m[1]}`);
const inlineNames = new Set(inline.map((m) => m[1]));
const missing = early.filter((n) => !inlineNames.has(n) && !n.startsWith('settings_'));
check(missing.length === 0, `no inline example ${missing}`);

// 10. Events
const evBlock = ts.split('export interface Events {')[1].split('\n}\n')[0];
const tsEvents = [...evBlock.matchAll(/'([a-z]+:\/\/[a-z-]+)'/g)].map((m) => m[1]);
const mdEvents = [...read(path.join(c, 'events.md')).matchAll(/^\| `([a-z]+:\/\/[a-z-]+)` \|/gm)].map((m) => m[1]);
const rsEvents = [...rs.matchAll(/pub const \w+: &str = "([a-z]+:\/\/[a-z-]+)";/g)].map((m) => m[1]);
check(eq(tsEvents, mdEvents) && eq(tsEvents, rsEvents), 'event lists differ');
check(eq([...tsEvents].sort(), Object.keys(eventsEx).sort()), 'events examples keys');
for (const e of tsEvents) check(/^[A-Za-z0-9\-/:_]+$/.test(e), `event name chars ${e}`);

// 11. SQL
try {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec(read(path.join(c, 'db-schema.sql')));
  check(db.prepare('PRAGMA user_version').get().user_version === 2, 'user_version');
  db.exec('PRAGMA foreign_keys = ON');
  const bid = '3f2a9c0d1b7e4a65c8d90f1e2b3a4c5d';
  const ins = db.prepare('INSERT INTO books(id,format,title,file_name,file_rel_path,file_size,added_at) VALUES (?,?,?,?,?,?,?)');
  ins.run(bid, 'epub', 't', 'f', bid + '.epub', 1, 0);
  db.prepare('INSERT INTO positions VALUES (?, ?, 0)').run(bid, JSON.stringify(examples.position_get.result));
  db.prepare("INSERT INTO bookmarks(book_id,locator_json,progress,created_at) VALUES (?, '{}', 0.5, 0)").run(bid);
  db.prepare("INSERT INTO book_prefs(book_id, txt_encoding) VALUES (?, 'gb18030')").run(bid);
  db.prepare("INSERT INTO sessions(book_id,local_day,started_at,ended_at,active_ms,chars_advanced,start_progress,end_progress) VALUES (?, '2026-11-09', 0, 1, 1, 1, 0, 0.1)").run(bid);
  for (const bad of [bid.toUpperCase(), bid.slice(1), bid.slice(1) + 'g']) {
    let threw = false; try { ins.run(bad, 'epub', 't', 'f', bad + 'x.epub', 1, 0); } catch { threw = true; }
    check(threw, `SQL accepts bad id ${bad}`);
  }
  let threw = false; try { db.prepare("INSERT INTO book_prefs(book_id, txt_encoding) VALUES (?, 'auto')").run(bid); } catch { threw = true; }
  check(threw, 'SQL accepts txt_encoding auto');
  db.prepare('INSERT INTO chapter_read VALUES (?, ?, 0)').run(bid, 's:0#');
  db.exec('DELETE FROM books');
  for (const t of ['positions', 'bookmarks', 'book_prefs', 'sessions', 'chapter_read']) check(db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n === 0, `cascade ${t}`);
  console.log('sqlite checks ran');
} catch (e) { fails.push('sqlite: ' + e.message); }

console.log(fails.length ? 'FAILURES:' : 'ALL CHECKS PASSED');
for (const f of fails) console.log(' - ' + f);
process.exit(fails.length ? 1 : 0);
