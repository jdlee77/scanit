// The first working path, checked the way a person would see it on a phone:
// create a Kit, type Serials in, reload, then Export and open the workbook.
import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";

// Times are Pacific (the browser's time zone in playwright.config.js).
const at = (h, m) => new Date(`2026-11-26T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00-08:00`);
// What a spreadsheet reader gives back for a local date and time written into the workbook.
const cellTime = (h, m, day = 26) => new Date(Date.UTC(2026, 10, day, h, m));

async function createKit(page, name) {
  await page.getByLabel("Kit name").fill(name);
  await page.getByRole("button", { name: "Create Kit" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

async function addSerial(page, serial) {
  await page.getByLabel("Serial").fill(serial);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: serial })).toBeVisible();
}

const backToKits = page => page.getByRole("link", { name: "All Kits" }).click();
const kitRow = (page, name) => page.getByRole("link", { name: new RegExp(`^${name}`) });

test("create a Kit, type Serials in, reload, and Export a workbook", async ({ page }) => {
  await page.clock.setFixedTime(at(8, 30));
  await page.goto("/");
  await expect(page.getByText("No Kits yet")).toBeVisible();

  await createKit(page, "Radio Cache 3");
  await page.clock.setFixedTime(at(9, 5));
  await addSerial(page, "SN-001");
  await page.clock.setFixedTime(at(9, 9));
  await addSerial(page, "  SN-002  ");
  await expect(page.getByLabel("Serial")).toHaveValue("");

  await backToKits(page);
  await page.clock.setFixedTime(at(9, 20));
  await createKit(page, "EOC Laptops");
  await backToKits(page);

  // Everything is still there after closing and reopening the app.
  await page.reload();
  await expect(kitRow(page, "Radio Cache 3")).toContainText("2 Items");
  await expect(kitRow(page, "EOC Laptops")).toContainText("0 Items");

  await kitRow(page, "Radio Cache 3").click();
  const items = page.getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("SN-001");
  await expect(items.nth(0)).toContainText("9:05 AM");
  await expect(items.nth(1)).toContainText("SN-002");
  await expect(items.nth(1)).toContainText("9:09 AM");
  await expect(page.getByText("Created Nov 26, 2026")).toBeVisible();

  // Reloading inside a Kit stays in that Kit.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Radio Cache 3" })).toBeVisible();
  await backToKits(page);

  await page.clock.setFixedTime(at(10, 0));
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("scanit-2026-11-26.xlsx");

  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(await download.path());
  expect(book.worksheets.map(s => s.name)).toEqual(["Summary", "Radio Cache 3", "EOC Laptops"]);

  const rows = sheet => sheet.getSheetValues().slice(1).map(r => r.slice(1));
  expect(rows(book.getWorksheet("Summary"))).toEqual([
    ["Kit", "Created", "Items"],
    ["Radio Cache 3", cellTime(8, 30), 2],
    ["EOC Laptops", cellTime(9, 20), 0],
  ]);
  expect(rows(book.getWorksheet("Radio Cache 3"))).toEqual([
    ["Serial", "Scanned at"],
    ["SN-001", cellTime(9, 5)],
    ["SN-002", cellTime(9, 9)],
  ]);
  expect(rows(book.getWorksheet("EOC Laptops"))).toEqual([["Serial", "Scanned at"]]);
});

test("a blank Serial or Kit name is not saved", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create Kit" }).click();
  await expect(page.getByRole("alert")).toContainText("name");
  await expect(page.getByText("No Kits yet")).toBeVisible();

  await createKit(page, "Spare Batteries");
  await page.getByLabel("Serial").fill("   ");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toContainText("Serial");
  await expect(page.getByRole("listitem")).toHaveCount(0);
});

test("Export with no Kits says there is nothing to export", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Export" })).toBeDisabled();
});

test("fits a phone screen with no sideways scrolling", async ({ page }) => {
  await page.goto("/");
  await createKit(page, "A Kit With A Rather Long Name For A Small Phone Screen");
  await addSerial(page, "SERIAL-THAT-IS-QUITE-LONG-0123456789ABCDEFGHIJKLMNOP");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
