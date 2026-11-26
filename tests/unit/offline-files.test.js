// The files the service worker keeps on the phone, the version stamp, and the web app manifest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, readAppFiles, appVersion } from "../../tools/app-version.js";

const listed = readAppFiles().files;
const filesIn = dir => readdirSync(join(ROOT, dir)).map(name => `${dir}/${name}`);

test("every listed app file exists", () => {
  for (const file of listed) assert.ok(existsSync(join(ROOT, file)), `${file} is listed in app-files.js but missing`);
});

test("every file the app is made of is listed, so it works offline", () => {
  const needed = [
    "index.html", "manifest.webmanifest",
    ...filesIn("src"),
    ...filesIn("vendor").filter(f => !f.includes("LICENSE")),
    ...filesIn("icons").filter(f => f.endsWith(".png")),
  ];
  for (const file of needed) assert.ok(listed.includes(file), `${file} is missing from app-files.js`);
});

test("the version stamp matches the files (run `npm run stamp` after changing an app file)", () => {
  assert.equal(readAppFiles().version, appVersion(),
    "app-files.js has an old APP_VERSION, so phones wouldn't pick up this change. Run: npm run stamp");
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
