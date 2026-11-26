// App shell: draws the screens and passes every tap to the Kit record,
// then saves the record with the Store after every change.
import { KitRecord, REFUSED, NEEDS_CONFIRMING } from "./kit-record.js";
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
  const item = kit && page === "item" && kit.items.find(i => i.id === decodeURIComponent(itemId ?? ""));
  const screen = location.hash === "#settings" ? settingsScreen({ record, save, render, message })
    : !kit ? kitListScreen(message)
    : page === "details" ? kitDetailsScreen(kit, message)
    : item ? itemEditScreen(kit, item)
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
    pending.format ? el("p", { class: "meta" }, `Read from ${withArticle(formatName(pending.format))}`) : "",
    messageLine(message),
    product || "",
    form.element,
  ];
}

/** Change or delete a saved Item. There's no moving: delete it here and scan it into the other Kit. */
function itemEditScreen(kit, item) {
  const saveButton = el("button", { type: "submit" }, "Save changes");
  const cancel = el("a", { href: kitLink(kit), class: "button secondary" }, "Cancel");
  const deleteButton = el("button", { type: "button", class: "danger" }, "Delete Item");
  const form = itemForm({ serial: item.serial, values: item.values ?? {}, buttons: [saveButton, cancel] });

  async function saveChanges(confirmed = false) {
    const result = record.editItem(kit.id, item.id, form.serial(), { values: form.values(), confirmed });
    if (form.stopFor(result, () => saveChanges(true))) return;
    if (await save()) location.hash = kitLink(kit);
  }
  form.element.addEventListener("submit", event => { event.preventDefault(); saveChanges(); });
  deleteButton.addEventListener("click", async () => {
    record.deleteItem(kit.id, item.id);
    if (!(await save())) return;
    nextNotice = `Deleted ${item.serial} from ${kit.name}.`;
    location.hash = kitLink(kit);
  });

  return [
    el("p", { class: "meta" }, `Kit: ${kit.name}`),
    el("h1", {}, "Edit Item"),
    el("p", { class: "meta" }, item.format ? `Read from ${withArticle(formatName(item.format))}` : "Typed in", " · ",
      el("time", { datetime: item.scannedAt }, formatDateTime(item.scannedAt))),
    form.element,
    el("h2", {}, "Delete"),
    el("p", { class: "small" }, "To move this Item to another Kit, delete it here, then scan it into that Kit."),
    deleteButton,
  ];
}

/** Rename a Kit, edit its Notes, or delete it (after an "Are you sure?" on the page). */
function kitDetailsScreen(kit, message) {
  const nameInput = el("input", { id: "kit-name", autocomplete: "off", enterkeyhint: "done" });
  nameInput.value = kit.name;
  const notesBox = el("textarea", { id: "kit-notes", rows: "4" });
  notesBox.value = kit.notes ?? "";
  const form = el("form", { class: "item-form" },
    el("label", { for: "kit-name" }, "Kit name"), nameInput,
    el("label", { for: "kit-notes" }, "Notes"),
    el("p", { class: "small" }, "Optional. Notes go at the top of this Kit's sheet in the Export, and in the Summary."),
    notesBox,
    el("div", { class: "buttons" },
      el("button", { type: "submit" }, "Save changes"),
      el("a", { href: kitLink(kit), class: "button secondary" }, "Cancel")));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const result = record.renameKit(kit.id, nameInput.value);
    if (result.outcome === REFUSED) return render(result.reason);
    record.setKitNotes(kit.id, notesBox.value);
    if (await save()) location.hash = kitLink(kit);
  });

  const deleteButton = el("button", { type: "button", class: "danger" }, "Delete Kit");
  const confirmSlot = el("div", {});
  deleteButton.addEventListener("click", () => {
    const yes = el("button", { type: "button", class: "danger" }, `Yes, delete ${kit.name}`);
    const no = el("button", { type: "button", class: "secondary" }, "Keep it");
    yes.addEventListener("click", async () => {
      record.deleteKit(kit.id);
      if (!(await save())) return;
      nextNotice = `Deleted the Kit ${kit.name}.`;
      location.hash = "#";
    });
    no.addEventListener("click", () => { confirmSlot.replaceChildren(); deleteButton.hidden = false; deleteButton.focus(); });
    deleteButton.hidden = true;
    confirmSlot.replaceChildren(el("div", { class: "problem", role: "alertdialog", "aria-label": "Are you sure?" },
      el("p", {}, el("strong", {}, "Are you sure? "),
        `This deletes ${kit.name} and its ${plural(kit.items.length, "Item")} from this phone. `
        + "It can't be undone; Export first if you need a copy."),
      el("div", { class: "row" }, yes, no)));
    no.focus();
  });

  return [
    el("a", { href: kitLink(kit), class: "back" }, kit.name),
    el("h1", {}, "Edit Kit"),
    messageLine(message),
    form,
    el("h2", {}, "Delete"),
    deleteButton,
    confirmSlot,
  ];
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
  const element = el("form", { class: "item-form" },
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
        const yes = el("button", { type: "button" }, "Save anyway");
        const no = el("button", { type: "button", class: "secondary" }, "Change the Serial");
        yes.addEventListener("click", saveAnyway);
        no.addEventListener("click", () => { problemSlot.replaceChildren(); serialBox.focus(); });
        show(el("div", { class: "problem", role: "alert" }, el("p", {}, result.reason), el("div", { class: "row" }, yes, no)));
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
const itemLink = (kit, item) => `${kitLink(kit)}/item/${encodeURIComponent(item.id)}`;
const DATE = { year: "numeric", month: "short", day: "numeric" };
const formatDate = iso => new Date(iso).toLocaleDateString(undefined, DATE);
const formatDateTime = iso => new Date(iso).toLocaleString(undefined, { ...DATE, hour: "numeric", minute: "2-digit" });
