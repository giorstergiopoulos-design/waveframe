'use strict';
// Media Player Pro importer: read-only, no credentials, idempotent merge, backup first. Fixtures are synthetic (built in a temp folder).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const M = require('../mpp-import.js');
const L = require('../renderer/mpplib.js');

const SECRET = 'S3cret-Passw0rd-XYZ', KEY = 'API-KEY-123456';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-mpp-'));
  const w = (n, s) => fs.writeFileSync(path.join(dir, n), s, 'utf8');
  w('recent.txt', 'C:\\Videos\\a.mp4\r\nhttps://example.com/live.m3u8\r\ndvd:///D:\\DISC\r\ndshow://\r\nC:\\Videos\\a.mp4\r\n');
  w('bookmarks.txt', 'C:\\Videos\\a.mp4|3553\nC:\\Videos\\a.mp4|9000\nbroken line\nC:\\Videos\\b.mkv|abc\n');
  w('resume.txt', 'C:\\Videos\\a.mp4|120000\nD:\\Films\\c.mkv|5000\n');
  w('settings.json', JSON.stringify({ Languages: 'el, EN,x', AutoDownload: true, AutoSync: false, SubFolder: '', PlainName: true, OsApiKey: KEY, OsUsername: 'user', OsPassword: SECRET, OnlineMeta: false, SubFontSize: 20, SubColor: 16776960, NetworkCachingMs: 1500 }));
  w('audio.json', JSON.stringify({ On: true, Preset: 'Cinema', Pre: 0, Bands: [4, 3, 1, 0, 0, 1, 2, 3, 3, 3], Clarity: 0, Ambience: 2, Surround: 6, Dynamic: 3, Bass: 4 }));
  w('audio-presets.json', JSON.stringify({ 'My <b>preset</b>': { Preset: 'x', Bands: [1, 2, 3], Bass: 20, Clarity: -3 } }));
  w('mode.txt', 'light'); w('ui.txt', 'wave'); w('accent.txt', '#FF8800'); w('skin.txt', 'Σκούρο (MPC)'); w('side.txt', 'hide');
  w('convert-dir.txt', 'D:\\Encodes'); w('window.txt', '980|303|1180|720|Normal');
  fs.mkdirSync(path.join(dir, 'meta')); fs.writeFileSync(path.join(dir, 'meta', 'x.json'), '{}'); w('suite.json', '{}');
  return dir;
}
const snapshot = (dir) => fs.readdirSync(dir, { recursive: true }).sort().map((n) => { const f = path.join(dir, n); const st = fs.statSync(f); return st.isFile() ? `${n}:${st.size}:${st.mtimeMs}:${crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')}` : n; }).join('\n');
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };

test('scan: every category is parsed, unsupported items and non-portable files are reported', () => {
  const dir = fixture();
  const r = M.scan(dir);
  assert.equal(r.found, true);
  assert.deepEqual(r.bundle.recent, ['C:\\Videos\\a.mp4', 'https://example.com/live.m3u8']);
  assert.deepEqual(r.bundle.bookmarks, [{ path: 'C:\\Videos\\a.mp4', ms: 3553 }, { path: 'C:\\Videos\\a.mp4', ms: 9000 }]);
  assert.equal(r.bundle.resume.length, 2);
  assert.deepEqual(r.bundle.subtitles.languages, ['el', 'en']);
  assert.equal(r.bundle.subtitles.color, '#ffff00');
  assert.equal(r.bundle.subtitles.fontSize, 20);
  assert.equal(r.bundle.audioCurrent.surround, 6);
  assert.equal(r.bundle.audioPresets[0].name, 'My bpreset/b'.replace('/b', '/b'), 'markup characters are stripped from names');
  assert.equal(r.bundle.audioPresets[0].bass, 10, 'effect level is clamped to 0-10');
  assert.equal(r.bundle.audioPresets[0].bands.length, 10);
  assert.deepEqual(r.bundle.appearance, { mode: 'light', ui: 'wave', sidePanel: 'hide', accent: '#ff8800', skin: 'Σκούρο (MPC)' });
  assert.equal(r.bundle.convertDir, 'D:\\Encodes');
  const what = r.notMigrated.map((x) => `${x.what}:${x.reason}`);
  for (const w of ['settings.json:credentials', 'window.txt:geometry', 'meta:cache', 'suite.json:updateState', 'recent.txt:unsupportedItems:2', 'bookmarks.txt:unsupportedItems:2']) assert.ok(what.includes(w), w + ' in ' + what.join(','));
});

