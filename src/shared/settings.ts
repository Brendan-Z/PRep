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
  baseUrl: "https://portkey.aipe.cba/v1",
  // Empty: the model below is a full Model-Catalog slug ("@provider/model"), so it
  // already carries the provider — sending a separate x-portkey-provider header
  // would conflict with it.
  provider: "",
  // Bedrock Claude Haiku 4.5 (US cross-region inference profile), routed via the
  // @bedrock-eus2 Model-Catalog provider. Confirm the exact id in the popup.
  model: "@bedrock-eus2/us.anthropic.claude-haiku-4-5-20251001-v1:0",
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
