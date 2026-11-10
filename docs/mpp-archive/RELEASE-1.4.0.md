# Opsis Media Player Pro 1.4.0

## English
- **Welcome guide** with 6 pages (Greek/English) on the first start of each new minor version and from Help → "Welcome"; animated logo; closes by shrinking into the title-bar icon.
- **"The Opsis family"**: a card for every app of the suite with capabilities, installed/update state, Open, Download (confirmation + SHA-256 check, refuses a mismatch, never runs anything) and Details.
- **New-version notice**: one request a day to GitHub, once per version, shown as a toast inside the window; switch it off in the Help menu. No telemetry.

**Tests**: the new core (version comparison, once-per-version, catalogue validation, installed detection with a fake registry, SHA-256 verification with a fake download) has unit tests; the self-test opens the real windows and the toast. The welcome page, last page, the shrinking animation, the family window and the toast were captured in screenshots and checked. **Not verified**: a real download of another app's installer, a real newer release arriving, other display scalings; creating the family window needs the network only for status of installed apps. The installer was compiled but not run on a test PC. Catalogue paths were checked against each app's installer script; GearWin, Kombos and Waveframe paths could not be verified from here.

## Ελληνικά
- **Καλωσόρισμα με οδηγό** 6 σελίδων (ελληνικά/αγγλικά) στην πρώτη εκκίνηση κάθε νέας minor έκδοσης και από Βοήθεια → «Καλώς ήρθες»· κινούμενο λογότυπο· κλείνει μικραίνοντας μέσα στο εικονίδιο του παραθύρου.
- **«Οι εφαρμογές της οικογένειας Opsis»**: κάρτα για κάθε εφαρμογή με δυνατότητες, κατάσταση εγκατάστασης/ενημέρωσης, Άνοιγμα, Λήψη (επιβεβαίωση + έλεγχος SHA-256, αρνείται σε ασυμφωνία, δεν εκτελεί τίποτα) και Λεπτομέρειες.
- **Ειδοποίηση νέας έκδοσης**: ένα αίτημα την ημέρα στο GitHub, μία φορά ανά έκδοση, ως toast μέσα στο παράθυρο· κλείνει από το μενού Βοήθεια. Χωρίς τηλεμετρία.

**Δοκιμές**: unit tests για τον κοινό πυρήνα και πραγματικό άνοιγμα των παραθύρων στο self-test· screenshots από όλα τα στάδια. **Δεν ελέγχθηκε**: πραγματική λήψη installer άλλης εφαρμογής, άφιξη πραγματικής νέας έκδοσης. Ο installer χτίστηκε αλλά δεν δοκιμάστηκε σε δοκιμαστικό PC.
