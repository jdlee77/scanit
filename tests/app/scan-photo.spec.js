// Reading codes from photos, the camera controls, and what happens when the camera won't start.
// The fake camera here is Chromium's default test pattern, which holds no code.
import { test, expect } from "@playwright/test";
import { FAKE_CAMERA_ARGS, TEST_CODES, codePicture, createKit, serialBox } from "./helpers.js";

test.use({ launchOptions: { args: FAKE_CAMERA_ARGS } });

const FORMAT_SHOWN = { QRCode: "QR code", EAN13: "EAN-13", Code128: "Code 128", Code39: "Code 39", DataMatrix: "Data Matrix" };

async function openScanner(page, kitName = "Photos") {
  await page.goto("/");
  await createKit(page, kitName);
  await page.getByRole("button", { name: "Scan" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Scan Items" })).toBeVisible();
}

const cameraIsOn = page => expect(page.getByRole("region", { name: "Camera" })).toBeVisible();

test("every code on the test sheet reads from a photo", async ({ page }) => {
  test.setTimeout(90000);
  await openScanner(page);
  await cameraIsOn(page);
  for (const code of TEST_CODES) {
    await page.getByLabel("Take a photo").setInputFiles(codePicture(code.file));
    await expect(serialBox(page), code.file).toHaveValue(code.text, { timeout: 10000 });
    const article = code.format === "EAN13" ? "an" : "a";
    await expect(page.getByText(`Read from ${article} ${FORMAT_SHOWN[code.format]}`), code.file).toBeVisible();
    await expect(page.getByText(/probably a product code/i), code.file).toHaveCount(code.format === "EAN13" ? 1 : 0);
    await page.getByRole("button", { name: "Save & scan next" }).click();
    await expect(page.getByRole("region", { name: "Camera" })).toBeVisible();
  }
  await page.getByRole("button", { name: "Back to Kit" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(TEST_CODES.length);
});

test("a photo with no code in it says so", async ({ page }) => {
  await openScanner(page);
  await cameraIsOn(page);
  await page.getByLabel("Take a photo").setInputFiles({
    name: "blank.png", mimeType: "image/png",
    // A plain white 64×64 picture.
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAYElEQVR4nO3PQQ0AIBDAMMC/50MEj4ZkVbDtmVk/OzrgVQNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgPaBXKqA31N0fbGAAAAAElFTkSuQmCC", "base64"),
  });
  await expect(page.getByText("No code found in that photo")).toBeVisible();
  await expect(page.getByRole("region", { name: "Camera" })).toBeVisible();
});

test("tapping the picture takes a still shot", async ({ page }) => {
  await openScanner(page);
  await cameraIsOn(page);
  await page.getByRole("region", { name: "Camera" }).click();
  await expect(page.getByText("Nothing found in that still shot")).toBeVisible({ timeout: 10000 });
});

test("zoom starts at 2×, with a flashlight and camera picker, where the phone supports them", async ({ page }) => {
  await page.addInitScript(() => {
    // Pretend to be an iPhone-like camera with zoom, a flashlight and several back lenses.
    MediaStreamTrack.prototype.getCapabilities = () => ({ zoom: { min: 1, max: 10, step: 0.1 }, torch: true });
    MediaStreamTrack.prototype.applyConstraints = async () => {};
    const realList = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = async () => {
      const real = (await realList()).find(d => d.kind === "videoinput");
      const fake = (deviceId, label) => ({ deviceId, label, kind: "videoinput", groupId: "g" });
      return [real, fake("wide", "Back Dual Wide Camera"), fake("triple", "Back Triple Camera")];
    };
  });
  await openScanner(page);
  await cameraIsOn(page);

  const zoom = page.getByRole("slider", { name: "Zoom" });
  await expect(zoom).toHaveValue("2");
  await expect(page.getByText("2.0×")).toBeVisible();
  await zoom.fill("3.5");
  await expect(page.getByText("3.5×")).toBeVisible();

  const torch = page.getByRole("button", { name: "Flashlight" });
  await expect(torch).toHaveAttribute("aria-pressed", "false");
  await torch.click();
  await expect(torch).toHaveAttribute("aria-pressed", "true");

  const picker = page.getByRole("combobox", { name: "Camera" });
  await expect(picker.getByRole("option")).toHaveCount(3);
  await expect(picker.getByRole("option", { name: "Back Triple Camera (best for close-ups)" })).toHaveCount(1);
});

test("no zoom, flashlight or picker on a camera without them", async ({ page }) => {
  await openScanner(page);
  await expect(page.getByRole("slider", { name: "Zoom" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Flashlight" })).toBeHidden();
  await expect(page.getByRole("combobox", { name: "Camera" })).toBeHidden();
});

test("a refused camera permission says what to do, and photos still work", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  });
  await openScanner(page, "No camera");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Camera permission was refused");
  await expect(alert).toContainText("Settings");
  await expect(alert).toContainText("Take a photo");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

  await page.getByLabel("Take a photo").setInputFiles(codePicture("Code39-CS9921847.png"));
  await expect(serialBox(page)).toHaveValue("CS9921847");
});

test("a camera that won't start says what to do", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Device in use", "NotReadableError"));
  });
  await openScanner(page, "Busy camera");
  await expect(page.getByRole("alert")).toContainText("The camera didn't start", { timeout: 10000 });
  await expect(page.getByRole("alert")).toContainText("Close any other app");
});

test("typing a Serial in still works from the Kit", async ({ page }) => {
  await page.goto("/");
  await createKit(page, "Typed");
  await serialBox(page).fill("HAND-TYPED-1");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("listitem").first()).toContainText("Typed in");
});

test("an Item's scanned-at time is when the code was read, not when it was saved", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-26T09:05:00-08:00"));
  await openScanner(page, "Timing");
  await page.getByLabel("Take a photo").setInputFiles(codePicture("Code39-CS9921847.png"));
  await expect(serialBox(page)).toHaveValue("CS9921847");
  await page.clock.setFixedTime(new Date("2026-11-26T09:20:00-08:00"));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("listitem").first()).toContainText("9:05 AM");
});

test("a Serial trimmed from the read keeps its code format; one replaced by hand counts as typed in", async ({ page }) => {
  await openScanner(page, "Corrections");
  await page.getByLabel("Take a photo").setInputFiles(codePicture("Code128-S-N-20B4471X.png"));
  await expect(serialBox(page)).toHaveValue("S/N 20B4471X");
  await serialBox(page).fill("20B4471X");
  await page.getByRole("button", { name: "Save & scan next" }).click();

  await page.getByLabel("Take a photo").setInputFiles(codePicture("EAN13-0036000291452.png"));
  await expect(serialBox(page)).toHaveValue("0036000291452");
  await serialBox(page).fill("RADIO-SERIAL-77");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  const items = page.getByRole("listitem");
  await expect(items.nth(0)).toContainText("20B4471X");
  await expect(items.nth(0)).toContainText("Code 128");
  await expect(items.nth(1)).toContainText("RADIO-SERIAL-77");
  await expect(items.nth(1)).toContainText("Typed in");
});
