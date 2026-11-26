// Cuts the printed scan test sheet (test-sheet.pdf, from the prototype) into one picture per code,
// for the app tests to show to the fake camera or upload as photos.
// Writes tests/fixtures/codes/*.png and codes.json (what each code should read as).
//
// Only needed if the test sheet changes. Needs pdftoppm (poppler) and Playwright's Chromium:
//   node tests/fixtures/make-test-codes.js
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const here = new URL(".", import.meta.url).pathname;
const root = join(here, "..", "..");
const out = join(here, "codes");

const pages = mkdtempSync(join(tmpdir(), "scanit-sheet-"));
execFileSync("pdftoppm", ["-r", "300", "-png", join(here, "test-sheet.pdf"), join(pages, "page")]);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.route("http://fixtures.local/**", route => {
  const path = new URL(route.request().url()).pathname;
  if (path === "/") return route.fulfill({ body: "<!doctype html><title>cut</title>", contentType: "text/html" });
  const file = path.startsWith("/pages/") ? join(pages, path.slice(7)) : join(root, path);
  route.fulfill({ body: readFileSync(file), contentType: file.endsWith(".wasm") ? "application/wasm" : undefined });
});
await page.goto("http://fixtures.local/"); // same origin as the pictures, so the canvas can read them
await page.addScriptTag({ url: "http://fixtures.local/vendor/zxing-wasm-reader-3.1.6.js" });

const codes = [];
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const name of readdirSync(pages).sort()) {
  const found = await page.evaluate(async src => {
    ZXingWASM.setZXingModuleOverrides({ locateFile: () => "http://fixtures.local/vendor/zxing_reader-3.1.6.wasm" });
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const results = await ZXingWASM.readBarcodes(ctx.getImageData(0, 0, img.width, img.height),
      { tryHarder: true, maxNumberOfSymbols: 32 });
    return results.filter(r => r.isValid).map(r => {
      const p = r.position;
      const xs = [p.topLeft.x, p.topRight.x, p.bottomLeft.x, p.bottomRight.x];
      const ys = [p.topLeft.y, p.topRight.y, p.bottomLeft.y, p.bottomRight.y];
      const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      // Grow the box for a quiet zone; linear codes report a thin line, so give them height too.
      const pad = Math.max(box.w, box.h) * 0.15 + 30;
      const h = Math.max(box.h, box.w * 0.35);
      const crop = {
        x: Math.max(0, box.x - pad), y: Math.max(0, box.y + box.h / 2 - h / 2 - pad),
        w: box.w + 2 * pad, h: h + 2 * pad,
      };
      const piece = Object.assign(document.createElement("canvas"), { width: Math.round(crop.w), height: Math.round(crop.h) });
      const pctx = piece.getContext("2d");
      pctx.fillStyle = "#fff";
      pctx.fillRect(0, 0, piece.width, piece.height);
      pctx.drawImage(canvas, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
      return { format: r.format, text: r.text, png: piece.toDataURL("image/png") };
    });
  }, `http://fixtures.local/pages/${name}`);
  for (const code of found) {
    const file = `${code.format}-${code.text.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}.png`;
    writeFileSync(join(out, file), Buffer.from(code.png.split(",")[1], "base64"));
    codes.push({ file, format: code.format, text: code.text });
  }
}
await browser.close();
rmSync(pages, { recursive: true, force: true });
writeFileSync(join(here, "codes.json"), JSON.stringify(codes, null, 2) + "\n");
console.log(codes.map(c => `${c.file}  ${JSON.stringify(c.text)}`).join("\n"), `\n${codes.length} codes`);
