'use strict';
// Read-only importer for the data of Opsis Media Player Pro (2.3.0). Media Player Pro keeps small text/JSON files in %AppData%\MediaPlayerPro:
//   recent.txt, bookmarks.txt (path|ms), resume.txt (path|ms), settings.json (subtitle options + online-service credentials),
//   audio.json (live equaliser/effects), audio-presets.json (custom presets), skin.txt / mode.txt / accent.txt / ui.txt / side.txt,
//   window.txt (geometry), convert-dir.txt, meta\*.json (online info cache), suite.json (update state).
// NOTHING in that folder is ever written or deleted: files are opened for reading, size-capped, and copied to a backup folder owned by this app.
// The result is a neutral bundle (plain data, no credentials) that the renderer merges into its own storage (renderer/mpplib.js).

const fs = require('fs');
const path = require('path');

const LIMITS = { fileBytes: 1024 * 1024, lines: 5000, recent: 30, resume: 2000, bookmarks: 2000, presets: 100, m3uEntries: 5000, pathLen: 2048 };

function defaultDir(env = process.env) {
  const base = env.APPDATA || '';
  return base ? path.join(base, 'MediaPlayerPro') : '';
}

function readText(dir, name) {
  try {
    const f = path.join(dir, name);
    const st = fs.lstatSync(f);
    if (!st.isFile() || st.size > LIMITS.fileBytes) return st.isFile() ? { tooBig: true } : null; // a link or folder is never followed
    return { text: fs.readFileSync(f, 'utf8').replace(/^﻿/, '') };
  } catch (_) { return null; }
}

// A media reference that can be played by the Suite: an absolute Windows path or an http(s) URL. DVD folders, capture devices and other
// schemes of Media Player Pro have no equivalent here and are reported as not migrated.
function validRef(p) {
  if (typeof p !== 'string' || !p || p.length > LIMITS.pathLen || /[\0\r\n]/.test(p)) return false;
  if (/^https?:\/\/[^\s]+$/i.test(p)) return true;
  return /^[A-Za-z]:[\\/]/.test(p) || /^\\\\[^\\]+\\[^\\]+/.test(p);
}

function lines(text, max) { return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, LIMITS.lines).slice(0, max || LIMITS.lines); }

function parseRecent(text) {
  const out = []; let skipped = 0;
  for (const l of lines(text)) { if (validRef(l)) { if (!out.includes(l)) out.push(l); } else skipped++; }
  return { items: out.slice(0, LIMITS.recent), skipped };
}

// "path|milliseconds" (the path never contains '|' on Windows; URLs may, so the LAST '|' separates the time)
function parsePairs(text, max) {
  const out = []; let skipped = 0;
  for (const l of lines(text)) {
    const i = l.lastIndexOf('|');
    const p = i > 0 ? l.slice(0, i) : '', ms = i > 0 ? Number(l.slice(i + 1)) : NaN;
    if (validRef(p) && Number.isFinite(ms) && ms >= 0 && ms < 1e11) out.push({ path: p, ms: Math.round(ms) }); else skipped++;
  }
  return { items: out.slice(0, max), skipped };
}

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const cleanName = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60);
const hex6 = (n) => '#' + (Math.max(0, Math.min(0xffffff, Math.round(Number(n)))) >>> 0).toString(16).padStart(6, '0');

function parseJson(text) { try { return JSON.parse(text); } catch (_) { return null; } }

// Subtitle / online options. The credentials (OsApiKey, OsUsername, OsPassword) are deliberately NOT copied.
function parseSettings(text) {
  const j = parseJson(text);
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const langs = String(j.Languages || 'el,en').split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z]{2,3}(-[a-z]{2,4})?$/.test(s)).slice(0, 8);
  return {
    settings: {
      languages: langs.length ? langs : ['el', 'en'],
      autoDownload: j.AutoDownload !== false,
      autoSync: j.AutoSync !== false,
      plainName: j.PlainName !== false,
      onlineMeta: j.OnlineMeta !== false,
      fontSize: Math.round(clamp(j.SubFontSize, 8, 64, 16)),
      color: hex6(clamp(j.SubColor, 0, 0xffffff, 0xffffff)),
      networkCachingMs: Math.round(clamp(j.NetworkCachingMs, 0, 60000, 1000)),
      subFolder: validRef(j.SubFolder) && !/^https?:/i.test(j.SubFolder) ? String(j.SubFolder) : '',
    },
    hadCredentials: !!(j.OsApiKey || j.OsUsername || j.OsPassword),
  };
}

