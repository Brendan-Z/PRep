// Typed message contracts between the content script / popup (senders) and the
// background service worker (receiver). Replaces the old stringly-typed messages.

import type { Quiz, Explanation } from "./quiz";

export interface QuizPayload {
  code: string;
  fileName: string;
  language: string;
  kind: string;
}

// Learn-mode request. `kind` is "line" (single click) or "block" (shift+click range).
export interface ExplainPayload {
  code: string;
  fileName: string;
  language: string;
  kind: string;
}

export type ExtensionRequest =
  | { type: "GENERATE_QUIZ"; payload: QuizPayload }
  | { type: "EXPLAIN_CODE"; payload: ExplainPayload }
  | { type: "TEST_KEY" };

export type GenerateQuizResponse =
  | { ok: true; quizzes: Quiz[] }
  | { ok: false; error: string; code?: string };

export type GenerateExplanationResponse =
  | { ok: true; explanation: Explanation }
  | { ok: false; error: string; code?: string };

export type TestKeyResponse = { ok: true } | { ok: false; error: string };

// Thin typed wrapper around chrome.runtime.sendMessage. The caller asserts the
// response type matching the request it sent.
export function sendMessage<T>(message: ExtensionRequest): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}
