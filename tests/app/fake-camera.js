// Runs once before the app tests: makes the video that Chromium's fake camera plays,
// from pictures of codes cut out of the printed test sheet (tests/fixtures/codes).
// The video loops: each code is held in view for 4 seconds, with a blank second between.
import { mkdirSync, openSync, writeSync, closeSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const here = new URL(".", import.meta.url).pathname;
const codesDir = join(here, "..", "fixtures", "codes");
export const VIDEO_DIR = join(here, ".generated");
export const SCAN_VIDEO = join(VIDEO_DIR, "scan-sequence.y4m");

/** The codes the fake camera shows, in order. */
export const SCAN_SEQUENCE = [
  "Code128-K9P2207731.png",
  "QRCode-Make-Motorola-Model-APX-6000-Serial-475C.png",
  "EAN13-0036000291452.png",
];

const WIDTH = 640, HEIGHT = 480, FPS = 4, HOLD_S = 4, GAP_S = 1;

export default async function makeFakeCameraVideo() {
  mkdirSync(VIDEO_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const frames = [];
  for (const file of [...SCAN_SEQUENCE, null]) {
    const dataUrl = file && `data:image/png;base64,${readFileSync(join(codesDir, file)).toString("base64")}`;
    const rgba = await page.evaluate(async ({ dataUrl, WIDTH, HEIGHT }) => {
      const canvas = Object.assign(document.createElement("canvas"), { width: WIDTH, height: HEIGHT });
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      if (dataUrl) {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        // Fit inside the on-screen aiming box (the middle 84% across, 50% down).
        const scale = Math.min((WIDTH * 0.6) / img.width, (HEIGHT * 0.42) / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
      }
      return Array.from(ctx.getImageData(0, 0, WIDTH, HEIGHT).data);
    }, { dataUrl, WIDTH, HEIGHT });
    frames.push({ file, yuv: toI420(rgba) });
  }
  await browser.close();

  const blank = frames.pop().yuv;
  const fd = openSync(SCAN_VIDEO, "w");
  writeSync(fd, `YUV4MPEG2 W${WIDTH} H${HEIGHT} F${FPS}:1 Ip A1:1 C420jpeg\n`);
  for (const { yuv } of frames) {
    for (let i = 0; i < HOLD_S * FPS; i++) { writeSync(fd, "FRAME\n"); writeSync(fd, yuv); }
    for (let i = 0; i < GAP_S * FPS; i++) { writeSync(fd, "FRAME\n"); writeSync(fd, blank); }
  }
  closeSync(fd);
}

// RGBA pixels -> one YUV 4:2:0 frame (full-range BT.601, as the y4m "C420jpeg" header says).
function toI420(rgba) {
  const y = Buffer.alloc(WIDTH * HEIGHT), u = Buffer.alloc(WIDTH * HEIGHT / 4), v = Buffer.alloc(WIDTH * HEIGHT / 4);
  for (let row = 0; row < HEIGHT; row++) {
    for (let col = 0; col < WIDTH; col++) {
      const i = (row * WIDTH + col) * 4;
      const [r, g, b] = [rgba[i], rgba[i + 1], rgba[i + 2]];
      y[row * WIDTH + col] = 0.299 * r + 0.587 * g + 0.114 * b;
      if (row % 2 === 0 && col % 2 === 0) {
        const c = (row / 2) * (WIDTH / 2) + col / 2;
        u[c] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        v[c] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      }
    }
  }
  return Buffer.concat([y, u, v]);
}
