# Opsis Media Suite (πρώην / formerly Opsis Media Suite)

**Έκδοση / Version:** 2.1.0 (πρώτο βήμα / first step) · Βάση / base: **Electron** (renderer = HTML/JS + Web Audio, main = Node)

## 1. Απόφαση και πλαίσιο

Η μελέτη «Opsis Media Suite» (GUIDELINES.md) πρότεινε ως ιδανικό ένα WPF shell με WebView2 και LibVLC. Ο χρήστης αποφάσισε να ξεκινήσει το Media Suite με βάση το **Opsis Media Suite (Electron)**. Αυτό το έγγραφο περιγράφει τι μοιράζονται σήμερα τα προϊόντα, τη συγκεκριμένη αρχιτεκτονική του 2.1.0 και, ρητά, τι **δεν** γίνεται ακόμη.

*The study proposed a WPF + WebView2 + LibVLC shell as the end goal. The user decided to start the Media Suite from **Opsis Media Suite (Electron)**. This document says what is shared today, the concrete 2.1.0 architecture, and — explicitly — what is not done yet.*

| Προϊόν | Τεχνολογία | Ρόλος στο Suite |
|---|---|---|
| **Opsis Media Suite** | Electron, Web Audio, FFmpeg (LGPL, κατεβαίνει με επιβεβαίωση) | Βελτίωση/αναπαραγωγή ήχου, **μετατροπέας ήχου και βίντεο**, ενιαίος μηχανισμός ενημέρωσης |
| **Opsis Media Player Pro** | WPF .NET 10, LibVLCSharp | Παραμένει **ξεχωριστό προϊόν** (player βίντεο/ήχου, υπότιτλοι, Chromecast). Καμία συγχώνευση κώδικα στο 2.1.0 |

## 2. Αρχιτεκτονική 2.1.0

```
renderer (HTML/JS, sandbox, CSP)           main process (Node)                      ffmpeg (LGPL, PATH ή λήψη με SHA-256)
┌──────────────────────────────┐   IPC     ┌──────────────────────────────┐  args[]  ┌──────────────────┐
│ Καρτέλα «Εξαγωγή/Μετατροπή»  │ ───────▶ │ conv-main.js (έλεγχος αποστ.  │ ───────▶ │ ήχος: decode →   │
│  • κάρτα ΗΧΟΥ  (convlib.js)  │          │   και ορισμάτων, όρια)        │          │ encode           │
│  • κάρτα ΒΙΝΤΕΟ (vidlib.js)  │ ◀─────── │ conv-engine.js: ουρά, ακύρωση,│ ◀─────── │ βίντεο: decode → │
│  • κοινή ουρά/πρόοδος/ακύρωση│ progress │   πρόοδος, καθαρισμός αρχείων │ stderr   │ scale → encode   │
└──────────────────────────────┘          └──────────────────────────────┘          └──────────────────┘
```

### Τι μοιράζονται ήχος και βίντεο (ήδη στο 2.1.0)
- **Μία ουρά κωδικοποίησης** (`createQueue` της `convlib.js`): σειριακά, συνολική πρόοδος, ακύρωση, σφάλματα ανά αρχείο χωρίς να σταματά η ουρά.
- **Ένας μηχανισμός ffmpeg:** ίδια εύρεση (PATH ή επαληθευμένη λήψη LGPL), ίδιο spawn με **πίνακα ορισμάτων** (ποτέ συνένωση string/shell), ίδιος καθαρισμός μισού αρχείου, ίδιο όνομα εξόδου με επίθημα που δεν αντικαθιστά ποτέ το πρωτότυπο.
- **Ένας μετατροπέας:** η ίδια καρτέλα, ο ίδιος φάκελος εξόδου και η ίδια λογική «δίπλα στο αρχικό / προεπιλεγμένος φάκελος / δικός μου» (ήχος: Μουσική\Opsis Media Suite· βίντεο: Βίντεο\Opsis Media Suite).
- **Θέματα και γλώσσες:** τα ίδια skins/CSS variables και οι ίδιες 20 γλώσσες.
- **Εφέ ήχου:** το ηχητικό κομμάτι ενός βίντεο μπορεί να περάσει από το δικό του μονοπάτι ήχου (EQ/LUFS της κάρτας ήχου) στο 2.1.1· στο 2.1.0 το βίντεο αντιγράφει ή επανακωδικοποιεί τον ήχο με ffmpeg.

### Κωδικοποίηση βίντεο: δύο επίπεδα δυνατοτήτων
1. **Web APIs (πληροφοριακά, ανίχνευση):** `VideoEncoder.isConfigSupported` (WebCodecs: H.264/VP9/AV1), `MediaRecorder.isTypeSupported` και `HTMLVideoElement` εμφανίζονται στο UI ως «Τι υποστηρίζει ο περιηγητής». Η εγγραφή/κωδικοποίηση ΜΕ Web APIs δεν χρησιμοποιείται ακόμη ως μηχανή.
2. **Τοπικοί κωδικοποιητές μέσω ffmpeg (η μηχανή του 2.1.0):** ανίχνευση με `ffmpeg -encoders` και `-hwaccels`: `libx264`, `libx265`, `libvpx-vp9`, `libsvtav1`/`libaom-av1` και hardware `h264/hevc/av1_nvenc`, `h264/hevc/av1_qsv`, `h264/hevc/av1_amf`. Αυτόματη επιλογή του καλύτερου διαθέσιμου (hardware → λογισμικό), με σαφή ένδειξη στο UI τι βρέθηκε/λείπει.

