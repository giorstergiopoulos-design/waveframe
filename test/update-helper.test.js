'use strict';
// Runs the REAL update helper script (PowerShell) with a harmless fake setup and a fake app (.bat files): nothing is installed.
// Verifies: it waits for the app to end, re-checks the SHA-256, runs the setup with the silent switches, restarts the app (new location first),
// and refuses to run anything when the hash does not match.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const S = require('../suite.js');

const opts = { skip: process.platform === 'win32' ? false : 'Windows only (PowerShell helper)' };

function runHelper(tamper) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-helper-'));
  try {
    const setup = path.join(dir, 'Waveframe.Setup.bat');
    const oldApp = path.join(dir, 'old.bat');
    const newApp = path.join(dir, 'Program Files', 'Waveframe.bat');
    fs.mkdirSync(path.dirname(newApp), { recursive: true });
    fs.writeFileSync(setup, `@echo %* > "${dir}\\setup.args"\r\n@exit /b 0\r\n`);
    fs.writeFileSync(oldApp, `@echo old > "${dir}\\old.ran"\r\n`);
    fs.writeFileSync(newApp, `@echo new > "${dir}\\new.ran"\r\n`);
    const sha = crypto.createHash('sha256').update(fs.readFileSync(setup)).digest('hex');
    const dummy = spawn('cmd.exe', ['/c', 'ping -n 2 127.0.0.1 > nul'], { windowsHide: true });
    const script = S.buildUpdateScript({ pid: dummy.pid, setupPath: setup, sha256: tamper ? 'f'.repeat(64) : sha, exePaths: [newApp, oldApp] });
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true, timeout: 60000 });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500); // the restarted app runs detached
    const has = (f) => fs.existsSync(path.join(dir, f));
    return { exit: r.status, setupRan: has('setup.args'), args: has('setup.args') ? fs.readFileSync(path.join(dir, 'setup.args'), 'utf8').trim() : '', newApp: has('new.ran'), oldApp: has('old.ran') };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('update helper: matching hash -> silent setup runs, app restarts from the new location', opts, () => {
  const r = runHelper(false);
  assert.equal(r.exit, 0);
  assert.equal(r.setupRan, true);
  assert.equal(r.args, '/SILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS');
  assert.equal(r.newApp, true, 'Program Files location is started');
  assert.equal(r.oldApp, false, 'the old per-user location is not');
});

test('update helper: a tampered setup (hash mismatch) is never run and the app is not restarted', opts, () => {
  const r = runHelper(true);
  assert.equal(r.exit, 2);
  assert.equal(r.setupRan, false);
  assert.equal(r.newApp || r.oldApp, false);
});