function parseFx(o) {
  if (!o || typeof o !== 'object') return null;
  const b = Array.isArray(o.Bands) ? o.Bands.slice(0, 10).map((x) => clamp(x, -12, 12, 0)) : [];
  while (b.length < 10) b.push(0);
  return { name: cleanName(o.Preset) || '', on: o.On !== false, pre: clamp(o.Pre, -12, 12, 0), bands: b, clarity: clamp(o.Clarity, 0, 10, 0), ambience: clamp(o.Ambience, 0, 10, 0), surround: clamp(o.Surround, 0, 10, 0), dynamic: clamp(o.Dynamic, 0, 10, 0), bass: clamp(o.Bass, 0, 10, 0) };
}

function parseAudioPresets(text) {
  const j = parseJson(text);
  if (!j || typeof j !== 'object' || Array.isArray(j)) return [];
  const out = [];
  for (const [k, v] of Object.entries(j).slice(0, LIMITS.presets)) { const fx = parseFx(v); const name = cleanName(k) || (fx && fx.name); if (fx && name) out.push({ ...fx, name }); }
  return out;
}

function parseAppearance(f) {
  const one = (n) => (f[n] && f[n].text != null ? f[n].text.trim() : '');
  const mode = one('mode.txt'), ui = one('ui.txt'), side = one('side.txt'), accent = one('accent.txt'), skin = cleanName(one('skin.txt'));
  const a = {};
  if (mode === 'dark' || mode === 'light') a.mode = mode;
  if (ui === 'classic' || ui === 'wave') a.ui = ui;
  if (side === 'hide' || side === 'show') a.sidePanel = side;
  if (/^#[0-9a-fA-F]{6}$/.test(accent)) a.accent = accent.toLowerCase();
  if (skin) a.skin = skin;
  return Object.keys(a).length ? a : null;
}

const NAMES = ['recent.txt', 'bookmarks.txt', 'resume.txt', 'settings.json', 'audio.json', 'audio-presets.json', 'skin.txt', 'mode.txt', 'accent.txt', 'ui.txt', 'side.txt', 'convert-dir.txt', 'window.txt'];

// Reads the folder and builds the neutral bundle + the list of what cannot be carried over.
function scan(dir) {
  const res = { found: false, dir: dir || '', bundle: {}, counts: {}, notMigrated: [] };
  let st; try { st = fs.statSync(dir); } catch (_) { return res; }
  if (!st.isDirectory()) return res;
  const f = {}; for (const n of NAMES) f[n] = readText(dir, n);
  const present = NAMES.filter((n) => f[n]);
  if (!present.length) return res;
  res.found = true;
  const skip = (what, reason) => res.notMigrated.push({ what, reason });
  for (const n of present) if (f[n].tooBig) skip(n, 'tooBig');

  const b = res.bundle;
  if (f['recent.txt'] && f['recent.txt'].text != null) { const r = parseRecent(f['recent.txt'].text); b.recent = r.items; if (r.skipped) skip('recent.txt', 'unsupportedItems:' + r.skipped); }
  if (f['bookmarks.txt'] && f['bookmarks.txt'].text != null) { const r = parsePairs(f['bookmarks.txt'].text, LIMITS.bookmarks); b.bookmarks = r.items; if (r.skipped) skip('bookmarks.txt', 'unsupportedItems:' + r.skipped); }
  if (f['resume.txt'] && f['resume.txt'].text != null) { const r = parsePairs(f['resume.txt'].text, LIMITS.resume); b.resume = r.items; if (r.skipped) skip('resume.txt', 'unsupportedItems:' + r.skipped); }
  if (f['settings.json'] && f['settings.json'].text != null) {
    const s = parseSettings(f['settings.json'].text);
    if (s) { b.subtitles = s.settings; if (s.hadCredentials) skip('settings.json', 'credentials'); } else skip('settings.json', 'unreadable');
  }
  if (f['audio.json'] && f['audio.json'].text != null) { const fx = parseFx(parseJson(f['audio.json'].text)); if (fx) b.audioCurrent = fx; else skip('audio.json', 'unreadable'); }
  b.audioPresets = f['audio-presets.json'] && f['audio-presets.json'].text != null ? parseAudioPresets(f['audio-presets.json'].text) : [];
  const ap = parseAppearance(f); if (ap) b.appearance = ap;
  if (f['convert-dir.txt'] && f['convert-dir.txt'].text != null) { const d = f['convert-dir.txt'].text.trim(); if (validRef(d) && !/^https?:/i.test(d)) b.convertDir = d; else skip('convert-dir.txt', 'unsupportedItems:1'); }
  if (f['window.txt']) skip('window.txt', 'geometry');
  try { if (fs.existsSync(path.join(dir, 'meta'))) skip('meta', 'cache'); } catch (_) { /* ignore */ }
  try { if (fs.existsSync(path.join(dir, 'suite.json'))) skip('suite.json', 'updateState'); } catch (_) { /* ignore */ }

  for (const k of ['recent', 'bookmarks', 'resume', 'audioPresets']) if (b[k]) res.counts[k] = b[k].length;
  for (const k of ['subtitles', 'audioCurrent', 'appearance', 'convertDir']) if (b[k]) res.counts[k] = 1;
  return res;
}

// Playlist files (.m3u / .m3u8) the user saved from Media Player Pro anywhere on disk. Only absolute paths / http(s) URLs are kept.
function parseM3u(text, baseDir) {
  const items = []; let skipped = 0;
  for (const l of lines(text, LIMITS.m3uEntries + 200)) {
    if (l.startsWith('#')) continue;
    let ref = l;
    if (!validRef(ref) && baseDir && !/^[a-z][a-z0-9+.-]*:/i.test(ref) && !ref.startsWith('\\\\')) ref = path.resolve(baseDir, ref); // relative entry
    if (validRef(ref)) { if (items.length < LIMITS.m3uEntries) items.push(ref); } else skipped++;
  }
  return { items, skipped };
}

function readM3uFile(file) {
  try {
    if (!path.isAbsolute(file) || !/\.m3u8?$/i.test(file)) return null;
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > 8 * 1024 * 1024) return null;
    const r = parseM3u(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''), path.dirname(file));
    return { name: cleanName(path.basename(file).replace(/\.m3u8?$/i, '')) || 'Playlist', ...r };
  } catch (_) { return null; }
}

