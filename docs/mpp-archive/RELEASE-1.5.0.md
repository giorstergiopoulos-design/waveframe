# Opsis Media Player Pro 1.5.0

## English
- **Converter**: MP4, WebM, MKV, AVI, WMV, TS, OGV and PNG/JPEG frames, poster, contact sheet; queue, trim, ETA, cancel; originals never touched. H.264/H.265/GIF/WebP are not offered (not producible by the bundled libvlc) — the old "MP4 H.264" item never worked and was replaced. Details: docs/CONVERTER.md.
- Encodes go to Videos\Opsis Media Player. Subtitles are saved as `<movie>.srt` (folder selectable); new Greek subtitle sources with fallbacks.
- Themed CheckBox/RadioButton, a single light/dark control, audio effects apply in 0.12 s and keep the position (a short stream restart remains — libvlc limit), real icons of all 7 apps in the family window, icon on the installer pages.
- Verified: 136 unit tests, self-test 118 passed / 0 failed (real conversions of every offered format). New and changed texts are in Greek and English (tests enforce it); screenshots (dark/light) are in the README. Not verified: real 150 % DPI of the new dialog, RTL; the older menus are still Greek-only.
- Assets: OpsisMediaPlayerPro-Setup.exe and the portable zip, each with a `.sha256` file.

## Ελληνικά
- **Μετατροπέας** βίντεο/εικόνας με ουρά, trim, ETA, ακύρωση· το πρωτότυπο δεν αγγίζεται. Δεν προσφέρονται H.264/H.265/GIF/WebP (δεν παράγονται από το libvlc)· το παλιό «MP4 H.264» δεν δούλευε ποτέ και αντικαταστάθηκε.
- Εγκωδικοποιήσεις στο Βίντεο\Opsis Media Player· υπότιτλοι ως `<ταινία>.srt` (επιλέξιμος φάκελος)· νέες ελληνικές πηγές με εναλλακτικά.
- Θεματικά CheckBox/RadioButton, ένα κουμπί light/dark, εφέ ήχου σε 0,12 s με διατήρηση θέσης (μένει σύντομη επανεκκίνηση ροής — όριο του libvlc), τα πραγματικά εικονίδια των 7 εφαρμογών, εικονίδιο στον installer.
- Ελέγχθηκαν: 136 unit tests, self-test 118/0. Τα νέα κείμενα είναι σε ελληνικά και αγγλικά (το επιβάλλουν tests), screenshots dark/light στο README. Δεν ελέγχθηκαν: πραγματικό DPI 150 % του νέου διαλόγου, RTL· τα παλιότερα μενού είναι ακόμα μόνο ελληνικά.
- Αρχεία: Setup.exe και portable zip με `.sha256`.
