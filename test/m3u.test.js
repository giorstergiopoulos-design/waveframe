'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const M = require('../m3u.js');

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
