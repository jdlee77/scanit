// Fields, Pick lists and the Settings file, checked on screen and in the Export.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createKit, exportWorkbook, sheetRows } from "./helpers.js";

const fieldNames = page => page.locator(".field-head .name");
const field = (page, name) => page.getByRole("textbox", { name, exact: true });
const choices = (page, name) => page.getByRole("group", { name: `${name} choices` }).getByRole("button");

async function openSettings(page) {
  await page.goto("/#settings");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
}

async function addField(page, name) {
  await page.getByLabel("New Field").fill(name);
  await page.getByRole("button", { name: "Add Field" }).click();
  await expect(fieldNames(page).filter({ hasText: name })).toHaveCount(1);
}

async function newKit(page, name) {
  await page.goto("/#");
  await createKit(page, name);
}

/** Type a Serial in, fill some Fields, and save. */
async function typeItem(page, serial, values = {}, button = "Save") {
  if (await page.getByRole("button", { name: "Type a Serial" }).isVisible()) {
    await page.getByRole("button", { name: "Type a Serial" }).click();
  }
  await page.getByRole("textbox", { name: "Serial" }).fill(serial);
  for (const [name, value] of Object.entries(values)) await field(page, name).fill(value);
  await page.getByRole("button", { name: button, exact: true }).click();
  // Wait for the save to land: the next form has an empty Serial, or the Kit shows the Item.
  if (button.endsWith("next")) await expect(page.getByRole("textbox", { name: "Serial" })).toHaveValue("");
  else await expect(page.getByRole("listitem").filter({ hasText: serial })).toBeVisible();
}

test("set up Fields, record Items using Pick lists, and Export them as columns", async ({ page }) => {
  await openSettings(page);
  for (const name of ["Make", "Model", "Condition"]) await addField(page, name);
  await page.getByRole("button", { name: "Move Condition up" }).click();
  await expect(fieldNames(page)).toHaveText(["Make", "Condition", "Model"]);

  await newKit(page, "Radios");
  await page.getByRole("button", { name: "Type a Serial" }).click();
  // The Item form shows every Field, in Settings order, below the Serial; the first Item starts blank.
  await expect(page.locator(".field-input label")).toHaveText(["Make", "Condition", "Model"]);
  for (const name of ["Make", "Condition", "Model"]) await expect(field(page, name)).toHaveValue("");
  await typeItem(page, "SN-1", { Make: "Motorola", Condition: "Good", Model: "APX 6000" }, "Save & type next");

  // The next Item starts with the previous Item's values.
  await expect(field(page, "Make")).toHaveValue("Motorola");
  await expect(field(page, "Model")).toHaveValue("APX 6000");
  await typeItem(page, "SN-2", { Condition: "Fair" }, "Save & type next");

  // Pick lists show alphabetically and narrow as you type.
  await field(page, "Condition").fill("");
  await expect(choices(page, "Condition")).toHaveText(["Fair", "Good"]);
  await field(page, "Condition").fill("g");
  await expect(choices(page, "Condition")).toHaveText(["Good"]);
  await choices(page, "Condition").getByText("Good").click();
  await expect(field(page, "Condition")).toHaveValue("Good");
  await typeItem(page, "SN-3");
  await expect(page.getByRole("listitem")).toHaveCount(3);

  // A new Kit's first Item starts blank, and only the Serial is needed.
  await newKit(page, "Laptops");
  await page.getByRole("button", { name: "Type a Serial" }).click();
  await expect(field(page, "Make")).toHaveValue("");
  await expect(choices(page, "Make")).toHaveText(["Motorola"]);
  await typeItem(page, "LT-1");
  await expect(page.getByRole("listitem")).toHaveCount(1);

  const book = await exportWorkbook(page);
  const radios = sheetRows(book.getWorksheet("Radios"));
  expect(radios.map(r => r.slice(0, 4))).toEqual([
    ["Serial", "Make", "Condition", "Model"],
    ["SN-1", "Motorola", "Good", "APX 6000"],
    ["SN-2", "Motorola", "Fair", "APX 6000"],
    ["SN-3", "Motorola", "Good", "APX 6000"],
  ]);
  expect(radios[0][4]).toBe("Scanned at");
  expect(radios[1][4]).toBeInstanceOf(Date);
  expect(sheetRows(book.getWorksheet("Laptops")).map(r => r.slice(0, 4))).toEqual([
    ["Serial", "Make", "Condition", "Model"],
    ["LT-1", null, null, null],
  ]);
});

