// Low-level Portkey HTTP client. The service worker is the only origin that
// calls Portkey (it is CORS-exempt given host_permissions) and the only holder
// of the API key.

import type { Settings } from "../shared/settings";

const PER_ATTEMPT_TIMEOUT_MS = 20000; // each fetch stays under the worker's 30s fetch limit

// Shape of the OpenAI-compatible chat-completions response we read from.
export interface PortkeyResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<string | { text?: string }> | null;
      tool_calls?: Array<{ function?: { arguments?: string } }>;
    };
  }>;
}

// Provider routing header: an "@slug" goes in x-portkey-provider (Model Catalog),
// anything else is treated as a legacy virtual key.
export function providerHeaders(provider: string): Record<string, string> {
  const p = provider?.trim();
  if (p && p.startsWith("@")) return { "x-portkey-provider": p };
  if (p) return { "x-portkey-virtual-key": p };
  return {};
}

function endpoint(baseUrl: string): string {
  return `${baseUrl}/chat/completions`;
}

export async function portkeyFetch(
  settings: Settings,
  body: unknown,
  timeoutMs: number = PER_ATTEMPT_TIMEOUT_MS,
): Promise<PortkeyResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint(settings.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-portkey-api-key": settings.apiKey,
        ...providerHeaders(settings.provider),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      const err = new Error(
        `Portkey ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`,
      ) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return (await res.json()) as PortkeyResponse;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("Request timed out. Try again or use a shorter block.", { cause: e });
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
