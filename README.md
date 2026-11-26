# scanit

A phone web app for recording the equipment in a Kit: type in (and, later, scan) each Item's Serial, then Export everything as one Excel workbook. Everything stays on the phone (see `docs/adr/0001-no-server-data-stays-on-the-phone.md`); the Export is the only copy that leaves it. Terms such as Kit, Item and Serial are defined in `CONTEXT.md`.

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
- `src/app.js`, `src/app.css`: the screens.
- `vendor/`: outside code copied into the repo so the app never needs the internet. Today that's only fflate, which zips the workbook.

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
- **App tests** (`tests/app/`, Playwright) open the real app in Chromium at phone size, click through it like a person would, and open the exported workbook to check every sheet and cell.
