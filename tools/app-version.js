// The app's offline file list and version fingerprint, worked out the same way by the stamp
// script (tools/stamp-version.js) and the tests.
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const APP_FILES_PATH = join(ROOT, "app-files.js");

const filesIn = (dir, keep) => readdirSync(join(ROOT, dir)).filter(keep).sort().map(name => `${dir}/${name}`);

/** Every file the app is made of: what the service worker keeps on the phone. */
export function appFiles() {
  return [
    "index.html",
    "manifest.webmanifest",
    ...filesIn("icons", name => name.endsWith(".png")),
    ...filesIn("src", () => true),
    ...filesIn("vendor", name => !name.startsWith("LICENSE")),
  ];
}

/**
 * The fingerprint of the app as it is now: a short hash of the file list, every file's contents,
 * and sw.js (which isn't kept in the cache but decides how it's used).
 * Line endings are ignored, so a Windows checkout gives the same fingerprint.
 */
export function appVersion(files = appFiles()) {
  const hash = createHash("sha256");
  for (const file of [...files, "sw.js"]) {
    let bytes = readFileSync(join(ROOT, file));
    if (!/\.(png|wasm)$/.test(file)) bytes = Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"));
    hash.update(file).update("\0").update(bytes).update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}

/** app-files.js as it should be now. */
export function appFilesText(files = appFiles(), version = appVersion(files)) {
  return `// Every file scanit needs, kept on the phone by the service worker (sw.js) so the app opens,
// scans and exports with no signal. Paths are relative to this folder.
//
// Written by \`npm run stamp\`: don't edit by hand. Run it after changing, adding or removing any
// app file. APP_VERSION is a fingerprint of all of them; a new one is how phones learn there's a
// new version. A test fails if this file is out of date.
self.APP_VERSION = ${JSON.stringify(version)};
self.APP_FILES = [
${files.map(f => `  ${JSON.stringify(f)},`).join("\n")}
];
`;
}

/** { version, files } as written in app-files.js now. */
export function readAppFiles() {
  const self = {};
  runInNewContext(readFileSync(APP_FILES_PATH, "utf8"), { self });
  return { version: self.APP_VERSION, files: self.APP_FILES };
}
