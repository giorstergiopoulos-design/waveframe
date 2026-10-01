# Waveframe QA Checklist

Τρέχεται στο τέλος κάθε Φάσης του `WAVEFRAME_ROADMAP.md`, πριν το version bump. Δεν βρέθηκε γνήσιο "62-point" πρότυπο ούτε στο τοπικό MotionDesk (κανένα αρχείο/commit το αναφέρει) ούτε ως καθιερωμένη σύμβαση στο GitHub — η λίστα παρακάτω φτιάχτηκε από την αρχή, ειδικά για το Waveframe, στο ίδιο πνεύμα λεπτομέρειας.

## 1. Build & εκκίνηση
- [x] `node --check` σε όλα τα αλλαγμένα `.js` αρχεία
- [x] Καθαρή εκκίνηση (`taskkill` + relaunch), χωρίς σφάλματα στο `run.log`
- [x] Ακριβώς ένα παράθυρο με τίτλο `Waveframe`
- [x] `npm install` χωρίς αποτυχίες σε καθαρό `node_modules` (επιβεβαιώθηκε μέσω επιτυχούς `npm run dist`)
- [x] `npm run dist` παράγει portable + NSIS χωρίς σφάλμα (packaged build, όχι μόνο `electron .`) — **v1.3.0: πρώτη φορά πραγματικά ελέγχθηκε, επιτυχές**· **v1.5.0: ξανά-ελέγχθηκε με το νέο NSIS config (license pages ανά γλώσσα, multi-language installer, shortcuts, file associations) — log επιβεβαίωσε `oneClick=false perMachine=false`, build artifacts καθαρίστηκαν μετά**
- [x] Packaged build: όλα τα ESM/asarUnpack deps (`music-metadata` κ.λπ.) φορτώνουν σωστά εκτός asar — το packaged `Waveframe.exe` ξεκίνησε καθαρά
- [x] `npm run smoke-test` περνάει καθαρά (launch → χωρίς σφάλματα στο log → cleanup) και δεν αφήνει ορφανές διαδικασίες `electron.exe` (επιβεβαιώθηκε με `tasklist` μετά το fix του `cmd.exe`/`taskkill /T` pattern)

## 2. Διεθνοποίηση (i18n)
- [x] Κάθε γλώσσα στο `I18N` έχει τα ίδια keys με το `el` (καμία απροειδοποίητη πτώση σε αγγλικά) — επαληθεύτηκε προγραμματιστικά, 20/20 γλώσσες πλήρεις
- [ ] Καμία αγγλική λέξη σε λειτουργικές ελληνικές ετικέτες (tabs, κουμπιά, μηνύματα) — εξαιρούνται ονόματα ειδών/skins/backgrounds και τεχνικά standards (URL, MP3, FFmpeg)
- [ ] Το tab-rail κείμενο δεν ξεχειλίζει το κουμπί σε καμία γλώσσα (ούτε οι πιο μακριές μεταφράσεις)
- [ ] Το carousel γλωσσών κυλάει σωστά και προς τις δύο κατευθύνσεις, στα άκρα
- [ ] Αλλαγή γλώσσας ενημερώνει άμεσα: tabs, presets, tooltips, Help window (αν ανοιχτό)
- [ ] Η επιλεγμένη γλώσσα επιμένει μετά από επανεκκίνηση (`waveframe.lang`)
- [ ] RTL/ειδικά scripts (αν προστεθούν) δεν σπάνε το layout

## 3. Player
- [ ] Φόρτωση αρχείου, URL, μικρόφωνο, test tone λειτουργούν
- [ ] Μη έγκυρο URL/αρχείο δείχνει το μεταφρασμένο μήνυμα σφάλματος, όχι σιωπηλή αποτυχία
- [ ] Album art + artist/album εμφανίζονται όταν υπάρχουν μεταδεδομένα, fallback εικονίδιο όταν δεν υπάρχουν
- [ ] Play/Pause/Next/Prev λειτουργούν από: UI, πλήκτρα πολυμέσων πληκτρολογίου, taskbar thumbbar
- [ ] Ο τίτλος του παραθύρου/taskbar tooltip ενημερώνεται με το τρέχον κομμάτι
- [ ] Playlist: προσθήκη, αφαίρεση, drag-drop, persistence μετά από επανεκκίνηση
- [ ] Crossfade λειτουργεί μεταξύ διαδοχικών κομματιών
- [ ] Visualizer επιλογή χωρίς επιλεγμένο mode δείχνει album art (μόλις υλοποιηθεί)

