// Every file scanit needs, kept on the phone by the service worker (sw.js) so the app opens,
// scans and exports with no signal. Paths are relative to this folder.
//
// Written by `npm run stamp`: don't edit by hand. Run it after changing, adding or removing any
// app file. APP_VERSION is a fingerprint of all of them; a new one is how phones learn there's a
// new version. A test fails if this file is out of date.
self.APP_VERSION = "c8cdb19c0eca";
self.APP_FILES = [
  "index.html",
  "manifest.webmanifest",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "src/app.css",
  "src/app.js",
  "src/dom.js",
  "src/export-builder.js",
  "src/files.js",
  "src/install-prompt.js",
  "src/kit-record.js",
  "src/offline.js",
  "src/scan-reading.js",
  "src/scanner.js",
  "src/settings-file.js",
  "src/settings-screen.js",
  "src/store.js",
  "vendor/fflate-0.8.3.js",
  "vendor/zxing-wasm-reader-3.1.6.js",
  "vendor/zxing_reader-3.1.6.wasm",
];
