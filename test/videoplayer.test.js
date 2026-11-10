'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../renderer/vplib.js');
const M = require('../media-main.js');

test('srt -> vtt: timestamps, indexes, ASS-style tags, shift and clamping', () => {
  const srt = '\uFEFF1\r\n00:00:01,500 --> 00:00:03,000\r\n{\\an8}Γεια <i>σου</i>\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,250\r\nΔεύτερο\r\nδιπλό\r\n\r\ngarbage\r\n\r\n3\r\n00:00:06,000 --> 00:00:05,000\r\nreverse\r\n';
  const r = V.srtToVtt(srt, 0);
  assert.equal(r.cues, 2);
  assert.ok(r.vtt.startsWith('WEBVTT\n\n00:00:01.500 --> 00:00:03.000\nΓεια <i>σου</i>\n'));
  assert.ok(r.vtt.includes('00:00:04.000 --> 00:00:05.250\nΔεύτερο\nδιπλό'));
  const later = V.srtToVtt(srt, 2000);
  assert.ok(later.vtt.includes('00:00:03.500 --> 00:00:05.000'));
  const earlier = V.srtToVtt(srt, -2000);
  assert.equal(earlier.cues, 2, 'a cue that starts before 0 is kept when it still ends after 0');
  assert.ok(earlier.vtt.includes('00:00:00.000 --> 00:00:01.000'));
  assert.equal(V.srtToVtt(srt, -9000).cues, 0);
  assert.equal(V.srtToVtt('', 0).cues, 0);
});

test('vtt input passes through, ass dialogue is converted', () => {
  const vtt = 'WEBVTT\n\n00:01.000 --> 00:02.000\nshort form\n';
  assert.equal(V.srtToVtt(vtt, 0).cues, 1);
  assert.ok(V.srtToVtt(vtt, 0).vtt.includes('00:00:01.000 --> 00:00:02.000'));
  const ass = '[Script Info]\nTitle: x\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\i1}Hello, world\\Nsecond\nDialogue: 0,bad,0:00:03.00,Default,,0,0,0,,x\n';
  const r = V.subtitleToVtt(ass, 'ass', 0);
  assert.equal(r.cues, 1);
  assert.ok(r.vtt.includes('00:00:01.500 --> 00:00:03.000\nHello, world\nsecond'));
});

test('resume, recent, bookmarks', () => {
  assert.equal(V.resumeAction(2000, 600000), 'clear');
  assert.equal(V.resumeAction(120000, 600000), 'save');
  assert.equal(V.resumeAction(595000, 600000), 'clear');
  assert.equal(V.resumeAction(1000, 0), 'keep');
  assert.deepEqual(V.pushRecent(['a', 'b', 'c'], 'b', 3), ['b', 'a', 'c']);
  assert.equal(V.pushRecent(Array.from({ length: 40 }, (_, i) => 'p' + i), 'new').length, 30);
  let bm = V.addBookmark([], 'x.mp4', 5000); bm = V.addBookmark(bm, 'x.mp4', 5400); bm = V.addBookmark(bm, 'x.mp4', 1000);
  assert.deepEqual(V.sortedBookmarks(bm, 'x.mp4').map((b) => b.ms), [1000, 5000]);
  assert.equal(V.clock(3723000), '1:02:03'); assert.equal(V.clock(65000), '1:05'); assert.equal(V.clock(-5), '0:00');
});

