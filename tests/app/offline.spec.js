// Working offline, installing to the home screen, keeping stored data, and picking up new versions.
import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtempSync, cpSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, dirname } from "node:path";
import { SCAN_VIDEO } from "./fake-camera.js";
import { FAKE_CAMERA_ARGS, createKit, serialBox, openWorkbook, sheetRows } from "./helpers.js";
import { ROOT, readAppFiles } from "../../tools/app-version.js";

test.use({ launchOptions: { args: [...FAKE_CAMERA_ARGS, `--use-file-for-fake-video-capture=${SCAN_VIDEO}`] } });

/** Wait until the service worker looks after this page: every app file is then on the phone. */
const waitForOffline = page => page.waitForFunction(() => navigator.serviceWorker.controller !== null);

test("after a first visit, scanit opens, scans and exports with the network off", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Kits" })).toBeVisible();
  await waitForOffline(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Kits" })).toBeVisible();
  await createKit(page, "Basement Cage");
  await page.reload(); // a Kit's own address opens offline too
  await expect(page.getByRole("heading", { level: 1, name: "Basement Cage" })).toBeVisible();

  // Scanning needs the code reader and its .wasm file, both kept on the phone.
  await page.getByRole("button", { name: "Scan" }).click();
  await expect(serialBox(page)).not.toHaveValue("", { timeout: 20000 });
  const serial = await serialBox(page).inputValue();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".items .serial")).toHaveText([serial]);

  await page.getByRole("link", { name: "All Kits" }).click();
  await page.getByRole("button", { name: "Export" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export" }).click(),
  ]);
  const book = await openWorkbook(download);
  expect(book.worksheets.map(s => s.name)).toEqual(["Summary", "Basement Cage"]);
  expect(sheetRows(book.getWorksheet("Basement Cage"))[1][0]).toBe(serial);
});

test("Chrome finds scanit installable: valid manifest, icons and offline support", async ({ page }) => {
  await page.goto("/");
  await waitForOffline(page);
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  expect(installabilityErrors).toEqual([]);
  const { url, data } = await cdp.send("Page.getAppManifest");
  expect(url).toMatch(/manifest\.webmanifest$/);
  expect(JSON.parse(data).display).toBe("standalone");
});

test.describe("on an iPhone", () => {
  test.use({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1" });

  test("the home-screen prompt gives the Share steps and the seven-day reason; dismissed, it stays gone", async ({ page }) => {
    await page.goto("/");
    const prompt = page.getByRole("complementary", { name: "Add scanit to your home screen" });
    await expect(prompt).toContainText("tap Share");
    await expect(prompt).toContainText("Add to Home Screen");
    await expect(prompt).toContainText("seven days");
    await prompt.getByRole("button", { name: "Dismiss" }).click();
    await expect(prompt).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Kits" })).toBeVisible();
    await expect(prompt).toHaveCount(0);
  });

  test("opened from the home screen, there's no prompt", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Kits" })).toBeVisible();
    await expect(page.locator(".home-prompt")).toHaveCount(0);
  });
});

test("elsewhere, the prompt explains installing from the browser's menu", async ({ page }) => {
  await page.goto("/");
  const prompt = page.getByRole("complementary", { name: "Add scanit to your home screen" });
  await expect(prompt).toContainText("Install scanit as an app");
  await expect(prompt).toContainText("Add to Home screen");
});

for (const [what, answer] of [["refuses", "return false"], ["can't be asked", "throw new Error('no')"]]) {
  test(`scanit asks to keep its stored data, and works when the browser ${what}`, async ({ page }) => {
    await page.addInitScript(answer => {
      window.__persistAsked = 0;
      navigator.storage.persisted = async () => false;
      navigator.storage.persist = new Function(`window.__persistAsked++; ${answer}`);
    }, answer);
    await page.goto("/");
    await createKit(page, "Radios");
    await expect.poll(() => page.evaluate(() => window.__persistAsked)).toBe(1);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Radios" })).toBeVisible();
  });
}

// ---- New versions --------------------------------------------------------------------------

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png",
  ".wasm": "application/wasm", ".webmanifest": "application/manifest+json" };

/** A copy of the app in a temporary folder, served on its own port, so the test can publish a new version. */
async function servedCopy() {
  const dir = mkdtempSync(join(tmpdir(), "scanit-"));
  for (const file of [...readAppFiles().files, "sw.js", "app-files.js"]) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    cpSync(join(ROOT, file), join(dir, file));
  }
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/$/, "/index.html");
    try {
      const body = readFileSync(join(dir, path));
      res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    /** Publish a new version: change the page's title and stamp a new APP_VERSION. */
    publish(title) {
      const edit = (file, change) => writeFileSync(join(dir, file), change(readFileSync(join(dir, file), "utf8")));
      edit("index.html", html => html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`));
      edit("app-files.js", js => js.replace(/APP_VERSION = "[^"]*"/, `APP_VERSION = "${title}"`));
    },
    close() { server.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

test("a new version is picked up on a later visit, and stored Kits survive the update", async ({ page }) => {
  const site = await servedCopy();
  try {
    await page.goto(site.url);
    await createKit(page, "Radio Cache 3");
    await page.getByRole("link", { name: "All Kits" }).click();
    await waitForOffline(page);
    await expect(page).toHaveTitle("scanit");

    site.publish("scanit v2");
    // The next visit finds the new version and fetches it in the background, still running the old one.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Kits" })).toBeVisible();
    await expect(page).toHaveTitle("scanit");
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state),
      { timeout: 15000 }).toBe("installed");

    // The visit after that runs the new version, with the Kit still there.
    await page.reload();
    await expect(page).toHaveTitle("scanit v2");
    await expect(page.locator(".kits .name")).toHaveText(["Radio Cache 3"]);
  } finally {
    site.close();
  }
});
