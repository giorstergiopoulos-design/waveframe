#!/usr/bin/env node
'use strict';

// Basic smoke test: launches the app, waits a few seconds, and checks that it
// didn't crash and logged no errors. Not a full UI test suite (no test
// framework is installed in this project) — just an automated version of the
// manual "launch, check run.log, confirm the window exists" verification used
// throughout development, so regressions that break startup get caught by a
// single command (`npm run smoke-test`) instead of a human having to notice.

const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ELECTRON_BIN = path.join(__dirname, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const LOG_FILE = path.join(__dirname, 'smoke-test.log');
const WAIT_MS = 4000;

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

async function main() {
  if (!fs.existsSync(ELECTRON_BIN)) {
    fail(`Electron binary not found at ${ELECTRON_BIN} — did you run "npm install"?`);
    return;
  }

  const logStream = fs.createWriteStream(LOG_FILE);
  // On Windows, electron.cmd is a shell shim, not a real PE executable, so it
  // must be launched through cmd.exe. Launching it this way means the real
  // electron.exe runs as a *grandchild* — plain child.kill() below only kills
  // the cmd.exe wrapper and leaves electron.exe running, so cleanup uses
  // `taskkill /T` (kill the whole process tree) instead.
  const child = process.platform === 'win32'
    ? spawn('cmd.exe', ['/c', ELECTRON_BIN, '.'], { cwd: __dirname })
    : spawn(ELECTRON_BIN, ['.'], { cwd: __dirname });
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  let exitedEarly = false;
  child.on('exit', (code) => {
    if (code !== null && code !== 0) exitedEarly = true;
  });

  await new Promise((resolve) => setTimeout(resolve, WAIT_MS));

  if (exitedEarly) {
    fail('The app exited on its own before the wait period finished — check smoke-test.log.');
  } else if (child.exitCode !== null) {
    fail('The app process is not running anymore.');
  } else {
    console.log('OK: app launched and stayed up for the test window.');
  }

  const logContents = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf-8') : '';
  const errorLines = logContents.split('\n').filter((line) => /error|exception|uncaught/i.test(line));
  if (errorLines.length > 0) {
    fail(`Found ${errorLines.length} error-looking line(s) in the log:\n${errorLines.join('\n')}`);
  } else {
    console.log('OK: no error-looking lines in the log.');
  }

  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already exited */ }
  } else {
    child.kill();
  }
  logStream.close();
  if (!process.exitCode) fs.unlinkSync(LOG_FILE);
}

main();
