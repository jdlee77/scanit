// The Settings screen: the shared Fields, their Pick lists, and the Settings file.
// Every rule is the Kit record's; this only draws and asks.
import { REFUSED } from "./kit-record.js";
import { settingsFileText, readSettingsFile, settingsFileName, SETTINGS_TYPE } from "./settings-file.js";
import { downloadFile } from "./files.js";
import { el, messageLine, plural } from "./dom.js";

/** ctx: { record, save, render, message } from the app shell. */
export function settingsScreen({ record, save, render, message }) {
  const fields = record.fields();

  /** Apply a change, save it, and redraw (with the refusal reason if the record refused it). */
  async function change(result, notice) {
    if (result.outcome === REFUSED) return render(result.reason);
    if (await save()) render(notice && { notice });
  }

  const fieldList = fields.length
    ? el("ol", { class: "fields" }, ...fields.map((field, i) => fieldRow(field, i)))
    : el("p", { class: "empty" }, "No Fields yet. Add one, such as Make or Model, to record it for every Item.");

  function fieldRow(field, index) {
    const button = (label, ariaLabel, onClick, disabled = false) => {
      const b = el("button", { type: "button", class: "secondary small-button", "aria-label": ariaLabel }, label);
      b.disabled = disabled;
      b.addEventListener("click", onClick);
      return b;
    };
    const picks = field.picks.length
      ? el("ul", { class: "picks" }, ...field.picks.map(value => el("li", {},
        el("span", { class: "pick" }, value),
        button("Rename", `Rename ${value} in ${field.name}`, () => {
          const newValue = prompt(`Rename "${value}" to:`, value);
          if (newValue !== null) change(record.renamePick(field.id, value, newValue));
        }),
        button("Remove", `Remove ${value} from ${field.name}`, () => change(record.removePick(field.id, value))))))
      : el("p", { class: "small" }, "Empty. Values entered on the Item form are added here.");

    return el("li", { class: "field-row" },
      el("div", { class: "field-head" },
        el("span", { class: "name" }, field.name),
        el("span", { class: "actions" },
          button("↑", `Move ${field.name} up`, () => change(record.moveField(field.id, index - 1)), index === 0),
          button("↓", `Move ${field.name} down`, () => change(record.moveField(field.id, index + 1)), index === fields.length - 1),
          button("Rename", `Rename ${field.name}`, () => {
            const name = prompt(`Rename the Field "${field.name}" to:`, field.name);
            if (name !== null) change(record.renameField(field.id, name));
          }),
          button("Remove", `Remove ${field.name}`, () => {
            if (confirm(`Remove the Field "${field.name}"? Its values will no longer appear in Items or Exports.`)) {
              change(record.removeField(field.id), `Removed the Field ${field.name}.`);
            }
          }))),
      el("details", {}, el("summary", {}, `${field.name} Pick list (${plural(field.picks.length, "value")})`), picks));
  }

  const newField = el("input", { id: "new-field", autocomplete: "off", enterkeyhint: "done" });
  const addForm = el("form", { class: "add" },
    el("label", { for: "new-field" }, "New Field"),
    el("div", { class: "row" }, newField, el("button", { type: "submit" }, "Add Field")));
  addForm.addEventListener("submit", event => { event.preventDefault(); change(record.addField(newField.value)); });

  const saveFile = el("button", { type: "button", class: "secondary" }, "Save Settings file");
  saveFile.addEventListener("click", () =>
    downloadFile(settingsFileText(record), settingsFileName(new Date()), SETTINGS_TYPE));
  const loadInput = el("input", { type: "file", accept: ".json,application/json" });
  loadInput.addEventListener("change", async () => {
    const file = loadInput.files[0];
    loadInput.value = "";
    if (!file) return;
    const result = record.mergeSettings(readSettingsFile(await file.text()));
    const added = result.added && `Settings loaded: added ${plural(result.added.fields, "Field")} `
      + `and ${plural(result.added.values, "Pick list value")}.`;
    change(result, added);
  });

  return [
    el("a", { href: "#", class: "back" }, "All Kits"),
    el("h1", {}, "Settings"),
    messageLine(message),
    el("h2", {}, "Fields"),
    el("p", { class: "small" }, "Every Kit uses these Fields. Items and the Export show them in this order, after the Serial. "
      + "Adding, renaming, moving or removing a Field changes every Kit's sheet, so exported Kits will show "
      + "\"Changed since export\"."),
    fieldList,
    addForm,
    el("h2", {}, "Settings file"),
    el("p", { class: "small" },
      "Save your Fields and Pick lists to a file, to keep a copy or load them on another phone. "
      + "Loading adds what's missing and never removes anything. Kits are not part of it."),
    el("div", { class: "file-actions" }, saveFile, el("label", { class: "file-button" }, "Load Settings file", loadInput)),
  ];
}
