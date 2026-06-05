// background.js — service worker.
// The ONLY holder of the Portkey API key and the ONLY origin that calls Portkey.
// Content scripts are NOT CORS-exempt; the service worker IS (given host_permissions),
// so all network calls live here. The content script only ever sends extracted code
// text and receives quiz JSON / scoring results back.

const DEFAULTS = {
  baseUrl: "https://api.portkey.ai/v1",
  provider: "@bedrock-eus1",
  // Bedrock Claude Sonnet 4.6 (US cross-region inference profile). Confirm the exact id
  // for your account in the options page — this is a sensible placeholder.
  model: "us.anthropic.claude-sonnet-4-6-20250929-v1:0",
};

const PER_ATTEMPT_TIMEOUT_MS = 20000; // each fetch stays under the worker's 30s fetch limit
const OVERALL_BUDGET_MS = 28000; // cap total time across the tool-call + fallback attempts

const QUIZ_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["question", "options", "correctIndex", "explanation"],
  properties: {
    question: { type: "string", description: "One question asking what the code DOES." },
    options: {
      type: "array",
      items: { type: "string" },
      minItems: 4,
      maxItems: 4,
      description: "Exactly four answer options; exactly one is correct.",
    },
    correctIndex: { type: "integer", minimum: 0, maximum: 3, description: "Index of the correct option." },
    explanation: {
      type: "string",
      description:
        "Plain-language, junior-friendly breakdown of exactly what the code does and why the correct option is right.",
    },
  },
};

const SYSTEM_PROMPT = [
  "You are a senior engineer writing ONE multiple-choice comprehension question for a",
  "junior/graduate engineer reviewing a pull request. Given a changed block of code, produce",
  "EXACTLY ONE question asking what the code DOES (its behaviour/effect), with EXACTLY 4 options.",
  "Exactly one option is correct; the other three must be plausible-but-wrong distractors a junior",
  "might actually pick (e.g. mutation vs copy, off-by-one, sync vs async, truthy/falsy edge cases,",
  "shallow vs deep, reference vs value). The explanation must break the code down in plain language",
  "for a junior and say WHY the correct option is right and why the most tempting wrong option is",
  "wrong — concise and concrete, no fluff. Base the question ONLY on the provided snippet; do not",
  "invent surrounding code you cannot see.",
].join(" ");

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function getSettings() {
  const s = await chrome.storage.local.get(["portkeyApiKey", "provider", "model", "baseUrl"]);
  return {
    apiKey: s.portkeyApiKey || "",
    provider: s.provider || DEFAULTS.provider,
    model: s.model || DEFAULTS.model,
    baseUrl: (s.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, ""),
  };
}

// Provider routing header: an "@slug" goes in x-portkey-provider (Model Catalog),
// anything else is treated as a legacy virtual key.
function providerHeaders(provider) {
  if (provider && provider.trim().startsWith("@")) {
    return { "x-portkey-provider": provider.trim() };
  }
  if (provider && provider.trim()) {
    return { "x-portkey-virtual-key": provider.trim() };
  }
  return {};
}

function endpoint(baseUrl) {
  return `${baseUrl}/chat/completions`;
}

// ---------------------------------------------------------------------------
// Portkey call
// ---------------------------------------------------------------------------

async function portkeyFetch(settings, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || PER_ATTEMPT_TIMEOUT_MS);
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
      const err = new Error(`Portkey ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Request timed out. Try again or use a shorter block.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function userMessage({ code, fileName, language, kind }) {
  const lang = language || "";
  const where = fileName ? `File: ${fileName}` : "File: (unknown)";
  const change = kind ? ` (change: ${kind})` : "";
  return `${where} (language: ${lang || "unknown"})${change}\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\nGenerate the question now.`;
}

function validateQuiz(q) {
  if (!q || typeof q !== "object") return false;
  if (typeof q.question !== "string" || !q.question.trim()) return false;
  if (!Array.isArray(q.options) || q.options.length !== 4) return false;
  if (!q.options.every((o) => typeof o === "string" && o.trim())) return false;
  if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3) return false;
  if (typeof q.explanation !== "string" || !q.explanation.trim()) return false;
  return true;
}

// Pull a JSON object out of a model's text content (handles ```json fences / stray prose).
function extractJson(text) {
  if (typeof text !== "string") return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch (_) {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1));
      } catch (_) {}
    }
  }
  return null;
}

