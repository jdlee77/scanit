// Rewrites app-files.js: the list of app files and their version fingerprint.
// Run after changing, adding or removing any app file: npm run stamp
// A new fingerprint changes app-files.js, which is how phones learn there's a new version to fetch.
import { readFileSync, writeFileSync } from "node:fs";
import { APP_FILES_PATH, appFilesText, appVersion } from "./app-version.js";

const before = readFileSync(APP_FILES_PATH, "utf8");
const after = appFilesText();
writeFileSync(APP_FILES_PATH, after);
console.log(after === before ? `Already up to date: version ${appVersion()}` : `Stamped version ${appVersion()}`);
