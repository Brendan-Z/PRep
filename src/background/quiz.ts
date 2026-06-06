// Quiz generation: builds the prompt, calls Portkey (forced tool call first,
// prompt-for-JSON fallback) and validates the result against the shared schema.

import { getSettings, type Settings } from "../shared/settings";
import type { QuizPayload, TestKeyResponse } from "../shared/messages";
import { QUIZ_JSON_SCHEMA, validateQuiz, type Quiz } from "../shared/quiz";
import { portkeyFetch, type PortkeyResponse } from "./portkey";

const PER_ATTEMPT_TIMEOUT_MS = 20000;
const OVERALL_BUDGET_MS = 28000; // cap total time across the tool-call + fallback attempts

const SYSTEM_PROMPT = [
  "You are a senior engineer writing ONE multiple-choice comprehension question for a",
  "junior/graduate engineer reviewing a pull request. Given a changed block of code, produce",
  "EXACTLY ONE question asking what the code DOES (its behaviour/effect), with EXACTLY 4 options.",
  "Exactly one option is correct; the other three must be plausible-but-wrong distractors a junior",
  "might actually pick (e.g. mutation vs copy, off-by-one, sync vs async, truthy/falsy edge cases,",
  "shallow vs deep, reference vs value).",
  // Option lettering + correctIndex consistency. A miscounted "option 1/2" in the
  // prose contradicts the highlighted answer and confuses the reader.
  "The four options are labelled A, B, C, D in the exact order you output them: A is options[0],",
  "B is options[1], C is options[2], D is options[3]. correctIndex is 0-based, so 0=A, 1=B, 2=C, 3=D.",
  "In the explanation, refer to options ONLY by their letter (A, B, C, D) — never by a number —",
  "and keep every statement consistent with correctIndex: NEVER describe the correct option as wrong.",
  "Structure the explanation as: first a brief plain-language summary of what the code does, then",
  "exactly one line per option, each starting with 'Option A:', 'Option B:', 'Option C:', 'Option D:'",
  "(in that order) stating whether that letter is correct or why it is wrong. Concise and concrete,",
  "no fluff. Base the question ONLY on the provided snippet; do not invent surrounding code you",
  "cannot see.",
].join(" ");

function userMessage({ code, fileName, language, kind }: QuizPayload): string {
  const lang = language || "";
  const where = fileName ? `File: ${fileName}` : "File: (unknown)";
  const change = kind ? ` (change: ${kind})` : "";
  return `${where} (language: ${lang || "unknown"})${change}\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\nGenerate the question now.`;
}

// Pull a JSON object out of a model's text content (handles ```json fences / stray prose).
export function extractJson(text: unknown): unknown {
  if (typeof text !== "string") return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
  }
  return null;
}

// Normalize OpenAI-compat message.content (string | null | array of blocks) to text.
export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : ((part as { text?: string })?.text ?? "")))
      .join("");
  }
  return "";
}

export function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return extractJson(s);
  }
}

// Strategy A: forced tool calling — Claude's native, most reliable structured-output path.
async function generateViaTool(
  settings: Settings,
  payload: QuizPayload,
  timeoutMs: number,
): Promise<Quiz | null> {
  const data: PortkeyResponse = await portkeyFetch(
    settings,
    {
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
            parameters: QUIZ_JSON_SCHEMA,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "emit_quiz" } },
    },
    timeoutMs,
  );

  const msg = data.choices?.[0]?.message;
  const args = msg?.tool_calls?.[0]?.function?.arguments;
  if (args) {
    const parsed = typeof args === "string" ? safeParse(args) : args;
    const quiz = validateQuiz(parsed);
    if (quiz) return quiz;
  }
  // Some gateways return the JSON in content even when a tool was forced.
  const fromContent = validateQuiz(extractJson(contentToText(msg?.content)));
  if (fromContent) return fromContent;
  return null;
}

// Strategy B: prompt-for-JSON fallback (if tool calling isn't honored by the route).
async function generateViaPrompt(
  settings: Settings,
  payload: QuizPayload,
  timeoutMs: number,
): Promise<Quiz | null> {
  const data: PortkeyResponse = await portkeyFetch(
    settings,
    {
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
    },
    timeoutMs,
  );
  return validateQuiz(extractJson(contentToText(data.choices?.[0]?.message?.content)));
}

export async function generateQuiz(payload: QuizPayload): Promise<Quiz> {
  const settings = await getSettings();
  if (!settings.apiKey) {
    const e = new Error("NO_KEY") as Error & { code?: string };
    e.code = "NO_KEY";
    throw e;
  }

  // Share one wall-clock budget across both attempts so a slow/hanging tool call
  // can't make the user wait ~2x the per-attempt timeout.
  const deadline = Date.now() + OVERALL_BUDGET_MS;
  const cap = () => Math.max(0, Math.min(PER_ATTEMPT_TIMEOUT_MS, deadline - Date.now()));

  let quiz: Quiz | null = null;
  let firstError: unknown = null;
  try {
    quiz = await generateViaTool(settings, payload, cap());
  } catch (e) {
    firstError = e;
  }
  if (!quiz && deadline - Date.now() > 3000) {
    quiz = await generateViaPrompt(settings, payload, cap());
  }
  if (!quiz) {
    if (firstError instanceof Error) throw firstError;
    throw new Error("The model did not return a valid 4-option question. Try again.");
  }
  return quiz;
}

export async function testConnection(): Promise<TestKeyResponse> {
  const settings = await getSettings();
  if (!settings.apiKey) return { ok: false, error: "No API key set." };
  try {
    await portkeyFetch(
      settings,
      {
        model: settings.model,
        max_tokens: 5,
        messages: [{ role: "user", content: "Reply with the single word: OK" }],
      },
      15000,
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e) };
  }
}
