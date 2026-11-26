// Steps and checks shared by the app tests.
import { expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixtures = join(new URL(".", import.meta.url).pathname, "..", "fixtures");
/** Every code on the printed test sheet: { file, format (ZXing name), text }. */
export const TEST_CODES = JSON.parse(readFileSync(join(fixtures, "codes.json"), "utf8"));
export const codePicture = file => join(fixtures, "codes", file);

export const FAKE_CAMERA_ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];

export async function createKit(page, name) {
  await page.getByLabel("Kit name").fill(name);
  await page.getByRole("button", { name: "Create Kit" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

export const serialBox = page => page.getByRole("textbox", { name: "Serial" });

/**
 * Count what a person would hear, feel and see on each read: beeps, buzzes and screen flashes.
 * Read the counts with readFeedback(page).
 */
export async function countFeedback(page) {
  await page.addInitScript(() => {
    const counts = { beeps: 0, buzzes: 0, flashes: 0 };
    window.__feedback = counts;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) { counts.beeps++; return start.apply(this, args); };
    navigator.vibrate = () => { counts.buzzes++; return true; };
    new MutationObserver(changes => {
      for (const c of changes) {
        const flash = c.target;
        if (!flash.classList?.contains("flash") || !flash.classList.contains("on")) continue;
        // Only count a flash a person could see: on the page, with the camera view showing.
        const view = flash.closest(".viewer");
        if (flash.isConnected && view && view.checkVisibility()) counts.flashes++;
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["class"] });
  });
}
export const readFeedback = page => page.evaluate(() => ({ ...window.__feedback }));
