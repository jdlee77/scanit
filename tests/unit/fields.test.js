// Fields, Pick lists, carry-over of Field values, and merging a loaded Settings file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KitRecord } from "../../src/kit-record.js";

const T = n => `2026-11-26T17:0${n}:00.000Z`;
const names = record => record.fields().map(f => f.name);

function withFields(...fieldNames) {
  const record = new KitRecord();
  const ids = fieldNames.map(name => record.addField(name).field.id);
  return { record, ids };
}

test("Fields can be added, and a blank or repeated name is refused", () => {
  const { record } = withFields("Make", "Model");
  assert.deepEqual(names(record), ["Make", "Model"]);
  assert.equal(record.addField("  ").outcome, "refused");
  const again = record.addField(" make ");
  assert.equal(again.outcome, "refused");
  assert.match(again.reason, /already/);
  assert.deepEqual(names(record), ["Make", "Model"]);
});

test("Fields can be renamed, keeping saved values", () => {
  const { record, ids: [make] } = withFields("Make", "Model");
  const { kit } = record.createKit("K", T(0));
  record.addItem(kit.id, "SN-1", T(1), { values: { [make]: "Motorola" } });
  assert.equal(record.renameField(make, "Manufacturer").outcome, "done");
  assert.deepEqual(names(record), ["Manufacturer", "Model"]);
  assert.deepEqual(record.kit(kit.id).items[0].values, { [make]: "Motorola" });
  assert.equal(record.renameField(make, "Model").outcome, "refused");
});

test("Fields can be reordered", () => {
  const { record, ids: [make, model, condition] } = withFields("Make", "Model", "Condition");
  record.moveField(condition, 0);
  assert.deepEqual(names(record), ["Condition", "Make", "Model"]);
  record.moveField(condition, 2);
  assert.deepEqual(names(record), ["Make", "Model", "Condition"]);
  record.moveField(make, 9); // beyond the end: goes last
  assert.deepEqual(names(record), ["Model", "Condition", "Make"]);
  assert.ok(model);
});

test("removing a Field removes its values from Items", () => {
  const { record, ids: [make, model] } = withFields("Make", "Model");
  const { kit } = record.createKit("K", T(0));
  record.addItem(kit.id, "SN-1", T(1), { values: { [make]: "Motorola", [model]: "APX 6000" } });
  record.removeField(make);
  assert.deepEqual(names(record), ["Model"]);
  assert.deepEqual(record.kit(kit.id).items[0].values, { [model]: "APX 6000" });
});

test("each new value saved on an Item joins that Field's Pick list, shown alphabetically", () => {
  const { record, ids: [make, model] } = withFields("Make", "Model");
  const { kit } = record.createKit("K", T(0));
  record.addItem(kit.id, "SN-1", T(1), { values: { [make]: "Motorola", [model]: "  APX 6000 " } });
  record.addItem(kit.id, "SN-2", T(2), { values: { [make]: "Harris" } });
  record.addItem(kit.id, "SN-3", T(3), { values: { [make]: "motorola", [model]: "" } });
  record.addItem(kit.id, "SN-4", T(4), { values: { [make]: "Kenwood 10" } });
  record.addItem(kit.id, "SN-5", T(5), { values: { [make]: "Kenwood 9" } });
  const [makes, models] = record.fields().map(f => f.picks);
  assert.deepEqual(makes, ["Harris", "Kenwood 9", "Kenwood 10", "Motorola"], "no second Motorola for a different case");
  assert.deepEqual(models, ["APX 6000"]);
  assert.deepEqual(record.kit(kit.id).items[0].values, { [make]: "Motorola", [model]: "APX 6000" }, "values are trimmed");
  assert.deepEqual(record.kit(kit.id).items[2].values, { [make]: "motorola" }, "a blank value isn't stored");
});

test("values for unknown Fields are ignored", () => {
  const { record, ids: [make] } = withFields("Make");
  const { kit } = record.createKit("K", T(0));
  const { item } = record.addItem(kit.id, "SN-1", T(1), { values: { [make]: "Motorola", nope: "x" } });
  assert.deepEqual(item.values, { [make]: "Motorola" });
});

test("only the Serial is required", () => {
  const { record } = withFields("Make", "Model");
  const { kit } = record.createKit("K", T(0));
  assert.equal(record.addItem(kit.id, "SN-1", T(1)).outcome, "added");
  assert.deepEqual(record.kit(kit.id).items[0].values, {});
});

test("renaming a Pick list value leaves saved Items unchanged", () => {
  const { record, ids: [make] } = withFields("Make");
  const { kit } = record.createKit("K", T(0));
  record.addItem(kit.id, "SN-1", T(1), { values: { [make]: "Motorlla" } });
  assert.equal(record.renamePick(make, "Motorlla", "Motorola").outcome, "done");
  assert.deepEqual(record.fields()[0].picks, ["Motorola"]);
  assert.deepEqual(record.kit(kit.id).items[0].values, { [make]: "Motorlla" });
});

