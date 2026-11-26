// The files the service worker keeps on the phone, the version stamp, and the web app manifest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, APP_FILES_PATH, readAppFiles, appFiles, appFilesText } from "../../tools/app-version.js";

test("every listed app file exists", () => {
  for (const file of readAppFiles().files) assert.ok(existsSync(join(ROOT, file)), `${file} is listed but missing`);
});

test("the offline file list holds the page, manifest, icons, code and vendored scanner and xlsx writer", () => {
  const files = appFiles();
  for (const file of ["index.html", "manifest.webmanifest", "icons/icon-192.png", "src/app.js",
    "vendor/zxing-wasm-reader-3.1.6.js", "vendor/zxing_reader-3.1.6.wasm", "vendor/fflate-0.8.3.js"]) {
    assert.ok(files.includes(file), `${file} should be kept offline`);
  }
  assert.ok(!files.some(f => f.includes("LICENSE") || f.endsWith(".py")), "licences and scripts aren't app files");
});

test("app-files.js is up to date: list and version (run `npm run stamp` after changing an app file)", () => {
  assert.equal(readFileSync(APP_FILES_PATH, "utf8").replace(/\r\n/g, "\n"), appFilesText(),
    "app-files.js is out of date, so phones wouldn't pick up this change. Run: npm run stamp");
});

/** A PNG's width and height, from its header. */
function pngSize(file) {
  const bytes = readFileSync(join(ROOT, file));
  assert.equal(bytes.subarray(1, 4).toString(), "PNG", `${file} is not a PNG`);
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

test("the manifest makes scanit installable: name, standalone, colours and real icons", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.name, "scanit");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.theme_color, "#1f4e79");
  const sizes = manifest.icons.map(i => i.sizes);
  assert.ok(sizes.includes("192x192") && sizes.includes("512x512"), "needs 192 and 512 pixel icons");
  assert.ok(manifest.icons.some(i => i.purpose === "maskable"), "needs a maskable icon for Android");
  for (const icon of manifest.icons) assert.equal(pngSize(icon.src), icon.sizes, `${icon.src} size`);
  assert.equal(pngSize("icons/apple-touch-icon.png"), "180x180");
});

test("index.html links the manifest and the iPhone home-screen icon", () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  assert.match(html, /<link rel="manifest" href="manifest.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon.png">/);
});