test('scan: credentials never reach the bundle', () => {
  const r = M.scan(fixture());
  const s = JSON.stringify(r);
  assert.ok(!s.includes(SECRET) && !s.includes(KEY) && !/OsPassword|OsApiKey|OsUsername/.test(s));
});

test('scan + backup never modify the source folder, backup copies the files and the Suite snapshot', () => {
  const dir = fixture(); const before = snapshot(dir);
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-bk-'));
  M.scan(dir);
  const b = M.backup(dir, dest, { 'waveframe.skin': 'midnight' }, new Date('2026-11-10T10:00:00Z'));
  assert.equal(snapshot(dir), before, 'source identical after scan and backup');
  assert.ok(b.dir.startsWith(dest) && b.dir.includes('mpp-import-2026-11-10T10-00-00'));
  assert.ok(b.copied.includes('settings.json') && b.copied.includes('resume.txt') && !b.copied.includes('meta'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(b.dir, 'waveframe-before.json'), 'utf8')), { 'waveframe.skin': 'midnight' });
  assert.ok(fs.existsSync(path.join(b.dir, 'source', 'bookmarks.txt')));
});

test('scan: missing folder, empty folder and oversized files', () => {
  assert.equal(M.scan(path.join(os.tmpdir(), 'wf-does-not-exist-' + Date.now())).found, false);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-mpp-empty-'));
  assert.equal(M.scan(empty).found, false);
  fs.writeFileSync(path.join(empty, 'recent.txt'), 'C:\\a.mp4\n'.repeat(200000));
  const r = M.scan(empty);
  assert.equal(r.found, true); assert.equal(r.bundle.recent, undefined);
  assert.ok(r.notMigrated.some((x) => x.what === 'recent.txt' && x.reason === 'tooBig'));
});

test('validRef: only absolute paths and http(s) URLs', () => {
  for (const ok of ['C:\\a\\b.mp4', 'c:/a/b.mp4', '\\\\srv\\share\\x.mkv', 'https://x.org/a.mp4', 'http://x.org/a']) assert.equal(M.validRef(ok), true, ok);
  for (const bad of ['', 'a.mp4', '..\\a.mp4', 'file:///C:/a', 'dvd:///D:', 'javascript:alert(1)', 'C:\\a\n.mp4', 'x'.repeat(3000)]) assert.equal(M.validRef(bad), false, bad);
});

test('m3u: relative entries resolve against the playlist folder, comments and bad schemes are dropped', () => {
  const r = M.parseM3u('#EXTM3U\n#EXTINF:1,x\nsub\\a.mp4\nC:\\abs\\b.mp4\ndvd:///x\nhttps://h.org/s.mp4\n', 'D:\\Lists');
  assert.deepEqual(r.items, ['D:\\Lists\\sub\\a.mp4', 'C:\\abs\\b.mp4', 'https://h.org/s.mp4']);
  assert.equal(r.skipped, 1);
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wf-m3u-')), 'My List.m3u');
  fs.writeFileSync(f, '#EXTM3U\nC:\\x\\y.mp4\n');
  assert.deepEqual(M.readM3uFile(f), { name: 'My List', items: ['C:\\x\\y.mp4'], skipped: 0 });
  assert.equal(M.readM3uFile('relative.m3u'), null);
  assert.equal(M.readM3uFile(path.join(os.tmpdir(), 'x.txt')), null);
});

