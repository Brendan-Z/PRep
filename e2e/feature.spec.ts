import { test } from "./fixtures/extension";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, "screenshots");

// A stable PRep PR used as the demo target. Public PR → no GitHub auth needed; if
// the repo is internal, GH_AUTH_STATE supplies a session (wired in the workflow).
const DEMO_PR = "https://github.com/Brendan-Z/PRep/pull/1/files";

// Baseline evidence: open a diff, click a changed hunk, and screenshot the card —
// including the ⚐ feedback button in the header. The triage agent extends this
// spec per feature so the visual-evidence workflow captures the new behaviour.
test("quiz card renders on a changed hunk", async ({ context, extensionId }) => {
  void extensionId;
  const page = await context.newPage();
  await page.goto(DEMO_PR, { waitUntil: "domcontentloaded" });

  // Click the first code line in the diff to open the card.
  const firstLine = page.locator(".blob-code-inner, .diff-text-inner").first();
  await firstLine.click();

  // The card lives in a shadow host appended to <body>.
  const host = page.locator("#pq-card-host");
  await host.waitFor({ state: "attached", timeout: 60_000 });

  await page.screenshot({ path: path.join(SHOTS, "card-on-hunk.png"), fullPage: false });
});
