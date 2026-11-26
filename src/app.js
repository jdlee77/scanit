// App shell: draws the screens and passes every tap to the Kit record,
// then saves the record with the Store after every change.
import { KitRecord, REFUSED } from "./kit-record.js";
import { openStore } from "./store.js";
import { buildExport, encodeXlsx, exportFileName, XLSX_TYPE } from "./export-builder.js";
import { createScanner } from "./scanner.js";
import { formatName, isProductCode } from "./scan-reading.js";
import { settingsScreen } from "./settings-screen.js";
import { downloadFile } from "./files.js";
import { el, messageLine, plural } from "./dom.js";

const main = document.querySelector("main");

let store;
let record;
let scanner;
// While adding Items to a Kit: { kitId, by: "scan" | "typing", pending, values }.
// pending: the Serial waiting in the Item form ({ raw, format, at } for a read; { raw: "" } when
// typing), or null while the camera is looking. values: Field values typed on a form that was
// refused (e.g. no Serial), so they're still there when it's shown again.
let adding = null;

// How the Item form differs when scanning and when typing.
const ADDING_BY = {
  scan: { saveAndNext: "Save & scan next", leave: "Back to camera", focusSerial: false,
    next: () => resumeScanning(), onLeave: () => resumeScanning() },
  typing: { saveAndNext: "Save & type next", leave: "Cancel", focusSerial: true,
    next: kitId => startTyping(kitId), onLeave: () => { stopAdding(); render(); } },
};

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
  scanner = createScanner({ onRead: read => { adding.pending = read; render(); } });
  addEventListener("hashchange", () => { stopAdding(); render(); });
  // Don't leave the camera running when the phone switches to another app.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden || adding?.by !== "scan") return;
    scanner.stop();
    if (!adding.pending) stopAdding();
    render();
  });
  render();
}

// ---- Screens ---------------------------------------------------------------

