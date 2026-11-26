// App shell: draws the screens and passes every tap to the Kit record,
// then saves the record with the Store after every change.
import { KitRecord, REFUSED } from "./kit-record.js";
import { openStore } from "./store.js";
import { buildExport, encodeXlsx, exportFileName, XLSX_TYPE } from "./export-builder.js";
import { createScanner } from "./scanner.js";
import { formatName, isProductCode } from "./scan-reading.js";

const main = document.querySelector("main");

let store;
let record;
let scanner;
// While scanning inside a Kit: { kitId, read } where read is the code waiting in the Item form, if any.
let scanning = null;

start();

async function start() {
  try {
    store = await openStore();
    record = KitRecord.fromJSON(await store.load());
  } catch (error) {
    main.replaceChildren(el("p", { role: "alert", class: "error" },
      "scanit can't use this browser's storage, so nothing could be loaded or saved. "
      + "Try opening it in Safari or Chrome, outside a private window."));
    console.error(error);
    return;
  }
  scanner = createScanner({ onRead: read => { scanning.read = read; render(); } });
  addEventListener("hashchange", () => { stopScanning(); render(); });
  // Don't leave the camera running when the phone switches to another app.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && scanning) { scanner.stop(); if (!scanning.read) stopScanning(); render(); }
  });
  render();
}

// ---- Screens ---------------------------------------------------------------

function render(message) {
  const kitId = location.hash.match(/^#kit\/(.+)$/)?.[1];
  const kit = kitId && record.kit(decodeURIComponent(kitId));
  const screen = !kit ? kitListScreen(message)
    : scanning?.kitId !== kit.id ? kitScreen(kit, message)
    : scanning.read ? itemFormScreen(kit, scanning.read, message)
    : scanScreen(kit);
  main.replaceChildren(...screen);
  main.querySelector("[autofocus]")?.focus();
}

function kitListScreen(message) {
  const kits = record.kits();
  const nameInput = el("input", { id: "kit-name", name: "name", autocomplete: "off", enterkeyhint: "done" });
  const form = el("form", { class: "add" },
    el("label", { for: "kit-name" }, "Kit name"),
    el("div", { class: "row" }, nameInput, el("button", { type: "submit" }, "Create Kit")));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const result = record.createKit(nameInput.value, new Date().toISOString());
    if (result.outcome === REFUSED) return render(result.reason);
    if (await save()) location.hash = kitLink(result.kit);
  });

  const list = kits.length
    ? el("ul", { class: "kits" }, ...kits.map(kit => el("li", {},
      el("a", { href: kitLink(kit) },
        el("span", { class: "name" }, kit.name),
        el("span", { class: "count" }, plural(kit.items.length, "Item"))))))
    : el("p", { class: "empty" }, "No Kits yet. Create one to start recording Items.");

  const exportButton = el("button", { type: "button", class: "export" }, "Export");
  exportButton.disabled = kits.length === 0;
  exportButton.addEventListener("click", exportAll);

  return [el("h1", {}, "Kits"), alertLine(message), form, list, exportButton];
}

function kitScreen(kit, message) {
  const scanButton = el("button", { type: "button", class: "scan" }, "Scan");
  scanButton.addEventListener("click", () => {
    scanning = { kitId: kit.id, read: null };
    render();
    scanner.scan();
  });

  const serialInput = el("input", {
    id: "serial", name: "serial", autocomplete: "off", autocapitalize: "characters",
    spellcheck: "false", enterkeyhint: "done",
  });
  const form = el("form", { class: "add" },
    el("label", { for: "serial" }, "Serial"),
    el("div", { class: "row" }, serialInput, el("button", { type: "submit" }, "Save")));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const result = record.addItem(kit.id, serialInput.value, new Date().toISOString());
    if (result.outcome === REFUSED) return render(result.reason);
    if (await save()) { render(); main.querySelector("#serial").focus(); }
  });

  const items = kit.items.length
    ? el("ol", { class: "items" }, ...kit.items.map(item => el("li", {},
      el("span", { class: "serial" }, item.serial),
      el("span", { class: "when" }, item.format ? formatName(item.format) : "Typed in", " · ",
        el("time", { datetime: item.scannedAt }, formatDateTime(item.scannedAt))))))
    : el("p", { class: "empty" }, "No Items yet. Scan one, or type a Serial in and Save.");

  return [
    el("a", { href: "#", class: "back" }, "All Kits"),
    el("h1", {}, kit.name),
    el("p", { class: "meta" }, `Created ${formatDate(kit.createdAt)} · ${plural(kit.items.length, "Item")}`),
    alertLine(message),
    scanButton,
    form,
    items,
  ];
}

