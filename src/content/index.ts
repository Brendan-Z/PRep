// Orchestrator. Runs in the page (semi-trusted; never sees the API key).
//
// Flow: click a changed code line -> resolve its hunk -> draw box + card ->
// ask the background worker for a quiz -> render 4 options -> grade locally ->
// reveal a junior-friendly explanation after every answer.

import * as selectors from "./selectors";
import { openCard, destroyExisting, type CardController, type CardHandlers } from "./card";
import { sendMessage, type GenerateQuizResponse, type QuizPayload } from "../shared/messages";
import type { Quiz } from "../shared/quiz";

let lifecycle: AbortController | null = null; // AbortController for the active page
let hintStyle: HTMLStyleElement | null = null; // injected "this is clickable" cursor hint
let currentCard: CardController | null = null; // active card controller
let active: { payload: QuizPayload; quiz: Quiz | null } | null = null;

// ---- quiz flow ---------------------------------------------------------

function closeCard(): void {
  if (currentCard) {
    currentCard.destroy();
    currentCard = null;
  }
  active = null;
}

function handlers(): CardHandlers {
  return {
    onClose: () => {
      currentCard = null;
      active = null;
    },
    onRetry: () => {
      if (active) requestQuiz();
    },
    onAnswer: (idx) => grade(idx),
  };
}

async function requestQuiz(): Promise<void> {
  if (!active || !currentCard) return;
  currentCard.showLoading();
  let resp: GenerateQuizResponse;
  try {
    resp = await sendMessage<GenerateQuizResponse>({ type: "GENERATE_QUIZ", payload: active.payload });
  } catch (e) {
    currentCard.showError(String(e instanceof Error ? e.message : e), true);
    return;
  }
  if (!currentCard) return; // closed while awaiting
  if (!resp || !resp.ok) {
    if (resp && resp.code === "NO_KEY") currentCard.showNeedsKey();
    else currentCard.showError((resp && resp.error) || "No response from the extension.", true);
    return;
  }
  active.quiz = resp.quiz;
  currentCard.showQuestion(resp.quiz);
}

function grade(idx: number): void {
  if (!active || !active.quiz || !currentCard) return;
  const correct = idx === active.quiz.correctIndex;
  currentCard.showResult({
    correct,
    chosenIndex: idx,
    correctIndex: active.quiz.correctIndex,
    explanation: active.quiz.explanation,
  });
}

function openQuiz(rows: Element[], info: selectors.RowInfo, code: string): void {
  closeCard();
  const payload: QuizPayload = {
    code,
    fileName: info.fileName,
    language: info.language,
    kind: info.kind,
  };
  active = { payload, quiz: null };
  currentCard = openCard(rows, handlers());
  requestQuiz();
}

// ---- click handling ----------------------------------------------------

const IGNORE =
  "a, button, [role='button'], summary, input, textarea, label, " +
  ".blob-num, .diff-line-number, [data-direction], [data-testid='comment-button']";

function onClick(e: MouseEvent): void {
  if (e.button !== 0 || e.detail > 1) return; // left, single click only
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (target.closest(IGNORE)) return; // don't hijack GitHub's own controls
  // Suppress only when the click lands inside an active selection (i.e. the user
  // just selected this code) — not when a stale selection exists elsewhere.
  const sel = window.getSelection?.();
  if (sel && !sel.isCollapsed && String(sel).trim() && sel.containsNode(target, true)) return;

  const rowEl = target.closest(".diff-line-row, tr");
  if (!rowEl) return;
  const view = selectors.rowView(rowEl);
  if (!selectors.isCodeRow(rowEl, view)) return;

  const rows = selectors.getHunkRows(rowEl);
  if (!rows.length) return;
  const code = selectors.getHunkText(rowEl);
  if (!code) return;
  const info = selectors.getRowInfo(rowEl);
  openQuiz(rows, info, code);
}

// ---- page lifecycle (GitHub navigates via Turbo, no full reload) -------

function isActivePage(): boolean {
  const p = location.pathname;
  return (
    /\/pull\/\d+\/(files|changes)\b/.test(p) ||
    /\/commit\/[0-9a-f]{6,40}/.test(p) ||
    /\/compare\//.test(p)
  );
}

function init(): void {
  teardown();
  if (!isActivePage()) return;
  lifecycle = new AbortController();
  document.addEventListener("click", onClick, { signal: lifecycle.signal });
  hintStyle = document.createElement("style");
  hintStyle.textContent = ".blob-code-inner, .diff-text-inner { cursor: pointer; }";
  document.head.appendChild(hintStyle);
}

function teardown(): void {
  if (lifecycle) {
    lifecycle.abort();
    lifecycle = null;
  }
  if (hintStyle) {
    hintStyle.remove();
    hintStyle = null;
  }
  closeCard();
  destroyExisting();
}

// Re-init on every soft navigation. init() calls teardown() first, so it is
// idempotent. We deliberately do NOT tear down on turbo:before-fetch-request /
// turbo:visit — GitHub fires those on link prefetch-on-hover, which would wipe
// the card while the user is still on the page.
init();
document.addEventListener("turbo:render", init);
document.addEventListener("turbo:load", init);
document.addEventListener("pjax:end", init); // older GHES
window.addEventListener("popstate", init);
