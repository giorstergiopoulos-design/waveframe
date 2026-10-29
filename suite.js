'use strict';
// Pure/testable logic for the welcome guide, the "Opsis family" showcase and the new-version check.
// No Electron imports here - main-process glue lives in suite-main.js, unit tests in test/suite.test.js.
// Shared spec: C:\w\SUITE-SPEC.md (catalogue schema in suite-apps.json).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const OWNER = 'giorstergiopoulos-design';
const SELF_REPO = 'waveframe';
const CATALOGUE_URL = 'https://raw.githubusercontent.com/giorstergiopoulos-design/Opsis/master/suite/apps.json';
const CATALOGUE_MAX_BYTES = 256 * 1024;
const RELEASE_MAX_BYTES = 1024 * 1024;
const INSTALLER_MAX_BYTES = 600 * 1024 * 1024;
const API_HOSTS = ['github.com', 'raw.githubusercontent.com', 'api.github.com'];

/* ------------------------------ versions ------------------------------ */

function parseVersion(s) {
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(s == null ? '' : s).trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] };
}

// Semver 2.0 precedence. Returns -1/0/1, or null when either side is not a valid version.
function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  if (!x.pre.length && !y.pre.length) return 0;
  if (!x.pre.length) return 1; // a release outranks its pre-releases
  if (!y.pre.length) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) { if (+p !== +q) return +p < +q ? -1 : 1; }
    else if (pn !== qn) return pn ? -1 : 1;
    else if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

function isNewer(latest, current) {
  const l = parseVersion(latest);
  return !!l && l.pre.length === 0 && compareVersions(latest, current) === 1;
}

function majorMinor(v) {
  const p = parseVersion(v);
  return p ? `${p.major}.${p.minor}` : null;
}

/* ------------------------------ persistent state ------------------------------ */

const STATE_DEFAULTS = { welcomeSeen: '', welcomeOptOut: false, familyOffered: false, notifiedVersion: '', skippedVersion: '', notifyEnabled: true, lastCheck: 0, releases: {} };

function sanitizeState(raw) {
  const s = { ...STATE_DEFAULTS, releases: {} };
  if (!raw || typeof raw !== 'object') return s;
  if (typeof raw.welcomeSeen === 'string' && raw.welcomeSeen.length < 20) s.welcomeSeen = raw.welcomeSeen;
  if (typeof raw.notifiedVersion === 'string' && raw.notifiedVersion.length < 40) s.notifiedVersion = raw.notifiedVersion;
  if (typeof raw.skippedVersion === 'string' && raw.skippedVersion.length < 40) s.skippedVersion = raw.skippedVersion;
  for (const k of ['welcomeOptOut', 'familyOffered', 'notifyEnabled']) if (typeof raw[k] === 'boolean') s[k] = raw[k];
  if (Number.isFinite(raw.lastCheck)) s.lastCheck = raw.lastCheck;
  if (raw.releases && typeof raw.releases === 'object') {
    for (const [repo, v] of Object.entries(raw.releases).slice(0, 30)) {
      if (/^[A-Za-z0-9._-]{1,100}$/.test(repo) && v && typeof v === 'object') s.releases[repo] = { at: Number(v.at) || 0, etag: typeof v.etag === 'string' ? v.etag.slice(0, 200) : '', release: v.release || null };
    }
  }
  return s;
}

function createStore(file, defaults, sanitize, fsApi = fs) {
  let data;
  try { data = sanitize(JSON.parse(fsApi.readFileSync(file, 'utf8'))); } catch (_) { data = sanitize(defaults); }
  return {
    get: () => data,
    set(patch) {
      data = sanitize({ ...data, ...patch });
      try {
        fsApi.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = file + '.tmp';
        fsApi.writeFileSync(tmp, JSON.stringify(data));
        fsApi.renameSync(tmp, file);
      } catch (_) { /* best effort: losing the state only means a repeated hint */ }
      return data;
    },
  };
}

