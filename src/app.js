// App shell: draws the screens and passes every tap to the Kit record,
// then saves the record with the Store after every change.
import { KitRecord, REFUSED, NEEDS_CONFIRMING, NOT_EXPORTED, EXPORTED, CHANGED_SINCE_EXPORT } from "./kit-record.js";
import { openStore } from "./store.js";
import { buildExport, encodeXlsx, exportFileName, XLSX_TYPE } from "./export-builder.js";
import { createScanner } from "./scanner.js";
import { formatName, isProductCode } from "./scan-reading.js";
import { settingsScreen } from "./settings-screen.js";
import { shareOrDownload, downloadFile, SHARED, CANCELLED, SHARE_FAILED } from "./files.js";
import { el, messageLine, plural, question } from "./dom.js";
import { startOffline, keepStoredData, UPDATING } from "./offline.js";
import { homeScreenPrompt } from "./install-prompt.js";
import { tourScreen, tourOffer, madeBy } from "./tour.js";

const main = document.querySelector("main");

let store;
let record;
let scanner;
// While adding Items to a Kit: { kitId, by: "scan" | "typing", pending }.
// pending: the Serial waiting in the Item form ({ raw, format, at } for a read; { raw: "" } when
// typing), or null while the camera is looking.
let adding = null;
// A notice to show on the next screen drawn after leaving this one (e.g. "Deleted the Kit ...").
let nextNotice = null;

// How the Item form differs when scanning and when typing.
const ADDING_BY = {
  scan: { saveAndNext: "Save & scan next", leave: "Back to camera", focusSerial: false,
    next: () => resumeScanning(), onLeave: () => resumeScanning() },
  typing: { saveAndNext: "Save & type next", leave: "Cancel", focusSerial: true,
    next: kitId => startTyping(kitId), onLeave: () => { stopAdding(); render(); } },
};

start();

async function start() {
  // A new version waiting from an earlier visit takes over first; the page reloads by itself.
  if (await startOffline({ isSafeToSwitch }) === UPDATING) return;
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
  addEventListener("hashchange", () => {
    stopAdding();
    render(nextNotice && { notice: nextNotice });
    nextNotice = null;
  });
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
  // #kit/<kit id>, #kit/<kit id>/details, #kit/<kit id>/item/<item id>
  const [, kitId, page, itemId] = location.hash.match(/^#kit\/([^/]+)(?:\/(details|item)(?:\/([^/]+))?)?$/) ?? [];
  const kit = kitId && record.kit(decodeURIComponent(kitId));
  const item = kit && page === "item" && record.item(kit.id, decodeURIComponent(itemId ?? ""));
  const tourStep = location.hash.match(/^#help(?:\/(\d+))?$/);
  const screen = tourStep ? tourScreen(Number(tourStep[1] ?? 1))
    : location.hash === "#settings" ? settingsScreen({ record, save, render, message })
    : location.hash === "#export" ? exportScreen(message)
    : !kit ? kitListScreen(message)
    : page === "details" ? kitDetailsScreen(kit, message)
    : item ? itemEditScreen(kit, item, message)
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
    if (!(await save())) return;
    // Now there's data worth keeping, ask the browser to keep it (asked in answer to a tap, as some
    // browsers want). A refusal is fine: the Export reminder still covers unsent Kits.
    keepStoredData();
    location.hash = kitLink(result.kit);
  });

  const list = kits.length
    ? el("ul", { class: "kits" }, ...kits.map(kit => el("li", {},
      el("a", { href: kitLink(kit) },
        el("span", { class: "name" }, kit.name),
        el("span", { class: "count" }, plural(kit.items.length, "Item")),
        exportStatusLine(kit)))))
    : el("p", { class: "empty" }, "No Kits yet. Create one to start recording Items.");

  // The Export is the only copy off the phone (ADR 0001), so say what still needs sending.
  const needing = record.kitsNeedingExport();
  const reminder = needing > 0 && el("p", { class: "note reminder" },
    `${plural(needing, "Kit")} not exported yet or changed since export. `
    + "The Export is the only copy that leaves this phone.");

  const exportButton = el("button", { type: "button", class: "export" }, "Export");
  exportButton.disabled = kits.length === 0;
  exportButton.addEventListener("click", () => { location.hash = "#export"; });

  return [
    el("nav", { class: "top" }, el("a", { href: "#help" }, "Help"), el("a", { href: "#settings" }, "Settings")),
    el("h1", {}, "Kits"), messageLine(message), tourOffer(), homeScreenPrompt({ kitCount: kits.length }),
    reminder || "", form, list, exportButton, madeBy(),
  ];
}

