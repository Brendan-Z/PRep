// Settings controller for the toolbar popup. Three fields: Portkey URL, API key,
// model. Saved to chrome.storage.local; the background worker reads them.

import { loadPopupSettings, savePopupSettings } from "../shared/settings";
import { sendMessage, type TestKeyResponse } from "../shared/messages";
import { buildFeedbackUrl } from "../shared/feedback";

const input = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
const statusEl = document.getElementById("status")!;
const modeChip = document.getElementById("mode") as HTMLButtonElement;

type Mode = "quiz" | "learn";

function renderMode(m: Mode): void {
  modeChip.textContent = m === "learn" ? "Learn" : "Quiz";
  modeChip.classList.toggle("learn", m === "learn");
}

async function loadMode(): Promise<void> {
  const s = (await chrome.storage.local.get("prepMode")) as { prepMode?: string };
  renderMode(s.prepMode === "learn" ? "learn" : "quiz");
}

modeChip.addEventListener("click", async () => {
  const next: Mode = modeChip.classList.contains("learn") ? "quiz" : "learn";
  renderMode(next);
  await chrome.storage.local.set({ prepMode: next });
});

// Reflect changes made elsewhere (the on-page Cmd/Ctrl+Shift+L shortcut).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.prepMode) {
    renderMode(changes.prepMode.newValue === "learn" ? "learn" : "quiz");
  }
});

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

// Context-free feedback (no diff open): opens a prefilled GitHub issue in a new tab.
document.getElementById("feedback")!.addEventListener("click", (e) => {
  e.preventDefault();
  void chrome.tabs.create({
    url: buildFeedbackUrl({ version: chrome.runtime.getManifest().version }),
  });
});

load();
loadMode();
