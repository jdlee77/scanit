// The tour: offered on first visit, stepped through, reopened from Help; and the author credit.
import { test, expect } from "@playwright/test";
import { TOUR_STEPS } from "../../src/tour.js";

const offer = page => page.getByRole("complementary", { name: "Take the tour" });

test("a first visit offers the tour; it walks through every step and ends on the Kit list", async ({ page }) => {
  await page.goto("/");
  await expect(offer(page)).toContainText("New to scanit?");
  await offer(page).getByRole("link", { name: "Take the tour" }).click();

  for (const [i, step] of TOUR_STEPS.entries()) {
    await expect(page.getByText(`Step ${i + 1} of ${TOUR_STEPS.length}`)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(step.title);
    await expect(page.locator(".tour-points li")).toHaveCount(step.points.length);
    // Every step fits a phone screen, with no sideways scrolling.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    if (i < TOUR_STEPS.length - 1) await page.getByRole("link", { name: "Next" }).click();
  }

  // Back works, and the last step credits the author.
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(TOUR_STEPS.at(-2).title);
  await page.getByRole("link", { name: "Next" }).click();
  await expect(page.locator(".made-by")).toHaveText("scanit by Jon Lee");

  await page.getByRole("link", { name: "Start using scanit" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Kits" })).toBeVisible();
  await expect(offer(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Kits" })).toBeVisible();
  await expect(offer(page)).toHaveCount(0);
});

test("the Fields step opens Settings, and Help brings the tour back", async ({ page }) => {
  await page.goto("/#help/2");
  await expect(page.getByRole("heading", { level: 1, name: "Set up your Fields" })).toBeVisible();
  await page.getByRole("link", { name: "Open Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

  await page.getByRole("link", { name: "All Kits" }).click();
  await page.getByRole("link", { name: "Help" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Welcome to scanit" })).toBeVisible();
  await page.getByRole("link", { name: "Skip tour" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Kits" })).toBeVisible();
});

test("Not now puts the offer away for good", async ({ page }) => {
  await page.goto("/");
  await offer(page).getByRole("button", { name: "Not now" }).click();
  await expect(offer(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Kits" })).toBeVisible();
  await expect(offer(page)).toHaveCount(0);
});

test("Jon Lee is credited as the author, linking to his contact page in a new tab", async ({ page }) => {
  for (const address of ["/", "/#settings"]) {
    await page.goto(address);
    const link = page.locator(".made-by").getByRole("link", { name: "Jon Lee" });
    await expect(link).toHaveAttribute("href", "https://jon-lee.carrd.co/");
    await expect(link).toHaveAttribute("target", "_blank");
  }
  await expect(page.locator('meta[name="author"]')).toHaveAttribute("content", "Jon Lee");
});
