#!/usr/bin/env node
'use strict';

// Renderer self-test: launches the real Electron app with WAVEFRAME_SELFTEST=1. main.js then runs window.__selfTest() inside
// the renderer (real Web Audio, real DOM, real i18n) and exits with 0 on success. Prints one PASS/FAIL line per check.
// Run with `npm run selftest` — complements `npm test` (pure unit tests) and `npm run smoke-test` (launch only).

const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ELECTRON_BIN = path.join(__dirname, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
if (!fs.existsSync(ELECTRON_BIN)) { console.error('FAIL: Electron not installed (run npm install)'); process.exit(1); }

const child = spawn(ELECTRON_BIN, ['.'], {
  cwd: __dirname,
  env: { ...process.env, WAVEFRAME_SELFTEST: '1', ELECTRON_ENABLE_LOGGING: '0' },
  shell: process.platform === 'win32',
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
child.stdout.on('data', (d) => { const s = d.toString(); out += s; process.stdout.write(s); });
child.stderr.on('data', () => { /* Chromium noise */ });

const timeout = setTimeout(() => {
  console.error('FAIL: self-test timed out after 60 s');
  try { if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else child.kill('SIGKILL'); } catch (_) { /* already gone */ }
  process.exit(1);
}, 60000);

child.on('exit', (code) => {
  clearTimeout(timeout);
  const failed = /^FAIL/m.test(out) || code !== 0;
  console.log(failed ? 'SELF-TEST FAILED' : 'SELF-TEST PASSED');
  process.exit(failed ? 1 : 0);
});
