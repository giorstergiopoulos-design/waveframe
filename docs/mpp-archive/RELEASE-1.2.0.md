# Opsis Media Player Pro 1.2.0 — first public release

## English
- Renamed to **Opsis Media Player Pro**. The light / dark / auto mode is now a button on the control bar instead of a menu.
- Everything from MPC-HC / VLC that was missing: output device, audio channels, video track, titles/chapters menus, repeat file, stop after current, statistics, remaining time, fit window to video, snapshot to clipboard, playlist move, mouse side buttons, window memory.
- Built-in self-test that executes every button and menu item against a real playback.

**Tests**: the self-test passes (95 commands executed, 0 failed; 32 commands that open dialogs, use the network or are irreversible are skipped) and the static menu audit finds every menu tag handled. The visual result of commands (e.g. that a rotation looks right) is not verified automatically. The installer was compiled but its optional "Open with" registry entry was not run on a test PC.

**Privacy**: automatic subtitle download and online movie/series information are on by default; they can be switched off (see the README). Audio files are never searched.

**Download**: `OpsisMediaPlayerPro-Setup.exe` (no admin) or `OpsisMediaPlayerPro-1.2.0.zip` (portable). Self-contained: no .NET needed.

## Ελληνικά
- Νέο όνομα **Opsis Media Player Pro**. Η λειτουργία σκούρη / φωτεινή / αυτόματη είναι πλέον κουμπί στη γραμμή ελέγχου και όχι στο μενού.
- Ό,τι έλειπε από MPC-HC / VLC: συσκευή εξόδου, κανάλια ήχου, κανάλι βίντεο, μενού τίτλων/κεφαλαίων, επανάληψη αρχείου, διακοπή μετά το τρέχον, στατιστικά, χρόνος που απομένει, προσαρμογή παραθύρου, στιγμιότυπο στο πρόχειρο, μετακίνηση στη λίστα, πλαϊνά κουμπιά ποντικιού, μνήμη παραθύρου.
- Ενσωματωμένος αυτοέλεγχος που εκτελεί κάθε κουμπί και κάθε στοιχείο μενού σε πραγματική αναπαραγωγή.

**Δοκιμές**: ο αυτοέλεγχος περνά (95 εντολές, 0 αποτυχίες· 32 που ανοίγουν παράθυρα, δίκτυο ή είναι μη αναστρέψιμες παραλείπονται). Το οπτικό αποτέλεσμα δεν ελέγχεται αυτόματα. Ο installer χτίστηκε αλλά δεν δοκιμάστηκε η προαιρετική εγγραφή «Άνοιγμα με» στο registry.