// Welcome guide: shown automatically once per major.minor version, unless the user opted out of automatic display.
function shouldShowWelcome(state, version) {
  const mm = majorMinor(version);
  return !!mm && !state.welcomeOptOut && state.welcomeSeen !== mm;
}

// Balloon: only for a stable release that is newer than the running version and was not announced before.
// "Skip this version" silences exactly that version; a newer one is announced again.
function shouldNotify(state, latestTag, currentVersion) {
  const v = String(latestTag).replace(/^v/, '');
  return state.notifyEnabled !== false && isNewer(latestTag, currentVersion) && state.notifiedVersion !== v && state.skippedVersion !== v;
}

/* ------------------------------ URL / host rules ------------------------------ */

function isAllowedUrl(url, { hosts = API_HOSTS, suffixes = [] } = {}) {
  let u;
  try { u = new URL(url); } catch (_) { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const h = u.hostname.toLowerCase();
  return hosts.includes(h) || suffixes.some((s) => h.endsWith(s) && h.length > s.length);
}
// Release assets are served by GitHub from these hosts after a redirect.
const DOWNLOAD_OPTS = { hosts: API_HOSTS, suffixes: ['.githubusercontent.com'] };

function isRepoPageUrl(url, repo) {
  if (!isAllowedUrl(url, { hosts: ['github.com'] })) return false;
  return new URL(url).pathname.toLowerCase().startsWith(`/${OWNER}/${repo}`.toLowerCase());
}

/* ------------------------------ catalogue ------------------------------ */

const ID_RE = /^[a-z0-9_-]{1,32}$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const str = (v, max) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

function cleanLocalised(obj, maxLen) {
  const out = {};
  if (obj && typeof obj === 'object') {
    for (const [lang, v] of Object.entries(obj)) if (/^[a-z]{2}$/.test(lang) && str(v, maxLen)) out[lang] = v;
  }
  return out;
}
function cleanLocalisedList(obj) {
  const out = {};
  if (obj && typeof obj === 'object') {
    for (const [lang, arr] of Object.entries(obj)) {
      if (!/^[a-z]{2}$/.test(lang) || !Array.isArray(arr)) continue;
      const list = arr.slice(0, 8).filter((x) => str(x, 200));
      if (list.length) out[lang] = list;
    }
  }
  return out;
}

// raw: JSON text or parsed object. Unknown fields are dropped; apps that fail validation are skipped.
// Returns { ok, apps, updated, error }. The whole file is rejected when it is oversize, malformed or not from our owner.
function validateCatalogue(raw, { maxBytes = CATALOGUE_MAX_BYTES } = {}) {
  let obj = raw;
  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    if (Buffer.byteLength(raw) > maxBytes) return { ok: false, error: 'oversize' };
    try { obj = JSON.parse(String(raw)); } catch (_) { return { ok: false, error: 'malformed' }; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'malformed' };
  if (obj.schema !== 1) return { ok: false, error: 'schema' };
  if (obj.owner !== OWNER) return { ok: false, error: 'owner' };
  if (!Array.isArray(obj.apps)) return { ok: false, error: 'malformed' };
  const apps = [];
  const seen = new Set();
  for (const a of obj.apps.slice(0, 30)) {
    if (!a || typeof a !== 'object') continue;
    const id = str(a.id, 32), name = str(a.name, 80), repo = str(a.repo, 100);
    if (!id || !ID_RE.test(id) || !name || !repo || !REPO_RE.test(repo) || seen.has(id)) continue;
    let installerAsset = null;
    if (str(a.installerAsset, 200)) { try { new RegExp(a.installerAsset); installerAsset = a.installerAsset; } catch (_) { /* skip */ } }
    seen.add(id);
    apps.push({
      id, name, repo, installerAsset,
      checksumAsset: str(a.checksumAsset, 200),
      uninstallDisplayName: str(a.uninstallDisplayName, 120) || name,
      paths: Array.isArray(a.paths) ? a.paths.slice(0, 6).filter((p) => str(p, 260)) : [],
      tagline: cleanLocalised(a.tagline, 160),
      capabilities: cleanLocalisedList(a.capabilities),
    });
  }
  if (!apps.length) return { ok: false, error: 'empty' };
  return { ok: true, apps, updated: str(obj.updated, 20) || '' };
}

/* ------------------------------ install detection (read-only) ------------------------------ */

const ENV_ALLOWED = ['LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'APPDATA'];

// Expands only whitelisted %VARS%; returns null for anything else, for relative paths, "..", or non-.exe targets.
function expandInstallPath(p, env) {
  if (typeof p !== 'string' || p.includes('..')) return null;
  let bad = false;
  const out = p.replace(/%([^%]+)%/g, (_, name) => {
    const key = name.toUpperCase();
    if (!ENV_ALLOWED.includes(key) || !env[Object.keys(env).find((k) => k.toUpperCase() === key)]) { bad = true; return ''; }
    return env[Object.keys(env).find((k) => k.toUpperCase() === key)];
  });
  if (bad || !/^[A-Za-z]:\\/.test(out) || !/\.exe$/i.test(out)) return null;
  return out;
}

// Parses `reg query <Uninstall key> /s` output into [{ displayName, displayVersion }].
function parseUninstallOutput(text) {
  const entries = [];
  let cur = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) { cur = { displayName: '', displayVersion: '' }; entries.push(cur); continue; }
    const m = /^\s+(DisplayName|DisplayVersion)\s+REG_(?:EXPAND_)?SZ\s+(.*)$/.exec(line);
    if (m && cur) cur[m[1] === 'DisplayName' ? 'displayName' : 'displayVersion'] = m[2].trim();
  }
  return entries.filter((e) => e.displayName);
}

