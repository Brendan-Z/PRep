// Settings persistence. The background worker reads the full Settings; the popup
// reads/writes the three user-facing fields. Provider is no longer surfaced in
// the UI but is still read (falling back to DEFAULTS) so Portkey routing works.

export interface Settings {
  apiKey: string;
  provider: string;
  model: string;
  baseUrl: string;
}

export const DEFAULTS = {
  baseUrl: "https://api.portkey.ai/v1",
  provider: "@bedrock-eus1",
  // Bedrock Claude Sonnet 4.6 (US cross-region inference profile). Confirm the
  // exact id for your account in the popup — this is a sensible placeholder.
  model: "us.anthropic.claude-sonnet-4-6-20250929-v1:0",
} as const;

type StoredSettings = Record<string, string | undefined>;

export async function getSettings(): Promise<Settings> {
  const s = (await chrome.storage.local.get([
    "portkeyApiKey",
    "provider",
    "model",
    "baseUrl",
  ])) as StoredSettings;
  return {
    apiKey: s.portkeyApiKey || "",
    provider: s.provider || DEFAULTS.provider,
    model: s.model || DEFAULTS.model,
    baseUrl: (s.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, ""),
  };
}

export interface PopupSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export async function loadPopupSettings(): Promise<PopupSettings> {
  const s = (await chrome.storage.local.get([
    "portkeyApiKey",
    "model",
    "baseUrl",
  ])) as StoredSettings;
  return {
    apiKey: s.portkeyApiKey || "",
    model: s.model || "",
    baseUrl: s.baseUrl || "",
  };
}

export async function savePopupSettings(values: PopupSettings): Promise<void> {
  await chrome.storage.local.set({
    portkeyApiKey: values.apiKey.trim(),
    model: values.model.trim(),
    baseUrl: values.baseUrl.trim(),
  });
}
