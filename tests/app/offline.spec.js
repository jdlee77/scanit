// Working offline, installing to the home screen, keeping stored data, and picking up new versions.
import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtempSync, cpSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, dirname } from "node:path";
import { SCAN_VIDEO } from "./fake-camera.js";
import { FAKE_CAMERA_ARGS, createKit, serialBox, openWorkbook, sheetRows } from "./helpers.js";
import { ROOT, readAppFiles, appFilesText } from "../../tools/app-version.js";

test.use({ launchOptions: { args: [...FAKE_CAMERA_ARGS, `--use-file-for-fake-video-capture=${SCAN_VIDEO}`] } });

/** Wait until the service worker looks after this page: every app file is then on the phone. */
const waitForOffline = page => page.waitForFunction(() => navigator.serviceWorker.controller !== null);

test("after a first visit, scanit opens, scans and exports with the network off", async ({ page, context }) => {
  // First visit, online: record a Kit with one typed-in Item.
  await page.goto("/");
  await createKit(page, "Basement Cage");
  await page.getByRole("button", { name: "Type a Serial" }).click();
  await serialBox(page).fill("TYPED-1");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("link", { name: "All Kits" }).click();
  await waitForOffline(page);

  // No signal: the app opens, and the Kit saved earlier opens with its Item.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Kits" })).toBeVisible();
  await page.locator(".kits a").filter({ hasText: "Basement Cage" }).click();
  await expect(page.locator(".items .serial")).toHaveText(["TYPED-1"]);
  await page.reload(); // a Kit's own address opens offline too
  await expect(page.getByRole("heading", { level: 1, name: "Basement Cage" })).toBeVisible();

  // Scanning needs the code reader and its .wasm file, both kept on the phone.
  await page.getByRole("button", { name: "Scan" }).click();
  await expect(serialBox(page)).not.toHaveValue("", { timeout: 20000 });
  const serial = await serialBox(page).inputValue();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".items .serial")).toHaveText(["TYPED-1", serial]);

  await page.getByRole("link", { name: "All Kits" }).click();
  await page.getByRole("button", { name: "Export" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export" }).click(),
  ]);
  const book = await openWorkbook(download);
  expect(book.worksheets.map(s => s.name)).toEqual(["Summary", "Basement Cage"]);
  expect(sheetRows(book.getWorksheet("Basement Cage")).slice(1).map(r => r[0])).toEqual(["TYPED-1", serial]);
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
    await expect(prompt).toContainText("Tap Share");
    await expect(prompt).toContainText("Add to Home Screen");
    await expect(prompt).toContainText("seven days");
    await expect(prompt).toContainText("Do it before recording Kits");
    await prompt.getByRole("button", { name: "Dismiss" }).click();
    await expect(prompt).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Kits" })).toBeVisible();
    await expect(prompt).toHaveCount(0);
  });

  test("with Kits already in the browser, the prompt says they won't move across, so Export first", async ({ page }) => {
    await page.goto("/");
    await createKit(page, "Radios");
    await page.getByRole("link", { name: "All Kits" }).click();
    await expect(page.locator(".home-prompt")).toContainText("the Kit here won't move across, so Export first");
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
    await expect(page.getByRole("heading", { level: 1, name: "Kits" })).toBeVisible();
    expect(await page.evaluate(() => window.__persistAsked)).toBe(0); // not before there's anything to keep
    await createKit(page, "Radios");
    await expect.poll(() => page.evaluate(() => window.__persistAsked)).toBe(1);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Radios" })).toBeVisible();
  });
}

// ---- New versions --------------------------------------------------------------------------

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png",
  ".wasm": "application/wasm", ".webmanifest": "application/manifest+json" };

/**
 * A copy of the app in a temporary folder, served from /scanit/ on its own port (as GitHub Pages
 * serves a project), so a test can publish a new version.
 */
async function servedCopy() {
  const dir = mkdtempSync(join(tmpdir(), "scanit-"));
  const files = readAppFiles().files;
  for (const file of [...files, "sw.js", "app-files.js"]) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    cpSync(join(ROOT, file), join(dir, file));
  }
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path === "/scanit/" ? "index.html" : path.startsWith("/scanit/") ? path.slice("/scanit/".length) : null;
    try {
      if (!file) throw new Error("outside the site");
      const body = readFileSync(join(dir, file));
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/scanit/`,
    /** Publish a new version: change the page's title and stamp a new version. */
    publish(title) {
      const html = join(dir, "index.html");
      writeFileSync(html, readFileSync(html, "utf8").replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`));
      writeFileSync(join(dir, "app-files.js"), appFilesText(files, title));
    },
    close() { server.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

/** Wait until a new version has been fetched and is waiting to take over. */
const newVersionWaiting = page => expect.poll(() => page.evaluate(async () =>
  (await navigator.serviceWorker.getRegistration())?.waiting?.state), { timeout: 15000 }).toBe("installed");

/** Pretend the phone switched away from scanit and back, as when a home-screen app is resumed. */
const switchAwayAndBack = page => page.evaluate(() => {
  for (const hidden of [true, false]) {
    Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  }
});

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
    await newVersionWaiting(page);

    // The visit after that runs the new version, with the Kit still there.
    await page.reload();
    await expect(page).toHaveTitle("scanit v2");
    await expect(page.locator(".kits .name")).toHaveText(["Radio Cache 3"]);
  } finally {
    site.close();
  }
});

test("a home-screen app that's resumed, not reopened, switches to a new version on the Kit list", async ({ page }) => {
  const site = await servedCopy();
  try {
    await page.goto(site.url);
    await createKit(page, "Radio Cache 3");
    await waitForOffline(page);
    site.publish("scanit v2");

    // Resumed while a Kit is open: the new version is fetched, but nothing is interrupted.
    await switchAwayAndBack(page);
    await newVersionWaiting(page);
    await switchAwayAndBack(page);
    await expect(page.getByRole("heading", { level: 1, name: "Radio Cache 3" })).toBeVisible();
    await expect(page).toHaveTitle("scanit");

    // Resumed on the Kit list, with nothing typed: it switches over by itself.
    await page.getByRole("link", { name: "All Kits" }).click();
    await switchAwayAndBack(page);
    await expect(page).toHaveTitle("scanit v2");
    await expect(page.locator(".kits .name")).toHaveText(["Radio Cache 3"]);
  } finally {
    site.close();
  }
});

test("while another scanit window is open, the new version waits, and the page still opens", async ({ page, context }) => {
  const site = await servedCopy();
  try {
    await page.goto(site.url);
    await waitForOffline(page);
    const other = await context.newPage();
    await other.goto(site.url);
    site.publish("scanit v2");
    await page.reload();
    await newVersionWaiting(page);

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Kits" })).toBeVisible();
    await expect(page).toHaveTitle("scanit");

    // Once the other window closes, the next visit switches over.
    await other.close();
    await page.reload();
    await expect(page).toHaveTitle("scanit v2");
  } finally {
    site.close();
  }
});
