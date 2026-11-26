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

/**
 * Go from the Kit list to the Export screen, untick the Kits named in leaveOut, tap Export, and
 * return the download (Chromium here has no Share menu, so the file downloads) once the app has
 * recorded the Export.
 */
export async function downloadExport(page, { leaveOut = [] } = {}) {
  await page.goto("/#");
  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Export" })).toBeVisible();
  for (const name of leaveOut) await page.getByRole("checkbox", { name: new RegExp(`^${name}\\b`) }).uncheck();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export" }).click(),
  ]);
  // Wait for the app to record the Export and go back to the Kit list, so the next step can't race it.
  await expect(page.getByRole("status")).toContainText(`Downloaded ${download.suggestedFilename()}`);
  return download;
}

/** Open a downloaded workbook with ExcelJS. */
export async function openWorkbook(download) {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(await download.path());
  return book;
}

/** Export every Kit and open the downloaded workbook. */
export async function exportWorkbook(page) {
  return openWorkbook(await downloadExport(page));
}

/** A sheet's rows as arrays of cell values, blank cells as null. */
export function sheetRows(sheet) {
  const width = sheet.columnCount;
  const rows = [];
  sheet.eachRow({ includeEmpty: true }, row => {
    rows.push(Array.from({ length: width }, (_, i) => row.getCell(i + 1).value ?? null));
  });
  return rows;
}