function findInstalled(app, { entries = [], exists = () => false, env = {} }) {
  const want = app.uninstallDisplayName.toLowerCase();
  const hit = entries.find((e) => {
    const n = e.displayName.toLowerCase();
    // "Waveframe 1.6.0" (electron-builder appends the version); require a word boundary so "Opsis" does not match "Opsis Media Player Pro".
    return n === want || (n.startsWith(want + ' ') && /^v?\d/.test(n.slice(want.length + 1)));
  });
  let exePath = null;
  for (const p of app.paths) {
    const x = expandInstallPath(p, env);
    if (x && exists(x)) { exePath = x; break; }
  }
  if (!hit && !exePath) return { installed: false, version: '', exePath: null };
  return { installed: true, version: hit && parseVersion(hit.displayVersion) ? hit.displayVersion : '', exePath };
}

/* ------------------------------ releases / checksums ------------------------------ */

// Reduces a GitHub release JSON to what we use; returns null for drafts, pre-releases or hosts we do not trust.
function trimRelease(r, repo) {
  if (!r || typeof r !== 'object' || r.draft || r.prerelease) return null;
  if (!parseVersion(r.tag_name) || !isRepoPageUrl(r.html_url, repo)) return null;
  const assets = (Array.isArray(r.assets) ? r.assets : []).slice(0, 60).map((a) => ({
    name: str(a && a.name, 200), size: Number.isFinite(a && a.size) ? a.size : 0,
    digest: typeof (a && a.digest) === 'string' ? a.digest : '', url: a && a.browser_download_url,
  })).filter((a) => a.name && isAllowedUrl(a.url, DOWNLOAD_OPTS));
  return { tag: r.tag_name, version: r.tag_name.replace(/^v/, ''), url: r.html_url, assets, notes: typeof r.body === 'string' ? r.body.slice(0, 4000) : '' };
}

function pickInstaller(release, app) {
  if (!release || !app.installerAsset) return null;
  const re = new RegExp(app.installerAsset);
  return release.assets.find((a) => re.test(a.name)) || null;
}

// Only files of THIS repository's own releases are ever downloaded as an update.
function isTrustedReleaseDownload(url, repo) {
  if (!isAllowedUrl(url, { hosts: ['github.com'] })) return false;
  return new URL(url).pathname.startsWith(`/${OWNER}/${repo}/releases/download/`);
}
function findChecksumAsset(release, installerName) {
  return (release && release.assets || []).find((a) => a.name === installerName + '.sha256') || null;
}

