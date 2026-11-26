// The Kit record's rules, checked through its public operations only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KitRecord } from "../../src/kit-record.js";

const T1 = "2026-11-26T17:00:00.000Z";
const T2 = "2026-11-26T17:05:00.000Z";
const T3 = "2026-11-26T17:09:00.000Z";

test("a new record has no Kits", () => {
  assert.deepEqual(new KitRecord().kits(), []);
});

test("creating a Kit records its name and created date", () => {
  const record = new KitRecord();
  const { outcome, kit } = record.createKit("Radio Cache 3", T1);
  assert.equal(outcome, "added");
  assert.equal(kit.name, "Radio Cache 3");
  assert.equal(kit.createdAt, T1);
  assert.deepEqual(record.kits().map(k => k.name), ["Radio Cache 3"]);
  assert.equal(record.kit(kit.id).name, "Radio Cache 3");
});

test("a Kit name is trimmed and cannot be blank", () => {
  const record = new KitRecord();
  assert.equal(record.createKit("  EOC Laptops  ", T1).kit.name, "EOC Laptops");
  const blank = record.createKit("   ", T1);
  assert.equal(blank.outcome, "refused");
  assert.match(blank.reason, /name/i);
  assert.equal(record.kits().length, 1);
});

test("Kits are listed in the order they were created", () => {
  const record = new KitRecord();
  record.createKit("B", T1);
  record.createKit("A", T2);
  assert.deepEqual(record.kits().map(k => k.name), ["B", "A"]);
});

test("adding a Serial adds an Item with its scanned-at time, in scan order", () => {
  const record = new KitRecord();
  const { kit } = record.createKit("Radio Cache 3", T1);
  const first = record.addItem(kit.id, "SN-001", T2);
  const second = record.addItem(kit.id, "SN-002", T3);
  assert.equal(first.outcome, "added");
  assert.equal(second.outcome, "added");
  assert.deepEqual(
    record.kit(kit.id).items.map(i => [i.serial, i.scannedAt]),
    [["SN-001", T2], ["SN-002", T3]],
  );
});

test("a Serial is trimmed, and a blank Serial is refused", () => {
  const record = new KitRecord();
  const { kit } = record.createKit("K", T1);
  assert.equal(record.addItem(kit.id, "  SN-9 \n", T2).item.serial, "SN-9");
  const blank = record.addItem(kit.id, "   ", T2);
  assert.equal(blank.outcome, "refused");
  assert.match(blank.reason, /Serial/);
  assert.equal(record.kit(kit.id).items.length, 1);
});

test("Items go only into the Kit they were added to", () => {
  const record = new KitRecord();
  const { kit: a } = record.createKit("A", T1);
  const { kit: b } = record.createKit("B", T1);
  record.addItem(a.id, "SN-1", T2);
  assert.equal(record.kit(a.id).items.length, 1);
  assert.equal(record.kit(b.id).items.length, 0);
});

test("adding to a Kit that doesn't exist throws", () => {
  assert.throws(() => new KitRecord().addItem("nope", "SN-1", T1), /Kit/);
});

test("the record survives a round trip through its JSON document", () => {
  const record = new KitRecord();
  const { kit } = record.createKit("Radio Cache 3", T1);
  record.addItem(kit.id, "SN-001", T2);
  const json = JSON.stringify(record.toJSON());
  const back = KitRecord.fromJSON(JSON.parse(json));
  assert.deepEqual(back.toJSON(), record.toJSON());
  assert.equal(back.kit(kit.id).items[0].serial, "SN-001");
});

test("reading what you were given can't change the record", () => {
  const record = new KitRecord();
  const { kit } = record.createKit("K", T1);
  record.kits()[0].name = "changed";
  record.kit(kit.id).items.push({ serial: "sneaky" });
  assert.equal(record.kit(kit.id).name, "K");
  assert.equal(record.kit(kit.id).items.length, 0);
});

test("an Item keeps the code format it was read from; a typed Serial has none", () => {
  const record = new KitRecord();
  const { kit } = record.createKit("K", T1);
  assert.equal(record.addItem(kit.id, "K9P2207731", T2, { format: "code_128" }).item.format, "code_128");
  assert.equal(record.addItem(kit.id, "TYPED-1", T3).item.format, undefined);
  assert.deepEqual(record.kit(kit.id).items.map(i => i.format), ["code_128", undefined]);
});

