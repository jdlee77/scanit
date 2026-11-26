# scanit

By [Jon Lee](https://jon-lee.carrd.co/).

A phone web app for recording the equipment in a Kit: scan (or type in) each Item's Serial, then Export everything as one Excel workbook. Everything stays on the phone (see `docs/adr/0001-no-server-data-stays-on-the-phone.md`); the Export is the only copy that leaves it. Terms such as Kit, Item and Serial are defined in `CONTEXT.md`.

## Trying it on your computer

The app is plain files with no build step. From this folder:

```bash
python3 -m http.server 8790
```

Then open <http://localhost:8790> in a browser.

## Working offline, and publishing a new version

After the first visit, scanit opens, scans and exports with no signal. A service worker (`sw.js`) keeps a copy of every app file on the phone; `app-files.js` lists them. `manifest.webmanifest` and the pictures in `icons/` let people add scanit to the home screen.

Because phones run their saved copy, **a changed file only reaches them when the version changes.** After changing, adding or removing any app file, run:

```bash
npm run stamp
```

This rewrites `app-files.js` with the current list of files and a new fingerprint of them. A test fails if you forget. GitHub also runs every test on each push (see the Actions tab), so a forgotten stamp shows up there as a red cross.

Phones fetch a new version in the background. They switch to it the next time scanit opens, or comes back on screen showing the Kit list, as long as no other scanit window is open. Kits are kept separately, so an update never touches them.

The same applies while trying changes on your computer: run `npm run stamp`, then reload the page twice.

To redraw the icons, change `icons/make-icons.py` and run it. It needs Python with the Pillow library; nothing else does.

## How it's put together

- `index.html`: the page.
- `src/kit-record.js`: every rule about Kits, Items, Fields and Pick lists. It never touches the screen or storage, so it's easy to test.
- `src/store.js`: keeps the Kit record in the browser's own storage (IndexedDB).
- `src/export-builder.js`: turns Kits into the `.xlsx` workbook.
- `src/scanner.js`: the camera, the code reader and the scanning controls, lifted from the scan prototype (the `prototype/scan-test` branch).
- `src/scan-reading.js`: the scanner's rules that don't need a camera (code types, the aiming box, not reporting the same code twice), so they're easy to test.
- `src/settings-file.js`: saves your Fields and Pick lists to a Settings file and reads one back.
- `src/app.js`, `src/settings-screen.js`, `src/app.css`, `src/dom.js`, `src/files.js`: the screens, and handing files to you.
- `src/offline.js`, `src/install-prompt.js`, `sw.js`, `app-files.js`: working offline, keeping stored data, and the home-screen prompt.
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
