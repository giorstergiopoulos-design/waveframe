'use strict';
// Video player helpers (2.3.0): subtitle conversion to WebVTT (the browser shows it natively, with a delay), resume / recent / bookmark rules,
// file-kind detection and the wfmedia: URL. Pure functions, unit-tested in Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WaveframeVp = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const VIDEO = ['mp4', 'm4v', 'mkv', 'webm', 'mov', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'm2ts', 'ogv', '3gp'];
  const AUDIO = ['mp3', 'wav', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'wma', 'aiff', 'aif'];
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 4];
  const LIMITS = { recent: 30, playlist: 2000, bookmarks: 2000, resume: 2000, cues: 20000 };

  const extOf = (p) => { const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(p || '')); return m ? m[1].toLowerCase() : ''; };
  const kindOf = (p) => (VIDEO.includes(extOf(p)) ? 'video' : AUDIO.includes(extOf(p)) ? 'audio' : /^https?:\/\//i.test(String(p || '')) ? 'video' : '');
  const titleOf = (p) => { const s = String(p || ''); const n = s.split(/[\\/]/).pop().replace(/\?.*$/, ''); return n.replace(/\.[A-Za-z0-9]{1,5}$/, '') || s; };
  const isUrl = (p) => /^https?:\/\//i.test(String(p || ''));

  // Local files are played through the read-only wfmedia: protocol of the main process (range requests, no whole-file blob); URLs play directly.
  function mediaUrl(p) { return isUrl(p) ? String(p) : 'wfmedia://f/' + encodeURIComponent(String(p)); }

  function clock(ms) {
    const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(r).padStart(2, '0');
  }

  const TS = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
  function toMs(h, m, s, f) { return ((+h * 60 + +m) * 60 + +s) * 1000 + +String(f).padEnd(3, '0'); }
  function vttTime(ms) {
    ms = Math.max(0, Math.round(ms));
    const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, f = ms % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(3, '0')}`;
  }
  const cleanText = (t) => t.replace(/\{\\[^}]*\}/g, '').replace(/\\N/g, '\n').replace(/\\n/g, '\n').replace(/\0/g, '').trim();

  // SubRip (.srt) or WebVTT text -> WebVTT text, every cue moved by shiftMs (negative = earlier). Cues that would start before 0 are clamped.
  function srtToVtt(text, shiftMs) {
    const shift = Number(shiftMs) || 0;
    const src = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/^WEBVTT[^\n]*\n/, '');
    const out = ['WEBVTT', ''];
    let cues = 0;
    for (const block of src.split(/\n{2,}/)) {
      const lines = block.split('\n').filter((l, i, a) => !(i === 0 && /^\d+$/.test(l.trim()) && a.length > 1 && /-->/.test(a[1])));
      const k = lines.findIndex((l) => l.includes('-->'));
      if (k < 0) continue;
      const parts = lines[k].split('-->');
      const a = TS.exec(parts[0]) || /(\d{1,2}):(\d{2})[,.](\d{1,3})/.exec(parts[0]) && (() => { const q = /(\d{1,2}):(\d{2})[,.](\d{1,3})/.exec(parts[0]); return [0, 0, q[1], q[2], q[3]]; })();
      const b = TS.exec(parts[1] || '') || /(\d{1,2}):(\d{2})[,.](\d{1,3})/.exec(parts[1] || '') && (() => { const q = /(\d{1,2}):(\d{2})[,.](\d{1,3})/.exec(parts[1]); return [0, 0, q[1], q[2], q[3]]; })();
      if (!a || !b) continue;
      const s = toMs(a[1], a[2], a[3], a[4]) + shift, e = toMs(b[1], b[2], b[3], b[4]) + shift;
      if (e <= 0 || e <= s) continue;
      const body = cleanText(lines.slice(k + 1).join('\n'));
      if (!body) continue;
      out.push(`${vttTime(s)} --> ${vttTime(e)}`, body, '');
      if (++cues >= LIMITS.cues) break;
    }
    return { vtt: out.join('\n'), cues };
  }

  // Advanced SubStation (.ass / .ssa): dialogue lines only, styling is dropped.
  function assToSrt(text) {
    const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
    let fmt = null, inEvents = false; const out = []; let n = 0;
    const t = (v) => { const m = /(\d+):(\d{2}):(\d{2})[.](\d{1,2})/.exec(v); return m ? `${String(m[1]).padStart(2, '0')}:${m[2]}:${m[3]},${String(m[4]).padEnd(3, '0')}` : null; };
    for (const l of lines) {
      if (/^\[events\]/i.test(l)) { inEvents = true; continue; }
      if (/^\[/.test(l)) inEvents = false;
      if (!inEvents) continue;
      if (/^format:/i.test(l)) { fmt = l.slice(7).split(',').map((x) => x.trim().toLowerCase()); continue; }
      if (!/^dialogue:/i.test(l) || !fmt) continue;
      const cols = l.slice(9).split(','), iS = fmt.indexOf('start'), iE = fmt.indexOf('end'), iT = fmt.indexOf('text');
      if (iS < 0 || iE < 0 || iT < 0) continue;
      const a = t(cols[iS]), b = t(cols[iE]), body = cleanText(cols.slice(iT).join(','));
      if (a && b && body) out.push(`${++n}\n${a} --> ${b}\n${body}\n`);
      if (n >= LIMITS.cues) break;
    }
    return out.join('\n');
  }

  function subtitleToVtt(text, ext, shiftMs) {
    const e = String(ext || '').toLowerCase();
    return srtToVtt(e === 'ass' || e === 'ssa' ? assToSrt(text) : text, shiftMs);
  }

  // Resume position: remembered after the first 5 s, forgotten when the end is near (last 10 s or 95 %).
  function resumeAction(posMs, durMs) {
    if (!(durMs > 0)) return 'keep';
    if (posMs < 5000) return 'clear';
    if (durMs - posMs < 10000 || posMs / durMs > 0.95) return 'clear';
    return 'save';
  }

  function pushRecent(list, p, max) {
    const l = (Array.isArray(list) ? list : []).filter((x) => x !== p);
    l.unshift(p);
    return l.slice(0, max || LIMITS.recent);
  }
  function addBookmark(list, p, ms) {
    const l = Array.isArray(list) ? list.slice() : [];
    const t = Math.round(ms);
    if (!l.some((b) => b.path === p && Math.abs(b.ms - t) < 1000)) l.push({ path: p, ms: t });
    return l.slice(-LIMITS.bookmarks);
  }
  function sortedBookmarks(list, p) { return (Array.isArray(list) ? list : []).filter((b) => b.path === p).sort((a, b) => a.ms - b.ms); }
  function limitResume(map) {
    const e = Object.entries(map || {});
    return Object.fromEntries(e.slice(Math.max(0, e.length - LIMITS.resume)));
  }
  // A path from storage is only offered for playback when it looks like something the main process would serve.
  const playable = (p) => typeof p === 'string' && (isUrl(p) || (/^[A-Za-z]:[\\/]/.test(p) && kindOf(p) !== '')) && p.length < 2048;

  // What plays after the current item. mode: off | list | file | shuffle. rnd: a number in [0,1) (injected for tests).
  function nextIndex(mode, idx, len, rnd) {
    if (len <= 0) return -1;
    if (mode === 'file') return idx;
    if (mode === 'shuffle') { if (len === 1) return 0; let k = Math.floor((rnd == null ? Math.random() : rnd) * (len - 1)); if (k >= idx) k++; return Math.min(k, len - 1); }
    if (idx < len - 1) return idx + 1;
    return mode === 'list' ? 0 : -1;
  }
  // Picture controls: values are percentages (100 = unchanged); rotate in degrees; flips are booleans. Returns the CSS filter / transform strings.
  function pictureCss(p, boxW, boxH) {
    const c = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Number(v) : 100));
    const filter = (c(p.brightness, 50, 150) === 100 && c(p.contrast, 50, 150) === 100 && c(p.saturation, 0, 200) === 100) ? ''
      : `brightness(${c(p.brightness, 50, 150)}%) contrast(${c(p.contrast, 50, 150)}%) saturate(${c(p.saturation, 0, 200)}%)`;
    const rot = [0, 90, 180, 270].includes(Number(p.rotate)) ? Number(p.rotate) : 0;
    const k = rot === 90 || rot === 270 ? (boxW > 0 && boxH > 0 ? Math.min(boxW / boxH, boxH / boxW) : 0.56) : 1;
    const parts = [];
    if (rot) parts.push(`rotate(${rot}deg)`);
    if (k !== 1) parts.push(`scale(${Math.round(k * 1000) / 1000})`);
    if (p.flipH) parts.push('scaleX(-1)');
    if (p.flipV) parts.push('scaleY(-1)');
    return { filter, transform: parts.join(' ') };
  }
  // A-B loop state machine: none -> A set -> loop A..B -> none.
  function abStep(state, nowSec) {
    if (!state || state.stage === 'off') return { stage: 'a', a: nowSec, b: 0 };
    if (state.stage === 'a') return nowSec > state.a + 0.2 ? { stage: 'loop', a: state.a, b: nowSec } : state;
    return { stage: 'off', a: 0, b: 0 };
  }

  return { nextIndex, pictureCss, abStep, VIDEO, AUDIO, SPEEDS, LIMITS, extOf, kindOf, titleOf, isUrl, mediaUrl, clock, vttTime, srtToVtt, assToSrt, subtitleToVtt, resumeAction, pushRecent, addBookmark, sortedBookmarks, limitResume, playable };
});
