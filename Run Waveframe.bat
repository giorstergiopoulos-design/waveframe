@echo off
title Waveframe
cd /d "%~dp0"
if not exist "node_modules\.bin\electron.cmd" (
  echo Waveframe dependencies are not installed yet.
  echo Running "npm install", please wait...
  call npm install
)
call "node_modules\.bin\electron.cmd" .
if errorlevel 1 pause
