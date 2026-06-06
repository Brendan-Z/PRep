// Learn-mode generation: given a clicked line or a shift-selected block, produce
// a junior-friendly, line-by-line teaching breakdown. Mirrors quiz.ts's two-stage
// strategy (forced tool call, prompt-for-JSON fallback) and reuses its helpers.

import { getSettings, type Settings } from "../shared/settings";
import type { ExplainPayload } from "../shared/messages";
import { EXPLANATION_JSON_SCHEMA, validateExplanation, type Explanation } from "../shared/quiz";
import { portkeyFetch, type PortkeyResponse } from "./portkey";
import { extractJson, contentToText, safeParse } from "./quiz";

const PER_ATTEMPT_TIMEOUT_MS = 20000;
const OVERALL_BUDGET_MS = 28000;

const SYSTEM_PROMPT = [
  "You are a patient senior engineer teaching a junior/graduate engineer how to read code during a",
  "pull-request review. Given a line or block of code, explain what it does so the junior actually",
  "understands it — not just a one-line summary. Produce: a short plain-language 'summary' of what",
  "the code does overall, then a 'lines' array breaking it down IN SOURCE ORDER, one entry per",
  "meaningful line or fragment, each with the exact 'code' and a concrete 'explanation' of what that",
  "line does and why it matters. Define jargon in plain terms. Be concise and concrete, no fluff.",
  "Base everything ONLY on the provided snippet; do not invent surrounding code you cannot see.",
].join(" ");

function userMessage({ code, fileName, language, kind }: ExplainPayload): string {
  const lang = language || "unknown";
  const where = fileName ? `File: ${fileName}` : "File: (unknown)";
  const scope = kind === "line" ? "a single line" : "a block";
  return `${where} (language: ${lang}). The reviewer selected ${scope} of code:\n\n\`\`\`${language || ""}\n${code}\n\`\`\`\n\nExplain it now for a junior engineer.`;
}

async function generateViaTool(
  settings: Settings,
  payload: ExplainPayload,
  timeoutMs: number,
): Promise<Explanation | null> {
  const data: PortkeyResponse = await portkeyFetch(
    settings,
    {
      model: settings.model,
      max_tokens: 1000,
      temperature: 0.3,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage(payload) },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "emit_explanation",
            description: "Return a line-by-line teaching breakdown of the provided code.",
            parameters: EXPLANATION_JSON_SCHEMA,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "emit_explanation" } },
    },
    timeoutMs,
  );

  const msg = data.choices?.[0]?.message;
  const args = msg?.tool_calls?.[0]?.function?.arguments;
  if (args) {
    const parsed = typeof args === "string" ? safeParse(args) : args;
    const explanation = validateExplanation(parsed);
    if (explanation) return explanation;
  }
  const fromContent = validateExplanation(extractJson(contentToText(msg?.content)));
  if (fromContent) return fromContent;
  return null;
}

async function generateViaPrompt(
  settings: Settings,
  payload: ExplainPayload,
  timeoutMs: number,
): Promise<Explanation | null> {
  const data: PortkeyResponse = await portkeyFetch(
    settings,
    {
      model: settings.model,
      max_tokens: 1000,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            SYSTEM_PROMPT +
            ' Respond ONLY with a JSON object of the form {"summary":string,"lines":[{"code":string,"explanation":string}]}. No prose, no code fences.',
        },
        { role: "user", content: userMessage(payload) },
      ],
    },
    timeoutMs,
  );
  return validateExplanation(extractJson(contentToText(data.choices?.[0]?.message?.content)));
}

export async function generateExplanation(payload: ExplainPayload): Promise<Explanation> {
  const settings = await getSettings();
  if (!settings.apiKey) {
    const e = new Error("NO_KEY") as Error & { code?: string };
    e.code = "NO_KEY";
    throw e;
  }

  const deadline = Date.now() + OVERALL_BUDGET_MS;
  const cap = () => Math.max(0, Math.min(PER_ATTEMPT_TIMEOUT_MS, deadline - Date.now()));

  let explanation: Explanation | null = null;
  let firstError: unknown = null;
  try {
    explanation = await generateViaTool(settings, payload, cap());
  } catch (e) {
    firstError = e;
  }
  if (!explanation && deadline - Date.now() > 3000) {
    explanation = await generateViaPrompt(settings, payload, cap());
  }
  if (!explanation) {
    if (firstError instanceof Error) throw firstError;
    throw new Error("The model did not return a valid explanation. Try again.");
  }
  return explanation;
}
