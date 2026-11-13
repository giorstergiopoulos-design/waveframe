'use strict';
// M3U / M3U8 playlist reading for the video tab: only absolute Windows paths and http(s) URLs are kept; relative entries are resolved against the playlist folder.
const fs = require('fs');
const path = require('path');
const MAX_LINES = 5000, MAX_PATH = 2048;

function validRef(p) {
  if (typeof p !== 'string' || !p || p.length > MAX_PATH || /[\0\r\n]/.test(p)) return false;
  if (/^https?:\/\/[^\s]+$/i.test(p)) return true;
  return /^[A-Za-z]:[\\/]/.test(p) || /^\\\\[^\\]+\\[^\\]+/.test(p);
}
const lines = (text, max) => String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, max);
function parseM3u(text, baseDir) {
  const items = []; let skipped = 0;
  for (const l of lines(text, MAX_LINES + 200)) {
    if (l.startsWith('#')) continue;
    let ref = l;
    if (!validRef(ref) && baseDir && !/^[a-z][a-z0-9+.-]*:/i.test(ref) && !ref.startsWith('\\\\')) ref = path.resolve(baseDir, ref);
    if (validRef(ref)) { if (items.length < MAX_LINES) items.push(ref); } else skipped++;
  }
  return { items, skipped };
}
function readM3uFile(file) {
  try {
    if (!path.isAbsolute(file) || !/\.m3u8?$/i.test(file)) return null;
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > 8 * 1024 * 1024) return null;
    const r = parseM3u(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''), path.dirname(file));
    const name = path.basename(file).replace(/\.m3u8?$/i, '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60) || 'Playlist';
    return { name, ...r };
  } catch (_) { return null; }
}
module.exports = { validRef, parseM3u, readM3uFile };
