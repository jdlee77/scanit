// Export builder: turns the Kit record into workbook content (sheets of rows),
// then encodes that content as .xlsx bytes. Runs offline in the browser and in Node.
// The only library is fflate (vendored), which zips the parts; the workbook XML is written here.
import { zipSync, strToU8 } from "../vendor/fflate-0.8.3.js";
import { dateStamp } from "./files.js";

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SUMMARY = "Summary";
const MAX_SHEET_NAME = 31;
// Excel won't open a sheet name containing these, or one that starts or ends with an apostrophe.
const FORBIDDEN = /[:\\/?*[\]]/g;
// Names no Kit sheet may take (compared without regard to case):
// our own Summary sheet, and "History", which Excel reserves.
const TAKEN_NAMES = [SUMMARY, "History"];

/** Workbook content for the Export: { sheets: [{ name, rows }] }. Cells are text, numbers or Dates. */
export function buildExport(record) {
  const kits = record.kits();
  const names = sheetNames(kits.map(k => k.name));
  const summary = {
    name: names[0],
    rows: [["Kit name", "Created", "Item count"], ...kits.map(k => [k.name, new Date(k.createdAt), k.items.length])],
  };
  const fields = record.fields();
  const kitSheets = kits.map((kit, i) => ({
    name: names[i + 1],
    rows: [
      ["Serial", ...fields.map(f => f.name), "Scanned at"],
      ...kit.items.map(item => [item.serial, ...fields.map(f => item.values?.[f.id] ?? ""), new Date(item.scannedAt)]),
    ],
  }));
  return { sheets: [summary, ...kitSheets] };
}

// "Summary" followed by a sheet name for each Kit name, cleaned to fit Excel's rules and made unique.
function sheetNames(kitNames) {
  const taken = new Set(TAKEN_NAMES.map(n => n.toLowerCase()));
  const names = [SUMMARY];
  for (const kitName of kitNames) {
    const base = cleanSheetName(kitName);
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      name = base.slice(0, MAX_SHEET_NAME - suffix.length).trimEnd() + suffix;
    }
    taken.add(name.toLowerCase());
    names.push(name);
  }
  return names;
}

function cleanSheetName(name) {
  const clean = String(name).replace(FORBIDDEN, "").replace(/\s+/g, " ").trim()
    .replace(/^'+|'+$/g, "").trim().slice(0, MAX_SHEET_NAME).trim();
  return clean || "Kit";
}

/** File name for an Export made on the given (local) date, e.g. scanit-2026-11-26.xlsx. */
export const exportFileName = date => `scanit-${dateStamp(date)}.xlsx`;

// ---- .xlsx encoding -------------------------------------------------------

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const STYLE = { header: 1, dateTime: 2 }; // indexes into cellXfs in styles(); 0 is plain

/** Encode workbook content as the bytes of an .xlsx file. */
export function encodeXlsx({ sheets }) {
  const strings = new SharedStrings();
  const files = {
    "[Content_Types].xml": contentTypes(sheets.length),
    "_rels/.rels": rootRels(),
    "docProps/core.xml": coreProps(),
    "docProps/app.xml": appProps(),
    "xl/workbook.xml": workbook(sheets),
    "xl/_rels/workbook.xml.rels": workbookRels(sheets.length),
    "xl/styles.xml": styles(),
  };
  sheets.forEach((sheet, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = worksheet(sheet, strings); });
  files["xl/sharedStrings.xml"] = strings.xml();
  const zipped = {};
  for (const [path, xml] of Object.entries(files)) zipped[path] = strToU8(XML_HEAD + xml);
  return zipSync(zipped, { level: 6 });
}