test("rename and remove Fields and Pick list values in Settings", async ({ page }) => {
  await openSettings(page);
  await addField(page, "Make");
  await addField(page, "Model");
  await newKit(page, "Radios");
  await typeItem(page, "SN-1", { Make: "Motorlla", Model: "APX 6000" });

  // Fix the typo in the Pick list: saved Items keep what they had.
  await openSettings(page);
  await page.getByText("Make Pick list (1 value)").click();
  page.once("dialog", dialog => dialog.accept("Motorola"));
  await page.getByRole("button", { name: "Rename Motorlla in Make" }).click();
  await expect(page.locator(".field-row", { hasText: "Make" }).locator(".pick")).toHaveText(["Motorola"]);

  page.once("dialog", dialog => dialog.accept("Manufacturer"));
  await page.getByRole("button", { name: "Rename Make", exact: true }).click();
  await expect(fieldNames(page)).toHaveText(["Manufacturer", "Model"]);

  let book = await exportWorkbook(page);
  expect(sheetRows(book.getWorksheet("Radios")).map(r => r.slice(0, 3))).toEqual([
    ["Serial", "Manufacturer", "Model"],
    ["SN-1", "Motorlla", "APX 6000"],
  ]);

  // Removing a Pick list value.
  await openSettings(page);
  await page.getByText("Manufacturer Pick list (1 value)").click();
  await page.getByRole("button", { name: "Remove Motorola from Manufacturer" }).click();
  await expect(page.getByText("Manufacturer Pick list (0 values)")).toBeVisible();

  // Removing a Field asks first and says what will happen.
  let question = "";
  page.once("dialog", dialog => { question = dialog.message(); dialog.dismiss(); });
  await page.getByRole("button", { name: "Remove Model", exact: true }).click();
  expect(question).toContain("will no longer appear in Items or Exports");
  await expect(fieldNames(page)).toHaveText(["Manufacturer", "Model"]);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Remove Model", exact: true }).click();
  await expect(fieldNames(page)).toHaveText(["Manufacturer"]);

  book = await exportWorkbook(page);
  expect(sheetRows(book.getWorksheet("Radios"))).toEqual([
    ["Serial", "Manufacturer", "Scanned at"],
    ["SN-1", "Motorlla", expect.any(Date)],
  ]);
});

test("a blank or repeated Field name is refused", async ({ page }) => {
  await openSettings(page);
  await addField(page, "Make");
  await page.getByLabel("New Field").fill("make");
  await page.getByRole("button", { name: "Add Field" }).click();
  await expect(page.getByRole("alert")).toContainText("already a Field called make");
  await expect(fieldNames(page)).toHaveText(["Make"]);
});

test("save a Settings file and load it on another phone", async ({ page, browser }) => {
  await openSettings(page);
  await addField(page, "Make");
  await addField(page, "Model");
  await newKit(page, "Radio Cache 3");
  await typeItem(page, "SN-1", { Make: "Motorola" });

  await openSettings(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save Settings file" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^scanit-settings-\d{4}-\d\d-\d\d\.json$/);
  const file = await download.path();
  const text = readFileSync(file, "utf8");
  expect(JSON.parse(text).fields).toEqual([{ name: "Make", picks: ["Motorola"] }, { name: "Model", picks: [] }]);
  expect(text).not.toContain("Radio Cache 3");

  // The other phone: a fresh browser profile with a Field of its own.
  const otherPhone = await browser.newContext({ ...test.info().project.use });
  const other = await otherPhone.newPage();
  await openSettings(other);
  await addField(other, "Condition");
  await other.getByLabel("Load Settings file").setInputFiles(file);
  await expect(other.getByRole("status")).toContainText("added 2 Fields and 1 Pick list value");
  await expect(fieldNames(other)).toHaveText(["Condition", "Make", "Model"]);

  // Loading again adds nothing new, and never brings Kits over.
  await other.getByLabel("Load Settings file").setInputFiles(file);
  await expect(other.getByRole("status")).toContainText("added 0 Fields and 0 Pick list values");
  await other.goto("/#");
  await expect(other.getByText("No Kits yet")).toBeVisible();

  await createKit(other, "Spares");
  await other.getByRole("button", { name: "Type a Serial" }).click();
  await expect(choices(other, "Make")).toHaveText(["Motorola"]);

  // Something that isn't a Settings file is turned away.
  await openSettings(other);
  await other.getByLabel("Load Settings file").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  await expect(other.getByRole("alert")).toContainText("isn't a scanit Settings file");
  await otherPhone.close();
});