## 3. Φάσεις της μελέτης vs 2.1.0

| Φάση της μελέτης | Κατάσταση |
|---|---|
| 1. Σκελετός (WPF + WebView2) | **Όχι.** Η βάση παραμένει Electron· το WPF shell μένει ως μακροπρόθεσμος στόχος |
| 2. Επιλογή όψης «Interface: Classic / Wave» | **Όχι ακόμη.** Θα γίνει όταν ένα κοινό shell φιλοξενήσει και τις δύο όψεις |
| 3. Ένα σερβίς κωδικοποίησης (ουρά FFmpeg) | **Ναι, για ήχο και βίντεο** μέσα στο Opsis Media Suite (ουρά + ακύρωση + πρόοδος + έλεγχος ορισμάτων) |
| 4. Φωτογραφίες (καρτέλα επεξεργασίας) | **Όχι** (2.2+) |
| 5. Κοινή μηχανή ήχου (DSP πάνω σε LibVLC callbacks) | **Όχι** |

## 4. Τι ΔΕΝ γίνεται ακόμη (ρητά)
- Συγχώνευση με το Media Player Pro, LibVLC, Chromecast/DLNA, κοινό shell και «Interface».
- Κωδικοποίηση βίντεο **μόνο με Web APIs** (WebCodecs/MediaRecorder) χωρίς ffmpeg· χρειάζεται muxer (MP4/WebM) — 2.1.1+.
- Επεξεργασία φωτογραφιών, μείωση θορύβου/φωνής ήχου με φίλτρα (afftdn, loudnorm) στο βίντεο.
- ~~Μετονομασία προϊόντος σε «Opsis Media Suite»~~ — έγινε στο 2.2.0 (repo, φάκελος ρυθμίσεων και κλειδιά ρυθμίσεων κρατούν το παλιό όνομα επίτηδες).
- Επαλήθευση hardware encoders σε πραγματική GPU (ανιχνεύονται από τη λίστα του ffmpeg· η πραγματική χρήση εξαρτάται από drivers).

## 5. Ασφάλεια και όρια (ισχύουν για κάθε κωδικοποίηση)
- Το ffmpeg ξεκινά πάντα με **πίνακα ορισμάτων**· οι διαδρομές είναι απόλυτες, υπάρχοντα αρχεία (είσοδος) και ελέγχονται· κανένα όρισμα δεν προέρχεται από string χρήστη χωρίς επικύρωση.
- Φίλτρα με διαδρομές (υπότιτλοι burn-in) περνούν από ειδικό escaping και μόνο από υπάρχοντα αρχεία.
- Όρια: μέγιστο πλήθος αρχείων ουράς, ανάλυση ≤ 7680×4320, fps ≤ 240, bitrate/CRF σε εύρος· καθαρισμός μισού αρχείου σε ακύρωση/σφάλμα.
- Η εφαρμογή δεν τρέχει τίποτα που δεν έχει επαληθευτεί (λήψη FFmpeg με SHA-256, ενημέρωση με SHA-256).


## Media Player Pro → Opsis Media Suite (2.3.0)
| Media Player Pro | In the Suite | Notes |
|---|---|---|
| Player (LibVLC) | Video tab (HTML5 video + the Suite's DSP) | Formats Chromium cannot play: convert in Export / Convert. DVD, capture devices: not carried over |
| recent.txt, bookmarks.txt, resume.txt | Importer → recent, bookmarks, resume positions | merged, deduplicated, local positions win |
| settings.json | Importer → subtitle options (languages, size, colour, auto-sync, plain name) | **OsApiKey / OsUsername / OsPassword are never copied** |
| audio.json, audio-presets.json | Importer → equaliser presets | the 10 bands are re-mapped to the Suite's frequencies by interpolation; bass level 0–10 → bass boost dB |
| skin / mode / accent | Importer → light/dark skin and accent colour | Wave/Classic is not a Suite concept |
| M3U playlists | "Add M3U playlists…" in the importer and in the Video tab | relative entries are resolved against the file |
| convert-dir.txt | Importer → video output folder | |
| meta\*.json, suite.json, window.txt | not migrated | cache / update state / window geometry |

Safety rules of the importer: the source folder is only opened for reading (size-capped, links not followed); a backup is written to the app's data folder before anything changes; only ticked categories are merged; nothing is deleted; running it twice changes nothing the second time. Tests: `test/mpp-import.test.js` (synthetic fixtures) and the Electron self-test (byte-identical source).
