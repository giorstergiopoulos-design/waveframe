# Changelog

## 2.2.0 — Waveframe is now Opsis Media Suite
- **Renamed:** the product, window titles, installer, shortcuts, Help, licence pages and all 20 languages now say "Opsis Media Suite". Files: OpsisMediaSuite-Setup-<version>.exe (installer) and OpsisMediaSuite-<version>.exe (portable). The repository, the settings folder (%AppData%\waveframe), the saved settings and the localStorage keys keep their old names on purpose, so nothing is lost.
- **Upgrade from Waveframe:** the new installer has a new AppId and removes the old Waveframe (Program Files or per-user) first; an autostart entry of the old copy is carried over. The default audio folder is Music\Opsis Media Suite (Music\WaveFrame is left untouched).
- **Updates of old versions:** a Waveframe 2.1.x client still looks for Waveframe.Setup.*.exe, so the release also carries a copy with that name (identical content, own .sha256); the new client accepts both names.
- The "part of the Opsis Media Suite" line in About was removed (it is the product name now). 20 languages, tests updated.

## 2.1.0 — Waveframe, part of the Opsis Media Suite (first step)
- **Video converter** in its own card beside the audio card of the Export / Convert tab, with the same queue/progress/cancel/cleanup engine: presets (YouTube 1080p/4K, small web, H.265 archive, phone/device, WebM VP9, GIF, extract audio), codec (H.264, H.265, VP9, AV1), container, resolution (never upscales), fps, CRF or target bitrate, 1-/2-pass, encoder speed, trim, remove audio, audio track and codec, embedded or burned-in subtitles (own track or external file), size estimate, thumbnail and probe info, output to Videos\Opsis Media Suite (or next to the original / a folder you pick, remembered).
- **Encoders:** detected with ffmpeg -encoders / -hwaccels; hardware (NVENC, QuickSync, AMF) first, software as automatic fallback; the UI shows what was found and what is missing. The LGPL ffmpeg that Waveframe downloads has no libx264/libx265 (GPL): software H.264 is OpenH264 (bitrate only), H.265 needs a GPU encoder; a user's own ffmpeg on PATH is used as is.
- Browser capabilities (WebCodecs VideoEncoder.isConfigSupported, MediaRecorder) are detected and shown, not used as the engine yet.
- Safe command building (argument arrays only), path and range validation, subtitle-path escaping, half-written files removed on error/cancel; IPC validated like every other channel.
- docs/MEDIA-SUITE.md: architecture and what is NOT done yet. About shows "Part of the Opsis Media Suite". 20 languages, ARIA, layout self-test over 20 languages x 100 % / 150 %, unit + real transcode tests (PATH ffmpeg and the LGPL build).
- Not done / for 2.1.1: transcoding with Web APIs only (no ffmpeg), real GPU encoding verified on more machines, audio chain (EQ/LUFS) for the audio of a video, Media Player Pro merge, photo tab, product renaming.

## 2.0.0
- Update mechanism, same as the Opsis News Crawler: check 30 s after start and every 24 h with ETag; one balloon per version, none while a game / full-screen app / presentation is in front (retry after 15 min); the balloon opens a window with Download and install, Later, Skip this version and What's new; the setup is downloaded from this repository's releases only, verified with SHA-256 (GitHub digest or the .sha256 asset), re-checked by a helper and installed silently, then the app restarts. Nothing unverified is ever run; portable copies and versions without a digest open the release page. All texts in 20 languages (balloon, window, dialogs, FFmpeg download confirmation).
- Export / Convert layout: every group of controls has its own spacing; layout self-test over 20 languages x 100 % / 150 % with files listed and while converting.
- Security: IPC channels answer only the main window and validate types/sizes; stricter CSP (object-src, base-uri, form-action); bounded and rotated crash log; tags read only from absolute audio-file paths; Help window navigation lock; static security tests; GitHub Actions CI (npm test + Electron self-test).
- Installer: machine-wide in Program Files (administrator rights); an earlier per-user install (Inno or NSIS) and its autostart entry are removed first, settings are kept.
- Verified afterwards: the real PowerShell update helper runs end to end with a fake setup (waits for the app, re-checks SHA-256, silent switches, restarts from Program Files; a tampered file is refused with exit 2) - test/update-helper.test.js; a real Windows toast is shown (Notification 'show' event); the Help changelog entry is localised in 20 languages.
- Open: the elevated Inno install over an older version (needs a UAC click on a real PC), clicking the toast, and native-speaker / spell-checker review of the 18 machine-translated languages.

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
