// Settings controller for the toolbar popup. Three fields: Portkey URL, API key,
// model. Saved to chrome.storage.local; the background worker reads them.

import { loadPopupSettings, savePopupSettings } from "../shared/settings";
import { sendMessage, type TestKeyResponse } from "../shared/messages";

const input = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
const statusEl = document.getElementById("status")!;

function setStatus(msg: string, kind = ""): void {
  statusEl.textContent = msg || "";
  statusEl.className = kind;
}

async function load(): Promise<void> {
  const s = await loadPopupSettings();
  input("apiKey").value = s.apiKey;
  input("model").value = s.model;
  input("baseUrl").value = s.baseUrl;
}

async function save(): Promise<void> {
  await savePopupSettings({
    baseUrl: input("baseUrl").value,
    apiKey: input("apiKey").value,
    model: input("model").value,
  });
}

document.getElementById("save")!.addEventListener("click", async () => {
  await save();
  setStatus("Saved.", "ok");
});

document.getElementById("test")!.addEventListener("click", async () => {
  await save();
  setStatus("Testing connection…");
  try {
    const res = await sendMessage<TestKeyResponse>({ type: "TEST_KEY" });
    if (res?.ok) setStatus("✓ Connection OK — Portkey responded.", "ok");
    else setStatus("✗ " + (res?.error || "Test failed."), "bad");
  } catch (e) {
    setStatus("✗ " + String(e instanceof Error ? e.message : e), "bad");
  }
});

load();