/** Choose the Kits to include, then hand the workbook off through Share (or download it). */
function exportScreen(message) {
  const kits = record.kits();
  const boxes = kits.map(kit => {
    const box = el("input", { type: "checkbox", id: `export-${kit.id}`, value: kit.id });
    box.checked = true;
    return box;
  });
  const exportButton = el("button", { type: "submit", class: "export" }, "Export");
  const count = el("p", { class: "small" });
  const problemSlot = el("div", { class: "problem-slot" });
  let sharing = false; // while the Share menu is open, another tap would make a second file
  const chosen = () => boxes.filter(b => b.checked).map(b => b.value);
  const showCount = () => {
    count.textContent = `${chosen().length} of ${plural(kits.length, "Kit")} ticked.`;
    exportButton.disabled = sharing || chosen().length === 0;
  };
  showCount();

  const form = el("form", { class: "stack-form" },
    el("ul", { class: "export-kits" }, ...kits.map((kit, i) => el("li", {},
      boxes[i],
      el("label", { for: boxes[i].id },
        el("span", { class: "name" }, kit.name), " ",
        el("span", { class: "count" }, plural(kit.items.length, "Item")),
        exportStatusLine(kit))))),
    count, exportButton, problemSlot);
  form.addEventListener("change", showCount);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (sharing) return;
    const kitIds = chosen();
    const now = new Date();
    const name = exportFileName(now);
    const bytes = encodeXlsx(buildExport(record, kitIds));
    problemSlot.replaceChildren();
    sharing = true;
    showCount();
    // Build and hand off straight away: phones only open Share in answer to a tap.
    const outcome = await shareOrDownload(bytes, name, XLSX_TYPE);
    sharing = false;
    showCount();
    if (outcome === CANCELLED) return render({ notice: "Share was closed, so nothing was sent. The Kits are not marked exported." });
    if (outcome === SHARE_FAILED) {
      // Downloading needs a fresh tap: the phone may silently block one that comes later.
      return problemSlot.replaceChildren(question({
        text: "Share couldn't send the file, so nothing was sent. Download it instead? "
          + "You can then send it from your phone's Files app.",
        yes: "Download instead", no: "Cancel",
        onYes: () => { downloadFile(bytes, name, XLSX_TYPE); recordExport(kitIds, now, name, "Downloaded"); },
        onNo: () => problemSlot.replaceChildren(),
      }).element);
    }
    recordExport(kitIds, now, name, outcome === SHARED ? "Shared" : "Downloaded");
  });

  return [
    el("a", { href: "#", class: "back" }, "All Kits"),
    el("h1", {}, "Export"),
    el("p", { class: "small" }, "Tick the Kits to include. Export makes one Excel workbook and opens your phone's "
      + "Share menu, to send it by email, Teams, Drive and so on. Where Share isn't available, it downloads."),
    messageLine(message),
    kits.length ? form : el("p", { class: "empty" }, "No Kits to export yet."),
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
      el("a", { href: itemLink(kit, item), "aria-label": `Edit ${item.serial}` },
        el("span", { class: "serial" }, item.serial),
        el("span", { class: "when" }, item.format ? formatName(item.format) : "Typed in", " · ",
          el("time", { datetime: item.scannedAt }, formatDateTime(item.scannedAt)))))))
    : el("p", { class: "empty" }, "No Items yet. Scan one, or type a Serial in.");

  return [
    el("nav", { class: "top split" },
      el("a", { href: "#", class: "back" }, "All Kits"),
      el("a", { href: `${kitLink(kit)}/details` }, "Edit Kit")),
    el("h1", {}, kit.name),
    el("p", { class: "meta" }, `Created ${formatDate(kit.createdAt)} · ${plural(kit.items.length, "Item")}`),
    kit.notes ? el("p", { class: "kit-notes" }, kit.notes) : "",
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
  const saveAndNext = el("button", { type: "submit" }, mode.saveAndNext);
  const saveOnly = el("button", { type: "button", class: "secondary" }, "Save");
  const leave = el("button", { type: "button", class: "secondary" }, mode.leave);
  const form = itemForm({
    serial: pending.raw, values: record.startingValues(kit.id), focusSerial: mode.focusSerial,
    buttons: [saveAndNext, saveOnly, leave],
  });

  async function saveItem(thenNext, confirmed = false) {
    // Keep the code format only if the Serial still comes from what was read (e.g. a trimmed prefix);
    // a Serial replaced by hand counts as typed in.
    const serial = form.serial();
    const format = serial && pending.format && pending.raw.includes(serial) ? pending.format : undefined;
    const result = record.addItem(kit.id, serial, pending.at ?? new Date().toISOString(),
      { format, values: form.values(), confirmed });
    if (form.stopFor(result, () => saveItem(thenNext, true))) return;
    if (!(await save())) return;
    if (!thenNext) { stopAdding(); return render(); }
    mode.next(kit.id);
  }
  form.element.addEventListener("submit", event => { event.preventDefault(); saveItem(true); });
  saveOnly.addEventListener("click", () => saveItem(false));
  leave.addEventListener("click", () => mode.onLeave());

  const product = isProductCode(pending.format) && el("p", { class: "note" },
    `This ${formatName(pending.format)} is probably a product code, not a serial number: every unit of a product `
    + "has the same one. If the label also has a serial number, scan or type that instead.");

  return [
    el("p", { class: "meta" }, `Kit: ${kit.name}`),
    el("h1", {}, "New Item"),
    pending.format ? el("p", { class: "meta" }, readFrom(pending.format)) : "",
    messageLine(message),
    product || "",
    form.element,
  ];
}

