// The Export builder: what goes in the workbook, and that the bytes are a real .xlsx.
// Run with TZ=UTC set by the test (see top) so local-time dates are predictable.
process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { KitRecord } from "../../src/kit-record.js";
import { buildExport, encodeXlsx, exportFileName } from "../../src/export-builder.js";

function sampleRecord() {
  const record = new KitRecord();
  const { kit: radios } = record.createKit("Radio Cache 3", "2026-11-20T16:00:00.000Z");
  record.addItem(radios.id, "SN-001", "2026-11-26T17:05:00.000Z");
  record.addItem(radios.id, "SN-002", "2026-11-26T17:09:30.000Z");
  record.createKit("EOC Laptops", "2026-11-21T09:15:00.000Z");
  return record;
}

test("an Export has a Summary sheet first, then one sheet per Kit", () => {
  const sheets = buildExport(sampleRecord()).sheets;
  assert.deepEqual(sheets.map(s => s.name), ["Summary", "Radio Cache 3", "EOC Laptops"]);
});

test("the Summary lists each Kit with its created date, Item count and Notes", () => {
  const [summary] = buildExport(sampleRecord()).sheets;
  assert.deepEqual(summary.rows, [
    ["Kit name", "Created", "Item count", "Notes"],
    ["Radio Cache 3", new Date("2026-11-20T16:00:00.000Z"), 2, ""],
    ["EOC Laptops", new Date("2026-11-21T09:15:00.000Z"), 0, ""],
  ]);
});

test("Kit Notes go at the top of the Kit sheet, one row per line, then a blank row, then the table", () => {
  const record = sampleRecord();
  const radios = record.kits()[0];
  record.setKitNotes(radios.id, "Shelf B2\nTwo batteries missing");
  const [summary, sheet, laptops] = buildExport(record).sheets;
  assert.deepEqual(sheet.rows, [
    ["Shelf B2"],
    ["Two batteries missing"],
    [],
    ["Serial", "Scanned at"],
    ["SN-001", new Date("2026-11-26T17:05:00.000Z")],
    ["SN-002", new Date("2026-11-26T17:09:30.000Z")],
  ]);
  assert.equal(sheet.headerRow, 3);
  assert.equal(summary.rows[1][3], "Shelf B2\nTwo batteries missing");
  assert.equal(laptops.headerRow, 0, "a Kit without Notes starts with the table");
});

test("blank lines inside Notes are left out, so the only blank row is the one before the table", () => {
  const record = sampleRecord();
  record.setKitNotes(record.kits()[0].id, "Shelf B2  \n\n   \nTwo batteries missing");
  const sheet = buildExport(record).sheets[1];
  assert.deepEqual(sheet.rows.slice(0, 4), [["Shelf B2"], ["Two batteries missing"], [], ["Serial", "Scanned at"]]);
});

test("text with line breaks is set to wrap; other cells are not", async () => {
  const record = sampleRecord();
  const radios = record.kits()[0];
  record.setKitNotes(radios.id, "Shelf B2\nTwo batteries missing");
  record.addItem(radios.id, "Make: Motorola\nSerial: 475CTV1293", "2026-11-26T17:20:00.000Z");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(encodeXlsx(buildExport(record)));
  const summary = book.getWorksheet("Summary");
  assert.equal(summary.getCell("D2").value, "Shelf B2\nTwo batteries missing");
  assert.equal(summary.getCell("D2").alignment?.wrapText, true);
  assert.equal(summary.getCell("A2").alignment?.wrapText, undefined);
  const sheet = book.getWorksheet("Radio Cache 3");
  assert.equal(sheet.getCell("A7").value, "Make: Motorola\nSerial: 475CTV1293");
  assert.equal(sheet.getCell("A7").alignment?.wrapText, true);
  assert.equal(sheet.getCell("A5").alignment?.wrapText, undefined);
});

test("in the workbook, the table header under the Notes is the bold row", async () => {
  const record = sampleRecord();
  record.setKitNotes(record.kits()[0].id, "Shelf B2");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(encodeXlsx(buildExport(record)));
  const radios = book.getWorksheet("Radio Cache 3");
  assert.equal(radios.getCell("A1").value, "Shelf B2");
  assert.equal(radios.getCell("A1").font?.bold, undefined);
  assert.equal(radios.getRow(2).cellCount, 0);
  assert.equal(radios.getCell("A3").value, "Serial");
  assert.equal(radios.getCell("A3").font?.bold, true);
  assert.equal(book.getWorksheet("Summary").getCell("D2").value, "Shelf B2");
});

test("a Kit sheet has a Serial / Scanned at header and one row per Item in scan order", () => {
  const sheets = buildExport(sampleRecord()).sheets;
  assert.deepEqual(sheets[1].rows, [
    ["Serial", "Scanned at"],
    ["SN-001", new Date("2026-11-26T17:05:00.000Z")],
    ["SN-002", new Date("2026-11-26T17:09:30.000Z")],
  ]);
  assert.deepEqual(sheets[2].rows, [["Serial", "Scanned at"]]);
});

test("the file is named with the local date", () => {
  assert.equal(exportFileName(new Date(2026, 10, 26, 23, 59)), "scanit-2026-11-26.xlsx");
  assert.equal(exportFileName(new Date(2027, 0, 3, 0, 1)), "scanit-2027-01-03.xlsx");
});

