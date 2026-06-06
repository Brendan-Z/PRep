import { test as base, chromium, type BrowserContext } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../../dist");

// Loads the built extension into a persistent Chromium context and seeds the
// Portkey settings into chrome.storage.local (via the real popup) so the content
// script can generate quizzes during the test.
export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      headless: false, // MV3 requires headed; CI wraps this in xvfb
      args: [
        `--disable-extensions-except=${DIST}`,
        `--load-extension=${DIST}`,
        "--headless=new",
      ],
    });
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    // The service worker registration carries the extension id.
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker");
    const extensionId = new URL(sw.url()).host;

    // Seed settings through the popup so we exercise the real save path.
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await popup.fill("#baseUrl", process.env.PORTKEY_BASE_URL ?? "");
    await popup.fill("#apiKey", process.env.PORTKEY_API_KEY ?? "");
    await popup.fill("#model", process.env.PORTKEY_MODEL ?? "");
    await popup.click("#save");
    await popup.close();

    await use(extensionId);
  },
});

export const expect = test.expect;
