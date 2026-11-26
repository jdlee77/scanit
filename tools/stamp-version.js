// Updates APP_VERSION in app-files.js: a fingerprint of every app file.
// Run after changing any app file: npm run stamp
// A new fingerprint changes app-files.js, which is how phones learn there's a new version to fetch.
import { readFileSync, writeFileSync } from "node:fs";
import { appVersion, APP_FILES_PATH } from "./app-version.js";

const text = readFileSync(APP_FILES_PATH, "utf8");
const version = appVersion();
const stamped = text.replace(/self\.APP_VERSION = "[^"]*";/, `self.APP_VERSION = "${version}";`);
writeFileSync(APP_FILES_PATH, stamped);
console.log(stamped === text ? `Already stamped: ${version}` : `Stamped version ${version}`);