// Copies the small files of the source folder (never the meta cache, never anything back) plus a snapshot of the Suite's own settings into a
// new folder inside the app's data directory, and returns its path. Nothing is written into the source.
function backup(srcDir, destRoot, snapshot, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(destRoot, 'mpp-import-' + stamp);
  fs.mkdirSync(path.join(dest, 'source'), { recursive: true });
  const copied = [];
  if (srcDir) for (const n of [...NAMES, 'suite.json']) {
    try { const st = fs.lstatSync(path.join(srcDir, n)); if (st.isFile() && st.size <= LIMITS.fileBytes) { fs.copyFileSync(path.join(srcDir, n), path.join(dest, 'source', n)); copied.push(n); } } catch (_) { /* not there */ }
  }
  fs.writeFileSync(path.join(dest, 'waveframe-before.json'), JSON.stringify(snapshot || {}, null, 2), 'utf8');
  return { dir: dest, copied };
}

function writeReport(dir, report) {
  try { fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report || {}, null, 2), 'utf8'); return true; } catch (_) { return false; }
}

module.exports = { LIMITS, NAMES, defaultDir, validRef, parseRecent, parsePairs, parseSettings, parseFx, parseAudioPresets, parseAppearance, parseM3u, readM3uFile, scan, backup, writeReport };
