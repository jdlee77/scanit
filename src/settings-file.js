// Settings file: the Fields and their Pick lists as a JSON file, to keep a copy off the phone
// or load on another phone. Kits are never part of it. Checking and merging the loaded Settings
// is the Kit record's job (mergeSettings), which turns away anything that isn't Settings.
import { dateStamp } from "./files.js";

export const SETTINGS_TYPE = "application/json";
// Marks the file as scanit Settings. (version is for telling formats apart if the file ever changes.)
const MARK = { app: "scanit", kind: "settings", version: 1 };

export function settingsFileText(record) {
  return JSON.stringify({ ...MARK, ...record.settings() }, null, 2) + "\n";
}

/** The Settings in a file's text, for the Kit record to merge; null if it isn't a scanit Settings file. */
export function readSettingsFile(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return null; }
  return doc?.app === MARK.app && doc?.kind === MARK.kind ? { fields: doc.fields } : null;
}

export const settingsFileName = date => `scanit-settings-${dateStamp(date)}.json`;
