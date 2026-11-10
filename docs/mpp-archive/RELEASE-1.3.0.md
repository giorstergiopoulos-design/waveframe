# Opsis Media Player Pro 1.3.0

## English
- **Moved from .NET 8 to .NET 10.** Verified: the build, the 39 unit tests, the menu audit and the whole `--selftest` (including the LibVLC audio extraction) pass on .NET 10, and the self-contained publish and the portable zip run the selftest too. The package stays self-contained, so no .NET install is needed.
- **Better subtitle download**: smarter ranking (season/episode, year, resolution, source, release group; a different episode is rejected), the 3 best candidates are compared with the video length, retry on network errors, `.vtt`/`.ass`/`.ssa` conversion and proper encoding detection (UTF-8/16, Greek and other legacy code pages).
- **Better subtitle sync**: two audio segments give the shift AND the speed drift, 20 ms precision, ±5 minute search, and a confidence check that refuses to apply a doubtful result.
- **Dark / light mode now applies to every window** (audio, help, statistics, subtitle picker, dialogs and the title bars) and changes live. Checked with screenshots of five secondary windows in both modes (`--ui-demo`); the statistics window was not visible in those screenshots.
- `Z` / `X` to move subtitles 100 ms, "reset delay" in the menu.

**Tests**: 39 unit tests for the subtitle logic (synthetic audio with known shift/drift; unrelated audio is rejected), and the app self-test now also runs a real end-to-end sync through LibVLC audio extraction (recovered a +7.3 s offset with 0.01 s error). 97 commands passed, 0 failed. **Not verified**: real films and the live subtitle services — the confidence thresholds were calibrated on synthetic data, and the new season/episode parameters sent to Podnapisi/OpenSubtitles were not tested against the real servers. If a sync is refused, use `Y` or `Z`/`X`. The installer was compiled but not run on a test PC.

## Ελληνικά
- **Μετάβαση από .NET 8 σε .NET 10.** Επαληθεύτηκε: το build, τα 39 unit tests, ο έλεγχος μενού και ολόκληρο το `--selftest` (και η εξαγωγή ήχου με LibVLC) περνούν σε .NET 10, και το αυτόνομο publish τρέχει το selftest. Το πακέτο μένει αυτόνομο, δεν χρειάζεται εγκατάσταση .NET.
- **Καλύτερη λήψη υποτίτλων**: έξυπνη κατάταξη (σεζόν/επεισόδιο, έτος, ανάλυση, πηγή, ομάδα· το λάθος επεισόδιο απορρίπτεται), σύγκριση των 3 καλύτερων με τη διάρκεια του βίντεο, επανάληψη σε σφάλματα δικτύου, μετατροπή `.vtt`/`.ass`/`.ssa` και σωστή αναγνώριση κωδικοποίησης.
- **Καλύτερος συγχρονισμός**: δύο τμήματα ήχου δίνουν τη μετατόπιση ΚΑΙ την απόκλιση ταχύτητας, ακρίβεια 20 ms, αναζήτηση ±5 λεπτά και έλεγχος βεβαιότητας που αρνείται να εφαρμόσει αμφίβολο αποτέλεσμα.
- **Η σκούρη / φωτεινή λειτουργία ισχύει πλέον σε ΟΛΑ τα παράθυρα** (ήχος, βοήθεια, στατιστικά, επιλογή υποτίτλων, διάλογοι, γραμμές τίτλου) με ζωντανή αλλαγή. Ελέγχθηκε με screenshots πέντε δευτερευόντων παραθύρων και στις δύο λειτουργίες· το παράθυρο στατιστικών δεν φαινόταν σε αυτά.
- `Z` / `X` για μετακίνηση υποτίτλων κατά 100 ms και «Μηδενισμός καθυστέρησης».

**Δοκιμές**: 39 unit tests (συνθετικός ήχος με γνωστή μετατόπιση/απόκλιση· ο άσχετος ήχος απορρίπτεται) και πλήρης έλεγχος μέσω LibVLC στο self-test (ανακτήθηκε μετατόπιση +7,3 s με σφάλμα 0,01 s). **Δεν ελέγχθηκε**: πραγματικές ταινίες και οι ζωντανές υπηρεσίες υποτίτλων· τα όρια βεβαιότητας βαθμονομήθηκαν σε συνθετικά δεδομένα. Αν ο συγχρονισμός απορριφθεί, χρησιμοποίησε `Y` ή `Z`/`X`.
