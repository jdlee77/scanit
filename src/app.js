// App shell: draws the screens and passes every tap to the Kit record,
// then saves the record with the Store after every change.
import { KitRecord } from "./kit-record.js";
import { openStore } from "./store.js";
import { buildExport, encodeXlsx, exportFileName } from "./export-builder.js";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const main = document.querySelector("main");

let store;
let record;

start();

async function start() {
  try {
    store = await openStore();
    record = KitRecord.fromJSON((await store.load()) ?? { kits: [] });
  } catch (error) {
    main.replaceChildren(el("p", { role: "alert", class: "error" },
      "scanit can't use this browser's storage, so nothing could be loaded or saved. "
      + "Try opening it in Safari or Chrome, outside a private window."));
    console.error(error);
    return;
  }
  addEventListener("hashchange", () => render());
  render();
}

// ---- Screens ---------------------------------------------------------------

function render(message) {
  const kitId = location.hash.match(/^#kit\/(.+)$/)?.[1];
  const kit = kitId && record.kit(decodeURIComponent(kitId));
  main.replaceChildren(...(kit ? kitScreen(kit, message) : kitListScreen(message)));
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
    if (!nameInput.value.trim()) return render("Give the Kit a name first.");
    const kit = record.createKit(nameInput.value, new Date().toISOString());
    if (await save()) location.hash = `#kit/${encodeURIComponent(kit.id)}`;
  });

  const list = kits.length
    ? el("ul", { class: "kits" }, ...kits.map(kit => el("li", {},
      el("a", { href: `#kit/${encodeURIComponent(kit.id)}` },
        el("span", { class: "name" }, kit.name),
        el("span", { class: "count" }, plural(kit.items.length, "Item"))))))
    : el("p", { class: "empty" }, "No Kits yet. Create one to start recording Items.");

  const exportButton = el("button", { type: "button", class: "export" }, "Export");
  exportButton.disabled = kits.length === 0;
  exportButton.addEventListener("click", exportAll);

  return [el("h1", {}, "Kits"), alertLine(message), form, list, exportButton];
}

function kitScreen(kit, message) {
  const serialInput = el("input", {
    id: "serial", name: "serial", autocomplete: "off", autocapitalize: "characters",
    spellcheck: "false", enterkeyhint: "done", autofocus: "",
  });
  const form = el("form", { class: "add" },
    el("label", { for: "serial" }, "Serial"),
    el("div", { class: "row" }, serialInput, el("button", { type: "submit" }, "Save")));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const result = record.addItem(kit.id, serialInput.value, new Date().toISOString());
    if (result.outcome === "refused") return render(`${result.reason}: type one in, then Save.`);
    if (await save()) render();
  });

  const items = kit.items.length
    ? el("ol", { class: "items" }, ...kit.items.map(item => el("li", {},
      el("span", { class: "serial" }, item.serial),
      el("time", { datetime: item.scannedAt }, formatDateTime(item.scannedAt)))))
    : el("p", { class: "empty" }, "No Items yet. Type a Serial in and Save.");

  return [
    el("a", { href: "#", class: "back" }, "All Kits"),
    el("h1", {}, kit.name),
    el("p", { class: "meta" }, `Created ${formatDate(kit.createdAt)} · ${plural(kit.items.length, "Item")}`),
    alertLine(message),
    form,
    items,
  ];
}

// ---- Actions ---------------------------------------------------------------

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

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const formatDate = iso => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const formatDateTime = iso => new Date(iso).toLocaleString(undefined,
  { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}