function scanScreen(kit) {
  const back = el("button", { type: "button", class: "secondary" }, "Back to Kit");
  back.addEventListener("click", () => { stopScanning(); render(); });
  return [
    el("p", { class: "meta" }, `Kit: ${kit.name}`),
    el("h1", {}, "Scan Items"),
    scanner.element,
    back,
  ];
}

function itemFormScreen(kit, read, message) {
  const serialBox = el("textarea", {
    id: "item-serial", rows: String(Math.min(8, read.raw.split("\n").length + 1)),
    autocomplete: "off", autocapitalize: "characters", spellcheck: "false",
  });
  serialBox.value = read.raw;
  const product = isProductCode(read.format) && el("p", { class: "note" },
    `This ${formatName(read.format)} is probably a product code, not a serial number: every unit of a product `
    + "has the same one. If the label also has a serial number, scan or type that instead.");

  const saveAndNext = el("button", { type: "submit" }, "Save & scan next");
  const saveOnly = el("button", { type: "button", class: "secondary" }, "Save");
  const backToCamera = el("button", { type: "button", class: "secondary" }, "Back to camera");
  const form = el("form", { class: "item-form" },
    el("label", { for: "item-serial" }, "Serial"), serialBox,
    el("div", { class: "buttons" }, saveAndNext, saveOnly, backToCamera));

  async function saveItem(thenScan) {
    const result = record.addItem(kit.id, serialBox.value, new Date().toISOString(), { format: read.format });
    if (result.outcome === REFUSED) return render(result.reason);
    if (!(await save())) return;
    if (thenScan) return resumeScanning();
    stopScanning();
    render();
  }
  form.addEventListener("submit", event => { event.preventDefault(); saveItem(true); });
  saveOnly.addEventListener("click", () => saveItem(false));
  backToCamera.addEventListener("click", resumeScanning);

  return [
    el("p", { class: "meta" }, `Kit: ${kit.name}`),
    el("h1", {}, "New Item"),
    el("p", { class: "meta" }, `Read from ${withArticle(formatName(read.format))}`),
    alertLine(message),
    product || "",
    form,
  ];
}

// ---- Actions ---------------------------------------------------------------

function resumeScanning() {
  scanning.read = null;
  render();
  scanner.scan();
}

function stopScanning() {
  scanning = null;
  scanner?.stop();
}

async function save() {
  try {
    await store.save(record.toJSON());
    return true;
  } catch (error) {
    console.error(error);
    render("That change could not be saved on this phone. Try again; if it keeps failing, Export now.");
    return false;
  }
}

function exportAll() {
  const bytes = encodeXlsx(buildExport(record));
  const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_TYPE }));
  const link = el("a", { href: url, download: exportFileName(new Date()) });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ---- Helpers ---------------------------------------------------------------

function alertLine(message) {
  return el("p", { role: "alert", class: message ? "error" : "error hidden" }, message ?? "");
}

// "a Code 128", "an EAN-13" (UPC is said "you-pee-see", so it takes "a").
const withArticle = name => `${/^[AEIO]/i.test(name) ? "an" : "a"} ${name}`;
const kitLink = kit => `#kit/${encodeURIComponent(kit.id)}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const DATE = { year: "numeric", month: "short", day: "numeric" };
const formatDate = iso => new Date(iso).toLocaleDateString(undefined, DATE);
const formatDateTime = iso => new Date(iso).toLocaleString(undefined, { ...DATE, hour: "numeric", minute: "2-digit" });

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}
