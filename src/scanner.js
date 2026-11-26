// Scanner: the camera, the code reader and the scanning controls, lifted from the prototype on the
// prototype/scan-test branch (see VERDICT.md there). It reads codes from the live camera and from
// photos and reports each read as { format, raw }. It knows nothing about Kits or Items.
//
// What made the prototype work on real phones, kept here:
// - open the camera once, falling back to simpler requests if the phone refuses one;
//   never close it and reopen it straight away (phones refuse);
// - read only the area under the aiming box, one reading strategy per frame;
// - an automatic still shot after 2.5 s without a read, and a still shot on tap;
// - zoom starting at 2×; ZXing (zxing-wasm 3.1.6, vendored) plus the phone's built-in reader.
import {
  FORMAT_IDS, STRATEGIES, RepeatFilter, aimRect, closeUpCamera, formatId, sharpen, stillShotDue,
} from "./scan-reading.js";
import { el } from "./dom.js";

const AIM_INSET = { top: 0.25, side: 0.08 };
const READER_OPTIONS = {
  formats: ["UPCA", "UPCE", "EAN13", "EAN8", "Code128", "Code39", "Code93", "Codabar", "ITF",
    "QRCode", "MicroQRCode", "DataMatrix", "PDF417", "Aztec"],
  tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 1,
};
const WASM_URL = new URL("../vendor/zxing_reader-3.1.6.wasm", import.meta.url).href;
const START_ZOOM = 2;
const FRAME_GAP_MS = 60;
const PAUSE_AFTER_READ_MS = 1200;
const CAMERA_RELEASE_MS = 500; // a phone needs a moment between closing the camera and opening it again
const HINT = "Fit the code inside the box · tap the picture for a still shot";
const FLASH_MS = 250; // how long the camera view stays up after a read, so the flash is seen

// ---- Code reader -------------------------------------------------------------

let readerReady;
/** Load ZXing (and find the phone's built-in reader) once; resolves to { native } or rejects. */
function loadReader() {
  readerReady ??= (async () => {
    ZXingWASM.setZXingModuleOverrides({ locateFile: path => (path.endsWith(".wasm") ? WASM_URL : path) });
    await ZXingWASM.prepareZXingModule({ fireImmediately: true });
    let native = null;
    try {
      if ("BarcodeDetector" in window) {
        const supported = await BarcodeDetector.getSupportedFormats();
        const formats = FORMAT_IDS.filter(f => supported.includes(f));
        if (formats.length) native = new BarcodeDetector({ formats });
      }
    } catch { /* no built-in reader: ZXing alone is fine */ }
    return { native };
  })();
  return readerReady;
}

const work = document.createElement("canvas");
const workCtx = work.getContext("2d", { willReadFrequently: true });

/** Draw part of a picture at a chosen size and return its pixels. */
function grab(source, srcW, srcH, rect, maxSide, minScale = 1) {
  const r = rect ?? { x: 0, y: 0, w: srcW, h: srcH };
  const fit = maxSide / Math.max(r.w, r.h);
  const scale = minScale > 1 ? Math.min(minScale, Math.max(fit, 1)) : Math.min(1, fit);
  const w = Math.max(1, Math.round(r.w * scale)), h = Math.max(1, Math.round(r.h * scale));
  work.width = w; work.height = h;
  workCtx.imageSmoothingEnabled = true; workCtx.imageSmoothingQuality = "high";
  workCtx.drawImage(source, r.x, r.y, r.w, r.h, 0, 0, w, h);
  return workCtx.getImageData(0, 0, w, h);
}

async function readWithStrategy(picture, strategy) {
  const { source, w, h, aim } = picture;
  const img = grab(source, w, h, strategy.region === "aim" ? aim : null, strategy.maxSide, strategy.minScale);
  if (strategy.sharpen) sharpen(img.data, img.width, img.height, strategy.sharpen.radius, strategy.sharpen.amount);
  const options = strategy.binarizer ? { ...READER_OPTIONS, binarizer: strategy.binarizer } : READER_OPTIONS;
  const hit = (await ZXingWASM.readBarcodes(img, options)).find(r => r.isValid && r.text);
  return hit ? { format: formatId(hit.format), raw: hit.text } : null;
}

async function readWithBuiltIn(picture, native) {
  if (!native) return null;
  const found = await native.detect(grab(picture.source, picture.w, picture.h, picture.aim, 1280));
  return found.length ? { format: formatId(found[0].format), raw: found[0].rawValue } : null;
}

