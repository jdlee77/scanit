// The scanner's pure parts, lifted from the prototype on the prototype/scan-test branch
// (validated on Jon's iPhone and Android phone). No page, camera or reader access.

// Reader format names (ZXing's, and the phone's built-in reader's) -> one id each.
const ZXING_TO_ID = {
  UPCA: "upc_a", UPCE: "upc_e", EAN13: "ean_13", EAN8: "ean_8",
  Code128: "code_128", Code39: "code_39", Code39Std: "code_39", Code39Ext: "code_39", Code93: "code_93",
  Codabar: "codabar", ITF: "itf", ITF14: "itf", QRCode: "qr_code", QRCodeModel2: "qr_code", MicroQRCode: "qr_code",
  DataMatrix: "data_matrix", PDF417: "pdf417", Aztec: "aztec", AztecCode: "aztec",
};
const FORMAT_NAMES = {
  upc_a: "UPC-A", upc_e: "UPC-E", ean_13: "EAN-13", ean_8: "EAN-8",
  code_128: "Code 128", code_39: "Code 39", code_93: "Code 93", codabar: "Codabar", itf: "ITF",
  qr_code: "QR code", data_matrix: "Data Matrix", pdf417: "PDF417", aztec: "Aztec",
};
const PRODUCT_FORMATS = ["upc_a", "upc_e", "ean_13", "ean_8"];

/** Every format id, for asking the phone's built-in reader what it supports. */
export const FORMAT_IDS = Object.keys(FORMAT_NAMES);

export const formatId = readerName => ZXING_TO_ID[readerName] ?? readerName;
export const formatName = id => FORMAT_NAMES[id] ?? id;
/** UPC and EAN identify a product, not one unit of it, so they're probably not a Serial. */
export const isProductCode = id => PRODUCT_FORMATS.includes(id);

/** How long the same code must be out of view before it counts as a new read. */
export const REPEAT_WINDOW_MS = 2500;
/** How long live reading may go without a read before an automatic still shot. */
export const STILL_SHOT_AFTER_MS = 2500;

/**
 * Stops a code held in view from being reported over and over. Each sighting of the
 * last code restarts its window, so it only counts again once it has been out of view.
 */
export class RepeatFilter {
  #windowMs;
  #last = null;
  constructor(windowMs = REPEAT_WINDOW_MS) { this.#windowMs = windowMs; }
  isNew(value, now) {
    const repeat = this.#last && this.#last.value === value && now - this.#last.at < this.#windowMs;
    this.#last = { value, at: now };
    return !repeat;
  }
  /** Treat the last code as just seen (e.g. scanning resumes with it still in front of the camera). */
  stillSeen(now) { if (this.#last) this.#last.at = now; }
}

export const stillShotDue = (lastReadOrStillAt, now) => now - lastReadOrStillAt > STILL_SHOT_AFTER_MS;

/**
 * The part of the camera picture under the on-screen aiming box. The video is shown with
 * object-fit: cover, so the screen shows a centred slice of the picture.
 * inset: the box's distance from the viewer's edges, as fractions {top, side}.
 * pad: grows the box a little so codes touching its edge still read.
 */
export function aimRect(srcW, srcH, viewW, viewH, inset, pad = 0.12) {
  const scale = Math.max(viewW / srcW, viewH / srcH);
  const visW = viewW / scale, visH = viewH / scale;
  const visX = (srcW - visW) / 2, visY = (srcH - visH) / 2;
  let w = visW * (1 - 2 * inset.side), h = visH * (1 - 2 * inset.top);
  let x = visX + visW * inset.side, y = visY + visH * inset.top;
  const px = w * pad, py = h * pad;
  x = Math.max(0, x - px); y = Math.max(0, y - py);
  w = Math.min(srcW - x, w + 2 * px); h = Math.min(srcH - y, h + 2 * py);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/**
 * Reading strategies, tried in turn: one per live frame (round-robin), all of them
 * on a still shot until one reads. region: "aim" (the aiming box) or "full" (whole picture).
 * maxSide: largest edge in pixels after scaling; minScale enlarges small crops.
 */
export const STRATEGIES = [
  { region: "aim", maxSide: 1280 },
  { region: "aim", maxSide: 2000, minScale: 1.6 },
  { region: "full", maxSide: 1600 },
  { region: "aim", maxSide: 1280, binarizer: "GlobalHistogram" },
  { region: "aim", maxSide: 1280, sharpen: { radius: 2, amount: 1.5 } },
  { region: "full", maxSide: 2000, binarizer: "GlobalHistogram" },
  { region: "aim", maxSide: 2000, minScale: 1.6, sharpen: { radius: 3, amount: 2 } },
  { region: "aim", maxSide: 1280, sharpen: { radius: 1, amount: 1 }, binarizer: "GlobalHistogram" },
];

/**
 * iPhones with several back lenses list "virtual" cameras that switch to the
 * close-up lens on their own; those are best for small labels.
 */
export function closeUpCamera(cameras) {
  return cameras.find(c => /triple/i.test(c.label)) ?? cameras.find(c => /dual wide/i.test(c.label)) ?? null;
}

/**
 * Unsharp mask on RGBA pixel data, in place: turns the picture grey and boosts edges,
 * which rescued slightly out-of-focus labels in testing.
 */
export function sharpen(data, w, h, radius, amount) {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  const tmp = new Float32Array(w * h), blur = new Float32Array(w * h), n = 2 * radius + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0; const row = y * w;
    for (let x = -radius; x <= radius; x++) acc += g[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / n;
      acc += g[row + Math.min(w - 1, x + radius + 1)] - g[row + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -radius; y <= radius; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      blur[y * w + x] = acc / n;
      acc += tmp[Math.min(h - 1, y + radius + 1) * w + x] - tmp[Math.max(0, y - radius) * w + x];
    }
  }
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(0, Math.min(255, g[i] + amount * (g[i] - blur[i])));
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
  }
}