// Normalize OpenAI-compat message.content (string | null | array of blocks) to text.
function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === "string" ? p : (p && p.text) || "")).join("");
  return "";
}

// Strategy A: forced tool calling — Claude's native, most reliable structured-output path.
async function generateViaTool(settings, payload, timeoutMs) {
  const data = await portkeyFetch(settings, {
    model: settings.model,
    max_tokens: 800,
    temperature: 0.4,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage(payload) },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "emit_quiz",
          description: "Return exactly one multiple-choice quiz question about the provided code.",
          parameters: QUIZ_SCHEMA,
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "emit_quiz" } },
  }, timeoutMs);

  const msg = data?.choices?.[0]?.message;
  const args = msg?.tool_calls?.[0]?.function?.arguments;
  if (args) {
    const parsed = typeof args === "string" ? safeParse(args) : args;
    if (validateQuiz(parsed)) return parsed;
  }
  // Some gateways return the JSON in content even when a tool was forced.
  const fromContent = extractJson(contentToText(msg?.content));
  if (validateQuiz(fromContent)) return fromContent;
  return null;
}

// Strategy B: prompt-for-JSON fallback (if tool calling isn't honored by the route).
async function generateViaPrompt(settings, payload, timeoutMs) {
  const data = await portkeyFetch(settings, {
    model: settings.model,
    max_tokens: 800,
    temperature: 0.4,
    messages: [
      {
        role: "system",
        content:
          SYSTEM_PROMPT +
          ' Respond ONLY with a JSON object of the form {"question":string,"options":[4 strings],"correctIndex":0-3 integer,"explanation":string}. No prose, no code fences.',
      },
      { role: "user", content: userMessage(payload) },
    ],
  }, timeoutMs);
  const parsed = extractJson(contentToText(data?.choices?.[0]?.message?.content));
  return validateQuiz(parsed) ? parsed : null;
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch (_) {
    return extractJson(s);
  }
}

async function generateQuiz(payload) {
  const settings = await getSettings();
  if (!settings.apiKey) {
    const e = new Error("NO_KEY");
    e.code = "NO_KEY";
    throw e;
  }

  // Share one wall-clock budget across both attempts so a slow/hanging tool call
  // can't make the user wait ~2x the per-attempt timeout.
  const deadline = Date.now() + OVERALL_BUDGET_MS;
  const cap = () => Math.max(0, Math.min(PER_ATTEMPT_TIMEOUT_MS, deadline - Date.now()));

  // Try tool calling first; on a malformed result fall back to prompt-JSON once.
  let quiz = null;
  let firstError = null;
  try {
    quiz = await generateViaTool(settings, payload, cap());
  } catch (e) {
    firstError = e;
  }
  if (!quiz && deadline - Date.now() > 3000) {
    quiz = await generateViaPrompt(settings, payload, cap());
  }
  if (!quiz) {
    throw firstError || new Error("The model did not return a valid 4-option question. Try again.");
  }
  return quiz;
}

async function testConnection() {
  const settings = await getSettings();
  if (!settings.apiKey) return { ok: false, error: "No API key set." };
  try {
    await portkeyFetch(settings, {
      model: settings.model,
      max_tokens: 5,
      messages: [{ role: "user", content: "Reply with the single word: OK" }],
    }, 15000);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// ---------------------------------------------------------------------------
// Message routing — sync listener that returns literal `true` to keep the
// channel open for the async response.
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type;
  if (type === "GENERATE_QUIZ") {
    generateQuiz(message.payload || {})
      .then((quiz) => sendResponse({ ok: true, quiz }))
      .catch((e) => sendResponse({ ok: false, error: String(e.message || e), code: e.code }));
    return true;
  }
  if (type === "TEST_KEY") {
    testConnection().then(sendResponse);
    return true;
  }
  // Not ours — let the channel close.
  return false;
});
