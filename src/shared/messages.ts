// Typed message contracts between the content script / popup (senders) and the
// background service worker (receiver). Replaces the old stringly-typed messages.

import type { Quiz } from "./quiz";

export interface QuizPayload {
  code: string;
  fileName: string;
  language: string;
  kind: string;
}

export type ExtensionRequest =
  | { type: "GENERATE_QUIZ"; payload: QuizPayload }
  | { type: "TEST_KEY" };

export type GenerateQuizResponse =
  | { ok: true; quiz: Quiz }
  | { ok: false; error: string; code?: string };

export type TestKeyResponse = { ok: true } | { ok: false; error: string };

// Thin typed wrapper around chrome.runtime.sendMessage. The caller asserts the
// response type matching the request it sent.
export function sendMessage<T>(message: ExtensionRequest): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}
