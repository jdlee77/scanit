# scanit

A phone web app for recording the equipment in a Kit: scan (or type in) each Item's Serial, then Export everything as one Excel workbook. Everything stays on the phone (see `docs/adr/0001-no-server-data-stays-on-the-phone.md`); the Export is the only copy that leaves it. Terms such as Kit, Item and Serial are defined in `CONTEXT.md`.

## Trying it on your computer

The app is plain files with no build step. From this folder:

```bash
python3 -m http.server 8790
```

Then open <http://localhost:8790> in a browser.

## How it's put together

- `index.html`: the page.
- `src/kit-record.js`: every rule about Kits and Items. It never touches the screen or storage, so it's easy to test.
- `src/store.js`: keeps the Kit record in the browser's own storage (IndexedDB).
- `src/export-builder.js`: turns Kits into the `.xlsx` workbook.
- `src/scanner.js`: the camera, the code reader and the scanning controls, lifted from the scan prototype (the `prototype/scan-test` branch).
- `src/scan-reading.js`: the scanner's rules that don't need a camera (code types, the aiming box, not reporting the same code twice), so they're easy to test.
- `src/app.js`, `src/app.css`: the screens.
- `vendor/`: outside code copied into the repo so the app never needs the internet: fflate, which zips the workbook, and zxing-wasm 3.1.6, which reads barcodes and QR codes.

## Tests

Install the test tools once, then run everything:

```bash
npm install
```

```bash
npm test
```

This runs two sets of tests:

- **Unit tests** (`tests/unit/`, Node's built-in runner) check the Kit record's rules and the workbook's contents.
- **App tests** (`tests/app/`, Playwright) open the real app in Chromium at phone size, click through it like a person would, and open the exported workbook to check every sheet and cell. Scanning is tested with Chromium's pretend camera, which plays a video made from codes on the printed test sheet, and with photo uploads of every code on the sheet.

The test codes in `tests/fixtures/codes/` were cut from `tests/fixtures/test-sheet.pdf` by `tests/fixtures/make-test-codes.js`. You only need to run that again if the test sheet changes.