function worksheet({ rows }, strings) {
  const widths = [];
  const rowXml = rows.map((row, r) => {
    const cells = row.map((value, c) => {
      widths[c] = Math.max(widths[c] ?? 8, displayLength(value));
      // A blank stays a truly empty cell, so Excel's filters see it as blank.
      return value === "" || value == null ? "" : cell(`${columnLetter(c)}${r + 1}`, value, r === 0, strings);
    }).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");
  const cols = widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${Math.min(w + 2, 60)}" customWidth="1"/>`).join("");
  return `<worksheet xmlns="${NS_MAIN}">${cols ? `<cols>${cols}</cols>` : ""}<sheetData>${rowXml}</sheetData></worksheet>`;
}

function cell(ref, value, isHeader, strings) {
  if (value instanceof Date) return `<c r="${ref}" s="${STYLE.dateTime}"><v>${excelSerial(value)}</v></c>`;
  if (typeof value === "number") return `<c r="${ref}"${isHeader ? ` s="${STYLE.header}"` : ""}><v>${value}</v></c>`;
  return `<c r="${ref}" t="s"${isHeader ? ` s="${STYLE.header}"` : ""}><v>${strings.index(String(value ?? ""))}</v></c>`;
}

function displayLength(value) {
  if (value instanceof Date) return 16;
  return String(value ?? "").length;
}

// Excel stores a date as days since 30 Dec 1899, with no time zone: use the phone's local time.
function excelSerial(date) {
  const localMs = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(),
    date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
  return localMs / 86400000 + 25569;
}

function columnLetter(index) {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

class SharedStrings {
  #list = [];
  #index = new Map();
  index(text) {
    if (!this.#index.has(text)) { this.#index.set(text, this.#list.length); this.#list.push(text); }
    return this.#index.get(text);
  }
  xml() {
    const items = this.#list.map(t => `<si><t xml:space="preserve">${escapeText(t)}</t></si>`).join("");
    return `<sst xmlns="${NS_MAIN}" count="${this.#list.length}" uniqueCount="${this.#list.length}">${items}</sst>`;
  }
}

// XML-escape text. Control characters (such as the separator inside some Data Matrix codes)
// aren't allowed in XML, so they use Excel's _xHHHH_ form; a literal "_x" is protected the same way.
function escapeText(text) {
  return text
    .replace(/_(?=x[0-9A-Fa-f]{4}_)/g, "_x005F_")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g, ch => `_x${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}_`)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const escapeAttr = text => escapeText(text).replace(/"/g, "&quot;");

function workbook(sheets) {
  const list = sheets.map((s, i) => `<sheet name="${escapeAttr(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
  return `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><bookViews><workbookView activeTab="0"/></bookViews>`
    + `<sheets>${list}</sheets></workbook>`;
}

function workbookRels(sheetCount) {
  const rel = (id, type, target) => `<Relationship Id="${id}" Type="${NS_REL}/${type}" Target="${target}"/>`;
  const sheetRels = Array.from({ length: sheetCount }, (_, i) => rel(`rId${i + 1}`, "worksheet", `worksheets/sheet${i + 1}.xml`));
  return `<Relationships xmlns="${NS_PKG_REL}">${sheetRels.join("")}`
    + rel(`rId${sheetCount + 1}`, "styles", "styles.xml")
    + rel(`rId${sheetCount + 2}`, "sharedStrings", "sharedStrings.xml")
    + "</Relationships>";
}

function rootRels() {
  return `<Relationships xmlns="${NS_PKG_REL}">`
    + `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>`
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    + `<Relationship Id="rId3" Type="${NS_REL}/extended-properties" Target="docProps/app.xml"/>`
    + "</Relationships>";
}

// Document properties: optional in the format, but some spreadsheet apps expect them.
function coreProps() {
  return '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
    + 'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>scanit</dc:creator></cp:coreProperties>';
}

function appProps() {
  return '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
    + "<Application>scanit</Application></Properties>";
}

function contentTypes(sheetCount) {
  const ct = "application/vnd.openxmlformats-officedocument.spreadsheetml";
  const sheetsXml = Array.from({ length: sheetCount }, (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${ct}.worksheet+xml"/>`).join("");
  return '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + `<Override PartName="/xl/workbook.xml" ContentType="${ct}.sheet.main+xml"/>`
    + `<Override PartName="/xl/styles.xml" ContentType="${ct}.styles+xml"/>`
    + `<Override PartName="/xl/sharedStrings.xml" ContentType="${ct}.sharedStrings+xml"/>`
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
    + sheetsXml + "</Types>";
}

// Cell styles, in STYLE order: normal, bold header, date and time.
function styles() {
  return `<styleSheet xmlns="${NS_MAIN}">`
    + '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts>'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="3">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    + "</cellXfs>"
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + "</styleSheet>";
}
