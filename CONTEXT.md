# scanit

A phone-based tool for recording the equipment in a Kit by scanning each Item's UPC or QR code, then handing the record off as an Excel workbook.

## Language

**Kit**:
A named group of Items recorded together, such as "Radio Cache 3", with optional Notes. A Kit stays open for changes until it is deleted.
_Avoid_: group, set, batch

**Item**:
One physical piece of equipment in a Kit, identified by its Serial and described by its Field values. A Serial appears at most once in a Kit, but may appear in more than one Kit.
_Avoid_: scan, entry, record

**Scan**:
The act of reading a UPC or QR code with the phone's camera to capture a Serial.
_Avoid_: using "scan" to mean the Item it produced

**Serial**:
The full contents of an Item's scanned code, which the user may correct before saving.
_Avoid_: barcode, code, ID

**Field**:
A named detail recorded for every Item besides its Serial, such as Make or Model. There is one shared list of Fields for all Kits.
_Avoid_: column, property, attribute

**Pick list**:
The remembered values for one Field, growing each time a new value is entered, offered back as choices later.
_Avoid_: dropdown, options

**Settings**:
The Fields and their Pick lists. Settings can be saved to and loaded from a Settings file; Kits are not part of Settings.

**Export**:
An Excel workbook holding a Summary sheet listing the included Kits, then one sheet per Kit. The Export is the only copy of Kit data that exists off the phone.
_Avoid_: backup, report