test('bandsToSuite: flat stays flat, the curve is interpolated and clamped', () => {
  assert.deepEqual(L.bandsToSuite(new Array(10).fill(0)), new Array(10).fill(0));
  const up = L.bandsToSuite([6, 6, 6, 6, 6, 6, 6, 6, 6, 6]);
  assert.ok(up.every((v) => v === 6));
  const ramp = L.bandsToSuite([0, 0, 0, 0, 0, 12, 12, 12, 12, 12]);
  assert.ok(ramp[0] === 0 && ramp[9] === 12 && ramp[5] >= 0 && ramp[5] <= 12);
  assert.equal(L.bandsToSuite([1]).length, 10);
});

test('apply: adds everything once, second run adds nothing (idempotent), local resume positions win', () => {
  const bundle = M.scan(fixture()).bundle;
  bundle.playlists = [{ name: 'Mine', items: ['C:\\a.mp4'] }];
  const s = mem();
  s.setItem(L.KEYS.resume, JSON.stringify({ 'C:\\Videos\\a.mp4': 777 }));
  const r1 = L.apply(s, bundle, null, { now: 'T1' });
  assert.equal(r1.added.recent, 2); assert.equal(r1.added.bookmarks, 2); assert.equal(r1.added.resume, 1);
  assert.equal(JSON.parse(s.getItem(L.KEYS.resume))['C:\\Videos\\a.mp4'], 777, 'existing local position is kept');
  assert.equal(JSON.parse(s.getItem(L.KEYS.resume))['D:\\Films\\c.mkv'], 5000);
  assert.equal(r1.added.playlists, 1); assert.equal(r1.added.subtitles, 1); assert.equal(r1.added.audio, 2); assert.equal(r1.added.appearance, 2); assert.equal(r1.added.convertDir, 1);
  assert.equal(s.getItem(L.KEYS.skin), 'light'); assert.equal(s.getItem(L.KEYS.accent), '#ff8800');
  assert.equal(s.getItem(L.KEYS.destMode), 'custom');
  const state = JSON.stringify([...s.m.entries()].filter(([k]) => k !== L.KEYS.record));
  const r2 = L.apply(s, bundle, null, { now: 'T2' });
  for (const k of ['recent', 'bookmarks', 'resume', 'playlists', 'subtitles', 'audio', 'appearance', 'convertDir']) assert.equal(r2.added[k], 0, k + ' second run');
  assert.equal(JSON.stringify([...s.m.entries()].filter(([k]) => k !== L.KEYS.record)), state, 'storage identical after the second run');
  assert.equal(JSON.parse(s.getItem(L.KEYS.record)).runs, 2);
});

test('apply: only the chosen categories are touched, nothing is removed', () => {
  const bundle = M.scan(fixture()).bundle;
  const s = mem();
  s.setItem(L.KEYS.recent, JSON.stringify(['C:\\mine.mp4']));
  s.setItem(L.KEYS.presets, JSON.stringify([{ name: 'old', bands: new Array(10).fill(1) }]));
  L.apply(s, bundle, ['recent']);
  assert.deepEqual(JSON.parse(s.getItem(L.KEYS.recent)), ['C:\\mine.mp4', 'C:\\Videos\\a.mp4', 'https://example.com/live.m3u8']);
  assert.equal(s.getItem(L.KEYS.skin), null); assert.equal(s.getItem(L.KEYS.subs), null); assert.equal(s.getItem(L.KEYS.bookmarks), null);
  L.apply(s, bundle, ['audioPresets', 'audioCurrent']);
  const presets = JSON.parse(s.getItem(L.KEYS.presets));
  assert.equal(presets[0].name, 'old'); assert.equal(presets.length, 3);
  assert.ok(presets.slice(1).every((p) => p.bands.length === 10 && p.bassBoost >= 0 && p.bassBoost <= 12));
});
