# Waveframe — Master Enrichment Roadmap

Πηγές: `C:\Users\Log9\Desktop\waveframe.md` (Φάση 1) + η λίστα προτάσεων εμπλουτισμού από τη συζήτηση (Φάσεις 2-3).
Δομή εμπνευσμένη από το `MOTIONDESK_MASTER_PROPOSALS_AND_ROADMAP.md` — ένα σημείο αναφοράς, checkboxes, καμία επανάληψη της ίδιας εξήγησης σε κάθε μήνυμα.

---

## Φάση 1 — Περιεχόμενα waveframe.md

1. [x] **URL button — YouTube Music.** ΔΕΝ υλοποιήθηκε ως downloader/converter (copyright/ToS ρίσκο — βλ. #10-11 και `CLAUDE.md` κανόνα 10). Επιβεβαιώθηκε η γενική φόρτωση από οποιοδήποτε άμεσο URL αρχείου ήχου· προστέθηκε καθαρό μήνυμα σφάλματος όταν το URL δεν είναι άμεσο αρχείο ήχου (π.χ. σελίδα YouTube).
2. [x] **Μετάφραση σφάλματος export** "Unable to decode audio data..." → πλέον μεταφρασμένο μήνυμα μέσω i18n (`export.decodeError`).
3. [x] **Πολλές ακόμα γλώσσες** — σύνολο **20** (ΕΛ, ΕΝ, Γαλλικά, Γερμανικά, Ισπανικά, Ιταλικά, Πορτογαλικά, Ρωσικά, Τουρκικά, Πολωνικά, Ολλανδικά, Σουηδικά, Δανικά, Νορβηγικά, Φινλανδικά, Τσεχικά, Σλοβακικά, Ουγγρικά, Ρουμανικά, Ουκρανικά), όλες πλήρως μεταφρασμένες και επαληθευμένες (ίδιο σύνολο keys σε όλες). Οριζόντιο κυλιόμενο carousel με πραγματικές SVG σημαίες (όχι Unicode emoji — τα Windows/Chromium δεν τα αποδίδουν ως εικόνες, εμφανίζονταν ως «GR»/«GB» κ.λπ., οπότε φτιάχτηκαν 20 inline SVG σημαίες), βελάκια άκρων για scroll, εφέ επιλογής (μεγέθυνση σημαίας + θόλωμα/απόκρυψη των υπολοίπων + μίνι βελάκια δίπλα στην επιλεγμένη σημαία), και ομαλό «κυμάτισμα» σημαίας σε hover (rotateY/skew 3D, όχι απότομο ταρακούνημα). Το tab-rail αυτο-προσαρμόζει πλάτος ώστε το κείμενο να μην ξεχειλίζει σε καμία γλώσσα.
4. [x] **Δεύτερο παράθυρο Βοήθειας:** ο οδηγός ενσωματώθηκε στην καρτέλα «Οδηγίες» (πλήρες κείμενο ανά καρτέλα με τα ενημερωμένα ελληνικά ονόματα), τα κουμπιά «Προβολή οδηγού»/«Οδηγίες, ιστορικό & βοήθεια» μετακινήθηκαν στο πλαίσιο «Σχετικά», νέα καρτέλα «Άδεια χρήσης» με προσοχή στην άδεια GPL του FFmpeg.
5. [x] **20 visualizations** — Bars, Oscilloscope, Radial Spectrum, Mirror Bars, Dual Wave, Particles, Starfield, Tunnel, Spiral, Battery Bars, Plasma Blobs, Fireworks, Ribbon, Kaleidoscope, Rain, Pulse Rings, Grid Wave, Vortex, Sunburst, Bubbles. Επιλογή μέσω picker grid (🎨 Οπτικοποίηση). «Καμία» εμφανίζει το album art (ή fallback εικονίδιο) στη θέση του καμβά.
6. [x] **15 ακόμα skins** (σύνολο 20: Midnight, Daylight, Retro LCD, Sunset, Monochrome, Ocean, Forest, Rose, Amber, Ice, Lavender, Crimson, Emerald, Slate, Coral, Neon, Sepia, Graphite, Mint, Solar) σε οριζόντιο κυλιόμενο πλαίσιο με βελάκια άκρων.
6b. [x] **«Classic» layout** — δομικά διαφορετική διάταξη κύριου παραθύρου (οριζόντια μπάρα καρτελών στην κορυφή αντί για κάθετο πλευρικό μενού), ανεξάρτητη επιλογή από το χρωματικό θέμα, στις Ρυθμίσεις. Scoped ως proof-of-concept (1 εναλλακτικό layout, όχι πλήρης μηχανή N layouts).
7. [x] **Button variations** — 4 στυλ για τα κουμπιά του player (Στρογγυλά/προεπιλογή, Τετράγωνα, Περίγραμμα, Γυαλιστερά), επιλογή στις Ρυθμίσεις, persist. (Bonus: οι σημαίες του language carousel πλέον «κυματίζουν» σε hover.)
8. [x] **Καθαρισμός αγγλικών όρων** από την ελληνική μετάφραση: tabs (Player/Enhance/Export→Αναπαραγωγή/Ενισχυτής Ήχου/Εξαγωγή), Playlist, Crossfade, Test Tone, Equalizer, Bass/Volume Boost, Compressor, Reverb, Exciter, Tempo, Lossless, "Dependencies", Cloud Sync, preset names (Music/Gaming/Movies/Voice/Small Speakers/Treble Boost), FAQ. Εξαιρέθηκαν σκόπιμα: ονόματα μουσικών ειδών (Rock/Pop/Jazz κ.λπ.), ονόματα skins/backgrounds (Midnight, Vinyl Nebula κ.λπ.) και τεχνικά standards (URL, MP3, FFmpeg) ως proper nouns/διεθνείς όροι.
9. — (κενό στο πρωτότυπο md)
10-11. [x] **Νομική ανάλυση YouTube Music ripping** — δόθηκε ως κείμενο στη συζήτηση· καμία υλοποίηση downloader· κανόνας καταγράφηκε μόνιμα στο `CLAUDE.md` (#10).
12. [x] **(Bonus, από follow-up ερώτηση) Άδεια FFmpeg.** Έρευνα σε αντίστοιχα projects (Electron/Qt/.NET/Python) επιβεβαίωσε ότι η σωστή πρακτική για κλειστή/ιδιόκτητη εφαρμογή είναι build **LGPL**, όχι GPL. Αφαιρέθηκε εντελώς η εξάρτηση `ffmpeg-static` (ήταν GPL-3.0-or-later), το fallback download άλλαξε σε BtbN **lgpl** build, και προστέθηκε έλεγχος για ήδη-εγκατεστημένο FFmpeg στο system PATH πρώτα (π.χ. codec pack) πριν από οποιαδήποτε λήψη. Καταγράφηκε στο `CLAUDE.md` (#11) και στην καρτέλα «Άδεια χρήσης».

## Φάση 2 — Προτάσεις εμπλουτισμού #1 + #5

**#1 Audio engine / DSP depth**
- [x] Parametric EQ mode: εναλλαγή Sliders/Καμπύλη πάνω από το EQ rack· η καμπύλη είναι draggable (κλικ+σύρε πάνω σε οποιοδήποτε από τα 10 σημεία αλλάζει το αντίστοιχο band σε πραγματικό χρόνο, με smooth quadratic interpolation ανάμεσα στα σημεία)
- [x] A/B compare: ήδη καλυμμένο πλήρως από τον master enable/disable διακόπτη του Ενισχυτή Ήχου (real audio bypass) — δεν χρειάστηκε ξεχωριστό κουμπί
- [x] Loudness normalization: ανάλυση RMS→gain (κλείνει σε -18dB reference, clamp ±12dB) στο πρώτο play κάθε κομματιού, cache στο ίδιο το playlist item, εφαρμόζεται μέσω αποκλειστικού `normGain` node πριν το EQ· διακόπτης on/off στα Προηγμένα Εφέ
- [x] Limiter στο master bus (DynamicsCompressorNode, threshold -1dB, ratio 20) πριν τον αναλυτή/έξοδο, ίδιος limiter και στο offline export path ώστε exports = live playback
- [x] Presets (custom, όχι τα built-in) θυμούνται πλήρη κατάσταση: bands + bassBoost + volumeBoost + surround + compressor + reverb + exciter

**#5 UI/UX & personalization**
- [x] Resizable playlist: drag handle κάτω από τη λίστα, ύψος 120-500px, persist. («Undockable» σε ξεχωριστό παράθυρο ρητά εκτός scope — μεγάλη αρχιτεκτονική αλλαγή για περιορισμένο όφελος)
- [x] Custom accent-color picker στις Ρυθμίσεις: `<input type=color>` παράγει --accent/-2/-3 μέσω HSL, override πάνω από οποιοδήποτε από τα 20 skins, με κουμπί «Επαναφορά θέματος»
- [x] Mini/compact always-on-top mode: κουμπί στη γραμμή τίτλου συρρικνώνει το παράθυρο (340×130, alwaysOnTop, μη-resizable) σε ένα compact bar με album art + track name + prev/play/next + επαναφορά

## Φάση 3 — Προτάσεις εμπλουτισμού #6, #7, #8, #9 (πλην auto-updater)

**#6 Windows platform integration**
- [x] SMTC (System Media Transport Controls) — έλεγχος από το Windows volume flyout / lock screen / ακουστικά Bluetooth (μέσω `navigator.mediaSession`, χωρίς native dependency)
- [x] Jump list (δεξί κλικ στο taskbar icon) με Play/Pause, Next, πρόσφατα κομμάτια
- [x] Auto-launch on login toggle στις Ρυθμίσεις

**#7 Reliability & performance**
- [x] Crash/error overlay (σύλληψη `window.onerror`/`unhandledrejection`) αντί για σιωπηλή αποτυχία, με crash log στο `userData`
- [x] Βασικά automated smoke tests (`npm run smoke-test` — άνοιγμα app, έλεγχος run.log, καθαρισμός χωρίς orphan processes)
- [x] Επαλήθευση πραγματικού packaged build (`npm run dist`) — ξανά-επιβεβαιώθηκε με το νέο NSIS config (license pages, multi-language installer, shortcuts, file associations)

**#8 Accessibility**
- [x] Πλήρης πλοήγηση με πληκτρολόγιο: global shortcuts (Space/βέλη/M/N/P) + ορατά focus rings (`:focus-visible`)
- [x] `aria-label`/σωστές Ελληνικές μεταφράσεις σε κουμπιά μόνο-εικονιδίου (Shuffle/Repeat/Mute/θέμα/mini-bar)
- [x] Σεβασμός `prefers-reduced-motion` για animated φόντα (CSS + έλεγχος και στο `backgrounds.js`)

**#9 Distribution (πλην auto-updater)**
- [ ] Code signing για NSIS/portable builds (SmartScreen trust) — **blocked**: απαιτεί πιστοποιητικό code-signing που πρέπει να προμηθευτεί ο χρήστης (π.χ. Authenticode cert), δεν μπορεί να γίνει αυτόνομα. Το manual update-check (`btnCheckUpdates`) είναι λειτουργικό στον κώδικα αλλά ανενεργό μέχρι να οριστεί πραγματικό public repo στο `WAVEFRAME_REPO` (renderer/app.js).

**Bonus (πέρα από το αρχικό roadmap, ζητήθηκαν σε αυτό το πέρασμα)**
- [x] Installer μοντελοποιημένος στο GearWin (github.com/giorstergiopoulos-design/GearWin): per-language EULA (`build/license_<lang>.txt` ×20 + fallback), `multiLanguageInstaller`, `oneClick:false`, shortcuts, `fileAssociations` (mp3/wav/flac/ogg/m4a/opus/wma)
- [x] Animated backgrounds: 3 → **10 συνολικά** (+starfield, aurora, vinylspin, particledrift, mesh, grid, bokeh), scrollable carousel UI με βελάκια
- [x] Πλήρης μετάφραση: **20/20 γλώσσες 100% complete**, verified με αυτοματοποιημένο keys-diff script
- [x] Window-state persistence (θέση/μέγεθος, πολλαπλές οθόνες), single-instance lock, file-association open-with, resizable playlist, EQ curve editor (drag), custom accent color, mini-mode floating bar

---

## Κατάσταση εκτέλεσης
Ενημερώνεται εδώ με ✅ / ημερομηνία καθώς ολοκληρώνονται στοιχεία — δεν επαναλαμβάνεται πλήρης περιγραφή στο chat, μόνο αναφορά στο αντίστοιχο νούμερο.

- ✅ **2026-09-30 — Φάση 1 ολοκληρώθηκε πλήρως** (όλα τα 1-11, με τις γλώσσες επεκταμένες σε 20 συνολικά). Version bump **v1.3.0**, πλήρες QA pass από το `WAVEFRAME_QA_CHECKLIST.md`: `npm run dist` πραγματικά δοκιμάστηκε (πρώτη φορά) και επιτυχές, packaged `.exe` εκκινήθηκε καθαρά, real-world encoding test με πραγματικό κατεβασμένο MP3 σε όλες τις μορφές εξαγωγής βρήκε και διόρθωσε πραγματικό bug (Opus + 44.1kHz), και το Opus απέκτησε δική του κλίμακα ποιότητας/bitrate.
- ✅ **2026-10-01 — Φάση 2 ολοκληρώθηκε πλήρως.** Version bump **v1.4.0**. Μία τελική επαλήθευση (όχι επαναλαμβανόμενα launches, κατόπιν ρητού αιτήματος) — καθαρή εκκίνηση, κανένα σφάλμα. Μεταφράσεις νέων strings προστέθηκαν μόνο στα Ελληνικά (`el`) αυτή τη φορά — batch μετάφραση σε όλες τις 19 άλλες γλώσσες αναβλήθηκε ρητά για το τέλος της Φάσης 3.
- ✅ **2026-10-01 — Φάση 3 ολοκληρώθηκε πλήρως + bonus items.** #6, #7, #8 πλήρως υλοποιημένα και επαληθευμένα· #9 blocked με σαφή τεκμηρίωση (χρειάζεται cert από τον χρήστη). Προστέθηκαν επίσης όλα τα bonus: GearWin-style installer/EULA, φόντα 3→10, πλήρης μετάφραση 20 γλωσσών, SMTC/jump-list/autostart, crash overlay, smoke-test, keyboard shortcuts + cheat sheet, aria-labels, reduced-motion, focus-visible, window-state persistence, single-instance lock, file associations, EQ curve editor, accent color, mini-mode. `node --check` καθαρό σε όλα τα αρχεία, `npm run smoke-test` περνάει χωρίς orphan processes, `npm run dist` ξανά-επιβεβαιώθηκε με το νέο NSIS config. Version bump **v1.5.0**.
- Επόμενο βήμα: καμία άλλη φάση δεν εκκρεμεί στο roadmap — το project είναι σε feature-complete κατάσταση πλην code signing (μπλοκαρισμένο, βλ. #9) και ενεργοποίησης του update-checker (χρειάζεται πραγματικό public repo).