test("renaming a Pick list value to one already there merges them", () => {
  const { record, ids: [make] } = withFields("Make");
  const { kit } = record.createKit("K", T(0));
  record.addItem(kit.id, "SN-1", T(1), { values: { [make]: "Motorola" } });
  record.addItem(kit.id, "SN-2", T(2), { values: { [make]: "Motorlla" } });
  record.renamePick(make, "Motorlla", "motorola");
  assert.deepEqual(record.fields()[0].picks, ["Motorola"]);
  assert.equal(record.renamePick(make, "Motorola", " ").outcome, "refused");
});

test("Pick list values can be removed", () => {
  const { record, ids: [make] } = withFields("Make");
  const { kit } = record.createKit("K", T(0));
  record.addItem(kit.id, "SN-1", T(1), { values: { [make]: "Motorola" } });
  record.addItem(kit.id, "SN-2", T(2), { values: { [make]: "Harris" } });
  record.removePick(make, "Motorola");
  assert.deepEqual(record.fields()[0].picks, ["Harris"]);
  assert.deepEqual(record.kit(kit.id).items[0].values, { [make]: "Motorola" }, "saved Items keep their value");
});

test("a new Item starts with the previous Item's Field values; the first starts blank", () => {
  const { record, ids: [make, model] } = withFields("Make", "Model");
  const { kit } = record.createKit("Radios", T(0));
  const { kit: other } = record.createKit("Laptops", T(0));
  assert.deepEqual(record.startingValues(kit.id), {});
  record.addItem(kit.id, "SN-1", T(1), { values: { [make]: "Motorola", [model]: "APX 6000" } });
  record.addItem(other.id, "LT-1", T(2), { values: { [make]: "Dell" } });
  assert.deepEqual(record.startingValues(kit.id), { [make]: "Motorola", [model]: "APX 6000" });
  assert.deepEqual(record.startingValues(other.id), { [make]: "Dell" });
  record.removeField(model);
  assert.deepEqual(record.startingValues(kit.id), { [make]: "Motorola" });
});

test("Settings hold the Fields and Pick lists by name, and no Kits", () => {
  const { record, ids: [make] } = withFields("Make", "Model");
  const { kit } = record.createKit("K", T(0));
  record.addItem(kit.id, "SN-1", T(1), { values: { [make]: "Motorola" } });
  assert.deepEqual(record.settings(), { fields: [{ name: "Make", picks: ["Motorola"] }, { name: "Model", picks: [] }] });
});

test("merging Settings matches Fields by name and only adds", () => {
  const { record, ids: [make] } = withFields("Make", "Condition");
  const { kit } = record.createKit("K", T(0));
  record.addItem(kit.id, "SN-1", T(1), { values: { [make]: "Harris" } });
  const result = record.mergeSettings({ fields: [
    { name: "make", picks: ["Motorola", "harris"] },
    { name: "Model", picks: ["APX 6000"] },
    { name: "  ", picks: ["ignored"] },
  ] });
  assert.equal(result.outcome, "done");
  assert.deepEqual(result.added, { fields: 1, values: 2 });
  assert.deepEqual(record.settings(), { fields: [
    { name: "Make", picks: ["Harris", "Motorola"] },
    { name: "Condition", picks: [] },
    { name: "Model", picks: ["APX 6000"] },
  ] });
  assert.equal(record.kits().length, 1, "Kits are untouched");
  assert.equal(record.kit(kit.id).items.length, 1);
});

test("merging something that isn't Settings is refused", () => {
  const record = new KitRecord();
  assert.equal(record.mergeSettings({ kits: [] }).outcome, "refused");
  assert.equal(record.mergeSettings(null).outcome, "refused");
  assert.equal(record.mergeSettings({ fields: [{ name: 3 }] }).outcome, "refused");
});

test("Fields and Pick lists survive the JSON document round trip", () => {
  const { record, ids: [make] } = withFields("Make");
  const { kit } = record.createKit("K", T(0));
  record.addItem(kit.id, "SN-1", T(1), { values: { [make]: "Motorola" } });
  const back = KitRecord.fromJSON(JSON.parse(JSON.stringify(record.toJSON())));
  assert.deepEqual(back.settings(), record.settings());
  assert.deepEqual(back.startingValues(kit.id), { [make]: "Motorola" });
});

test("a record saved before Fields existed still loads", () => {
  const back = KitRecord.fromJSON({ kits: [{ id: "k", name: "Old", createdAt: T(0), items: [{ id: "i", serial: "A", scannedAt: T(1) }] }] });
  assert.deepEqual(back.fields(), []);
  assert.deepEqual(back.startingValues("k"), {});
});