test("line breaks inside a Serial are kept; only the ends are trimmed", () => {
  const record = new KitRecord();
  const { kit } = record.createKit("K", T1);
  const { item } = record.addItem(kit.id, "\nMake: Motorola\nSerial: 475CTV1293\n ", T2, { format: "qr_code" });
  assert.equal(item.serial, "Make: Motorola\nSerial: 475CTV1293");
});

// ---- Managing Items and Kits ------------------------------------------------

/** A record with Kits A and B; A holds SN-1 and SN-2, B holds SN-9. */
function twoKits() {
  const record = new KitRecord();
  const { kit: a } = record.createKit("A", T1);
  const { kit: b } = record.createKit("B", T1);
  const sn1 = record.addItem(a.id, "SN-1", T2).item;
  const sn2 = record.addItem(a.id, "SN-2", T3).item;
  record.addItem(b.id, "SN-9", T3);
  return { record, a, b, sn1, sn2 };
}

test("adding a Serial already in this Kit is refused, naming it", () => {
  const { record, a } = twoKits();
  const result = record.addItem(a.id, "  SN-1 ", T3);
  assert.equal(result.outcome, "refused");
  assert.match(result.reason, /SN-1 is already in this Kit/);
  assert.equal(record.kit(a.id).items.length, 2);
});

test("adding a Serial already in another Kit needs confirming, naming that Kit", () => {
  const { record, a } = twoKits();
  const result = record.addItem(a.id, "SN-9", T3);
  assert.equal(result.outcome, "needs confirming");
  assert.deepEqual(result.kitNames, ["B"]);
  assert.match(result.reason, /SN-9 is already in B/);
  assert.equal(record.kit(a.id).items.length, 2, "nothing is saved until confirmed");

  const confirmed = record.addItem(a.id, "SN-9", T3, { confirmed: true });
  assert.equal(confirmed.outcome, "added");
  assert.deepEqual(record.kit(a.id).items.map(i => i.serial), ["SN-1", "SN-2", "SN-9"]);
});

test("the warning names every other Kit holding the Serial", () => {
  const { record, a, b } = twoKits();
  const { kit: c } = record.createKit("C", T1);
  record.addItem(a.id, "SN-X", T3);
  record.addItem(b.id, "SN-X", T3, { confirmed: true });
  const result = record.addItem(c.id, "SN-X", T3);
  assert.deepEqual(result.kitNames, ["A", "B"]);
  assert.match(result.reason, /A and B/);
});

test("Serials match exactly: a different case isn't a duplicate", () => {
  const { record, a } = twoKits();
  assert.equal(record.addItem(a.id, "sn-1", T3).outcome, "added");
});

test("editing an Item changes its Serial and values but keeps its place and scanned-at time", () => {
  const { record, a, sn1 } = twoKits();
  const result = record.editItem(a.id, sn1.id, " SN-1A ");
  assert.equal(result.outcome, "done");
  const items = record.kit(a.id).items;
  assert.deepEqual(items.map(i => i.serial), ["SN-1A", "SN-2"]);
  assert.equal(items[0].scannedAt, T2);
});

test("saving an Item with its own Serial unchanged is not a duplicate", () => {
  const { record, a, sn1 } = twoKits();
  assert.equal(record.editItem(a.id, sn1.id, "SN-1").outcome, "done");
});

test("editing to a Serial already in this Kit is refused", () => {
  const { record, a, sn1 } = twoKits();
  const result = record.editItem(a.id, sn1.id, "SN-2");
  assert.equal(result.outcome, "refused");
  assert.match(result.reason, /SN-2 is already in this Kit/);
  assert.equal(record.kit(a.id).items[0].serial, "SN-1");
});

test("editing to a Serial in another Kit needs confirming, then saves", () => {
  const { record, a, sn1 } = twoKits();
  const result = record.editItem(a.id, sn1.id, "SN-9");
  assert.equal(result.outcome, "needs confirming");
  assert.deepEqual(result.kitNames, ["B"]);
  assert.equal(record.kit(a.id).items[0].serial, "SN-1");
  assert.equal(record.editItem(a.id, sn1.id, "SN-9", { confirmed: true }).outcome, "done");
  assert.equal(record.kit(a.id).items[0].serial, "SN-9");
});