// The sheet names an Export gets for Kits with these names.
function sheetNamesFor(kitNames) {
  const record = new KitRecord();
  for (const name of kitNames) record.createKit(name, "2026-11-20T16:00:00.000Z");
  return buildExport(record).sheets.map(s => s.name);
}

test("sheet names lose the characters Excel forbids", () => {
  assert.deepEqual(sheetNamesFor(["Cage: A/B [old]?*\\"]), ["Summary", "Cage AB old"]);
});

test("sheet names are cut to Excel's 31-character limit", () => {
  assert.deepEqual(sheetNamesFor(["A".repeat(40)]), ["Summary", "A".repeat(31)]);
});

test("duplicate sheet names, including a Kit named Summary or History, get a numbered suffix", () => {
  assert.deepEqual(
    sheetNamesFor(["Radios", "radios", "Summary", "history", "B".repeat(35), "B".repeat(31)]),
    ["Summary", "Radios", "radios (2)", "Summary (2)", "history (2)", "B".repeat(31), "B".repeat(27) + " (2)"],
  );
});

test("a name that cleans to nothing still gets a usable sheet name", () => {
  assert.deepEqual(sheetNamesFor(["[]", "'Quoted'"]), ["Summary", "Kit", "Quoted"]);
});

test("the encoded bytes open as a workbook with the same sheets and cells", async () => {
  const bytes = encodeXlsx(buildExport(sampleRecord()));
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  assert.deepEqual(book.worksheets.map(s => s.name), ["Summary", "Radio Cache 3", "EOC Laptops"]);

  const summary = book.getWorksheet("Summary");
  assert.deepEqual(summary.getRow(1).values.slice(1), ["Kit name", "Created", "Item count", "Notes"]);
  assert.equal(summary.getCell("A2").value, "Radio Cache 3");
  assert.deepEqual(summary.getCell("B2").value, new Date("2026-11-20T16:00:00.000Z"));
  assert.equal(summary.getCell("C2").value, 2);
  assert.equal(summary.getCell("C3").value, 0);

  const radios = book.getWorksheet("Radio Cache 3");
  assert.deepEqual(radios.getRow(1).values.slice(1), ["Serial", "Scanned at"]);
  assert.equal(radios.getCell("A2").value, "SN-001");
  assert.deepEqual(radios.getCell("B3").value, new Date("2026-11-26T17:09:30.000Z"));
  assert.match(radios.getCell("B2").numFmt, /yyyy-mm-dd hh:mm/);
  assert.equal(radios.rowCount, 3);
});

test("text that looks like XML or a number is kept exactly as typed", async () => {
  const record = new KitRecord();
  const { kit } = record.createKit("Tom & Jerry <kit>", "2026-11-20T16:00:00.000Z");
  record.addItem(kit.id, "0012345678905", "2026-11-26T17:05:00.000Z");
  record.addItem(kit.id, 'S/N "A" & <B>', "2026-11-26T17:06:00.000Z");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(encodeXlsx(buildExport(record)));
  const sheet = book.getWorksheet("Tom & Jerry <kit>");
  assert.equal(sheet.getCell("A2").value, "0012345678905");
  assert.equal(sheet.getCell("A3").value, 'S/N "A" & <B>');
});

test("the code format an Item was read from isn't exported", () => {
  const record = new KitRecord();
  const { kit } = record.createKit("K", "2026-11-20T16:00:00.000Z");
  record.addItem(kit.id, "K9P2207731", "2026-11-26T17:05:00.000Z", { format: "code_128" });
  assert.deepEqual(buildExport(record).sheets[1].rows, [
    ["Serial", "Scanned at"],
    ["K9P2207731", new Date("2026-11-26T17:05:00.000Z")],
  ]);
});

test("a Kit sheet shows each Field in Settings order, between Serial and Scanned at", () => {
  const record = new KitRecord();
  const make = record.addField("Make").field.id;
  const model = record.addField("Model").field.id;
  const condition = record.addField("Condition").field.id;
  record.moveField(condition, 0);
  const { kit } = record.createKit("Radios", "2026-11-20T16:00:00.000Z");
  record.addItem(kit.id, "SN-1", "2026-11-26T17:05:00.000Z", { values: { [make]: "Motorola", [model]: "APX 6000" } });
  record.addItem(kit.id, "SN-2", "2026-11-26T17:06:00.000Z", { values: { [condition]: "Good" } });
  assert.deepEqual(buildExport(record).sheets[1].rows, [
    ["Serial", "Condition", "Make", "Model", "Scanned at"],
    ["SN-1", "", "Motorola", "APX 6000", new Date("2026-11-26T17:05:00.000Z")],
    ["SN-2", "Good", "", "", new Date("2026-11-26T17:06:00.000Z")],
  ]);
});

test("blank Field values are empty cells in the workbook", async () => {
  const record = new KitRecord();
  const make = record.addField("Make").field.id;
  record.addField("Model");
  const { kit } = record.createKit("Radios", "2026-11-20T16:00:00.000Z");
  record.addItem(kit.id, "SN-1", "2026-11-26T17:05:00.000Z", { values: { [make]: "Motorola" } });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(encodeXlsx(buildExport(record)));
  const sheet = book.getWorksheet("Radios");
  assert.deepEqual(sheet.getRow(1).values.slice(1), ["Serial", "Make", "Model", "Scanned at"]);
  assert.equal(sheet.getCell("B2").value, "Motorola");
  assert.equal(sheet.getCell("C2").value, null);
  assert.deepEqual(sheet.getCell("D2").value, new Date("2026-11-26T17:05:00.000Z"));
});