/** Change or delete a saved Item. There's no moving: delete it here and scan it into the other Kit. */
function itemEditScreen(kit, item, message) {
  const saveButton = el("button", { type: "submit" }, "Save changes");
  const cancel = el("a", { href: kitLink(kit), class: "button secondary" }, "Cancel");
  const form = itemForm({ serial: item.serial, values: item.values ?? {}, buttons: [saveButton, cancel] });

  async function saveChanges(confirmed = false) {
    const result = record.editItem(kit.id, item.id, form.serial(), { values: form.values(), confirmed });
    if (form.stopFor(result, () => saveChanges(true))) return;
    if (await save()) location.hash = kitLink(kit);
  }
  form.element.addEventListener("submit", event => { event.preventDefault(); saveChanges(); });

  const deleteItem = askBeforeDeleting({
    button: "Delete Item",
    text: `This deletes ${item.serial} from ${kit.name}.`,
    yes: "Yes, delete it",
    async onYes() {
      record.deleteItem(kit.id, item.id);
      if (!(await save())) return;
      nextNotice = `Deleted ${item.serial} from ${kit.name}.`;
      location.hash = kitLink(kit);
    },
  });

  return [
    el("p", { class: "meta" }, `Kit: ${kit.name}`),
    el("h1", {}, "Edit Item"),
    el("p", { class: "meta" }, item.format ? readFrom(item.format) : "Typed in", " · ",
      el("time", { datetime: item.scannedAt }, formatDateTime(item.scannedAt))),
    messageLine(message),
    form.element,
    el("h2", {}, "Delete"),
    el("p", { class: "small" }, "To move this Item to another Kit, delete it here, then scan it into that Kit."),
    ...deleteItem,
  ];
}

