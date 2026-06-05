// popup.js — settings controller for the toolbar popup.
// Three fields only: Portkey URL, API key, model. Saved to chrome.storage.local;
// the background worker reads them when generating a quiz.

const $ = (id) => document.getElementById(id);
const statusEl = $("status");

function setStatus(msg, kind) {
  statusEl.textContent = msg || "";
  statusEl.className = kind || "";
}

async function load() {
  const s = await chrome.storage.local.get(["portkeyApiKey", "model", "baseUrl"]);
  $("apiKey").value = s.portkeyApiKey || "";
  $("model").value = s.model || "";
  $("baseUrl").value = s.baseUrl || "";
}

async function saveSettings() {
  await chrome.storage.local.set({
    portkeyApiKey: $("apiKey").value.trim(),
    model: $("model").value.trim(),
    baseUrl: $("baseUrl").value.trim(),
  });
}

$("save").addEventListener("click", async () => {
  await saveSettings();
  setStatus("Saved.", "ok");
});

$("test").addEventListener("click", async () => {
  await saveSettings();
  setStatus("Testing connection…", "");
  try {
    const res = await chrome.runtime.sendMessage({ type: "TEST_KEY" });
    if (res && res.ok) setStatus("✓ Connection OK — Portkey responded.", "ok");
    else setStatus("✗ " + ((res && res.error) || "Test failed."), "bad");
  } catch (e) {
    setStatus("✗ " + String((e && e.message) || e), "bad");
  }
});

load();
