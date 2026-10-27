'use strict';
// Main-process glue for the welcome guide, the "Opsis family" showcase and the new-version balloon.
// All network access (catalogue, releases, installer download) happens here; the windows never fetch anything themselves.
// Pure logic and its unit tests: suite.js / test/suite.test.js.

const { app, BrowserWindow, ipcMain, dialog, shell, Notification, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const S = require('./suite.js');

const DAY = 24 * 3600 * 1000;
const MSG = {
  el: {
    balloonTitle: (v) => `Waveframe ${v} είναι διαθέσιμο`,
    balloonBody: 'Πάτησε για να δεις τι νέο υπάρχει.',
    dlTitle: 'Λήψη εγκαταστάτη',
    dlDetail: (n, mb, host, sha) => `Αρχείο: ${n}\nΜέγεθος: ${mb} MB\nΠηγή: ${host} (GitHub)\nSHA-256: ${sha}…\n\nΤο αρχείο θα αποθηκευτεί στις Λήψεις και θα ελεγχθεί με το SHA-256. Δεν θα εκτελεστεί αυτόματα.`,
    dlGo: 'Λήψη', dlPage: 'Σελίδα έκδοσης', dlCancel: 'Άκυρο',
    dlBad: 'Η λήψη ακυρώθηκε: το αρχείο δεν ταιριάζει με το αναμενόμενο SHA-256 ή μέγεθος και διαγράφηκε.',
    dlFail: 'Η λήψη απέτυχε. Δοκίμασε ξανά αργότερα.',
  },
  en: {
    balloonTitle: (v) => `Waveframe ${v} is available`,
    balloonBody: 'Click to see what\'s new.',
    dlTitle: 'Download installer',
    dlDetail: (n, mb, host, sha) => `File: ${n}\nSize: ${mb} MB\nSource: ${host} (GitHub)\nSHA-256: ${sha}…\n\nThe file is saved to Downloads and verified with its SHA-256. It is never run automatically.`,
    dlGo: 'Download', dlPage: 'Release page', dlCancel: 'Cancel',
    dlBad: 'Download cancelled: the file did not match the expected SHA-256 or size and was deleted.',
    dlFail: 'The download failed. Try again later.',
  },
};

function init({ getMainWin, getTheme, isMini, isTrusted }) {
  const userData = () => app.getPath('userData');
  const store = S.createStore(path.join(userData(), 'suite-state.json'), S.STATE_DEFAULTS, S.sanitizeState);
  let lang = 'el';
  const m = () => MSG[lang] || MSG.en;

  /* ---------- catalogue: embedded fallback + daily cached refresh ---------- */
  const CAT_CACHE = () => path.join(userData(), 'suite-catalogue.json');
  function embeddedCatalogue() {
    return S.validateCatalogue(fs.readFileSync(path.join(__dirname, 'suite-apps.json'), 'utf8'));
  }
  function loadCatalogue() {
    try {
      const c = JSON.parse(fs.readFileSync(CAT_CACHE(), 'utf8'));
      const v = S.validateCatalogue(String(c.raw || ''));
      if (v.ok) return { ...v, source: 'cache', at: Number(c.at) || 0 };
    } catch (_) { /* no cache yet */ }
    return { ...embeddedCatalogue(), source: 'embedded', at: 0 };
  }
  async function refreshCatalogue() {
    const cur = loadCatalogue();
    if (Date.now() - cur.at < DAY) return;
    try {
      const r = await S.httpGet(S.CATALOGUE_URL, { timeout: 5000, maxBytes: S.CATALOGUE_MAX_BYTES, hostOpts: { hosts: S.API_HOSTS } });
      const raw = r.body.toString('utf8');
      if (S.validateCatalogue(raw).ok) fs.writeFileSync(CAT_CACHE(), JSON.stringify({ at: Date.now(), raw }));
    } catch (_) { /* silently keep the previous copy */ }
  }

  /* ---------- releases (ETag, conditional) ---------- */
  async function getRelease(repo, maxAgeMs = 0) {
    const st = store.get();
    const cached = st.releases[repo];
    if (cached && cached.release && maxAgeMs && Date.now() - cached.at < maxAgeMs) return cached.release;
    try {
      const headers = cached && cached.etag && cached.release ? { 'If-None-Match': cached.etag } : {};
      const r = await S.httpGet(`https://api.github.com/repos/${S.OWNER}/${repo}/releases/latest`, { timeout: 8000, headers, hostOpts: { hosts: S.API_HOSTS } });
      let release;
      if (r.status === 304 && cached) release = cached.release;
      else release = S.trimRelease(JSON.parse(r.body.toString('utf8')), repo);
      const releases = { ...st.releases, [repo]: { at: Date.now(), etag: String(r.headers.etag || ''), release } };
      store.set({ releases });
      return release;
    } catch (_) {
      return cached ? cached.release : null;
    }
  }

  /* ---------- new-version balloon ---------- */
  let balloon = null;
  function showBalloon(rel) {
    if (!Notification.isSupported()) return false;
    balloon = new Notification({ title: m().balloonTitle(`v${rel.version}`), body: m().balloonBody });
    balloon.on('click', () => { if (S.isRepoPageUrl(rel.url, S.SELF_REPO)) shell.openExternal(rel.url); });
    balloon.show();
    return true;
  }
  async function checkForUpdate({ manual }) {
    const rel = await getRelease(S.SELF_REPO);
    store.set({ lastCheck: Date.now() });
    if (!rel) return { status: 'error' };
    if (!S.isNewer(rel.tag, app.getVersion())) return { status: 'current', version: rel.version };
    if (manual || S.shouldNotify(store.get(), rel.tag, app.getVersion())) {
      if (showBalloon(rel)) store.set({ notifiedVersion: rel.version });
    }
    return { status: 'newer', version: rel.version, url: rel.url };
  }
  function scheduleUpdateChecks() {
    const run = () => { if (store.get().notifyEnabled) checkForUpdate({ manual: false }).catch(() => {}); };
    setTimeout(run, 30000).unref();
    setInterval(run, DAY).unref();
  }

  /* ---------- splash windows ---------- */
  let splash = null, splashKind = '', chainFamily = false;
  const reducedMotion = () => { try { return !!systemPreferences.getAnimationSettings().prefersReducedMotion; } catch (_) { return false; } };

  async function brandRect(main) {
    try {
      return await main.webContents.executeJavaScript('(()=>{const e=document.getElementById("brandIcon");if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()');
    } catch (_) { return null; }
  }

  async function openSplash(kind, { auto = false } = {}) {
    const main = getMainWin();
    if (!main || main.isDestroyed() || isMini()) return false;
    if (splash && !splash.isDestroyed()) { splash.focus(); return true; }
    splashKind = kind;
    chainFamily = auto && kind === 'welcome' && !store.get().familyOffered;
    if (kind === 'welcome') store.set({ welcomeSeen: S.majorMinor(app.getVersion()) });
    if (kind === 'family') store.set({ familyOffered: true });
    const win = new BrowserWindow({
      ...main.getContentBounds(), parent: main, show: false, frame: false, transparent: true, hasShadow: false,
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
      backgroundColor: '#00000000', title: 'Waveframe',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'splash-preload.js') },
    });
    splash = win;
    win.removeMenu();
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    const follow = () => { if (!win.isDestroyed() && !main.isDestroyed()) win.setBounds(main.getContentBounds()); };
    for (const ev of ['move', 'resize', 'maximize', 'unmaximize', 'restore']) main.on(ev, follow);
    win.on('closed', () => {
      for (const ev of ['move', 'resize', 'maximize', 'unmaximize', 'restore']) main.removeListener(ev, follow);
      if (splash === win) splash = null;
    });
    win.once('ready-to-show', () => { win.show(); win.focus(); });
    const q = new URLSearchParams({ kind, theme: getTheme() });
    win.loadFile(path.join(__dirname, 'renderer', 'splash.html'), { search: q.toString() });
    return true;
  }

  const fromSplash = (e) => !!splash && !splash.isDestroyed() && e.sender === splash.webContents;

  ipcMain.handle('splash:init', async (e) => {
    if (!fromSplash(e)) return null;
    const main = getMainWin();
    return {
      kind: splashKind, lang, version: app.getVersion(), reducedMotion: reducedMotion(),
      slow: Number(process.env.WAVEFRAME_SPLASH_SLOW) || 1,
      target: main ? await brandRect(main) : null,
      dontShow: store.get().welcomeOptOut,
    };
  });

  ipcMain.handle('splash:close', async (e, opts) => {
    if (!fromSplash(e)) return null;
    if (splashKind === 'welcome') store.set({ welcomeOptOut: !!(opts && opts.dontShow) });
    const main = getMainWin();
    const win = splash;
    setTimeout(() => { if (win && !win.isDestroyed() && splash === win) finishSplash(); }, 2500 + 500 * (Number(process.env.WAVEFRAME_SPLASH_SLOW) || 1)); // fail-safe if the page never reports back
    return { target: main ? await brandRect(main) : null };
  });

  function finishSplash() {
    const kind = splashKind, chain = chainFamily;
    splash.destroy();
    const main = getMainWin();
    if (main && !main.isDestroyed()) main.webContents.executeJavaScript('(()=>{const e=document.getElementById("brandIcon");if(e){e.classList.remove("brand-pop");void e.offsetWidth;e.classList.add("brand-pop");}})()').catch(() => {});
    if (kind === 'welcome' && chain) setTimeout(() => openSplash('family'), 250);
  }
  ipcMain.on('splash:done', (e) => { if (fromSplash(e)) finishSplash(); });

  /* ---------- family showcase data ---------- */
  function readUninstallEntries() {
    const keys = [
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    ];
    return Promise.all(keys.map((k) => new Promise((resolve) => {
      execFile('reg', ['query', k, '/s'], { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 8000 }, (err, out) => resolve(err ? [] : S.parseUninstallOutput(out)));
    }))).then((all) => all.flat());
  }
  const pick = (obj, l) => (obj && (obj[l] || obj.en)) || (Array.isArray(obj) ? obj : undefined);

  let installedVersions = {};
  ipcMain.handle('suite:catalogue', async (e) => {
    if (!fromSplash(e)) return null;
    refreshCatalogue(); // background: used by the next opening
    const cat = loadCatalogue();
    const entries = await readUninstallEntries();
    const apps = cat.apps.map((a) => {
      const inst = S.findInstalled(a, { entries, exists: (p) => fs.existsSync(p), env: process.env });
      const self = a.id === 'waveframe';
      return {
        id: a.id, name: a.name, self,
        tagline: pick(a.tagline, lang) || '',
        bullets: pick(a.capabilities, lang) || [],
        installed: self ? true : inst.installed, version: self ? app.getVersion() : inst.version,
        canOpen: !self && !!inst.exePath,
      };
    });
    installedVersions = Object.fromEntries(apps.filter((x) => x.installed && x.version).map((x) => [x.id, x.version]));
    apps.sort((a, b) => (b.self - a.self));
    return { apps, source: cat.source };
  });

  ipcMain.handle('suite:releases', async (e) => {
    if (!fromSplash(e)) return null;
    const cat = loadCatalogue();
    const out = {};
    await Promise.all(cat.apps.map(async (a) => {
      const rel = await getRelease(a.repo, 3600 * 1000);
      if (rel) out[a.id] = { version: rel.version, update: !!installedVersions[a.id] && S.isNewer(rel.version, installedVersions[a.id]) };
    }));
    return out;
  });

  let downloading = false;
  ipcMain.handle('suite:action', async (e, req) => {
    if (!fromSplash(e) || !req || typeof req.id !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(req.id)) return { status: 'error' };
    const a = loadCatalogue().apps.find((x) => x.id === req.id);
    if (!a) return { status: 'error' };
    const repoUrl = `https://github.com/${S.OWNER}/${a.repo}`;
    if (req.action === 'details') { shell.openExternal(repoUrl); return { status: 'page' }; }
    if (req.action === 'open') {
      const inst = S.findInstalled(a, { entries: [], exists: (p) => fs.existsSync(p), env: process.env });
      if (!inst.exePath) return { status: 'error' };
      const err = await shell.openPath(inst.exePath);
      return { status: err ? 'error' : 'opened' };
    }
    if (req.action !== 'install') return { status: 'error' };
    if (downloading) return { status: 'busy' };

    const rel = await getRelease(a.repo, 3600 * 1000);
    const page = () => { shell.openExternal(rel ? rel.url : `${repoUrl}/releases`); return { status: 'page' }; };
    if (!rel) return page();
    const asset = S.pickInstaller(rel, a);
    if (!asset || !/\.exe$/i.test(asset.name)) return page();
    let sha = S.digestSha256(asset);
    if (!sha && a.checksumAsset) {
      const ck = rel.assets.find((x) => x.name === a.checksumAsset);
      if (ck) { try { sha = S.parseChecksumText((await S.httpGet(ck.url, { timeout: 8000, maxBytes: 4096 })).body.toString('utf8'), asset.name); } catch (_) { /* falls through to the page */ } }
    }
    if (!sha) return page();

    const safeName = path.basename(asset.name).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    const mb = (asset.size / 1048576).toFixed(1);
    const choice = await dialog.showMessageBox(splash && !splash.isDestroyed() ? splash : getMainWin(), {
      type: 'question', title: 'Waveframe', message: m().dlTitle, detail: m().dlDetail(safeName, mb, new URL(asset.url).hostname, sha.slice(0, 16)),
      buttons: [m().dlGo, m().dlPage, m().dlCancel], defaultId: 0, cancelId: 2, noLink: true,
    });
    if (choice.response === 1) return page();
    if (choice.response !== 0) return { status: 'cancelled' };

    let dest = path.join(app.getPath('downloads'), safeName);
    for (let n = 1; fs.existsSync(dest); n++) dest = path.join(app.getPath('downloads'), safeName.replace(/(\.exe)$/i, ` (${n})$1`));
    downloading = true;
    try {
      let last = -1;
      await S.downloadVerified(asset.url, dest, {
        expectedSha256: sha, expectedSize: asset.size,
        onProgress: (p) => { const n = Math.floor(p * 100); if (n !== last && splash && !splash.isDestroyed()) { last = n; splash.webContents.send('suite:progress', { id: a.id, pct: n }); } },
      });
      shell.showItemInFolder(dest);
      return { status: 'downloaded', path: dest };
    } catch (err) {
      const bad = err && (err.code === 'sha-mismatch' || err.code === 'size-mismatch');
      dialog.showMessageBox(splash && !splash.isDestroyed() ? splash : getMainWin(), { type: bad ? 'error' : 'warning', title: 'Waveframe', message: bad ? m().dlBad : m().dlFail, buttons: ['OK'] });
      return { status: 'failed', code: err && err.code };
    } finally { downloading = false; }
  });

  /* ---------- main window / help window entry points ---------- */
  ipcMain.on('suite:open', (e, kind) => {
    if (!isTrusted(e.sender)) return;
    if (kind === 'welcome' || kind === 'family') openSplash(kind);
  });
  ipcMain.on('suite:settings', (e, s) => {
    if (!isTrusted(e.sender) || !s || typeof s !== 'object') return;
    if (typeof s.lang === 'string' && /^[a-z]{2}$/.test(s.lang)) lang = s.lang;
    if (typeof s.notify === 'boolean') store.set({ notifyEnabled: s.notify });
  });
  ipcMain.handle('updates:check-now', async (e) => {
    if (!isTrusted(e.sender)) return { status: 'error' };
    return checkForUpdate({ manual: true });
  });
  ipcMain.on('suite:get-notify-sync', (e) => { e.returnValue = store.get().notifyEnabled; });

  /* ---------- startup hooks ---------- */
  function onMainLoaded() {
    if (S.shouldShowWelcome(store.get(), app.getVersion())) setTimeout(() => openSplash('welcome', { auto: true }), 1200);
    scheduleUpdateChecks();
  }

  /* ---------- renderer-less self-test (WAVEFRAME_SELFTEST=1) ---------- */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, ms = 6000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { try { if (await fn()) return true; } catch (_) { /* not ready */ } await wait(100); }
    return false;
  }
  async function selfTest() {
    const out = [];
    const check = (name, ok, extra) => out.push({ name, ok: !!ok, extra: extra === undefined ? '' : String(extra) });
    const js = (code) => splash.webContents.executeJavaScript(code);
    try {
      check('embedded catalogue valid', embeddedCatalogue().ok);
      lang = 'en';
      await openSplash('welcome');
      check('welcome window opens and renders 6 pages', await waitFor(async () => (await js('document.querySelectorAll(".page").length')) === 6));
      check('welcome text is localised (no raw keys)', !/splash\./.test(await js('document.body.innerText')));
      check('welcome shows the version', (await js('document.body.innerText')).includes(app.getVersion()));
      await js('document.getElementById("btnNext").click()');
      check('next moves to page 2', await waitFor(async () => (await js('document.querySelector(".page.active h2").textContent')) === 'Playback'));
      const closed = new Promise((r) => splash.once('closed', () => r(true)));
      splash.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      check('Escape closes the welcome window after the shrink animation', await Promise.race([closed, wait(4000).then(() => false)]));
      check('welcome remembered for this major.minor', S.shouldShowWelcome(store.get(), app.getVersion()) === false);
      await wait(400);
      await openSplash('family');
      const want = loadCatalogue().apps.length;
      check('family window lists every catalogue app', await waitFor(async () => (await js('document.querySelectorAll(".app-card").length')) === want, 15000), `${await js('document.querySelectorAll(".app-card").length')} of ${want}`);
      check('family marks this app as "You are here"', (await js('document.querySelector(".app-card.self .badge-here")?.textContent || ""')) === 'You are here');
      check('family text is localised (no raw keys)', !/splash\./.test(await js('document.body.innerText')));
      const closed2 = new Promise((r) => splash.once('closed', () => r(true)));
      splash.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      check('Escape closes the family window', await Promise.race([closed2, wait(4000).then(() => false)]));
    } catch (e) { check('splash self-test threw', false, e && e.stack || e); }
    return out;
  }

  return { onMainLoaded, openSplash, selfTest };
}

module.exports = { init };