/** Rename a Kit, edit its Notes, or delete it (after an "Are you sure?" on the page). */
function kitDetailsScreen(kit, message) {
  const nameInput = el("input", { id: "kit-name", autocomplete: "off", enterkeyhint: "done" });
  nameInput.value = kit.name;
  const notesBox = el("textarea", { id: "kit-notes", rows: "4" });
  notesBox.value = kit.notes ?? "";
  const problemSlot = el("div", { class: "problem-slot" });
  const form = el("form", { class: "stack-form" },
    el("label", { for: "kit-name" }, "Kit name"), nameInput,
    el("label", { for: "kit-notes" }, "Notes"),
    el("p", { class: "small" }, "Optional. Notes go at the top of this Kit's sheet in the Export, and in the Summary."),
    notesBox,
    problemSlot,
    el("div", { class: "buttons" },
      el("button", { type: "submit" }, "Save changes"),
      el("a", { href: kitLink(kit), class: "button secondary" }, "Cancel")));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const result = record.renameKit(kit.id, nameInput.value);
    // Show the refusal in place, so the Notes typed so far stay on the form.
    if (result.outcome === REFUSED) return problemSlot.replaceChildren(el("p", { role: "alert", class: "error" }, result.reason));
    record.setKitNotes(kit.id, notesBox.value);
    if (await save()) location.hash = kitLink(kit);
  });
  nameInput.addEventListener("input", () => problemSlot.replaceChildren());

  const deleteKit = askBeforeDeleting({
    button: "Delete Kit",
    text: [`This deletes ${kit.name} and its ${plural(kit.items.length, "Item")} from this phone. `
      + "It can't be undone; Export first if you need a copy.", unsentWarning(kit)],
    yes: `Yes, delete ${kit.name}`,
    async onYes() {
      record.deleteKit(kit.id);
      if (!(await save())) return;
      nextNotice = `Deleted the Kit ${kit.name}.`;
      location.hash = "#";
    },
  });

  return [
    el("a", { href: kitLink(kit), class: "back" }, kit.name),
    el("h1", {}, "Edit Kit"),
    messageLine(message),
    form,
    el("h2", {}, "Delete"),
    ...deleteKit,
  ];
}

/**
 * A delete button that first asks "Are you sure?" on the page, with "Keep it" to back out.
 * Returns the elements to place on the screen.
 */
function askBeforeDeleting({ button, text, yes, onYes }) {
  const deleteButton = el("button", { type: "button", class: "danger" }, button);
  const slot = el("div", {});
  deleteButton.addEventListener("click", () => {
    const ask = question({
      label: "Are you sure?", text: [el("strong", {}, "Are you sure? "), text], yes, no: "Keep it", onYes,
      onNo: () => { slot.replaceChildren(); deleteButton.hidden = false; deleteButton.focus(); },
    });
    ask.yesButton.classList.add("danger");
    deleteButton.hidden = true;
    slot.replaceChildren(ask.element);
    ask.noButton.focus();
  });
  return [deleteButton, slot];
}

/**
 * The Item form shared by new and saved Items: the Serial, then each Field, then the buttons,
 * with room above the buttons for a refusal or a "Save anyway?" question.
 */
