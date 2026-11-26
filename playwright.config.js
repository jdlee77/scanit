// Playwright drives the real app in Chromium at phone size, served as plain static files.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/app",
  timeout: 30000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    ...devices["Pixel 7"],
    baseURL: "http://localhost:8790",
    timezoneId: "America/Los_Angeles",
    locale: "en-US",
    trace: "off",
  },
  webServer: {
    command: "python3 -m http.server 8790",
    url: "http://localhost:8790/index.html",
    reuseExistingServer: true,
    stdout: "ignore",
    stderr: "ignore",
  },
});
