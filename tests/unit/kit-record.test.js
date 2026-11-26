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
  const kit = record.createKit("Radio Cache 3", T1);
  assert.equal(kit.name, "Radio Cache 3");
  assert.equal(kit.createdAt, T1);
  assert.deepEqual(record.kits().map(k => k.name), ["Radio Cache 3"]);
  assert.equal(record.kit(kit.id).name, "Radio Cache 3");
});

test("a Kit name is trimmed and cannot be blank", () => {
  const record = new KitRecord();
  assert.equal(record.createKit("  EOC Laptops  ", T1).name, "EOC Laptops");
  assert.throws(() => record.createKit("   ", T1), /name/i);
});

test("Kits are listed in the order they were created", () => {
  const record = new KitRecord();
  record.createKit("B", T1);
  record.createKit("A", T2);
  assert.deepEqual(record.kits().map(k => k.name), ["B", "A"]);
});

test("adding a Serial adds an Item with its scanned-at time, in scan order", () => {
  const record = new KitRecord();
  const kit = record.createKit("Radio Cache 3", T1);
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
  const kit = record.createKit("K", T1);
  assert.equal(record.addItem(kit.id, "  SN-9 \n", T2).item.serial, "SN-9");
  const blank = record.addItem(kit.id, "   ", T2);
  assert.equal(blank.outcome, "refused");
  assert.equal(record.kit(kit.id).items.length, 1);
});

test("Items go only into the Kit they were added to", () => {
  const record = new KitRecord();
  const a = record.createKit("A", T1);
  const b = record.createKit("B", T1);
  record.addItem(a.id, "SN-1", T2);
  assert.equal(record.kit(a.id).items.length, 1);
  assert.equal(record.kit(b.id).items.length, 0);
});

test("adding to a Kit that doesn't exist throws", () => {
  assert.throws(() => new KitRecord().addItem("nope", "SN-1", T1), /Kit/);
});

test("the record survives a round trip through its JSON document", () => {
  const record = new KitRecord();
  const kit = record.createKit("Radio Cache 3", T1);
  record.addItem(kit.id, "SN-001", T2);
  const json = JSON.stringify(record.toJSON());
  const back = KitRecord.fromJSON(JSON.parse(json));
  assert.deepEqual(back.toJSON(), record.toJSON());
  assert.equal(back.kit(kit.id).items[0].serial, "SN-001");
});

test("reading what you were given can't change the record", () => {
  const record = new KitRecord();
  const kit = record.createKit("K", T1);
  record.kits()[0].name = "changed";
  record.kit(kit.id).items.push({ serial: "sneaky" });
  assert.equal(record.kit(kit.id).name, "K");
  assert.equal(record.kit(kit.id).items.length, 0);
});
