'use strict';
// Static security checks (run with `npm test`): window hardening, CSP, IPC guards, no markup injection from user data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('every BrowserWindow keeps contextIsolation on, nodeIntegration off and the sandbox on', () => {
  for (const f of ['main.js', 'suite-main.js']) {
    const src = read(f);
    const wins = [...src.matchAll(/new BrowserWindow\(\{[\s\S]*?\n\s*\}\);/g)].map((m) => m[0]);
    assert.ok(wins.length >= 1, `${f}: no BrowserWindow found`);
    for (const w of wins) {
      assert.match(w, /contextIsolation:\s*true/, `${f}: contextIsolation`);
      assert.match(w, /nodeIntegration:\s*false/, `${f}: nodeIntegration`);
      assert.match(w, /sandbox:\s*true/, `${f}: sandbox`);
    }
  }
});

test('every page has a strict CSP (no inline script/style, no eval, no plugins, no base/form hijack) and no inline style attributes', () => {
  for (const f of ['index.html', 'help.html', 'splash.html']) {
    const html = read(path.join('renderer', f));
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html);
    assert.ok(csp, `${f}: no CSP`);
    assert.match(csp[1], /script-src 'self'/);
    assert.match(csp[1], /style-src 'self'/);
    assert.match(csp[1], /object-src 'none'/);
    assert.match(csp[1], /base-uri 'none'/);
    assert.match(csp[1], /form-action 'none'/);
    assert.ok(!/unsafe-inline|unsafe-eval/.test(csp[1]), `${f}: unsafe CSP`);
    assert.ok(!/\sstyle="/.test(html), `${f}: inline style attribute`);
    assert.ok(!/\son[a-z]+="/i.test(html), `${f}: inline event handler`);
  }
});

test('every ipcMain channel of main.js, conv-main.js and suite-main.js checks who is asking', () => {
  const cases = [['main.js', /fromMain\(|fromApp\(/], ['conv-main.js', /trusted\(/], ['suite-main.js', /fromSplash\(|isTrusted\(/]];
  for (const [file, guard] of cases) {
    const src = read(file);
    const parts = src.split(/\n\s*ipcMain\.(?:on|handle)\(/).slice(1);
    assert.ok(parts.length > 3, `${file}: channels not found`);
    for (const part of parts) {
      const chan = /^'([^']+)'/.exec(part)[1];
      const body = part.split(/\n\s*(?:ipcMain\.|\/\*|function |async function )/)[0];
      // the three read-only constants / dialogs delegate to the guard on the first line of their body as well
      assert.match(body, guard, `${file}: channel ${chan} has no sender check`);
    }
  }
});

test('IPC arguments are validated in main.js (types, sizes, patterns)', () => {
  const m = read('main.js');
  assert.match(m, /typeof enabled === 'boolean'/);
  assert.match(m, /PNG_DATA_URL/);
  assert.match(m, /slice\(0, 4000\)/, 'crash log entries are bounded');
  assert.match(m, /512 \* 1024/, 'crash log is rotated');
  assert.match(m, /path\.isAbsolute\(filePath\)/);
  assert.match(m, /AUDIO_FILE_EXTENSIONS\.includes/);
  assert.match(m, /\^\[a-z0-9-\]\{1,30\}\$/, 'theme names are a strict pattern');
});

test('names of tracks and presets never reach innerHTML', () => {
  const app = read(path.join('renderer', 'app.js'));
  for (const bad of ['${item.name}', '${p.name}', '${track.name}', '${f.name}', '${item.picture}']) {
    assert.ok(!app.includes(bad), `app.js interpolates ${bad} into markup`);
  }
  const conv = read(path.join('renderer', 'converter.js'));
  assert.ok(!/innerHTML/.test(conv), 'converter.js must not use innerHTML');
  const splash = read(path.join('renderer', 'splash.js'));
  assert.ok(!/innerHTML/.test(splash), 'splash.js (catalogue text from the network) must not use innerHTML');
});

test('the update never runs a download that was not verified: hash is required and re-checked by the helper', () => {
  const sm = read('suite-main.js');
  assert.match(sm, /isTrustedReleaseDownload\(asset\.url/);
  assert.match(sm, /expectedSha256: sha/);
  assert.match(sm, /buildUpdateScript/);
  assert.ok(!/execFile\([^)]*setupPath|spawn\([^)]*asset\.url/.test(sm));
});