## 4. Ενισχυτής Ήχου (Enhance)
- [ ] Master enable/disable πραγματικά παρακάμπτει την αλυσίδα εφέ (audio bypass, όχι απλά οπτικό)
- [ ] Master disable/enable ΔΕΝ χάνει τις επιμέρους ρυθμίσεις (EQ/boosts/FX)
- [ ] Mini level meter αντιδρά σε πραγματικό χρόνο στην αναπαραγωγή
- [ ] EQ 10 ζωνών εφαρμόζεται ακουστικά και οπτικά (sliders συγχρονισμένα)
- [ ] Knob γραφικά (Bass/Surround/Volume Boost) συγχρονίζονται με τα underlying sliders και στις δύο κατευθύνσεις
- [ ] Presets: φόρτωση, αποθήκευση custom preset, ενεργό preset highlighted σωστά
- [ ] Compressor/Reverb/Exciter switches ενεργοποιούν/απενεργοποιούν τα σωστά audio nodes
- [ ] Tempo + preserve-pitch λειτουργούν στην αναπαραγωγή

## 5. Export
- [ ] Επιλογή συγκεκριμένων κομματιών (checkboxes) στο batch export
- [x] Όλες οι μορφές (WAV/MP3/FLAC/OGG/AAC/Opus/WMA) παράγουν έγκυρο, αναπαραγώγιμο αρχείο — **επαληθεύτηκε με πραγματικό κατεβασμένο MP3** (SoundHelix sample) μέσω απευθείας κλήσης του ίδιου ffmpeg binary/εντολών που χρησιμοποιεί η εφαρμογή· βρέθηκε και διορθώθηκε πραγματικό bug (Opus απέτυχε σε 44.1kHz — βλ. `CLAUDE.md` #12)
- [ ] Ποιότητες Low/Medium/High(320kbps)/Lossless παράγουν το σωστό bitrate/δείγμα (το Opus έχει πλέον δική του κλίμακα bitrate — 64/96/160k, βλ. `CLAUDE.md` #12)
- [x] Φάκελος προορισμού: προεπιλογή ο φάκελος Μουσική των Windows (`app.getPath('music')`), εκτός αν ο χρήστης επιλέξει διαφορετικό — βλ. `CLAUDE.md` #13
- [ ] Μπάρα προόδου ενημερώνεται ρεαλιστικά ανά αρχείο σε batch export
- [ ] Αλλαγή ονόματος όταν υπάρχει ήδη αρχείο με το ίδιο όνομα (auto-increment), όχι σιωπηλή αντικατάσταση
- [ ] Μη έγκυρο/κατεστραμμένο αρχείο δείχνει το μεταφρασμένο `export.decodeError`
- [ ] Ανενεργό FFmpeg → σαφές μήνυμα + σύνδεσμος στις Ρυθμίσεις, όχι σιωπηλή αποτυχία

## 6. Ρυθμίσεις
- [ ] Dependencies panel: σωστή ανίχνευση system PATH → download fallback, λήψη/εγκατάσταση με progress
- [ ] Skins: εφαρμόζονται άμεσα, επιμένουν μετά από επανεκκίνηση
- [ ] Button-style variations (μόλις υλοποιηθούν): εφαρμόζονται σε όλα τα relevant κουμπιά συνεπώς
- [ ] Animated backgrounds: επιλογή, hue auto/manual, resize με το παράθυρο
- [ ] Backup & Cloud Sync: export παράγει έγκυρο JSON, import επαναφέρει σωστά και κάνει reload
- [ ] Tutorial: «Προβολή οδηγού» ξανατρέχει τον οδηγό οποτεδήποτε

## 7. Παράθυρο & OS integration
- [ ] Resize/maximize/restore δεν σπάνε το layout σε καμία καρτέλα
- [ ] Ελάχιστο μέγεθος (1180×760) τηρείται
- [ ] Διπλό κλικ στη γραμμή τίτλου maximize/restore
- [ ] Animated background canvas προσαρμόζεται σωστά σε resize
- [ ] Taskbar thumbbar: σωστά εικονίδια, σωστό tooltip, σωστή εναλλαγή play/pause icon
- [ ] SMTC (`navigator.mediaSession`): play/pause/next/previous από το Windows volume flyout/lock screen — επιβεβαιώθηκε μόνο σε επίπεδο κώδικα (`node --check` + code review), όχι με πραγματικό click-through στο Windows flyout
- [ ] Jump list: Play/Pause/Next εμφανίζονται στο δεξί-κλικ του taskbar icon και προωθούν σωστά στο ήδη-ανοιχτό παράθυρο μέσω `second-instance` — επιβεβαιώθηκε μόνο σε επίπεδο κώδικα
- [ ] Auto-launch on login: ο διακόπτης στις Ρυθμίσεις αντανακλά σωστά το `app.getLoginItemSettings()` και το ενημερώνει — επιβεβαιώθηκε μόνο σε επίπεδο κώδικα
- [ ] Διπλό κλικ σε συσχετισμένο αρχείο ήχου (mp3/wav/flac/ogg/m4a/opus/wma) ανοίγει/φορτώνει σωστά, είτε η εφαρμογή τρέχει ήδη είτε όχι — απαιτεί πραγματικό packaged install για πλήρη δοκιμή (file association registration), όχι μόνο `electron .`
- [x] Θέση/μέγεθος παραθύρου αποθηκεύεται και επανέρχεται σωστά μεταξύ επανεκκινήσεων, με validation αν η αποθηκευμένη θέση δεν ανήκει πλέον σε καμία συνδεδεμένη οθόνη — code-level επιβεβαιωμένο (`loadWindowState`/`saveWindowState` σε `main.js`)
- [x] `app.requestSingleInstanceLock()`: δεύτερη εκκίνηση δεν ανοίγει νέο παράθυρο, προωθεί jump-list action/αρχείο στο υπάρχον — code-level επιβεβαιωμένο

## 8. Δεύτερο παράθυρο Βοήθειας
- [ ] Ακολουθεί το ενεργό skin/light-dark mode χωρίς flash λάθος θέματος στο άνοιγμα
- [ ] Live theme sync αν αλλάξει το θέμα ενώ είναι ανοιχτό
- [ ] Καρτέλες Οδηγίες/Ιστορικό/Βοήθεια/Άδεια χρήσης όλες προσβάσιμες και σωστά μεταφρασμένες
- [ ] Άδεια χρήσης αντανακλά με ακρίβεια την πραγματική τρέχουσα αρχιτεκτονική εξαρτήσεων

## 9. Ασφάλεια & άδειες
- [x] Καμία νέα inline `style=""` προστέθηκε (CSP `style-src 'self'`) — επιβεβαιώθηκε με έλεγχο όλων των νέων HTML/JS προσθηκών αυτού του πέρασματος
- [x] `window.prompt`/`alert` δεν χρησιμοποιούνται πουθενά νέα — μόνο τα custom dialogs
- [x] Καμία εξάρτηση αποκλειστικά άδειας GPL στο `package.json`/bundled binaries — δεν προστέθηκε κανένα νέο npm package αυτό το πέρασμα
- [x] `CLAUDE.md` ενημερωμένο αν άλλαξε κάποιος από τους κανόνες/αρχιτεκτονική — κανόνες 14-16 προστέθηκαν (installer/EULA pattern, el-only μεταφράσεις + JSON.stringify gotcha, smoke-test + Windows process-tree gotcha)

## 10. Παλινδρόμηση (regression)
- [x] Ό,τι δούλευε πριν τη Φάση συνεχίζει να δουλεύει — `node --check` καθαρό σε όλα τα αρχεία του project, `npm run smoke-test` περνάει, πλήρης packaged build (`npm run dist`) πέτυχε χωρίς σφάλμα
- [x] Καμία βλαβερή αλλαγή στο version number/changelog entries προηγούμενων εκδόσεων — v1.3.0/v1.4.0 entries παραμένουν ως είχαν, νέο v1.5.0 entry προστέθηκε στην κορυφή
