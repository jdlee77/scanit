// Keeping the record correct after the fact: edit and delete Items, duplicate warnings,
// rename a Kit, Notes in the Export, and deleting a Kit.
import { test, expect } from "@playwright/test";
import { createKit, exportWorkbook, serialBox, sheetRows } from "./helpers.js";

async function typeSerial(page, serial) {
  await page.getByRole("button", { name: "Type a Serial" }).click();
  await serialBox(page).fill(serial);
  await page.getByRole("button", { name: "Save", exact: true }).click();
}

async function addSerial(page, serial) {
  await typeSerial(page, serial);
  await expect(page.getByRole("link", { name: `Edit ${serial}` })).toBeVisible();
}

const serials = page => page.locator(".items .serial");
const backToKits = page => page.getByRole("link", { name: "All Kits" }).click();
const openKit = (page, name) => page.getByRole("link", { name: new RegExp(`^${name}`) }).click();

test("edit and delete Items; they stay in scan order", async ({ page }) => {
  await page.goto("/");
  await createKit(page, "Radios");
  for (const s of ["SN-1", "SN-2", "SN-3"]) await addSerial(page, s);

  await page.getByRole("link", { name: "Edit SN-2" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Edit Item" })).toBeVisible();
  await expect(serialBox(page)).toHaveValue("SN-2");
  await serialBox(page).fill("SN-2B");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(serials(page)).toHaveText(["SN-1", "SN-2B", "SN-3"]);

  // Cancel leaves the Item as it was.
  await page.getByRole("link", { name: "Edit SN-3" }).click();
  await serialBox(page).fill("NOPE");
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(serials(page)).toHaveText(["SN-1", "SN-2B", "SN-3"]);

  // Delete asks first, on the page; "Keep it" backs out.
  await page.getByRole("link", { name: "Edit SN-1" }).click();
  await page.getByRole("button", { name: "Delete Item" }).click();
  const ask = page.getByRole("alertdialog", { name: "Are you sure?" });
  await expect(ask).toContainText("This deletes SN-1 from Radios");
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(ask).toBeHidden();
  await page.getByRole("button", { name: "Delete Item" }).click();
  await page.getByRole("button", { name: "Yes, delete it" }).click();
  await expect(page.getByRole("status")).toContainText("Deleted SN-1 from Radios");
  await expect(serials(page)).toHaveText(["SN-2B", "SN-3"]);

  await page.reload();
  await expect(serials(page)).toHaveText(["SN-2B", "SN-3"]);
});

test("a Serial already in this Kit is refused, on adding and on editing", async ({ page }) => {
  await page.goto("/");
  await createKit(page, "Radios");
  await addSerial(page, "SN-1");
  await addSerial(page, "SN-2");

  await typeSerial(page, "SN-1");
  await expect(page.getByRole("alert")).toContainText("SN-1 is already in this Kit");
  await expect(serialBox(page)).toHaveValue("SN-1"); // still on the form, nothing lost
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(serials(page)).toHaveText(["SN-1", "SN-2"]);

  await page.getByRole("link", { name: "Edit SN-2" }).click();
  await serialBox(page).fill("SN-1");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText("SN-1 is already in this Kit");
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(serials(page)).toHaveText(["SN-1", "SN-2"]);
});

test("a Serial in another Kit warns, names that Kit, and saves only when confirmed", async ({ page }) => {
  await page.goto("/");
  await createKit(page, "Radios");
  await addSerial(page, "SN-1");
  await backToKits(page);
  await createKit(page, "Spares");
  await addSerial(page, "SN-5");

  // Adding: "Change the Serial" keeps the form open; "Save anyway" saves it.
  await typeSerial(page, "SN-1");
  const warning = page.getByRole("alert");
  await expect(warning).toContainText("SN-1 is already in Radios");
  await page.getByRole("button", { name: "Change the Serial" }).click();
  await expect(warning).toBeHidden();
  await expect(serialBox(page)).toBeFocused();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Save anyway" }).click();
  await expect(serials(page)).toHaveText(["SN-5", "SN-1"]);

  // Editing: the same warning, and nothing changes until confirmed.
  await backToKits(page);
  await openKit(page, "Radios");
  await addSerial(page, "SN-2");
  await page.getByRole("link", { name: "Edit SN-2" }).click();
  await serialBox(page).fill("SN-5");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText("SN-5 is already in Spares");
  await page.getByRole("button", { name: "Save anyway" }).click();
  await expect(serials(page)).toHaveText(["SN-1", "SN-5"]);

  // Once confirmed, editing that Item again doesn't ask again while its Serial stays the same.
  await page.getByRole("link", { name: "Edit SN-5" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Radios" })).toBeVisible();
});

test("rename a Kit and add Notes; the Export shows them", async ({ page }) => {
  await page.goto("/");
  await createKit(page, "Radios");
  await addSerial(page, "SN-1");

  await page.getByRole("link", { name: "Edit Kit" }).click();
  await page.getByLabel("Kit name").fill("Radio Cache 3");
  await page.getByLabel("Notes").fill("Shelf B2\nTwo batteries missing");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Radio Cache 3" })).toBeVisible();
  await expect(page.locator(".kit-notes")).toHaveText("Shelf B2\nTwo batteries missing");

  // A blank name is refused, and the Notes typed so far stay on the form.
  await page.getByRole("link", { name: "Edit Kit" }).click();
  await page.getByLabel("Kit name").fill(" ");
  await page.getByLabel("Notes").fill("Typed before the refusal");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText("name");
  await expect(page.getByLabel("Notes")).toHaveValue("Typed before the refusal");
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(page.locator(".kit-notes")).toHaveText("Shelf B2\nTwo batteries missing");
  await expect(page.getByRole("heading", { level: 1, name: "Radio Cache 3" })).toBeVisible();

  // Edit the Notes.
  await page.getByRole("link", { name: "Edit Kit" }).click();
  await expect(page.getByLabel("Notes")).toHaveValue("Shelf B2\nTwo batteries missing");
  await page.getByLabel("Notes").fill("Shelf B2\nOne battery missing");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".kit-notes")).toHaveText("Shelf B2\nOne battery missing");

  const book = await exportWorkbook(page);
  expect(book.worksheets.map(s => s.name)).toEqual(["Summary", "Radio Cache 3"]);
  const kitRows = sheetRows(book.getWorksheet("Radio Cache 3"));
  expect(kitRows.slice(0, 3)).toEqual([["Shelf B2", null], ["One battery missing", null], [null, null]]);
  expect(kitRows[3]).toEqual(["Serial", "Scanned at"]);
  expect(kitRows[4][0]).toBe("SN-1");
  const summary = sheetRows(book.getWorksheet("Summary"));
  expect(summary[0]).toEqual(["Kit name", "Created", "Item count", "Notes"]);
  expect(summary[1][3]).toBe("Shelf B2\nOne battery missing");
});

test("deleting a Kit asks on the page, naming the Kit and its Item count", async ({ page }) => {
  let browserDialog = false;
  page.on("dialog", dialog => { browserDialog = true; dialog.dismiss(); });
  await page.goto("/");
  await createKit(page, "Radios");
  await addSerial(page, "SN-1");
  await addSerial(page, "SN-2");
  await backToKits(page);
  await createKit(page, "Spares");
  await backToKits(page);
  await openKit(page, "Radios");

  await page.getByRole("link", { name: "Edit Kit" }).click();
  await page.getByRole("button", { name: "Delete Kit" }).click();
  const ask = page.getByRole("alertdialog", { name: "Are you sure?" });
  await expect(ask).toContainText("Radios and its 2 Items");
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(ask).toBeHidden();

  await page.getByRole("button", { name: "Delete Kit" }).click();
  await page.getByRole("button", { name: "Yes, delete Radios" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Kits" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Deleted the Kit Radios");
  await expect(page.locator(".kits .name")).toHaveText(["Spares"]);
  expect(browserDialog).toBe(false);

  await page.reload();
  await expect(page.locator(".kits .name")).toHaveText(["Spares"]);
});

test("when a change can't be saved, the Edit Item screen says so and nothing changes", async ({ page }) => {
  await page.goto("/");
  await createKit(page, "Radios");
  await addSerial(page, "SN-1");
  await addSerial(page, "SN-2");

  // From here on, the phone's storage refuses every save.
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function () { throw new DOMException("Storage is full", "QuotaExceededError"); };
  });
  await page.getByRole("link", { name: "Edit SN-1" }).click();
  await serialBox(page).fill("SN-1B");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText("could not be saved");
  await expect(serialBox(page)).toHaveValue("SN-1"); // back to what's stored

  await page.getByRole("button", { name: "Delete Item" }).click();
  await page.getByRole("button", { name: "Yes, delete it" }).click();
  await expect(page.getByRole("alert")).toContainText("could not be saved");
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(serials(page)).toHaveText(["SN-1", "SN-2"]);
});
