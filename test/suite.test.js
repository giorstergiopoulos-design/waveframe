'use strict';
// Unit tests for suite.js (welcome/showcase/update-check logic) - run with `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const S = require('../suite.js');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wf-suite-'));

test('version comparison follows semver (numeric, not lexical; pre-releases below releases)', () => {
  assert.equal(S.compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(S.compareVersions('v1.7.0', '1.7.0'), 0);
  assert.equal(S.compareVersions('1.6.0', '1.7.0'), -1);
  assert.equal(S.compareVersions('2.0.0-rc.1', '2.0.0'), -1);
  assert.equal(S.compareVersions('2.0.0-rc.2', '2.0.0-rc.10'), -1);
  assert.equal(S.compareVersions('1.0.0-alpha', '1.0.0-1'), 1);
  assert.equal(S.compareVersions('garbage', '1.0.0'), null);
  assert.equal(S.compareVersions('1.0', '1.0.0'), null);
});

test('isNewer ignores pre-releases and invalid tags', () => {
  assert.equal(S.isNewer('v1.7.1', '1.7.0'), true);
  assert.equal(S.isNewer('v1.7.0', '1.7.0'), false);
  assert.equal(S.isNewer('v1.6.9', '1.7.0'), false);
  assert.equal(S.isNewer('v2.0.0-beta.1', '1.7.0'), false);
  assert.equal(S.isNewer('nightly', '1.7.0'), false);
  assert.equal(S.majorMinor('v1.7.3'), '1.7');
});

test('welcome is shown once per major.minor and respects opt-out', () => {
  let st = S.sanitizeState({});
  assert.equal(S.shouldShowWelcome(st, '1.7.0'), true);
  st = { ...st, welcomeSeen: '1.7' };
  assert.equal(S.shouldShowWelcome(st, '1.7.5'), false, 'patch release does not re-show');
  assert.equal(S.shouldShowWelcome(st, '1.8.0'), true, 'new minor shows again');
  assert.equal(S.shouldShowWelcome({ ...st, welcomeOptOut: true }, '1.8.0'), false);
  assert.equal(S.shouldShowWelcome(st, 'junk'), false);
});

test('balloon is announced once per version and only when enabled', () => {
  let st = S.sanitizeState({});
  assert.equal(S.shouldNotify(st, 'v1.8.0', '1.7.0'), true);
  st = { ...st, notifiedVersion: '1.8.0' };
  assert.equal(S.shouldNotify(st, 'v1.8.0', '1.7.0'), false, 'already told');
  assert.equal(S.shouldNotify(st, 'v1.9.0', '1.7.0'), true, 'a newer one is announced again');
  assert.equal(S.shouldNotify({ ...st, notifiedVersion: '', notifyEnabled: false }, 'v1.8.0', '1.7.0'), false);
  assert.equal(S.shouldNotify(S.sanitizeState({}), 'v1.7.0', '1.7.0'), false);
});

test('state store persists, survives corrupt files and drops unknown/wrong-typed fields', () => {
  const dir = tmp(), file = path.join(dir, 'state.json');
  const store = S.createStore(file, S.STATE_DEFAULTS, S.sanitizeState);
  assert.equal(store.get().notifyEnabled, true);
  store.set({ notifiedVersion: '1.8.0', welcomeSeen: '1.7', evil: 'x', familyOffered: 'yes' });
  const again = S.createStore(file, S.STATE_DEFAULTS, S.sanitizeState).get();
  assert.equal(again.notifiedVersion, '1.8.0');
  assert.equal(again.welcomeSeen, '1.7');
  assert.equal(again.familyOffered, false, 'wrong type ignored');
  assert.equal(again.evil, undefined);
  fs.writeFileSync(file, '{not json');
  assert.equal(S.createStore(file, S.STATE_DEFAULTS, S.sanitizeState).get().welcomeSeen, '');
  fs.rmSync(dir, { recursive: true, force: true });
});

const embedded = fs.readFileSync(path.join(__dirname, '..', 'suite-apps.json'), 'utf8');

test('the embedded fallback catalogue validates and contains waveframe', () => {
  const r = S.validateCatalogue(embedded);
  assert.equal(r.ok, true);
  assert.equal(r.apps.length, 7);
  const wf = r.apps.find((a) => a.id === 'waveframe');
  assert.ok(wf.tagline.el && wf.tagline.en && wf.capabilities.en.length >= 3);
});

test('catalogue validation rejects oversize, malformed, wrong schema/owner, empty', () => {
  assert.equal(S.validateCatalogue('x'.repeat(300 * 1024)).error, 'oversize');
  assert.equal(S.validateCatalogue('{nope').error, 'malformed');
  assert.equal(S.validateCatalogue('[]').error, 'malformed');
  assert.equal(S.validateCatalogue({ schema: 2, owner: S.OWNER, apps: [] }).error, 'schema');
  assert.equal(S.validateCatalogue({ schema: 1, owner: 'someone-else', apps: [{ id: 'a', name: 'A', repo: 'A' }] }).error, 'owner');
  assert.equal(S.validateCatalogue({ schema: 1, owner: S.OWNER, apps: [] }).error, 'empty');
});

test('catalogue validation skips bad apps, bad regexes and drops unknown fields', () => {
  const r = S.validateCatalogue({
    schema: 1, owner: S.OWNER, extra: 1,
    apps: [
      { id: 'ok', name: 'Ok', repo: 'Ok', installerAsset: '^a$', hack: '<script>', tagline: { en: 'x', xx: 'no', 'en-US': 'bad key' }, paths: ['%LocalAppData%\\a.exe'] },
      { id: 'BAD ID', name: 'x', repo: 'x' },
      { id: 'badrepo', name: 'x', repo: '../../etc' },
      { id: 'badre', name: 'x', repo: 'x', installerAsset: '(' },
      { id: 'ok', name: 'dup', repo: 'dup' },
      null,
    ],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.apps.map((a) => a.id), ['ok', 'badre']);
  assert.equal(r.apps[0].hack, undefined);
  assert.deepEqual(Object.keys(r.apps[0].tagline).sort(), ['en', 'xx']);
  assert.equal(r.apps[1].installerAsset, null);
});

test('URL allow-list: https only, GitHub hosts only, no credentials, no odd ports', () => {
  assert.equal(S.isAllowedUrl(S.CATALOGUE_URL), true);
  assert.equal(S.isAllowedUrl('http://api.github.com/x'), false);
  assert.equal(S.isAllowedUrl('https://evil.example/x'), false);
  assert.equal(S.isAllowedUrl('https://github.com.evil.example/x'), false);
  assert.equal(S.isAllowedUrl('https://user:pw@github.com/x'), false);
  assert.equal(S.isAllowedUrl('https://github.com:8443/x'), false);
  assert.equal(S.isAllowedUrl('https://objects.githubusercontent.com/x'), false, 'asset CDN is only valid for downloads');
  assert.equal(S.isAllowedUrl('https://objects.githubusercontent.com/x', S.DOWNLOAD_OPTS), true);
  assert.equal(S.isAllowedUrl('https://githubusercontent.com/x', S.DOWNLOAD_OPTS), false);
  assert.equal(S.isAllowedUrl('not a url'), false);
  assert.equal(S.isRepoPageUrl(`https://github.com/${S.OWNER}/waveframe/releases/tag/v1.7.0`, 'waveframe'), true);
  assert.equal(S.isRepoPageUrl('https://github.com/attacker/waveframe/releases/tag/v1.7.0', 'waveframe'), false);
});

test('install detection: registry entries, word-boundary names, whitelisted env paths, fakes', () => {
  const reg = [
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\abc',
    '    DisplayName    REG_SZ    Waveframe 1.6.0',
    '    DisplayVersion    REG_SZ    1.6.0',
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\def',
    '    DisplayName    REG_SZ    Opsis Media Player Pro',
    '    DisplayVersion    REG_SZ    2.0.0',
  ].join('\r\n');
  const entries = S.parseUninstallOutput(reg);
  assert.equal(entries.length, 2);
  const apps = S.validateCatalogue(embedded).apps;
  const env = { LocalAppData: 'C:\\Users\\u\\AppData\\Local', ProgramFiles: 'C:\\Program Files' };
  const wf = S.findInstalled(apps.find((a) => a.id === 'waveframe'), { entries, exists: () => false, env });
  assert.deepEqual([wf.installed, wf.version], [true, '1.6.0']);
  const opsis = S.findInstalled(apps.find((a) => a.id === 'opsis'), { entries, exists: () => false, env });
  assert.equal(opsis.installed, false, '"Opsis" must not match "Opsis Media Player Pro"');
  const mp = S.findInstalled(apps.find((a) => a.id === 'mediaplayer'), { entries, exists: () => false, env });
  assert.equal(mp.version, '2.0.0');
  const exe = 'C:\\Users\\u\\AppData\\Local\\Programs\\Kombos\\Kombos.exe';
  const byPath = S.findInstalled(apps.find((a) => a.id === 'kombos'), { entries: [], exists: (p) => p === exe, env });
  assert.deepEqual([byPath.installed, byPath.version, byPath.exePath], [true, '', exe]);
  assert.equal(S.expandInstallPath('%USERPROFILE%\\x.exe', { USERPROFILE: 'C:\\u' }), null, 'non-whitelisted variable');
  assert.equal(S.expandInstallPath('%LocalAppData%\\..\\..\\Windows\\x.exe', env), null, 'path traversal');
  assert.equal(S.expandInstallPath('%LocalAppData%\\x.bat', env), null, 'only .exe');
  assert.equal(S.expandInstallPath('\\\\server\\share\\x.exe', env), null, 'UNC / relative');
});

const release = (over = {}) => ({
  tag_name: 'v1.7.0', html_url: `https://github.com/${S.OWNER}/waveframe/releases/tag/v1.7.0`, draft: false, prerelease: false,
  assets: [
    { name: 'Waveframe.Setup.1.7.0.exe', size: 5, digest: 'sha256:' + 'a'.repeat(64), browser_download_url: `https://github.com/${S.OWNER}/waveframe/releases/download/v1.7.0/Waveframe.Setup.1.7.0.exe` },
    { name: 'evil.exe', size: 5, browser_download_url: 'https://evil.example/evil.exe' },
  ], ...over,
});

test('release trimming ignores drafts/pre-releases/foreign hosts and picks the installer by regex', () => {
  assert.equal(S.trimRelease(release({ draft: true }), 'waveframe'), null);
  assert.equal(S.trimRelease(release({ prerelease: true }), 'waveframe'), null);
  assert.equal(S.trimRelease(release({ html_url: 'https://evil.example/r' }), 'waveframe'), null);
  const r = S.trimRelease(release(), 'waveframe');
  assert.equal(r.version, '1.7.0');
  assert.equal(r.assets.length, 1, 'asset on a foreign host is dropped');
  const app = S.validateCatalogue(embedded).apps.find((a) => a.id === 'waveframe');
  assert.equal(S.pickInstaller(r, app).name, 'Waveframe.Setup.1.7.0.exe');
  assert.equal(S.digestSha256(S.pickInstaller(r, app)), 'a'.repeat(64));
  assert.equal(S.digestSha256({ digest: 'md5:abc' }), null);
});

test('checksum text parsing and comparison', () => {
  const h = 'ab'.repeat(32);
  assert.equal(S.parseChecksumText(`${h}\n`, 'x.exe'), h);
  assert.equal(S.parseChecksumText(`${h.toUpperCase()}  x.exe`, 'x.exe'), h);
  assert.equal(S.parseChecksumText(`${h} *other.exe`, 'x.exe'), null);
  assert.equal(S.parseChecksumText('nothing here', 'x.exe'), null);
  assert.equal(S.sha256Matches(h, h.toUpperCase()), true);
  assert.equal(S.sha256Matches(h, 'cd'.repeat(32)), false);
  assert.equal(S.sha256Matches(h, 'short'), false);
});

function server(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler).listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

test('SHA-256 verified download: match is kept, mismatch is refused and deleted', async () => {
  const payload = crypto.randomBytes(200000);
  const { srv, base } = await server((req, res) => { res.writeHead(200, { 'content-length': payload.length }); res.end(payload); });
  const hostOk = (u) => u.startsWith(base);
  const dir = tmp();
  try {
    const good = await S.downloadVerified(base + '/a', path.join(dir, 'a.exe'), { expectedSha256: sha(payload), expectedSize: payload.length, lib: http, hostOk });
    assert.equal(good.sha256, sha(payload));
    assert.equal(fs.existsSync(path.join(dir, 'a.exe')), true);
    await assert.rejects(S.downloadVerified(base + '/a', path.join(dir, 'b.exe'), { expectedSha256: 'f'.repeat(64), lib: http, hostOk }), { code: 'sha-mismatch' });
    assert.equal(fs.existsSync(path.join(dir, 'b.exe')), false, 'corrupt file removed');
    await assert.rejects(S.downloadVerified(base + '/a', path.join(dir, 'c.exe'), { expectedSha256: sha(payload), expectedSize: 123, lib: http, hostOk }), { code: 'size-mismatch' });
    await assert.rejects(S.downloadVerified(base + '/a', path.join(dir, 'd.exe'), { expectedSha256: '', lib: http, hostOk }), { code: 'no-checksum' });
    await assert.rejects(S.downloadVerified(base + '/a', path.join(dir, 'e.exe'), { expectedSha256: sha(payload), maxBytes: 1000, lib: http, hostOk }), { code: 'size-mismatch' });
    await assert.rejects(S.downloadVerified('https://evil.example/a', path.join(dir, 'f.exe'), { expectedSha256: sha(payload) }), { code: 'bad-host' });
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('httpGet: size cap (declared and streamed), 304, errors, redirect to a bad host', async () => {
  const big = Buffer.alloc(5000, 1);
  const { srv, base } = await server((req, res) => {
    if (req.url === '/big') { res.writeHead(200, { 'content-length': big.length }); return res.end(big); }
    if (req.url === '/chunked') { res.writeHead(200); res.write(big); return res.end(big); }
    if (req.url === '/304') { res.writeHead(304); return res.end(); }
    if (req.url === '/redir') { res.writeHead(302, { location: 'http://evil.example/x' }); return res.end(); }
    if (req.url === '/ok') { res.writeHead(200, { etag: '"e1"' }); return res.end('{"a":1}'); }
    res.writeHead(404); res.end();
  });
  const hostOk = (u) => u.startsWith(base);
  try {
    await assert.rejects(S.httpGet(base + '/big', { lib: http, hostOk, maxBytes: 1000 }), { code: 'too-large' });
    await assert.rejects(S.httpGet(base + '/chunked', { lib: http, hostOk, maxBytes: 1000 }), { code: 'too-large' });
    assert.equal((await S.httpGet(base + '/304', { lib: http, hostOk })).status, 304);
    await assert.rejects(S.httpGet(base + '/nope', { lib: http, hostOk }), { code: 'http-404' });
    await assert.rejects(S.httpGet(base + '/redir', { lib: http, hostOk }), { code: 'bad-host' });
    const ok = await S.httpGet(base + '/ok', { lib: http, hostOk });
    assert.equal(ok.headers.etag, '"e1"');
    assert.equal(JSON.parse(ok.body).a, 1);
    await assert.rejects(S.httpGet('https://evil.example/', {}), { code: 'bad-host' });
  } finally { srv.close(); }
});

test('every app of the catalogue resolves to an embedded icon (waveframe draws its own); icons are real PNGs', () => {
  const apps = S.validateCatalogue(embedded).apps;
  for (const a of apps) {
    if (a.id === 'waveframe') continue;
    const f = path.join(__dirname, '..', 'renderer', 'appicons', `${a.id}.png`);
    assert.ok(fs.existsSync(f), `missing icon for ${a.id}`);
    const b = fs.readFileSync(f);
    assert.equal(b.slice(1, 4).toString(), 'PNG', `${a.id} is not a PNG`);
    assert.ok(b.readUInt32BE(16) >= 96 && b.readUInt32BE(20) >= 96, `${a.id} icon too small for 200 % DPI`);
  }
});

test('install detection uses the uninstall names and paths of the catalogue (Opsis = "Opsis - Desktop Customization")', () => {
  const apps = S.validateCatalogue(embedded).apps;
  const opsis = apps.find((a) => a.id === 'opsis');
  assert.equal(opsis.uninstallDisplayName, 'Opsis - Desktop Customization');
  const env = { LocalAppData: 'C:\\Users\\u\\AppData\\Local', ProgramFiles: 'C:\\Program Files' };
  const entries = [{ displayName: 'Opsis - Desktop Customization', displayVersion: '2.1.3' }];
  assert.deepEqual(S.findInstalled(opsis, { entries, exists: () => false, env }).version, '2.1.3');
  const byPath = S.findInstalled(opsis, { entries: [], exists: (p) => p === 'C:\\Program Files\\Opsis - Desktop Customization\\Opsis.exe', env });
  assert.equal(byPath.installed, true);
});