/** A careful read of one picture: the built-in reader, then every strategy until one reads. */
async function readCarefully(picture) {
  const { native } = await loadReader();
  try { const hit = await readWithBuiltIn(picture, native); if (hit) return hit; } catch { /* try ZXing */ }
  for (const strategy of STRATEGIES) {
    const hit = await readWithStrategy(picture, strategy).catch(() => null);
    if (hit) return hit;
  }
  return null;
}

// ---- Camera ------------------------------------------------------------------

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Open the camera, falling back to simpler requests when a phone refuses one. A refused
 * permission stops at once; other failures (camera busy, settings not supported) move on to the
 * next, simpler request after a short pause.
 */
async function openStream(deviceId) {
  const attempts = [
    ...(deviceId ? [{ deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }] : []),
    { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    { facingMode: "environment" },
    true,
  ];
  let lastError;
  for (const video of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: false, video });
    } catch (error) {
      lastError = error;
      if (isPermissionRefusal(error)) break;
      await wait(400);
    }
  }
  throw lastError;
}

const isPermissionRefusal = error => error.name === "NotAllowedError" || error.name === "SecurityError";

/** What to tell the user when the camera won't start, and what to do next. */
function cameraProblem(error) {
  const fallback = "Meanwhile you can use Take a photo below, or go back and type the Serial in.";
  if (!error) return `This browser can't open the camera from a web page. ${fallback}`;
  if (isPermissionRefusal(error)) {
    return "Camera permission was refused. To scan, allow the camera for this site: on iPhone, open Settings, "
      + "then Safari, then Camera; on Android, tap the icon beside the web address, then Permissions. "
      + `Then tap Try again. ${fallback}`;
  }
  if (error.name === "NotFoundError" || error.name === "OverconstrainedError") {
    return `No camera was found on this device. ${fallback}`;
  }
  return `The camera didn't start (the phone said: ${error.name}). Close any other app or browser tab `
    + `that is using the camera, then tap Try again. ${fallback}`;
}

// ---- Feedback ----------------------------------------------------------------

