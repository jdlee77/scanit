// Scanning Items through Chromium's fake camera. The camera plays a looping video of codes cut
// from the printed test sheet (see fake-camera.js): a Code 128, a multi-line QR code, then a UPC.
import { test, expect } from "@playwright/test";
import { SCAN_VIDEO } from "./fake-camera.js";
import { FAKE_CAMERA_ARGS, createKit, serialBox, countFeedback, readFeedback } from "./helpers.js";

test.use({ launchOptions: { args: [...FAKE_CAMERA_ARGS, `--use-file-for-fake-video-capture=${SCAN_VIDEO}`] } });

// Each code is in view for 4 s of every 15 s loop, so allow time for the next one to come round.
const READ_TIMEOUT = { timeout: 20000 };
const QR_TEXT = "Make: Motorola\nModel: APX 6000\nSerial: 475CTV1293";

test("scan Items one after another with Save & scan next", async ({ page }) => {
  await countFeedback(page);
  await page.goto("/");
  await createKit(page, "Radio Cache 3");
  await page.getByRole("button", { name: "Scan" }).click();

  // First code: a Code 128 serial label.
  await expect(serialBox(page)).toHaveValue("K9P2207731", READ_TIMEOUT);
  await expect(page.getByRole("heading", { name: "New Item" })).toBeVisible();
  await expect(page.getByText("Read from a Code 128")).toBeVisible();
  await expect(page.getByText(/product code/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Save & scan next" }).click();

  // Straight back to the camera; the next code read is the QR code, every line kept.
  // (Wait on the Serial itself: the previous form stays up for a moment while it saves.)
  await expect(serialBox(page)).toHaveValue(QR_TEXT, READ_TIMEOUT);
  await expect(page.getByText("Read from a QR code")).toBeVisible();
  await page.getByRole("button", { name: "Save & scan next" }).click();

  // A UPC comes back as 13 digits, with a note that it's probably a product code.
  await expect(serialBox(page)).toHaveValue("0036000291452", READ_TIMEOUT);
  await expect(page.getByText(/probably a product code, not a serial number/i)).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // Back in the Kit: three Items in scan order, each showing the code format it was read from.
  await expect(page.getByRole("heading", { level: 1, name: "Radio Cache 3" })).toBeVisible();
  const items = page.getByRole("listitem");
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText("K9P2207731");
  await expect(items.nth(0)).toContainText("Code 128");
  await expect(items.nth(1)).toContainText("Serial: 475CTV1293");
  await expect(items.nth(1)).toContainText("QR code");
  await expect(items.nth(2)).toContainText("0036000291452");
  await expect(items.nth(2)).toContainText("EAN-13");

  // A beep, a flash and a buzz for every read.
  expect(await readFeedback(page)).toEqual({ beeps: 3, buzzes: 3, flashes: 3 });

  // The camera is off once back in the Kit.
  expect(await page.evaluate(() => document.querySelectorAll("video").length)).toBe(0);
});

test("the Serial can be corrected before saving, and Back to camera saves nothing", async ({ page }) => {
  await page.goto("/");
  await createKit(page, "Spares");
  await page.getByRole("button", { name: "Scan" }).click();
  await scanUntil(page, "K9P2207731");

  await page.getByRole("button", { name: "Back to camera" }).click();
  await expect(page.getByRole("region", { name: "Camera" })).toBeVisible();

  // The next read (the QR code): keep only the serial number.
  await expect(serialBox(page)).toHaveValue(QR_TEXT, READ_TIMEOUT);
  await serialBox(page).fill("475CTV1293");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  const items = page.getByRole("listitem");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("475CTV1293");
});

test("the camera still starts when the phone refuses the first request", async ({ page }) => {
  await page.addInitScript(() => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let calls = 0;
    navigator.mediaDevices.getUserMedia = constraints => {
      calls++;
      window.__cameraRequests = calls;
      return calls === 1
        ? Promise.reject(new DOMException("Could not start video source", "NotReadableError"))
        : real(constraints);
    };
  });
  await page.goto("/");
  await createKit(page, "Fallback");
  await page.getByRole("button", { name: "Scan" }).click();
  await expect(serialBox(page)).toHaveValue("K9P2207731", READ_TIMEOUT);
  expect(await page.evaluate(() => window.__cameraRequests)).toBe(2);
});

/** The video loops through its codes; go back to the camera until this one is read. */
async function scanUntil(page, serial) {
  for (let tries = 0; tries < 4; tries++) {
    await expect(serialBox(page)).not.toHaveValue("", READ_TIMEOUT);
    if (await serialBox(page).inputValue() === serial) return;
    await page.getByRole("button", { name: "Back to camera" }).click();
    await expect(serialBox(page)).toBeHidden();
  }
  throw new Error(`The camera never read ${serial}`);
}

test("duplicate warnings work while scanning: refused in this Kit, Save anyway for another Kit", async ({ page }) => {
  await page.goto("/");
  await createKit(page, "Radio Cache 3");
  // The first code the camera shows is K9P2207731; put it in this Kit by typing it.
  await page.getByRole("button", { name: "Type a Serial" }).click();
  await serialBox(page).fill("K9P2207731");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // Scanning it again into the same Kit is refused; Back to camera saves nothing.
  await page.getByRole("button", { name: "Scan" }).click();
  await scanUntil(page, "K9P2207731");
  await page.getByRole("button", { name: "Save & scan next" }).click();
  await expect(page.getByRole("alert")).toContainText("K9P2207731 is already in this Kit");
  await page.getByRole("button", { name: "Back to camera" }).click();
  await page.getByRole("button", { name: "Back to Kit" }).click();
  await expect(page.locator(".items .serial")).toHaveText(["K9P2207731"]);

  // Scanned into another Kit, it warns, names the first Kit, and Save anyway goes on scanning.
  await page.getByRole("link", { name: "All Kits" }).click();
  await createKit(page, "Spares");
  await page.getByRole("button", { name: "Scan" }).click();
  await scanUntil(page, "K9P2207731");
  await page.getByRole("button", { name: "Save & scan next" }).click();
  await expect(page.getByRole("alert")).toContainText("K9P2207731 is already in Radio Cache 3");
  await page.getByRole("button", { name: "Save anyway" }).click();
  // Saved, and straight back to the camera for the next read.
  await expect(serialBox(page)).not.toHaveValue("K9P2207731", READ_TIMEOUT);
  await page.getByRole("button", { name: "Back to camera" }).click();
  await page.getByRole("button", { name: "Back to Kit" }).click();
  await expect(page.locator(".items .serial")).toHaveText(["K9P2207731"]);
});
