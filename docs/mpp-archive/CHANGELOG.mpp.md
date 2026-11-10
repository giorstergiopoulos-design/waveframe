# Changelog

## 1.6.1 — 2026-10-30
- **Right-to-left check**: the new Settings window and the Converter dialog were rendered with `FlowDirection=RightToLeft`: labels move to the right, fields to the left, nothing is clipped (the capture of a mirrored visual shows mirrored text; that is a capture artefact). `--snapshots` now also writes these RTL images.
- **VP9 output ~0.9 s short — investigated, NOT fixable here**: with the bundled libvlc 3.0.21 the VP9 encoder options (`lag-in-frames`, `quality`) have no effect (identical output), and the loss also occurs without audio; libvpx at 1080p cannot keep real-time pace and drops frames. VP9 stays marked "experimental"; VP8 WebM or MP4 are the safe choices.
- Audio effects without a stream restart: **not possible** with libvlc 3.0 (the filters are set when the stream starts); the effect applies after 0.12 s with the position kept. Documented in the Audio settings page.
- Still NOT VERIFIED: the installer and per-user migration on a clean/upgraded PC, the update popup against a real newer release, a real 150 % DPI session. Windows 11 style rows in the old dialogs and a UI-Automation click-through of the old menus are not done (the `--selftest` already executes every menu and button tag, 119 checks).

