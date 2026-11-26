// Settings file: the Fields and their Pick lists as a JSON file, to keep a copy off the phone
// or load on another phone. Kits are never part of it. Merging the loaded Settings is the
// Kit record's job (mergeSettings).
import { dateStamp } from "./files.js";

export const SETTINGS_TYPE = "application/json";
const MARK = { app: "scanit", kind: "settings", version: 1 };

export function settingsFileText(record) {
  return JSON.stringify({ ...MARK, ...record.settings() }, null, 2) + "\n";
}

/** The Settings in a file's text, or throws an error whose message can be shown to the user. */
export function readSettingsFile(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { doc = null; }
  if (doc?.app !== MARK.app || doc?.kind !== MARK.kind) throw new Error("That file isn't a scanit Settings file.");
  return { fields: doc.fields };
}

export const settingsFileName = date => `scanit-settings-${dateStamp(date)}.json`;
