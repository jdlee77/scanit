// The app's file list and version fingerprint, read the same way by the stamp script and the tests.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { join } from "node:path";

export const ROOT = join(new URL(".", import.meta.url).pathname, "..");
export const APP_FILES_PATH = join(ROOT, "app-files.js");

/** { version, files } as written in app-files.js. */
export function readAppFiles() {
  const self = {};
  runInNewContext(readFileSync(APP_FILES_PATH, "utf8"), { self });
  return { version: self.APP_VERSION, files: self.APP_FILES };
}

/** The fingerprint the files have now: a short hash of the list and every file's contents. */
export function appVersion() {
  const hash = createHash("sha256");
  for (const file of readAppFiles().files) {
    hash.update(file).update("\0").update(readFileSync(join(ROOT, file))).update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}
