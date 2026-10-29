# Changelog

## 1.10.0
- Update mechanism, same as the Opsis News Crawler: check 30 s after start and every 24 h with ETag; one balloon per version, none while a game / full-screen app / presentation is in front (retry after 15 min); the balloon opens a window with Download and install, Later, Skip this version and What's new; the setup is downloaded from this repository's releases only, verified with SHA-256 (GitHub digest or the .sha256 asset), re-checked by a helper and installed silently, then the app restarts. Nothing unverified is ever run; portable copies and versions without a digest open the release page. All texts in 20 languages (balloon, window, dialogs, FFmpeg download confirmation).
- Export / Convert layout: every group of controls has its own spacing; layout self-test over 20 languages x 100 % / 150 % with files listed and while converting.
- Security: IPC channels answer only the main window and validate types/sizes; stricter CSP (object-src, base-uri, form-action); bounded and rotated crash log; tags read only from absolute audio-file paths; Help window navigation lock; static security tests; GitHub Actions CI (npm test + Electron self-test).
- Installer: machine-wide in Program Files (administrator rights); an earlier per-user install (Inno or NSIS) and its autostart entry are removed first, settings are kept.
- Open: the real silent install over an older version was not executed in this environment (script and hash logic are unit-tested; the update window is covered by the self-test); the reported button overlap in Export / Convert could not be reproduced headless, spacing was fixed and the layout test added; natives review of the 18 machine-translated languages is still pending.

## 1.9.1
- Translations: the Export/Convert, welcome guide, Opsis-family, notification and mini-player texts now exist in all 20 languages (were Greek/English only for 1.8-1.9). Coverage test: same keys and placeholders in every language, no English leftovers, no raw keys (test/i18n.test.js).
- Repo hygiene: removed make_icon.js (unused, not referenced anywhere).
- Bugs found and still open in 1.9.0 audit: 150 % DPI and RTL still not run on real hardware; spelling review of the 18 machine-translated languages still needs a native reviewer.

## 1.9.0
- Export and Converter merged into one tab "Export / Convert" (playlist tracks + files, quality presets, all formats).
- Encodes are saved to Music\WaveFrame by default (created automatically); another folder or "next to the original" can be chosen and is remembered.
- Mini player shows the live visualization instead of the animated background, with a new visualization button next to the controls; the mini window can now actually shrink.
- MIT licence for Waveframe; full texts of third-party licences (MIT, LGPL v3, GPL v3) in Help → License and the installer's `licenses` folder.
- Correct app icons in "The Opsis family"; Inno Setup wizard artwork with the Waveframe icon; SHA-256 file for every release asset.
- Fixes: switches expose role=switch/aria-checked and read their initial state from the engine; "Reset effects" also switches compressor, reverb and exciter off; names of tracks/presets are never interpreted as HTML; backup import validates its data; unhandled AbortError on quick pause; old tutorial no longer opens together with the welcome guide.
- Bug audit: 7 found / 7 fixed; open: new strings only in Greek and English, no spelling check of the other 18 languages, real 150 % DPI and RTL not tested, light/150 % screenshots partially obscured by dialogs during the automated run, the "Save to" selector is slightly narrow.

## 1.8.0
- Audio converter tab (lazy-loaded): audio and video audio tracks to WAV, FLAC, MP3, AAC, OGG, Opus, AIFF, ALAC, WMA; trim, rate, channels, LUFS target, effects, batch with cancel. FFmpeg (LGPL) downloaded only after confirmation and verified with SHA-256.

## 1.7.0
- Welcome guide, "The Opsis family" showcase, new-version notification, Inno Setup installer.

## 1.6.0
- BS.1770 loudness (LUFS), sleep timer, Equalizer APO export, AudioContext leak fix, renderer self-test.