function digestSha256(asset) {
  const m = /^sha256:([0-9a-f]{64})$/i.exec(asset && asset.digest || '');
  return m ? m[1].toLowerCase() : null;
}

// Accepts "<hex>", "<hex>  file.exe" or "<hex> *file.exe" (sha256sum / certutil style, first matching line wins).
function parseChecksumText(text, fileName) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*([0-9a-fA-F]{64})(?:\s+\*?(.+?))?\s*$/.exec(line);
    if (m && (!m[2] || !fileName || m[2] === fileName)) return m[1].toLowerCase();
  }
  return null;
}

function sha256Matches(actual, expected) {
  return typeof actual === 'string' && typeof expected === 'string' && /^[0-9a-f]{64}$/i.test(expected) && actual.toLowerCase() === expected.toLowerCase();
}

/* ------------------------------ update helpers ------------------------------ */

// SHQueryUserNotificationState: 2 = busy (full-screen app), 3 = D3D full screen (game), 4 = presentation mode.
const isBusyNotificationState = (n) => n === 2 || n === 3 || n === 4;
const FULLSCREEN_PS = "Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class Q { [DllImport(\"shell32.dll\")] public static extern int SHQueryUserNotificationState(out int s); }'; $s = 0; [void][Q]::SHQueryUserNotificationState([ref]$s); $s";

