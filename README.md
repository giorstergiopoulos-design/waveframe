# Waveframe

Ένας δωρεάν, πραγματικός ενισχυτής ήχου και media player για Windows 10/11, χτισμένος από την αρχή με Electron και το native Web Audio API του browser — χωρίς εξωτερικό DSP engine. Φορτώνει τοπικά αρχεία, URLs, ή το μικρόφωνό σου, περνάει τον ήχο μέσα από μια πλήρη αλυσίδα ενίσχυσης σε πραγματικό χρόνο (ισοσταθμιστής, μπάσα, 3D περιβάλλων ήχος, compressor, reverb, exciter, loudness normalization, limiter), και μπορεί να εξάγει το αποτέλεσμα σε 7 μορφές αρχείου μέσω FFmpeg.

*A free, real-time audio enhancer and media player for Windows 10/11, built from scratch with Electron and the browser's native Web Audio API — no external DSP engine. See the [English section](#english) below.*

## Περιεχόμενα / Contents

- [Ελληνικά](#ελληνικά)
- [English](#english)
- [Άδεια / License](#άδεια--license)

## Ελληνικά

### Λειτουργίες

| Ενότητα | Τι κάνει |
|---|---|
| ▶️ Αναπαραγωγή | Φόρτωση αρχείου/URL/μικροφώνου/test tone, playlist με drag-drop, crossfade, album art & μεταδεδομένα, 20 visualizers |
| 🎚 Ενισχυτής Ήχου | 10-ζωνών ισοσταθμιστής (sliders ή draggable καμπύλη), Ενίσχυση Μπάσων/Έντασης, 3D Περιβάλλων Ήχος, Compressor/Reverb/Exciter, loudness normalization, master limiter — όλα με master bypass χωρίς απώλεια ρυθμίσεων |
| 💾 Εξαγωγή | Batch export επιλεγμένων κομματιών σε WAV/MP3/FLAC/OGG/AAC(M4A)/Opus/WMA, ποιότητα έως 320kbps ή χωρίς απώλειες, με όλα τα ενεργά εφέ ενσωματωμένα |
| 🎨 Εμφάνιση | 20 θέματα (skins), 10 κινούμενα φόντα, 20 visualizers, 2 διατάξεις παραθύρου (Modern/Classic), custom accent color, mini/compact always-on-top mode |
| 🌐 Γλώσσες | Πλήρης διεπαφή σε 20 γλώσσες (Ελληνικά, Αγγλικά, Γαλλικά, Γερμανικά, Ισπανικά, Ιταλικά, Πορτογαλικά, Ρωσικά, Τουρκικά, Πολωνικά, Ολλανδικά, Σουηδικά, Δανικά, Νορβηγικά, Φινλανδικά, Τσεχικά, Σλοβακικά, Ουγγρικά, Ρουμανικά, Ουκρανικά) |
| 🖥 Windows integration | SMTC (έλεγχος από lock screen/ακουστικά Bluetooth), taskbar thumbbar & jump list, συσχέτιση αρχείων ήχου, auto-launch on login, toast ειδοποιήσεις αλλαγής κομματιού |
| ♿ Προσβασιμότητα | Πλήρης πλοήγηση με πληκτρολόγιο, ορατά focus rings, σεβασμός `prefers-reduced-motion` |
| 🛡 Αξιοπιστία | Crash overlay με αρχείο καταγραφής αντί για σιωπηλή κατάρρευση, backup/restore ρυθμίσεων σε JSON (για συγχρονισμό μέσω OneDrive/Drive/Dropbox) |

### Εγκατάσταση

Κατέβασε το τελευταίο `Waveframe-Setup-*.exe` από τα [Releases](../../releases) και εκτέλεσέ το — ο οδηγός εγκατάστασης υποστηρίζει επιλογή γλώσσας/φακέλου εγκατάστασης και δημιουργεί συντομεύσεις επιφάνειας εργασίας/μενού Έναρξης. Υπάρχει επίσης μια φορητή (portable) έκδοση `Waveframe-*.exe` που δεν απαιτεί εγκατάσταση.

Η εφαρμογή χρειάζεται ένα FFmpeg (LGPL build) για την εξαγωγή αρχείων· αν δεν υπάρχει ήδη στο σύστημα, το κατεβάζει μόνη της από τις Ρυθμίσεις → Dependencies με ένα κλικ.

### Χτίσιμο από τον πηγαίο κώδικα

```
npm install
npm start          # εκκίνηση σε dev mode
npm run smoke-test # αυτοματοποιημένος έλεγχος εκκίνησης χωρίς σφάλματα
npm run dist        # παράγει portable + NSIS installer (Windows x64) στο release/
```

### Δομή αποθετηρίου

- `main.js` / `preload.js` — Electron main process + context-isolated bridge
- `renderer/` — η ίδια η εφαρμογή (vanilla JS/HTML/CSS, χωρίς framework): `app.js` (audio engine & UI), `i18n.js` (20 γλώσσες), `backgrounds.js` (10 κινούμενα φόντα), `help.html` (ενσωματωμένος οδηγός/ιστορικό/άδεια)
- `build/` — per-language EULA αρχεία για τον installer
- `WAVEFRAME_ROADMAP.md` / `WAVEFRAME_QA_CHECKLIST.md` — ιστορικό ανάπτυξης ανά φάση και λίστα ελέγχου ποιότητας

## English

Waveframe is a free, real-time audio enhancer and media player for Windows 10/11, built from scratch with Electron and the browser's native Web Audio API — no external DSP engine. It loads local files, URLs, or your microphone, runs the audio through a full real-time enhancement chain (equalizer, bass boost, 3D surround, compressor, reverb, exciter, loudness normalization, limiter), and can export the result to 7 file formats via FFmpeg.

### Features

| Area | What it does |
|---|---|
| ▶️ Playback | File/URL/microphone/test-tone input, drag-drop playlist, crossfade, album art & metadata, 20 visualizers |
| 🎚 Audio Enhancer | 10-band equalizer (sliders or a draggable curve), Bass/Volume Boost, 3D Surround, Compressor/Reverb/Exciter, loudness normalization, master limiter — all with a master bypass that never loses your settings |
| 💾 Export | Batch-export selected tracks to WAV/MP3/FLAC/OGG/AAC(M4A)/Opus/WMA, up to 320kbps or lossless, with every active effect baked in |
| 🎨 Appearance | 20 skins, 10 animated backgrounds, 20 visualizers, 2 window layouts (Modern/Classic), custom accent color, mini/compact always-on-top mode |
| 🌐 Languages | Full interface in 20 languages (Greek, English, French, German, Spanish, Italian, Portuguese, Russian, Turkish, Polish, Dutch, Swedish, Danish, Norwegian, Finnish, Czech, Slovak, Hungarian, Romanian, Ukrainian) |
| 🖥 Windows integration | SMTC (lock screen / Bluetooth headset controls), taskbar thumbbar & jump list, audio file associations, auto-launch on login, track-change toast notifications |
| ♿ Accessibility | Full keyboard navigation, visible focus rings, respects `prefers-reduced-motion` |
| 🛡 Reliability | Crash overlay with a log file instead of a silent failure, JSON backup/restore of all settings (for syncing via OneDrive/Drive/Dropbox) |

### Installation

Download the latest `Waveframe-Setup-*.exe` from [Releases](../../releases) and run it — the installer wizard supports choosing a language/install folder and creates desktop/Start Menu shortcuts. A portable `Waveframe-*.exe` build that needs no installation is also provided.

The app needs an FFmpeg (LGPL build) for exporting; if one isn't already on your system, it can download it itself from Settings → Dependencies with one click.

### Building from source

```
npm install
npm start          # launch in dev mode
npm run smoke-test # automated startup/crash check
npm run dist        # produces a portable build + NSIS installer (Windows x64) in release/
```

### Repository layout

- `main.js` / `preload.js` — Electron main process + context-isolated bridge
- `renderer/` — the app itself (vanilla JS/HTML/CSS, no framework): `app.js` (audio engine & UI), `i18n.js` (20 languages), `backgrounds.js` (10 animated backgrounds), `help.html` (built-in guide/changelog/license)
- `build/` — per-language EULA files for the installer
- `WAVEFRAME_ROADMAP.md` / `WAVEFRAME_QA_CHECKLIST.md` — phase-by-phase development history and QA checklist

## Άδεια / License

Το ίδιο το Waveframe διανέμεται ελεύθερα για προσωπική χρήση, αλλά **δεν** είναι ανοιχτού κώδικα υπό κάποια OSI άδεια (κλειστός πηγαίος κώδικας/all-rights-reserved πέραν της ελεύθερης χρήσης). Ενσωματώνει βιβλιοθήκες ανοιχτού κώδικα άδειας MIT (Electron, music-metadata, adm-zip) και προαιρετικά ένα FFmpeg άδειας **LGPL** (ποτέ GPL) για την εξαγωγή αρχείων. Πλήρη στοιχεία αδειοδότησης υπάρχουν στην καρτέλα «Άδεια χρήσης» μέσα στην εφαρμογή (Βοήθεια → Άδεια χρήσης) και στα `build/license_*.txt`.

*Waveframe itself is distributed free for personal use, but is **not** open-source under an OSI license (closed-source/all-rights-reserved beyond free use). It bundles MIT-licensed open-source libraries (Electron, music-metadata, adm-zip) and optionally an **LGPL** (never GPL) FFmpeg build for exporting. Full license details are in the in-app "License" tab (Help → License) and in `build/license_*.txt`.*

**Το λογισμικό παρέχεται "ΩΣ ΕΧΕΙ", χωρίς καμία εγγύηση. / Provided "AS IS", without warranty of any kind.**
