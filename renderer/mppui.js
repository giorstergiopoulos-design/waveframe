'use strict';
// Settings card "Import from Media Player Pro" (2.3.0). The data is read by the main process (mpp-import.js, read-only), shown with a count per
// category, and only the ticked categories are merged (mpplib.js) AFTER a backup of the source files and of the Suite's own settings was written.

(function () {
  const M = window.WaveframeMpp;
  const api = window.waveframe;
  const $ = (id) => document.getElementById(id);
  const fmt = (s, vars) => Object.entries(vars || {}).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s);
  const ORDER = [['recent', 'mpp.cat.recent'], ['bookmarks', 'mpp.cat.bookmarks'], ['resume', 'mpp.cat.resume'], ['subtitles', 'mpp.cat.subtitles'], ['audioPresets', 'mpp.cat.audioPresets'], ['audioCurrent', 'mpp.cat.audioCurrent'], ['appearance', 'mpp.cat.appearance'], ['convertDir', 'mpp.cat.convertDir']];
  let scan = null, extraLists = [];

  const status = (s) => { $('mppStatus').textContent = s || ''; };

  function render() {
    const box = $('mppResult'); box.textContent = '';
    if (!scan) return;
    if (!scan.found && !extraLists.length) { status(t('mpp.notFound')); $('mppImport').classList.add('dep-hidden'); return; }
    if (scan.found) {
      const p = document.createElement('p'); p.className = 'hint'; p.textContent = fmt(t('mpp.found'), { dir: scan.dir }); box.append(p);
      for (const [key, label] of ORDER) {
        const n = scan.counts[key]; if (!n && key !== 'subtitles') continue; if (!scan.bundle[key] || (Array.isArray(scan.bundle[key]) && !scan.bundle[key].length)) continue;
        box.append(row(key, t(label), n));
      }
    }
    if (extraLists.length) box.append(row('playlists', t('mpp.cat.playlists'), extraLists.length));
    if (scan.found && scan.notMigrated.length) {
      const h = document.createElement('p'); h.className = 'hint'; h.textContent = t('mpp.notMigrated'); box.append(h);
      const ul = document.createElement('ul'); ul.className = 'mpp-notes';
      for (const n of scan.notMigrated) { const li = document.createElement('li'); const [reason, num] = String(n.reason).split(':'); li.textContent = fmt(t(`mpp.reason.${reason}`), { what: n.what, n: num || '' }); ul.append(li); }
      box.append(ul);
    }
    $('mppImport').classList.remove('dep-hidden');
    status('');
  }
  function row(key, label, n) {
    const r = document.createElement('label'); r.className = 'mpp-row';
    const c = document.createElement('input'); c.type = 'checkbox'; c.checked = true; c.dataset.cat = key;
    const s = document.createElement('span'); s.textContent = label;
    const k = document.createElement('span'); k.className = 'mpp-count'; k.textContent = key === 'subtitles' || key === 'audioCurrent' || key === 'appearance' || key === 'convertDir' ? '' : String(n);
    r.append(c, s, k); return r;
  }

  async function doScan() {
    status(t('mpp.scanning')); extraLists = [];
    scan = await api.mppScan();
    render();
  }
  async function addM3u() {
    const lists = await api.mppPickM3u(); if (!lists.length) return;
    extraLists = extraLists.concat(lists);
    if (!scan) scan = { found: false, bundle: {}, counts: {}, notMigrated: [] };
    render();
  }
  async function doImport() {
    const cats = [...document.querySelectorAll('#mppResult input[data-cat]:checked')].map((c) => c.dataset.cat);
    if (!cats.length) { status(t('mpp.nothingSelected')); return; }
    $('mppImport').disabled = true; status(t('mpp.backingUp'));
    try {
      const snap = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('waveframe.')) snap[k] = localStorage.getItem(k); }
      const bk = await api.mppBackup(snap);
      if (!bk || !bk.ok) { status(t('mpp.backupFailed')); return; }
      const bundle = { ...scan.bundle, playlists: extraLists };
      const r = M.apply(localStorage, bundle, cats, { labels: { currentPreset: t('mpp.presetCurrent'), playlistPrefix: '' }, currentDarkSkin: localStorage.getItem('waveframe.lastDarkSkin') || 'midnight' });
      await api.mppReport({ at: new Date().toISOString(), categories: cats, added: r.added, unchanged: r.unchanged, notMigrated: scan.notMigrated || [] });
      if (r.appearance) { if (r.appearance.skin) applySkin(r.appearance.skin); if (r.appearance.accent) applyAccentColor(r.appearance.accent); }
      window.dispatchEvent(new Event('waveframe:storage-changed'));
      if (typeof renderUserPresets === 'function') renderUserPresets();
      const total = Object.values(r.added).reduce((a, b) => a + b, 0);
      status(fmt(t('mpp.done'), { n: total, dir: bk.dir }));
    } catch (_) { status(t('mpp.failed')); } finally { $('mppImport').disabled = false; }
  }

  $('mppScan').addEventListener('click', doScan);
  $('mppM3u').addEventListener('click', addM3u);
  $('mppImport').addEventListener('click', doImport);
  document.addEventListener('waveframe:language-changed', () => { if (scan) render(); });
})();