let audio;
/** Must run during a tap: browsers only allow sound that a tap started. */
function prepareSound() {
  try { audio ??= new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch { /* no sound */ }
}
function beep() {
  try {
    const tone = audio.createOscillator(), volume = audio.createGain();
    tone.frequency.value = 1760; volume.gain.value = 0.15;
    tone.connect(volume); volume.connect(audio.destination);
    tone.start(); tone.stop(audio.currentTime + 0.09);
  } catch { /* no sound */ }
}

// ---- The scanner -------------------------------------------------------------

/**
 * Create the scanner. onRead({ format, raw, at }) is called for each new read (at: when it was
 * read, as an ISO date); scanning pauses until scan() is called again. The scanner's controls are in scanner.element.
 */
export function createScanner({ onRead }) {
  const ui = buildControls();
  const repeats = new RepeatFilter();
  let stream = null, track = null, deviceId = null, stoppedAt = 0;
  let scanning = false, loopRunning = false, busy = false, pausedUntil = 0, lastActivity = 0, strategyIndex = 0;

  /** Open the camera if it isn't open, and start (or carry on) reading. Call during a tap. */
  async function scan() {
    prepareSound();
    ui.hint.textContent = HINT;
    loadReader().catch(() => showProblem(
      "The code reader didn't load. Reload the page and try again. Meanwhile you can type the Serial in."));
    if (!stream) {
      if (!(await openCamera())) return;
    } else {
      await ui.video.play().catch(() => {}); // re-shown after the Item form
    }
    repeats.stillSeen(Date.now());
    lastActivity = Date.now();
    scanning = true;
    loop();
  }

  async function openCamera() {
    ui.problem.hidden = true;
    if (!navigator.mediaDevices?.getUserMedia) return showProblem(cameraProblem(null), false);
    await wait(Math.max(0, stoppedAt + CAMERA_RELEASE_MS - Date.now()));
    try {
      stream = await openStream(deviceId);
    } catch (error) {
      stream = null;
      return showProblem(cameraProblem(error), true);
    }
    await useTrack();
    // Camera names only appear once permission is granted.
    await listCameras();
    ui.viewer.hidden = false;
    return true;
  }

  function showProblem(message, canRetry = false) {
    ui.problemText.textContent = message;
    ui.retry.hidden = !canRetry;
    ui.problem.hidden = false;
    ui.viewer.hidden = true;
    ui.cameraControls.hidden = true;
    return false;
  }

  async function useTrack() {
    track = stream.getVideoTracks()[0];
    deviceId = track.getSettings?.().deviceId ?? deviceId;
    ui.video.srcObject = stream;
    await ui.video.play().catch(() => {});
    const caps = track.getCapabilities?.() ?? {};
    if (caps.focusMode?.includes("continuous")) {
      await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
    }
    // Start a little zoomed in, so people hold the phone far enough away for it to focus.
    const hasZoom = caps.zoom && caps.zoom.max > caps.zoom.min;
    ui.zoomField.hidden = !hasZoom;
    if (hasZoom) {
      Object.assign(ui.zoom, { min: caps.zoom.min, max: Math.min(caps.zoom.max, 8), step: caps.zoom.step || 0.1 });
      await setZoom(Math.min(Math.max(START_ZOOM, caps.zoom.min), Number(ui.zoom.max)));
    }
    ui.torch.hidden = !caps.torch;
    ui.torch.setAttribute("aria-pressed", "false");
    ui.cameraControls.hidden = false;
  }

  async function listCameras() {
    const cameras = (await navigator.mediaDevices.enumerateDevices().catch(() => []))
      .filter(d => d.kind === "videoinput");
    const closeUp = closeUpCamera(cameras);
    ui.camera.replaceChildren(...cameras.map((c, i) => el("option", { value: c.deviceId },
      (c.label || `Camera ${i + 1}`) + (c === closeUp ? " (best for close-ups)" : ""))));
    ui.camera.value = deviceId ?? "";
    ui.cameraField.hidden = cameras.length < 2;
    ui.cameraHint.hidden = !closeUp;
  }

  async function setZoom(value) {
    ui.zoom.value = value;
    ui.zoomValue.textContent = `${Number(value).toFixed(1)}×`;
    await track?.applyConstraints({ advanced: [{ zoom: Number(value) }] }).catch(() => {});
  }

  async function toggleTorch() {
    const on = ui.torch.getAttribute("aria-pressed") !== "true";
    try {
      await track.applyConstraints({ advanced: [{ torch: on }] });
      ui.torch.setAttribute("aria-pressed", String(on));
    } catch { /* this camera's flashlight can't be switched from here */ }
  }

  async function switchCamera(id) {
    const wasScanning = scanning;
    closeCamera();
    deviceId = id;
    await wait(CAMERA_RELEASE_MS);
    if (await openCamera() && wasScanning) { scanning = true; loop(); }
  }

  function closeCamera() {
    scanning = false;
    stream?.getTracks().forEach(t => t.stop());
    if (stream) stoppedAt = Date.now();
    stream = null; track = null;
    ui.video.srcObject = null;
  }

  /** The live picture, with the aiming box worked out for its size. */
  function livePicture() {
    const { video, viewer } = ui;
    const box = viewer.getBoundingClientRect();
    return { source: video, w: video.videoWidth, h: video.videoHeight,
      aim: aimRect(video.videoWidth, video.videoHeight, box.width, box.height, AIM_INSET) };
  }

  async function loop() {
    if (loopRunning) return;
    loopRunning = true;
    while (scanning) {
      const now = Date.now();
      if (ui.video.readyState >= 2 && ui.video.videoWidth && !busy && now >= pausedUntil) {
        busy = true;
        try { await readLiveFrame(); } finally { busy = false; }
      }
      await wait(FRAME_GAP_MS);
    }
    loopRunning = false;
  }

  async function readLiveFrame() {
    let reader;
    try { reader = await loadReader(); } catch { return; }
    const picture = livePicture();
    let hit = await readWithBuiltIn(picture, reader.native).catch(() => null);
    hit ??= await readWithStrategy(picture, STRATEGIES[strategyIndex++ % STRATEGIES.length]).catch(() => null);
    if (hit) { lastActivity = Date.now(); report(hit); }
    else if (stillShotDue(lastActivity, Date.now())) { lastActivity = Date.now(); await stillShot(false); }
  }

  /** A still shot: a full-resolution photo where the browser allows it (on a tap), else the current frame. */
  async function stillShot(tapped) {
    const live = livePicture();
    if (!live.w) return;
    if (tapped) ui.hint.textContent = "Taking a still shot…";
    let picture = null;
    if (tapped && "ImageCapture" in window && track) {
      try {
        const photo = await createImageBitmap(await new ImageCapture(track).takePhoto());
        const sx = photo.width / live.w, sy = photo.height / live.h;
        picture = { source: photo, w: photo.width, h: photo.height,
          aim: { x: live.aim.x * sx, y: live.aim.y * sy, w: live.aim.w * sx, h: live.aim.h * sy } };
      } catch { /* use the current frame instead */ }
    }
    if (!picture) {
      // Freeze the frame so every strategy works on the same picture.
      const frame = Object.assign(document.createElement("canvas"), { width: live.w, height: live.h });
      frame.getContext("2d").drawImage(ui.video, 0, 0);
      picture = { ...live, source: frame };
    }
    const hit = await readCarefully(picture).catch(() => null);
    if (hit) report(hit);
    else if (tapped) ui.hint.textContent = "Nothing found in that still shot. Try zooming in, or moving back a little.";
  }

  /** Run one reading job at a time: live frames, still shots and photos share the reader. */
  async function exclusively(job) {
    while (busy) await wait(50);
    busy = true;
    try { return await job(); } finally { busy = false; }
  }

  async function tapStillShot() {
    if (!scanning) return;
    prepareSound();
    await exclusively(() => stillShot(true));
  }

  async function readPhoto(file) {
    if (!file) return;
    prepareSound();
    ui.photoStatus.textContent = "Reading the photo…";
    await exclusively(async () => {
      try {
        const photo = await createImageBitmap(file);
        const centre = { x: photo.width * 0.1, y: photo.height * 0.1, w: photo.width * 0.8, h: photo.height * 0.8 };
        const hit = await readCarefully({ source: photo, w: photo.width, h: photo.height, aim: centre });
        ui.photoStatus.textContent = hit ? "" : "No code found in that photo. Try again closer and steadier, with the label flat and well lit.";
        if (hit) report(hit, { always: true });
      } catch {
        ui.photoStatus.textContent = "That photo couldn't be read. Try taking it again.";
      }
    });
  }

  function report(hit, { always = false } = {}) {
    if (!repeats.isNew(hit.raw, Date.now()) && !always) return;
    scanning = false;
    pausedUntil = Date.now() + PAUSE_AFTER_READ_MS;
    const read = { ...hit, at: new Date().toISOString() };
    beep();
    navigator.vibrate?.(70);
    ui.flash.classList.add("on");
    ui.aim.classList.add("hit");
    requestAnimationFrame(() => requestAnimationFrame(() => ui.flash.classList.remove("on")));
    // Keep the camera view up for a moment so the flash and the green box are seen.
    setTimeout(() => { ui.aim.classList.remove("hit"); onRead(read); }, FLASH_MS);
  }

  ui.viewer.addEventListener("click", tapStillShot);
  ui.torch.addEventListener("click", toggleTorch);
  ui.zoom.addEventListener("input", () => setZoom(ui.zoom.value));
  ui.camera.addEventListener("change", () => switchCamera(ui.camera.value));
  ui.retry.addEventListener("click", () => scan());
  ui.photo.addEventListener("change", () => { readPhoto(ui.photo.files[0]); ui.photo.value = ""; });

  return {
    element: ui.root,
    scan,
    /** Close the camera. */
    stop() { closeCamera(); ui.problem.hidden = true; ui.photoStatus.textContent = ""; },
  };
}

function buildControls() {
  const video = el("video", { playsinline: "", muted: "", autoplay: "" });
  video.muted = true;
  const flash = el("div", { class: "flash" });
  const hint = el("p", { class: "hint" }, HINT);
  const aim = el("div", { class: "aim" });
  const viewer = el("section", { class: "viewer", "aria-label": "Camera" }, video, aim, hint, flash);
  viewer.hidden = true;

  const zoom = el("input", { type: "range", min: "1", max: "4", step: "0.1", value: "1" });
  const zoomValue = el("span", { class: "value" });
  const zoomField = el("label", { class: "field" }, el("span", {}, "Zoom ", zoomValue), zoom);
  const torch = el("button", { type: "button", class: "secondary", "aria-pressed": "false" }, "Flashlight");
  const camera = el("select", {});
  const cameraHint = el("span", { class: "small" }, "If small labels look blurry, choose the camera marked \"best for close-ups\".");
  const cameraField = el("label", { class: "field" }, "Camera", camera, cameraHint);
  const cameraControls = el("div", { class: "camera-controls" }, zoomField, torch, cameraField);
  cameraControls.hidden = true;

  const problemText = el("span", {});
  const retry = el("button", { type: "button" }, "Try again");
  const problem = el("div", { class: "problem", role: "alert" }, problemText, retry);
  problem.hidden = true;

  const photo = el("input", { type: "file", accept: "image/*", capture: "environment" });
  const photoStatus = el("p", { class: "small", "aria-live": "polite" });
  const photoBlock = el("div", { class: "photo" },
    el("label", { class: "file-button" }, "Take a photo", photo),
    el("p", { class: "small" }, "Opens the phone's own camera, which focuses up close better than a web page can."),
    photoStatus);

  const root = el("div", { class: "scanner" }, problem, viewer, cameraControls, photoBlock);
  return { root, video, flash, aim, hint, viewer, zoom, zoomValue, zoomField, torch, camera, cameraHint, cameraField,
    cameraControls, problem, problemText, retry, photo, photoStatus };
}
