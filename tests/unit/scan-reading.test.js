// The scanner's pure parts: format names, repeat filtering, the aiming box, and camera choice.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatId, formatName, isProductCode, RepeatFilter, aimRect, closeUpCamera, stillShotDue, sharpen,
} from "../../src/scan-reading.js";

test("reader format names become one id each, with a friendly name", () => {
  assert.equal(formatId("QRCode"), "qr_code");
  assert.equal(formatId("MicroQRCode"), "qr_code");
  assert.equal(formatId("Code39Ext"), "code_39");
  assert.equal(formatId("data_matrix"), "data_matrix"); // the phone's built-in reader already uses ids
  assert.equal(formatName("ean_13"), "EAN-13");
  assert.equal(formatName("code_128"), "Code 128");
  assert.equal(formatName("something_new"), "something_new");
});

test("UPC and EAN are product codes; serial-label formats are not", () => {
  for (const f of ["upc_a", "upc_e", "ean_13", "ean_8"]) assert.equal(isProductCode(f), true, f);
  for (const f of ["code_128", "code_39", "qr_code", "data_matrix", undefined]) assert.equal(isProductCode(f), false, String(f));
});

test("the same code held in view isn't reported again within 2.5 seconds", () => {
  const filter = new RepeatFilter(2500);
  assert.equal(filter.isNew("A", 0), true);
  assert.equal(filter.isNew("A", 1000), false);
  assert.equal(filter.isNew("A", 3000), false, "still in view: each sighting restarts the 2.5 s");
  assert.equal(filter.isNew("A", 5600), true, "out of view for over 2.5 s, so it counts again");
  assert.equal(filter.isNew("B", 5700), true, "a different code always counts");
});

test("a code still in view after a pause isn't reported again", () => {
  const filter = new RepeatFilter(2500);
  filter.isNew("A", 0);
  filter.stillSeen(20000); // e.g. back from the Item form
  assert.equal(filter.isNew("A", 21000), false);
  filter.forget();
  assert.equal(filter.isNew("A", 21100), true);
});

test("the aiming box maps to the matching part of the camera picture", () => {
  // A 4:3 picture shown in a 4:3 viewer: the box is the same fraction of both.
  assert.deepEqual(aimRect(1280, 960, 400, 300, { top: 0.25, side: 0.08 }, 0),
    { x: 102, y: 240, w: 1075, h: 480 });
  // A 16:9 picture in a 4:3 viewer: the sides are cropped off screen, so the box sits in the visible middle.
  const r = aimRect(1920, 1080, 400, 300, { top: 0.25, side: 0.08 }, 0);
  assert.equal(r.y, 270);
  assert.equal(r.h, 540);
  assert.equal(r.x, 240 + Math.round(1440 * 0.08));
});

test("the aiming box grows a little but stays inside the picture", () => {
  const r = aimRect(1000, 1000, 100, 100, { top: 0.01, side: 0.01 });
  assert.deepEqual(r, { x: 0, y: 0, w: 1000, h: 1000 });
});

test("the iPhone's close-up camera is the triple, else the dual wide", () => {
  const cam = (deviceId, label) => ({ deviceId, label });
  assert.equal(closeUpCamera([cam("1", "Back Camera"), cam("2", "Back Dual Wide Camera"), cam("3", "Back Triple Camera")]).deviceId, "3");
  assert.equal(closeUpCamera([cam("1", "Back Camera"), cam("2", "Back Dual Wide Camera")]).deviceId, "2");
  assert.equal(closeUpCamera([cam("1", "camera2 0, facing back")]), null);
});

test("an automatic still shot is due after 2.5 seconds with nothing read", () => {
  assert.equal(stillShotDue(1000, 3400), false);
  assert.equal(stillShotDue(1000, 3501), true);
});

test("sharpening greys the picture and strengthens edges", () => {
  // One row: dark, dark, light, light (RGBA).
  const px = v => [v, v, v, 255];
  const data = new Uint8ClampedArray([...px(50), ...px(50), ...px(200), ...px(200)]);
  sharpen(data, 4, 1, 1, 1.5);
  const grey = [0, 4, 8, 12].map(i => data[i]);
  assert.ok(grey[1] < 50, "the dark side of the edge gets darker");
  assert.ok(grey[2] > 200, "the light side of the edge gets lighter");
  assert.equal(data[3], 255, "transparency is left alone");
});
