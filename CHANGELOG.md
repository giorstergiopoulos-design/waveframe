# Changelog

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
