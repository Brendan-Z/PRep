import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "../package.json";

// Typed MV3 manifest. CRXJS resolves the TS entry points below into built assets.
// prep.png lives in public/ (Vite copies it verbatim to the dist root).
export default defineManifest({
  manifest_version: 3,
  name: "PRep",
  version: pkg.version,
  description:
    "Click a changed code block in any GitHub PR and get quizzed on what it does. Powered by Portkey.",
  icons: { "16": "prep.png", "32": "prep.png", "48": "prep.png", "128": "prep.png" },
  permissions: ["storage"],
  host_permissions: ["https://*/*"],
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["https://*/*"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
    },
  ],
  action: {
    default_title: "PRep — settings",
    default_popup: "src/popup/index.html",
    default_icon: { "16": "prep.png", "32": "prep.png", "48": "prep.png", "128": "prep.png" },
  },
});
