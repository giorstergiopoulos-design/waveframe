'use strict';
// Merges the neutral bundle read by mpp-import.js (Opsis Media Player Pro data) into the Suite's own storage. Pure logic over a storage-like object
// ({ getItem, setItem }), so it is unit-tested without a browser. Rules: only adds, never removes; runs twice give the same result (idempotent);
// what the user already has locally wins over imported values (resume positions), nothing from the source is ever touched.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WaveframeMpp = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SUITE_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const MPP_FREQS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
  const KEYS = {
    recent: 'waveframe.video.recent', resume: 'waveframe.video.resume', bookmarks: 'waveframe.video.bookmarks', subs: 'waveframe.video.subs',
    playlists: 'waveframe.video.playlists', presets: 'waveframe.userPresets', accent: 'waveframe.accentColor', skin: 'waveframe.skin',
    destMode: 'waveframe.vidDestMode', destFolder: 'waveframe.vidDestFolder', record: 'waveframe.mppImport',
  };
  const CATEGORIES = ['recent', 'bookmarks', 'resume', 'playlists', 'subtitles', 'audioPresets', 'audioCurrent', 'appearance', 'convertDir'];

  const read = (s, k, d) => { try { const v = s.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } };
  const write = (s, k, v) => s.setItem(k, JSON.stringify(v));
  const round1 = (x) => Math.round(x * 10) / 10;

  // The ten bands of Media Player Pro sit at other frequencies than the Suite's equaliser: the gain curve is interpolated (log frequency).
  function bandsToSuite(mpp) {
    const g = (Array.isArray(mpp) ? mpp : []).slice(0, 10); while (g.length < 10) g.push(0);
    return SUITE_FREQS.map((f) => {
      if (f <= MPP_FREQS[0]) return round1(g[0]);
      if (f >= MPP_FREQS[9]) return round1(g[9]);
      let i = 0; while (MPP_FREQS[i + 1] < f) i++;
      const t = (Math.log(f) - Math.log(MPP_FREQS[i])) / (Math.log(MPP_FREQS[i + 1]) - Math.log(MPP_FREQS[i]));
      return Math.max(-12, Math.min(12, round1(g[i] + (g[i + 1] - g[i]) * t)));
    });
  }

  function fxToPreset(fx, name) {
    return { name, bands: bandsToSuite(fx.bands), bassBoost: Math.min(12, Math.round(fx.bass * 1.2 * 2) / 2) };
  }

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // categories: array of names to import (default = all present in the bundle). Returns { added, unchanged, appearance, record }.
  function apply(store, bundle, categories, opts) {
    const o = opts || {};
    const labels = o.labels || { currentPreset: 'Media Player Pro', playlistPrefix: '' };
    const want = new Set(categories || CATEGORIES);
    const added = {}, unchanged = {};
    const count = (cat, a, u) => { added[cat] = a; unchanged[cat] = u; };
    const b = bundle || {};
    let appearance = null;

    if (want.has('recent') && Array.isArray(b.recent)) {
      const cur = read(store, KEYS.recent, []); const out = cur.slice(); let a = 0;
      for (const p of b.recent) if (!out.includes(p)) { out.push(p); a++; }
      write(store, KEYS.recent, out.slice(0, 30)); count('recent', Math.min(a, Math.max(0, 30 - cur.length)), b.recent.length - a);
    }
    if (want.has('bookmarks') && Array.isArray(b.bookmarks)) {
      const cur = read(store, KEYS.bookmarks, []); let a = 0;
      for (const m of b.bookmarks) if (!cur.some((x) => x.path === m.path && x.ms === m.ms)) { cur.push({ path: m.path, ms: m.ms }); a++; }
      write(store, KEYS.bookmarks, cur); count('bookmarks', a, b.bookmarks.length - a);
    }
    if (want.has('resume') && Array.isArray(b.resume)) {
      const cur = read(store, KEYS.resume, {}); let a = 0;
      for (const m of b.resume) if (!(m.path in cur)) { cur[m.path] = m.ms; a++; }
      write(store, KEYS.resume, cur); count('resume', a, b.resume.length - a);
    }
    if (want.has('playlists') && Array.isArray(b.playlists)) {
      const cur = read(store, KEYS.playlists, {}); let a = 0;
      for (const p of b.playlists) {
        const name = (labels.playlistPrefix || '') + p.name;
        if (!(name in cur) || !same(cur[name], p.items)) { cur[name] = p.items.slice(0, 5000); a++; }
      }
      write(store, KEYS.playlists, cur); count('playlists', a, b.playlists.length - a);
    }
    if (want.has('subtitles') && b.subtitles) {
      const cur = read(store, KEYS.subs, null);
      if (same(cur, b.subtitles)) count('subtitles', 0, 1); else { write(store, KEYS.subs, b.subtitles); count('subtitles', 1, 0); }
    }
    const presetsIn = [];
    if (want.has('audioPresets') && Array.isArray(b.audioPresets)) for (const p of b.audioPresets) presetsIn.push(fxToPreset(p, p.name));
    if (want.has('audioCurrent') && b.audioCurrent) presetsIn.push(fxToPreset(b.audioCurrent, labels.currentPreset));
    if (presetsIn.length || want.has('audioPresets') || want.has('audioCurrent')) {
      const cur = read(store, KEYS.presets, []); let a = 0;
      for (const p of presetsIn) { const i = cur.findIndex((x) => x.name === p.name); if (i < 0) { cur.push(p); a++; } else if (!same(cur[i].bands, p.bands)) { cur[i] = { ...cur[i], ...p }; a++; } }
      if (presetsIn.length) write(store, KEYS.presets, cur);
      const total = presetsIn.length; count('audio', a, total - a);
    }
    if (want.has('appearance') && b.appearance) {
      const ap = b.appearance; let a = 0; appearance = {};
      if (ap.mode) { const sk = ap.mode === 'light' ? 'light' : (o.currentDarkSkin || 'midnight'); if (store.getItem(KEYS.skin) !== sk) { store.setItem(KEYS.skin, sk); a++; } appearance.skin = sk; }
      if (ap.accent) { if (store.getItem(KEYS.accent) !== ap.accent) { store.setItem(KEYS.accent, ap.accent); a++; } appearance.accent = ap.accent; }
      count('appearance', a, (ap.mode ? 1 : 0) + (ap.accent ? 1 : 0) - a);
    }
    if (want.has('convertDir') && b.convertDir) {
      if (store.getItem(KEYS.destFolder) === b.convertDir) count('convertDir', 0, 1); else { store.setItem(KEYS.destFolder, b.convertDir); store.setItem(KEYS.destMode, 'custom'); count('convertDir', 1, 0); }
    }
    const rec = read(store, KEYS.record, { runs: 0 });
    const record = { runs: (rec.runs || 0) + 1, at: o.now || new Date().toISOString(), added };
    write(store, KEYS.record, record);
    return { added, unchanged, appearance, record };
  }

  return { SUITE_FREQS, MPP_FREQS, KEYS, CATEGORIES, bandsToSuite, fxToPreset, apply };
});
