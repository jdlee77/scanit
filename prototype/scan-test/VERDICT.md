# Scan test: verdict

**Question:** do labels scan reliably on Jon's iPhone and Android phone, and what do they contain?

**Answer (2026-11-26):** yes for scanning. All 16 codes on the printed test sheet (`test-sheet.pdf`) scanned on both phones: QR (including 14 mm), UPC-A, EAN-13, Code 128 (including 22 mm), Code 39 and Data Matrix (including 11 mm).

What it took, carried into the real app:
- v1 (whole frame, one pass per frame) read nothing on real phones.
- v2 approach works: read only the area under the aiming box, cycle reading strategies (box, enlarged, whole picture, high contrast, sharpened), automatic still shot after 2.5 s with no read, tap for a still shot, zoom starting at 2x, ZXing (zxing-wasm 3.1.6) plus the phone's built-in reader where present.
- v3 fix: open the camera once, never close and reopen it straight away (phones refuse); fall back to simpler camera requests.
- UPC-A reads come back as 13-digit EAN-13 with a leading 0.

**Still open:** what Jon's real equipment labels contain (barcode types, prefixes, extra QR content). Not tested yet; the app lets the Serial be corrected before saving, so this doesn't block building.
