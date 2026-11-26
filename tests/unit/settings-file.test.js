// The Settings file: Fields and Pick lists saved as JSON and loaded on another phone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KitRecord } from "../../src/kit-record.js";
import { settingsFileText, readSettingsFile, settingsFileName } from "../../src/settings-file.js";

function phoneWithSettings() {
  const record = new KitRecord();
  const make = record.addField("Make").field.id;
  record.addField("Model");
  const { kit } = record.createKit("Radio Cache 3", "2026-11-26T17:00:00.000Z");
  record.addItem(kit.id, "SN-1", "2026-11-26T17:05:00.000Z", { values: { [make]: "Motorola" } });
  return record;
}

test("a Settings file loaded on another phone gives it the same Fields and Pick lists", () => {
  const text = settingsFileText(phoneWithSettings());
  const otherPhone = new KitRecord();
  const result = otherPhone.mergeSettings(readSettingsFile(text));
  assert.equal(result.outcome, "done");
  assert.deepEqual(otherPhone.settings(), { fields: [{ name: "Make", picks: ["Motorola"] }, { name: "Model", picks: [] }] });
});

test("a Settings file holds no Kits, Items or Serials", () => {
  const text = settingsFileText(phoneWithSettings());
  assert.doesNotMatch(text, /Radio Cache 3|SN-1|kits/i);
  assert.equal(JSON.parse(text).fields.length, 2);
});

test("a file that isn't a scanit Settings file is turned away with a reason", () => {
  assert.throws(() => readSettingsFile("not json at all"), /isn't a scanit Settings file/);
  assert.throws(() => readSettingsFile(JSON.stringify({ fields: [] })), /isn't a scanit Settings file/);
  assert.throws(() => readSettingsFile(JSON.stringify({ app: "scanit", kind: "export" })), /isn't a scanit Settings file/);
});

test("the Settings file is named with the local date", () => {
  assert.equal(settingsFileName(new Date(2026, 10, 26, 23, 30)), "scanit-settings-2026-11-26.json");
});