const psQuote = (x) => "'" + String(x).replace(/'/g, "''") + "'";

// The helper that outlives the app: waits for the app to end, re-checks the hash of the downloaded setup, runs it silently
// (the setup elevates itself for Program Files), and opens the app again when it succeeded.
// exePaths: where the app may be after the setup ran (the first that exists is started - a per-user install moves to Program Files).
function buildUpdateScript({ pid, setupPath, sha256, exePaths }) {
  if (!/^\d+$/.test(String(pid)) || !/^[0-9a-f]{64}$/i.test(sha256)) throw new Error('bad update parameters');
  return [
    "$ErrorActionPreference = 'Stop'",
    `try { Wait-Process -Id ${pid} -Timeout 120 -ErrorAction SilentlyContinue } catch { }`,
    `if ((Get-FileHash -LiteralPath ${psQuote(setupPath)} -Algorithm SHA256).Hash.ToLowerInvariant() -ne ${psQuote(sha256.toLowerCase())}) { exit 2 }`,
    `$p = Start-Process -FilePath ${psQuote(setupPath)} -ArgumentList '/SILENT','/SUPPRESSMSGBOXES','/NORESTART','/CLOSEAPPLICATIONS' -Wait -PassThru`,
    `$exe = @(${exePaths.map(psQuote).join(',')}) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1`,
    'if ($p.ExitCode -eq 0 -and $exe) { Start-Process -FilePath $exe }',
  ].join('\r\n');
}

/* ------------------------------ network (allow-list, size cap, timeout) ------------------------------ */

// Resolves { status, headers, body } for 200/304; rejects with Error.code in: bad-host, too-large, timeout, http-<n>, too-many-redirects.
function httpGet(url, { lib = require('https'), timeout = 8000, maxBytes = RELEASE_MAX_BYTES, headers = {}, hostOpts = DOWNLOAD_OPTS, hostOk, redirects = 0 } = {}) {
  const allowed = hostOk || ((u) => isAllowedUrl(u, hostOpts));
  return new Promise((resolve, reject) => {
    const fail = (code) => reject(Object.assign(new Error(code), { code }));
    if (!allowed(url)) return fail('bad-host');
    const req = lib.get(url, { headers: { 'User-Agent': 'Waveframe', Accept: 'application/vnd.github+json, */*', ...headers }, timeout }, (res) => {
      const sc = res.statusCode;
      if (sc >= 300 && sc < 400 && sc !== 304 && res.headers.location) {
        res.resume();
        if (redirects >= 5) return fail('too-many-redirects');
        let next;
        try { next = new URL(res.headers.location, url).toString(); } catch (_) { return fail('bad-host'); }
        return httpGet(next, { lib, timeout, maxBytes, headers, hostOpts, hostOk, redirects: redirects + 1 }).then(resolve, reject);
      }
      if (sc === 304) { res.resume(); return resolve({ status: 304, headers: res.headers, body: Buffer.alloc(0) }); }
      if (sc !== 200) { res.resume(); return fail(`http-${sc}`); }
      if (Number(res.headers['content-length']) > maxBytes) { res.destroy(); return fail('too-large'); }
      const chunks = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n > maxBytes) { res.destroy(); fail('too-large'); } else chunks.push(c); });
      res.on('end', () => resolve({ status: 200, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', () => fail('network'));
    });
    req.on('timeout', () => { req.destroy(); fail('timeout'); });
    req.on('error', () => fail('network'));
  });
}

// Streams an installer to destPath while hashing; refuses (and deletes the file) when size or SHA-256 differ.
function downloadVerified(url, destPath, { expectedSha256, expectedSize = 0, maxBytes = INSTALLER_MAX_BYTES, lib = require('https'), hostOk, onProgress, timeout = 30000, redirects = 0 } = {}) {
  const allowed = hostOk || ((u) => isAllowedUrl(u, DOWNLOAD_OPTS));
  return new Promise((resolve, reject) => {
    const fail = (code, cleanup) => { if (cleanup) { try { fs.unlinkSync(destPath); } catch (_) { /* gone */ } } reject(Object.assign(new Error(code), { code })); };
    if (!/^[0-9a-f]{64}$/i.test(expectedSha256 || '')) return fail('no-checksum');
    if (!allowed(url)) return fail('bad-host');
    const req = lib.get(url, { headers: { 'User-Agent': 'Waveframe' }, timeout }, (res) => {
      const sc = res.statusCode;
      if (sc >= 300 && sc < 400 && res.headers.location) {
        res.resume();
        if (redirects >= 5) return fail('too-many-redirects');
        let next; try { next = new URL(res.headers.location, url).toString(); } catch (_) { return fail('bad-host'); }
        return downloadVerified(next, destPath, { expectedSha256, expectedSize, maxBytes, lib, hostOk, onProgress, timeout, redirects: redirects + 1 }).then(resolve, reject);
      }
      if (sc !== 200) { res.resume(); return fail(`http-${sc}`); }
      const total = Number(res.headers['content-length']) || expectedSize;
      if (total > maxBytes || (expectedSize && total && total !== expectedSize)) { res.destroy(); return fail('size-mismatch'); }
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(destPath);
      let n = 0;
      res.on('data', (c) => {
        n += c.length;
        if (n > maxBytes) { res.destroy(); out.destroy(); return fail('too-large', true); }
        hash.update(c);
        if (onProgress && total) onProgress(n / total);
      });
      res.pipe(out);
      res.on('error', () => { out.destroy(); fail('network', true); });
      out.on('error', () => fail('write', true));
      out.on('finish', () => out.close(() => {
        if (expectedSize && n !== expectedSize) return fail('size-mismatch', true);
        const actual = hash.digest('hex');
        if (!sha256Matches(actual, expectedSha256)) return fail('sha-mismatch', true);
        resolve({ path: destPath, sha256: actual, bytes: n });
      }));
    });
    req.on('timeout', () => { req.destroy(); fail('timeout', true); });
    req.on('error', () => fail('network', true));
  });
}

module.exports = {
  OWNER, SELF_REPO, CATALOGUE_URL, CATALOGUE_MAX_BYTES, API_HOSTS, DOWNLOAD_OPTS,
  parseVersion, compareVersions, isNewer, majorMinor,
  STATE_DEFAULTS, sanitizeState, createStore, shouldShowWelcome, shouldNotify,
  isAllowedUrl, isRepoPageUrl, validateCatalogue,
  expandInstallPath, parseUninstallOutput, findInstalled,
  trimRelease, pickInstaller, digestSha256, parseChecksumText, sha256Matches, isTrustedReleaseDownload, findChecksumAsset,
  isBusyNotificationState, FULLSCREEN_PS, psQuote, buildUpdateScript,
  httpGet, downloadVerified,
};
