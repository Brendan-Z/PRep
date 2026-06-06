// Service worker entry — routes typed messages. The sync listener returns literal
// `true` to keep the channel open for the async response.

import { generateQuiz, testConnection } from "./quiz";
import { generateExplanation, generateFileOverview } from "./explain";
import type { ExtensionRequest } from "../shared/messages";

chrome.runtime.onMessage.addListener((message: ExtensionRequest, _sender, sendResponse) => {
  if (message?.type === "GENERATE_QUIZ") {
    generateQuiz(message.payload)
      .then((quizzes) => sendResponse({ ok: true, quizzes }))
      .catch((e: unknown) => {
        const err = e as { message?: string; code?: string };
        sendResponse({ ok: false, error: String(err?.message ?? e), code: err?.code });
      });
    return true;
  }
  if (message?.type === "EXPLAIN_CODE") {
    generateExplanation(message.payload)
      .then((explanation) => sendResponse({ ok: true, explanation }))
      .catch((e: unknown) => {
        const err = e as { message?: string; code?: string };
        sendResponse({ ok: false, error: String(err?.message ?? e), code: err?.code });
      });
    return true;
  }
  if (message?.type === "EXPLAIN_FILE") {
    generateFileOverview(message.payload)
      .then((overview) => sendResponse({ ok: true, overview }))
      .catch((e: unknown) => {
        const err = e as { message?: string; code?: string };
        sendResponse({ ok: false, error: String(err?.message ?? e), code: err?.code });
      });
    return true;
  }
  if (message?.type === "TEST_KEY") {
    testConnection().then(sendResponse);
    return true;
  }
  // Not ours — let the channel close.
  return false;
});