## 1.6.0 — 2026-10-30
- **Unified update popup** (same buttons and messages as the other Opsis apps): 30 s after start and every 24 h (ETag, once per version) the toast offers **Install / Later / Skip this version / What's new**. Install downloads only from this repository's release, checks SHA-256 (refuses and deletes on a mismatch, never runs without a digest), then a helper re-checks the hash, asks for administrator rights (UAC), installs silently into Program Files and reopens the player. Every stage goes to `%LocalAppData%\OpsisMediaPlayerPro\update\last-update.log`; a failed update is reported on the next start. Tests with a fake HTTP layer.
- **Wave interface**: a second look based on the Waveframe palettes (20 themes generated from Waveframe's `styles.css`, rounded controls). Themes -> Interface -> Classic (MPC) / Wave switches live, no restart.
- **Settings window by category** (Themes -> Settings...): Appearance, Audio, Video, Subtitles, Converter, Updates (Greek and English).
- **Installer in Program Files** (administrator, `{autopf}`), "Open with" entries in HKLM; an old per-user install is removed silently first, settings in `%AppData%\MediaPlayerPro` stay. **NOT VERIFIED**: compiled, not run on a clean or an upgraded machine.
- **Subtitles**: an existing subtitle next to the video or in your subtitle folder is found, so nothing is downloaded again on every play; "plain name" never overwrites an existing `movie.srt`. Subtitle files and zip entries are limited to 5 MB by the real byte count (zip bomb), entry names with `..`/absolute paths are ignored, nothing is extracted to disk.
- **Converter**: a cancelled or failed conversion deletes its half-written file; the media probe no longer blocks the UI thread; changing "Output" keeps the audio choice; an empty/invalid output folder gives a clear message.
- **Security**: `explorer.exe`, `notepad.exe`, `shutdown`, `powershell.exe` start by full Windows path; the family window launches only an existing local full-path `.exe`.
- Tests: 153 unit tests; `--selftest` 119 passed, 0 failed.
- Not done (1.6.1): real 150 % DPI and RTL runs, click-through of every old menu with UI Automation, Windows 11 style rows in the old dialogs, live audio effects without the short stream restart (libvlc limit), VP9 ~0.9 s shorter output, screenshot of the update toast.

## 1.5.0 — 2026-10-29
- **Converter** (Tools → "Convert video / image…"): MP4, WebM (VP8, VP9), MKV (VP9), AVI (MPEG-4, Motion JPEG), WMV, TS, OGV; resolution, fps, quality, audio codec (AAC/MPEG audio/Opus/Vorbis/WMA/copy/none); image outputs PNG/JPEG: frame sequence (every N seconds/frames, with a range), poster frame, contact sheet; trim from A-B or typed seconds; queue with progress, ETA and cancel; names get a suffix and never overwrite; the original is never touched. Only formats the bundled libvlc 3.0.21 really produces are offered (see docs/CONVERTER.md). **Fixed:** the old "Convert to MP4 (H.264)" produced an empty file — H.264/H.265, GIF and WebP are not available in this libvlc and are not offered.
- **Encodes go to `Videos\Opsis Media Player`** (created automatically, changeable in the dialog and used as the start folder of the MP3/clip export).
- **Subtitles**: the primary language is saved as `<movie>.srt` next to the movie (other languages `<movie>.<lang>.srt`); the folder is selectable (Subtitles → "Subtitle save folder…"). New Greek sources opened in the browser with automatic pick-up of the download: SubDL (Subscene shut down in May 2024 and never had a public API), GreekSubtitles, Subtitle Cat, OpenSubtitles web, Podnapisi web, Subs4Free — with a message to try another source if a site is down or shows anti-bot protection.
- **CheckBox / RadioButton** now use the theme (accent fill, check mark, indeterminate dash, keyboard focus ring) in dark and light — before they were the default Windows controls.
- **One light/dark control**: the duplicate "Light" entry was removed from the Theme menu (the mode button / Ctrl+Shift+L is the only switch).
- **Audio effects (Ambience, Surround, Dynamic Boost)**: apply after 0.12 s instead of 0.7 s and keep the playback position (self-test toggles each during playback). **Still open:** libvlc 3.0 cannot change these filters on a running player, so a short restart of the stream remains; the status bar says so.
- **Opsis family window**: the real icon of all 7 apps (embedded .ico, largest frame, crisp at 100/150/200 %); the letter tile is only the fallback for unknown apps. Test: every catalogue app has an embedded icon.
- Installer wizard pages show the app icon (large + small image, modern style).
- Tests: 136 unit tests (11 new for the converter and icons), self-test extended with real conversions of every offered format, the three image outputs, the original-untouched check and the audio-effect position check: 118 passed, 0 failed.
- **Languages**: every new or changed text (converter dialog, format labels, new menu items, status messages, Greek subtitle sources) exists in Greek and English (the two languages of the app) through `Loc.T`; tests fail on any raw Greek literal in the converter UI and on empty/Greek-in-English pairs. The older, untouched menus of the player are still Greek-only (not part of this release); the English strings are my own translation and deserve a native review.
- **README**: icon at the top, real dark + light screenshots (player, converter, audio, Opsis family) from `--snapshots`, SHA-256 verification steps; `docs/img/social-preview.png` (1280×640) ready; suggested GitHub About: "Fast video/audio player on the VLC engine with MPC shortcuts, converter, subtitle download and sync", topics: wpf, dotnet, vlc, libvlc, media-player, windows, subtitles, converter.
- **Bug audit (honest)**: found and fixed — H.264 convert item produced an empty file; CheckBox/RadioButton ignored the theme; duplicate light/dark choice; audio-effect debounce 700 ms; converter dialog had no background of its own (invisible text in the first capture) and an unreadable "…" button; buttons row now wraps. Still open — audio effects restart the stream (libvlc limit); VP9 output ~0.9 s short; the converter was not run under a real 150 % DPI session (only a layout simulation, whose result was not meaningful), nor RTL.
- Repo hygiene: no tracked build outputs or stray files found (checked `git ls-files`); `release/` added to .gitignore.

## 1.4.0 — 2026-10-27
- **Welcome guide**: 6 pages (Greek/English) on the first start of every new major/minor version and from Help → "Welcome"; animated app logo; "Don't show again"; closes by shrinking into the title-bar icon (a simple fade on PCs with animations turned off).
- **"The Opsis family"** window: one card per app of the suite (animated icon, tagline, capabilities, installed / update-available state from a read-only registry/folder probe, Open, Download with confirmation + SHA-256 check that refuses a mismatch, Details). Offered once after the guide.
- **New-version notice**: one GET a day to the GitHub releases API (ETag, 8 s timeout), once per version, as a toast inside the window (the player has no tray icon; no toast in full screen); setting in the Help menu.
- Catalogue: embedded fallback + a live copy at most once a day (github.com only, ≤256 KB, validated). 120+ new unit tests for version comparison, once-per-version logic, catalogue validation, installed-state detection and SHA-256 verification; the self-test opens the real windows.

## 1.3.0 — 2026-10-23
- **Dark / light mode for EVERY window**: the theme colours now live at application level (before, only the main window had them and the other windows kept a copy or the system look, so text could be unreadable after a mode change). The audio, help, statistics, subtitle-picker and prompt windows follow the theme live, and the title bars / borders follow it too (Windows 11 22H2+; older Windows only get the dark/light caption).
- **Moved from .NET 8 to .NET 10** (the app, the unit tests, the build scripts). LibVLCSharp.WPF 3.8.5 and libvlc 3.0.21 run unchanged on .NET 10.
- **Subtitle download**: candidates are ranked by season/episode, year, resolution, source, codec and release group (a different episode is rejected), the 3 best are downloaded and compared with the video length, transient network errors (429/5xx/timeouts) are retried, OpenSubtitles tokens are renewed, `.vtt`/`.ass`/`.ssa` and UTF-16/Greek encodings are converted to UTF-8 `.srt`.
- **Subtitle sync**: two audio segments (start and 70 %) give both the shift and the speed drift (25 ↔ 23.976 fps or any ratio within ±6 %), 3 refinement steps down to 20 ms, ±5 min search, confidence checks so a doubtful result is never applied, output through a real SRT writer.
- `Z` / `X` subtitle delay keys and "reset delay".
- New pure-logic folder `SubCore` with 39 unit tests, and an end-to-end sync check in the self-test (97 commands passed, 0 failed).

## 1.2.0 — 2026-10-23
- Renamed to **Opsis Media Player Pro** (the executable is now `OpsisMediaPlayerPro.exe`; your settings in `%AppData%\MediaPlayerPro` are kept).
- The light / dark / auto mode is no longer in the menu: it is a button on the control bar (and `Ctrl+Shift+L`) that cycles dark → light → auto.
- Snapshot to the clipboard (`Ctrl+C`), move playlist items (`Alt+↑/↓`), mouse side buttons = previous / next file, window position and size are remembered.
- **Self-test**: `OpsisMediaPlayerPro.exe --selftest <file>` runs every button and menu item against a real playback; plus a static audit of the menu tags (`tests/audit-menus.py`).
- Audio files no longer trigger an online subtitle search.
- Repository, installer (Inno Setup 7, no admin, optional per-user "Open with" entry) and portable zip.

## 1.1.0
- Rounded menus with shadow, accent hover, check marks and aligned shortcuts.
- Output-device and audio-channel selection (stereo, reversed, left, right, Dolby), video track, titles and chapters menus, repeat file, stop after current file, playback statistics (`Ctrl+J`), remaining time (`T`), fit window to video (`Ctrl+1/2/5`), open URL dialog, playlist context menu, `V`/`B` cycling, `Home`/`End`, jump keys with Alt/Shift, hidden cursor in full screen.

## 1.0.7 and earlier
- Audio enhancer (10-band equalizer, effects, presets), side panel with movie/series information, themes with light/dark, subtitle download and sync (Podnapisi, OpenSubtitles.com, Subs4Free), bookmarks, conversion and A-B clip export, resume position, sleep timer, Chromecast/DLNA.
