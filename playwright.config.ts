import { defineConfig } from "@playwright/test";

// MV3 extensions only load in a persistent context with a real (headed) Chromium;
// CI runs this under xvfb. Screenshots land in e2e/screenshots and are committed to
// the PR branch by the pr-visual-evidence workflow.
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    actionTimeout: 30_000,
    screenshot: "off",
  },
});