function itemForm({ serial, values, buttons, focusSerial = false }) {
  const serialBox = el("textarea", {
    id: "item-serial", rows: String(Math.min(8, serial.split("\n").length + 1)),
    autocomplete: "off", autocapitalize: "characters", spellcheck: "false", ...(focusSerial && { autofocus: "" }),
  });
  serialBox.value = serial;
  const fieldInputs = record.fields().map(field => fieldInput(field, values[field.id] ?? ""));
  const problemSlot = el("div", { class: "problem-slot" });
  const element = el("form", { class: "stack-form" },
    el("label", { for: "item-serial" }, "Serial"), serialBox,
    ...fieldInputs.map(f => f.element),
    problemSlot,
    el("div", { class: "buttons" }, ...buttons));
  // Changing the Serial answers the question, so it goes away.
  serialBox.addEventListener("input", () => problemSlot.replaceChildren());

  function show(...content) {
    problemSlot.replaceChildren(...content);
    problemSlot.scrollIntoView?.({ block: "center" });
  }

  return {
    element,
    serial: () => serialBox.value.trim(),
    values: () => Object.fromEntries(fieldInputs.map(f => [f.fieldId, f.input.value])),
    /**
     * If the Kit record didn't save, show why (or ask to save anyway, calling saveAnyway on yes)
     * and return true. Everything typed stays on the form.
     */
    stopFor(result, saveAnyway) {
      if (result.outcome === REFUSED) {
        show(el("p", { role: "alert", class: "error" }, result.reason));
        return true;
      }
      if (result.outcome === NEEDS_CONFIRMING) {
        show(question({
          text: result.reason, yes: "Save anyway", no: "Change the Serial", onYes: saveAnyway,
          onNo: () => { problemSlot.replaceChildren(); serialBox.focus(); },
        }).element);
        return true;
      }
      return false;
    },
  };
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

/**
 * Mark the Kits in an Export as exported. The marks are made on a copy and kept only once stored,
 * so a Kit never looks sent unless the phone has recorded it. how: "Shared" or "Downloaded".
 */
async function recordExport(kitIds, now, name, how) {
  const next = KitRecord.fromJSON(record.toJSON());
  next.markExported(kitIds, now.toISOString());
  try {
    await store.save(next.toJSON());
  } catch (error) {
    console.error(error);
    return render(`${how} ${name}, but this phone couldn't record that, so these Kits still show as `
      + "not sent. If you're not sure the file arrived, Export them again.");
  }
  record = next;
  nextNotice = `${how} ${name} with ${plural(kitIds.length, "Kit")}.`;
  location.hash = "#";
}

function startTyping(kitId) {
  adding = { kitId, by: "typing", pending: { raw: "" } };
  render();
}

function resumeScanning() {
  adding.pending = null;
  render();
  scanner.scan();
}

/** Whether reloading into a new version now would lose nothing: on the Kit list, nothing typed, no camera. */
function isSafeToSwitch() {
  const onKitList = location.hash === "" || location.hash === "#";
  return onKitList && !adding && !document.querySelector("#kit-name")?.value;
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
    // Go back to what's stored, so the screen never shows a change the phone doesn't have.
    try { record = KitRecord.fromJSON(await store.load()); } catch (loadError) { console.error(loadError); }
    render("That change could not be saved on this phone. Try again; if it keeps failing, Export now.");
    return false;
  }
}

// ---- Helpers ---------------------------------------------------------------

// How each Export status reads: on a Kit row, and as a warning when deleting the Kit (none if sent).
const EXPORT_STATUS_TEXT = {
  [NOT_EXPORTED]: {
    line: () => "Not exported yet",
    deleteWarning: () => "This Kit has never been exported, so no copy of it exists anywhere else.",
  },
  [EXPORTED]: {
    line: at => `Exported ${formatDateTime(at)}`,
    deleteWarning: null,
  },
  [CHANGED_SINCE_EXPORT]: {
    line: () => "Changed since export",
    deleteWarning: at => `This Kit has changed since its last Export (${formatDateTime(at)}), `
      + "so those changes exist only on this phone.",
  },
};

/** "Not exported yet", "Exported (date)" or "Changed since export", for a Kit row. */
function exportStatusLine(kit) {
  const { status, exportedAt } = record.exportStatus(kit.id);
  return el("span", { class: status === EXPORTED ? "status" : "status unsent" }, EXPORT_STATUS_TEXT[status].line(exportedAt));
}

/** The warning for deleting a Kit whose latest contents have never left the phone, or "". */
function unsentWarning(kit) {
  const { status, exportedAt } = record.exportStatus(kit.id);
  const warning = EXPORT_STATUS_TEXT[status].deleteWarning;
  return warning ? el("strong", { class: "unsent-warning" }, " ", warning(exportedAt)) : "";
}

// "a Code 128", "an EAN-13" (UPC is said "you-pee-see", so it takes "a").
const withArticle = name => `${/^[AEIO]/i.test(name) ? "an" : "a"} ${name}`;
const readFrom = format => `Read from ${withArticle(formatName(format))}`;
const kitLink = kit => `#kit/${encodeURIComponent(kit.id)}`;
const itemLink = (kit, item) => `${kitLink(kit)}/item/${encodeURIComponent(item.id)}`;
const DATE = { year: "numeric", month: "short", day: "numeric" };
const formatDate = iso => new Date(iso).toLocaleDateString(undefined, DATE);
const formatDateTime = iso => new Date(iso).toLocaleString(undefined, { ...DATE, hour: "numeric", minute: "2-digit" });
