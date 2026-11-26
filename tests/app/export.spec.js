// The full Export: choose Kits, Share (or download where there's no Share), and export status.
import { test, expect } from "@playwright/test";
import { createKit, downloadExport, openWorkbook, serialBox, sheetRows } from "./helpers.js";
import ExcelJS from "exceljs";

// Times are Pacific (the browser's time zone in playwright.config.js).
const at = (h, m) => new Date(`2026-11-26T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00-08:00`);

async function addSerial(page, serial) {
  await page.getByRole("button", { name: "Type a Serial" }).click();
  await serialBox(page).fill(serial);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("link", { name: `Edit ${serial}` })).toBeVisible();
}

/** Three Kits, each with one Item, then back on the Kit list. */
async function threeKits(page) {
  await page.goto("/");
  for (const [name, serial] of [["Radios", "SN-1"], ["Laptops", "LT-1"], ["Spares", "SP-1"]]) {
    await createKit(page, name);
    await addSerial(page, serial);
    await page.getByRole("link", { name: "All Kits" }).click();
  }
}

const kitRow = (page, name) => page.locator(".kits li").filter({ hasText: new RegExp(`^${name}`) });
const reminder = page => page.locator(".reminder");

test("leave one Kit out: the workbook has only the ticked Kits, and their status updates", async ({ page }) => {
  await page.clock.setFixedTime(at(9, 0));
  await threeKits(page);
  for (const name of ["Radios", "Laptops", "Spares"]) await expect(kitRow(page, name)).toContainText("Not exported yet");
  await expect(reminder(page)).toContainText("3 Kits not exported yet or changed since export");

  // Every Kit is ticked to start with.
  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(3);
  for (const box of await page.getByRole("checkbox").all()) await expect(box).toBeChecked();
  await expect(page.getByText("3 of 3 Kits ticked.")).toBeVisible();

  await page.clock.setFixedTime(at(10, 15));
  const download = await downloadExport(page, { leaveOut: ["Laptops"] });
  expect(download.suggestedFilename()).toBe("scanit-2026-11-26.xlsx");
  const book = await openWorkbook(download);
  expect(book.worksheets.map(s => s.name)).toEqual(["Summary", "Radios", "Spares"]);
  expect(sheetRows(book.getWorksheet("Summary")).map(r => r[0])).toEqual(["Kit name", "Radios", "Spares"]);

  // Back on the Kit list: the exported Kits say so, the one left out doesn't.
  await expect(page.getByRole("status")).toContainText("Downloaded scanit-2026-11-26.xlsx with 2 Kits");
  await expect(kitRow(page, "Radios")).toContainText("Exported Nov 26, 2026, 10:15 AM");
  await expect(kitRow(page, "Spares")).toContainText("Exported Nov 26, 2026, 10:15 AM");
  await expect(kitRow(page, "Laptops")).toContainText("Not exported yet");
  await expect(reminder(page)).toContainText("1 Kit not exported yet or changed since export");

  // Editing an exported Kit makes it "Changed since export"; it survives a reload.
  await page.locator(".kits a").filter({ hasText: "Radios" }).click();
  await addSerial(page, "SN-2");
  await page.getByRole("link", { name: "All Kits" }).click();
  await expect(kitRow(page, "Radios")).toContainText("Changed since export");
  await expect(reminder(page)).toContainText("2 Kits not exported yet or changed since export");
  await page.reload();
  await expect(kitRow(page, "Radios")).toContainText("Changed since export");

  // Exporting everything clears the reminder.
  await downloadExport(page);
  await expect(page.getByRole("status")).toContainText("with 3 Kits");
  await expect(reminder(page)).toHaveCount(0);
});

test("Export can't be tapped with no Kits ticked", async ({ page }) => {
  await threeKits(page);
  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(3);
  for (const box of await page.getByRole("checkbox").all()) await box.uncheck();
  await expect(page.getByText("0 of 3 Kits ticked.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export" })).toBeDisabled();
});

