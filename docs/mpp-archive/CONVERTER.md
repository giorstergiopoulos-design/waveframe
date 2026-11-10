# Converter — what is really supported / Μετατροπέας — τι υποστηρίζεται πραγματικά

Bundled libvlc: **3.0.21** (VideoLAN.LibVLC.Windows). Every format below was produced by a real conversion in `--selftest` (and in the probe before it) and the result was re-opened to check duration and size. Anything not in the list is **not offered**, because this libvlc cannot produce it.

| Output | Video | Audio options | Verified (duration / resolution) |
|---|---|---|---|
| MP4 | MPEG-4 Part 2 | AAC, MPEG audio, none, copy | yes / yes |
| WebM | VP8 | Vorbis, Opus, none | yes / yes |
| WebM, MKV | VP9 (marked *experimental*) | Opus, Vorbis, none | plays; the file is ~0.9 s shorter than requested (libvlc encoder does not flush) |
| AVI | MPEG-4 / Motion JPEG | MPEG audio, none | yes / height rounded to a multiple of 16 |
| WMV / ASF | WMV2 | WMA, MPEG audio, none | yes; the ASF header reports ~2 s less (preroll) |
| TS | MPEG-2 | MPEG audio, AAC, none | duration yes; libvlc does not report the size |
| OGV | Theora | Vorbis, Opus, none | duration yes; libvlc does not report the size |
| Images | PNG, JPEG: current frame, frame sequence (every N seconds or N frames, with start–end range), poster frame, contact sheet (PNG) | | yes |

**Not available (measured, not guessed):** H.264 and H.265/HEVC (the bundled x264 plugin is the 10-bit build and every attempt produced an empty file — this also means the old "Convert to MP4 (H.264)" menu item never worked and was replaced), animated GIF, WebP, MP3 *encoder* (lame is not bundled; "MPEG audio" is MPEG-1 layer 2/3 through libavcodec), WebM/MKV with H.264.

Rules: the original is only read; outputs go to `Videos\Opsis Media Player` (changeable in the dialog, remembered) with a suffix and `(2)`, `(3)` … if the name exists; the output can never be the source file. Trim uses the A-B markers or typed seconds. Queue with progress, ETA, cancel.

Audio-only conversion (MP3 extraction) is unchanged; other audio formats belong to Waveframe.
