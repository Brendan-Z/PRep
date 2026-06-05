import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./src/manifest.config";

// CRXJS reads the typed manifest, bundles the TS entry points (service worker,
// content script, popup) and emits a loadable MV3 extension into dist/.
export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