/** Draw the screen for the current address. message: an error to show, or { notice }. */
function render(message) {
  const kitId = location.hash.match(/^#kit\/(.+)$/)?.[1];
  const kit = kitId && record.kit(decodeURIComponent(kitId));
  const screen = location.hash === "#settings" ? settingsScreen({ record, save, render, message })
    : !kit ? kitListScreen(message)
    : adding?.kitId !== kit.id ? kitScreen(kit, message)
    : adding.pending ? itemFormScreen(kit, adding.pending, message)
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
  exportButton.addEventListener("click", () =>
    downloadFile(encodeXlsx(buildExport(record)), exportFileName(new Date()), XLSX_TYPE));

  return [
    el("nav", { class: "top" }, el("a", { href: "#settings" }, "Settings")),
    el("h1", {}, "Kits"), messageLine(message), form, list, exportButton,
  ];
}

function kitScreen(kit, message) {
  const scanButton = el("button", { type: "button", class: "scan" }, "Scan");
  scanButton.addEventListener("click", () => {
    adding = { kitId: kit.id, by: "scan", pending: null };
    render();
    scanner.scan();
  });
  const typeButton = el("button", { type: "button", class: "secondary wide" }, "Type a Serial");
  typeButton.addEventListener("click", () => startTyping(kit.id));

  const items = kit.items.length
    ? el("ol", { class: "items" }, ...kit.items.map(item => el("li", {},
      el("span", { class: "serial" }, item.serial),
      el("span", { class: "when" }, item.format ? formatName(item.format) : "Typed in", " · ",
        el("time", { datetime: item.scannedAt }, formatDateTime(item.scannedAt))))))
    : el("p", { class: "empty" }, "No Items yet. Scan one, or type a Serial in.");

  return [
    el("a", { href: "#", class: "back" }, "All Kits"),
    el("h1", {}, kit.name),
    el("p", { class: "meta" }, `Created ${formatDate(kit.createdAt)} · ${plural(kit.items.length, "Item")}`),
    messageLine(message),
    scanButton,
    typeButton,
    items,
  ];
}

function scanScreen(kit) {
  const back = el("button", { type: "button", class: "secondary" }, "Back to Kit");
  back.addEventListener("click", () => { stopAdding(); render(); });
  return [
    el("p", { class: "meta" }, `Kit: ${kit.name}`),
    el("h1", {}, "Scan Items"),
    scanner.element,
    back,
  ];
}

function itemFormScreen(kit, pending, message) {
  const mode = ADDING_BY[adding.by];
  const serialBox = el("textarea", {
    id: "item-serial", rows: String(Math.min(8, pending.raw.split("\n").length + 1)),
    autocomplete: "off", autocapitalize: "characters", spellcheck: "false", ...(mode.focusSerial && { autofocus: "" }),
  });
  serialBox.value = pending.raw;
  const product = isProductCode(pending.format) && el("p", { class: "note" },
    `This ${formatName(pending.format)} is probably a product code, not a serial number: every unit of a product `
    + "has the same one. If the label also has a serial number, scan or type that instead.");

  const start = adding.values ?? record.startingValues(kit.id);
  const fieldInputs = record.fields().map(field => fieldInput(field, start[field.id] ?? ""));

  const saveAndNext = el("button", { type: "submit" }, mode.saveAndNext);
  const saveOnly = el("button", { type: "button", class: "secondary" }, "Save");
  const leave = el("button", { type: "button", class: "secondary" }, mode.leave);
  const form = el("form", { class: "item-form" },
    el("label", { for: "item-serial" }, "Serial"), serialBox,
    ...fieldInputs.map(f => f.element),
    el("div", { class: "buttons" }, saveAndNext, saveOnly, leave));

  const typedValues = () => Object.fromEntries(fieldInputs.map(f => [f.fieldId, f.input.value]));

  async function saveItem(thenNext) {
    // Keep the code format only if the Serial still comes from what was read (e.g. a trimmed prefix);
    // a Serial replaced by hand counts as typed in.
    const serial = serialBox.value.trim();
    const format = serial && pending.format && pending.raw.includes(serial) ? pending.format : undefined;
    const result = record.addItem(kit.id, serial, pending.at ?? new Date().toISOString(),
      { format, values: typedValues() });
    if (result.outcome === REFUSED) {
      adding.values = typedValues(); // keep what was typed while showing the message
      return render(result.reason);
    }
    adding.values = null;
    if (!(await save())) return;
    if (!thenNext) { stopAdding(); return render(); }
    mode.next(kit.id);
  }
  form.addEventListener("submit", event => { event.preventDefault(); saveItem(true); });
  saveOnly.addEventListener("click", () => saveItem(false));
  leave.addEventListener("click", () => { adding.values = null; mode.onLeave(); });

  return [
    el("p", { class: "meta" }, `Kit: ${kit.name}`),
    el("h1", {}, "New Item"),
    pending.format ? el("p", { class: "meta" }, `Read from ${withArticle(formatName(pending.format))}`) : "",
    messageLine(message),
    product || "",
    form,
  ];
}

/**
 * One Field on the Item form: a text box with its Pick list below as choices to tap,
 * in alphabetical order, narrowed to those matching what's typed.
 */
function fieldInput(field, value) {
  const id = `field-${field.id}`;
  const input = el("input", { id, autocomplete: "off", enterkeyhint: "next" });
  input.value = value;
  const choices = el("div", { class: "choices", role: "group", "aria-label": `${field.name} choices` });
  function showChoices() {
    choices.replaceChildren(...record.matchingPicks(field.id, input.value).map(pick => {
      const button = el("button", { type: "button", class: "choice" }, pick);
      button.addEventListener("click", () => { input.value = pick; showChoices(); });
      return button;
    }));
  }
  input.addEventListener("input", showChoices);
  showChoices();
  return { fieldId: field.id, input, element: el("div", { class: "field-input" }, el("label", { for: id }, field.name), input, choices) };
}

// ---- Actions ---------------------------------------------------------------

function startTyping(kitId) {
  adding = { kitId, by: "typing", pending: { raw: "" } };
  render();
}

function resumeScanning() {
  adding.pending = null;
  render();
  scanner.scan();
}

function stopAdding() {
  adding = null;
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

// ---- Helpers ---------------------------------------------------------------

// "a Code 128", "an EAN-13" (UPC is said "you-pee-see", so it takes "a").
const withArticle = name => `${/^[AEIO]/i.test(name) ? "an" : "a"} ${name}`;
const kitLink = kit => `#kit/${encodeURIComponent(kit.id)}`;
const DATE = { year: "numeric", month: "short", day: "numeric" };
const formatDate = iso => new Date(iso).toLocaleDateString(undefined, DATE);
const formatDateTime = iso => new Date(iso).toLocaleString(undefined, { ...DATE, hour: "numeric", minute: "2-digit" });