test("editing an Item already confirmed into two Kits doesn't ask again unless its Serial changes", () => {
  const { record, a } = twoKits();
  const { item } = record.addItem(a.id, "SN-9", T3, { confirmed: true });
  assert.equal(record.editItem(a.id, item.id, "SN-9").outcome, "done");
  assert.equal(record.editItem(a.id, item.id, "SN-9X").outcome, "done");
  assert.equal(record.editItem(a.id, item.id, "SN-9").outcome, "needs confirming");
});

test("one Item can be looked up by its Kit and id", () => {
  const { record, a, b, sn2 } = twoKits();
  assert.equal(record.item(a.id, sn2.id).serial, "SN-2");
  assert.equal(record.item(b.id, sn2.id), undefined);
  assert.equal(record.item("nope", sn2.id), undefined);
});

test("editing to a blank Serial is refused", () => {
  const { record, a, sn1 } = twoKits();
  assert.equal(record.editItem(a.id, sn1.id, "  ").outcome, "refused");
});

test("a Serial changed by hand no longer counts as read from a code", () => {
  const record = new KitRecord();
  const { kit } = record.createKit("K", T1);
  const { item } = record.addItem(kit.id, "K9P2207731", T2, { format: "code_128" });
  record.editItem(kit.id, item.id, "K9P2207731");
  assert.equal(record.kit(kit.id).items[0].format, "code_128");
  record.editItem(kit.id, item.id, "K9P2207732");
  assert.equal(record.kit(kit.id).items[0].format, undefined);
});

test("editing an Item's Field values grows the Pick list", () => {
  const record = new KitRecord();
  const make = record.addField("Make").field;
  const { kit } = record.createKit("K", T1);
  const { item } = record.addItem(kit.id, "SN-1", T2, { values: { [make.id]: "Motorola" } });
  record.editItem(kit.id, item.id, "SN-1", { values: { [make.id]: "Kenwood" } });
  assert.deepEqual(record.kit(kit.id).items[0].values, { [make.id]: "Kenwood" });
  assert.deepEqual(record.fields()[0].picks, ["Kenwood", "Motorola"]);
});

test("deleting an Item leaves the rest in scan order", () => {
  const { record, a, sn1 } = twoKits();
  record.addItem(a.id, "SN-3", T3);
  assert.equal(record.deleteItem(a.id, sn1.id).outcome, "done");
  assert.deepEqual(record.kit(a.id).items.map(i => i.serial), ["SN-2", "SN-3"]);
  // Once deleted, the Serial can be added again.
  assert.equal(record.addItem(a.id, "SN-1", T3).outcome, "added");
});

test("a Kit can be renamed, but not to a blank name", () => {
  const { record, a } = twoKits();
  assert.equal(record.renameKit(a.id, "  Radio Cache 3 ").outcome, "done");
  assert.equal(record.kit(a.id).name, "Radio Cache 3");
  const blank = record.renameKit(a.id, " ");
  assert.equal(blank.outcome, "refused");
  assert.equal(record.kit(a.id).name, "Radio Cache 3");
});

test("Kit Notes can be added, edited and cleared", () => {
  const { record, a } = twoKits();
  record.setKitNotes(a.id, "  Shelf B2\nCheck batteries  ");
  assert.equal(record.kit(a.id).notes, "Shelf B2\nCheck batteries");
  record.setKitNotes(a.id, "Shelf C1");
  assert.equal(record.kit(a.id).notes, "Shelf C1");
  record.setKitNotes(a.id, "   ");
  assert.equal(record.kit(a.id).notes, undefined);
});

test("deleting a Kit removes it and its Items, so its Serials no longer warn", () => {
  const { record, a, b } = twoKits();
  record.deleteKit(b.id);
  assert.deepEqual(record.kits().map(k => k.name), ["A"]);
  assert.equal(record.addItem(a.id, "SN-9", T3).outcome, "added");
});