test("where the phone has a Share menu, Export shares the .xlsx file instead of downloading", async ({ page }) => {
  // Stand in for a phone's Share menu: accept files, and keep what was shared.
  await page.addInitScript(() => {
    navigator.canShare = data => Array.isArray(data?.files) && data.files.length > 0;
    navigator.share = async data => {
      const file = data.files[0];
      window.__shared = { name: file.name, type: file.type, bytes: [...new Uint8Array(await file.arrayBuffer())] };
    };
  });
  let downloaded = false;
  page.on("download", () => { downloaded = true; });
  await page.clock.setFixedTime(at(11, 0));
  await threeKits(page);
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("checkbox", { name: /^Spares\b/ }).uncheck();
  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("status")).toContainText("Shared scanit-2026-11-26.xlsx with 2 Kits");

  const shared = await page.evaluate(() => window.__shared);
  expect(shared.name).toBe("scanit-2026-11-26.xlsx");
  expect(shared.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(shared.bytes));
  expect(book.worksheets.map(s => s.name)).toEqual(["Summary", "Radios", "Laptops"]);
  expect(downloaded).toBe(false);
  await expect(kitRow(page, "Spares")).toContainText("Not exported yet");
});

test("closing the Share menu sends nothing and marks nothing exported", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.canShare = () => true;
    navigator.share = async () => { throw new DOMException("Share canceled", "AbortError"); };
  });
  await threeKits(page);
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("status")).toContainText("nothing was sent");
  await page.getByRole("link", { name: "All Kits" }).click();
  await expect(kitRow(page, "Radios")).toContainText("Not exported yet");
});

test("deleting a Kit warns when it was never exported or has changed since", async ({ page }) => {
  await threeKits(page);
  const askToDelete = async name => {
    await page.goto("/#");
    await page.locator(".kits a").filter({ hasText: name }).click();
    await page.getByRole("link", { name: "Edit Kit" }).click();
    await page.getByRole("button", { name: "Delete Kit" }).click();
    return page.getByRole("alertdialog", { name: "Are you sure?" });
  };

  await expect(await askToDelete("Radios")).toContainText("never been exported");

  await downloadExport(page);
  const ask = await askToDelete("Radios");
  await expect(ask).toContainText("Radios and its 1 Item");
  await expect(ask).not.toContainText("never been exported");
  await expect(ask).not.toContainText("changed since");

  await page.getByRole("button", { name: "Keep it" }).click();
  await page.getByLabel("Notes").fill("Shelf B2");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".kit-notes")).toHaveText("Shelf B2");
  await expect(await askToDelete("Radios")).toContainText("changed since its last Export");
});

test("while the Share menu is open, Export can't be tapped again", async ({ page }) => {
  // A Share menu that stays open until the test closes it.
  await page.addInitScript(() => {
    navigator.canShare = () => true;
    navigator.share = () => new Promise(resolve => { window.__closeShare = resolve; });
  });
  await threeKits(page);
  await page.getByRole("button", { name: "Export" }).click();
  const exportButton = page.getByRole("button", { name: "Export" });
  await exportButton.click();
  await expect(exportButton).toBeDisabled();
  await page.evaluate(() => window.__closeShare());
  await expect(page.getByRole("status")).toContainText("Shared scanit-");
});

test("when Share refuses the file, nothing is marked sent until Download instead is tapped", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.canShare = () => true;
    navigator.share = async () => { throw new DOMException("Not allowed", "NotAllowedError"); };
  });
  let downloads = 0;
  page.on("download", () => { downloads++; });
  await threeKits(page);
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("alert")).toContainText("Share couldn't send the file");
  expect(downloads).toBe(0); // no download behind the user's back

  // Cancel: still nothing sent.
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("link", { name: "All Kits" }).click();
  await expect(kitRow(page, "Radios")).toContainText("Not exported yet");

  // Download instead: a fresh tap downloads the file, and only then are the Kits marked.
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("button", { name: "Export" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download instead" }).click(),
  ]);
  const book = await openWorkbook(download);
  expect(book.worksheets.map(s => s.name)).toEqual(["Summary", "Radios", "Laptops", "Spares"]);
  await expect(page.getByRole("status")).toContainText("Downloaded scanit-");
  await expect(kitRow(page, "Radios")).toContainText("Exported");
});

test("if the phone can't record the Export, the Kits don't look sent", async ({ page }) => {
  await threeKits(page);
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function () { throw new DOMException("Storage is full", "QuotaExceededError"); };
  });
  await page.getByRole("button", { name: "Export" }).click();
  await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export" }).click()]);
  await expect(page.getByRole("alert")).toContainText("couldn't record that");
  await page.getByRole("link", { name: "All Kits" }).click();
  await expect(kitRow(page, "Radios")).toContainText("Not exported yet");
  await expect(reminder(page)).toContainText("3 Kits");
});