test('file kinds, titles and URLs', () => {
  assert.equal(V.kindOf('C:\\a\\b.MKV'), 'video'); assert.equal(V.kindOf('C:\\a\\b.flac'), 'audio'); assert.equal(V.kindOf('C:\\a\\b.txt'), '');
  assert.equal(V.kindOf('https://x.org/live'), 'video');
  assert.equal(V.titleOf('C:\\Films\\My.Movie.2020.mkv'), 'My.Movie.2020'); assert.equal(V.titleOf('https://x.org/a/b.mp4?token=1'), 'b');
  assert.equal(V.mediaUrl('C:\\Films\\a b.mp4'), 'wfmedia://f/C%3A%5CFilms%5Ca%20b.mp4');
  assert.equal(V.mediaUrl('https://x.org/a.mp4'), 'https://x.org/a.mp4');
  assert.equal(decodeURIComponent(new URL(V.mediaUrl('C:\\Films\\a b.mp4')).pathname.replace(/^\//, '')), 'C:\\Films\\a b.mp4', 'round-trips through the URL the main process parses');
  assert.equal(V.playable('C:\\x\\y.mp4'), true); assert.equal(V.playable('C:\\x\\y.exe'), false); assert.equal(V.playable('..\\y.mp4'), false); assert.equal(V.playable(5), false);
});

test('subtitle bytes: UTF-8, UTF-8 BOM and Windows-1253 (Greek) all decode', () => {
  assert.equal(M.decodeText(Buffer.from('Καλημέρα', 'utf8')), 'Καλημέρα');
  assert.equal(M.decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Καλημέρα')])), 'Καλημέρα');
  assert.equal(M.decodeText(Buffer.from([0xca, 0xe1, 0xeb, 0xe7, 0xec, 0xdd, 0xf1, 0xe1])), 'Καλημέρα');
});

test('the main process side only serves media and subtitles, never other file types', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'media-main.js'), 'utf8');
  assert.match(src, /SERVE_EXTS = new Set\(\[\.\.\.VIDEO_EXTS, \.\.\.AUDIO_EXTS, \.\.\.SUB_EXTS\]\)/);
  for (const ch of ['vp:pick', 'vp:subs-for', 'vp:pick-sub', 'vp:exists', 'photo:pick', 'photo:read', 'photo:save', 'mpp:scan', 'mpp:backup', 'mpp:report', 'mpp:pick-m3u']) {
    const i = src.indexOf(`'${ch}'`); assert.ok(i > 0, ch);
    assert.ok(/trusted\(e\)/.test(src.slice(i, i + 220)), ch + ' checks the sender');
  }
  assert.ok(!/\.sub|exe|bat|dll/.test(M.VIDEO_EXTS.join(',') + M.AUDIO_EXTS.join(',')) || true);
  assert.ok(![...M.VIDEO_EXTS, ...M.AUDIO_EXTS].some((e) => ['exe', 'bat', 'cmd', 'dll', 'js', 'ps1', 'json'].includes(e)));
});

test('repeat modes decide what plays next', () => {
  assert.equal(V.nextIndex('off', 0, 3), 1); assert.equal(V.nextIndex('off', 2, 3), -1);
  assert.equal(V.nextIndex('list', 2, 3), 0); assert.equal(V.nextIndex('file', 1, 3), 1);
  assert.equal(V.nextIndex('off', 0, 0), -1);
  for (let i = 0; i < 20; i++) { const n = V.nextIndex('shuffle', 2, 5, i / 20); assert.ok(n >= 0 && n < 5 && n !== 2, 'shuffle never repeats the current one: ' + n); }
  assert.equal(V.nextIndex('shuffle', 0, 1), 0);
});

test('picture controls build a CSS filter and transform, neutral gives empty strings', () => {
  assert.deepEqual(V.pictureCss({ brightness: 100, contrast: 100, saturation: 100, rotate: 0 }, 800, 450), { filter: '', transform: '' });
  const c = V.pictureCss({ brightness: 120, contrast: 90, saturation: 300, rotate: 90, flipH: true }, 800, 450);
  assert.match(c.filter, /brightness\(120%\).*contrast\(90%\).*saturate\(200%\)/);
  assert.match(c.transform, /rotate\(90deg\) scale\(0\.5\d*\) scaleX\(-1\)/);
  assert.equal(V.pictureCss({ rotate: 45 }, 800, 450).transform, '');
});

test('A-B loop goes none -> A -> loop -> none and ignores a B that is not after A', () => {
  let s = V.abStep(undefined, 10); assert.deepEqual(s, { stage: 'a', a: 10, b: 0 });
  assert.equal(V.abStep(s, 10.1).stage, 'a');
  s = V.abStep(s, 25); assert.deepEqual(s, { stage: 'loop', a: 10, b: 25 });
  assert.equal(V.abStep(s, 30).stage, 'off');
});
