// Orchestrator. Runs in the page (semi-trusted; never sees the API key).
//
// Two modes, toggled with Cmd/Ctrl+Shift+L:
//   - Quiz  (default): click a changed line -> resolve its hunk -> one multiple-
//     choice question PER FILE (generated once, cached; clicking other lines in
//     the same file reuses it).
//   - Learn: click a line -> plain-language explanation of that line; shift+click
//     another line -> explanation of the block between them.

import * as selectors from "./selectors";
import { openCard, destroyExisting, type CardController, type CardHandlers } from "./card";
import {
  sendMessage,
  type GenerateQuizResponse,
  type GenerateExplanationResponse,
  type QuizPayload,
  type ExplainPayload,
} from "../shared/messages";
import type { Quiz } from "../shared/quiz";

type Mode = "quiz" | "learn";

type Active =
  | { kind: "quiz"; payload: QuizPayload; rows: Element[]; container: Element | null; quiz: Quiz | null }
  | { kind: "explain"; payload: ExplainPayload; rows: Element[] };

let lifecycle: AbortController | null = null; // AbortController for the active page
let hintStyle: HTMLStyleElement | null = null; // injected "this is clickable" cursor hint
let currentCard: CardController | null = null; // active card controller
let active: Active | null = null;

let mode: Mode = "quiz";
// One quiz per file, generated once. Keyed by the file container element so it is
// naturally dropped when GitHub swaps the DOM on navigation.
const quizCache = new WeakMap<Element, { quiz: Quiz; rows: Element[]; payload: QuizPayload }>();
let lastLearnRow: Element | null = null; // anchor for learn-mode shift+click ranges

// ---- quiz / explain flow ----------------------------------------------

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
      if (!active) return;
      if (active.kind === "quiz") requestQuiz();
      else requestExplain();
    },
    onAnswer: (idx) => grade(idx),
    onNewQuestion: () => {
      if (!active || active.kind !== "quiz") return;
      // Drop the cached quiz for this file and regenerate a fresh one.
      if (active.container) quizCache.delete(active.container);
      active.quiz = null;
      requestQuiz();
    },
  };
}

async function requestQuiz(): Promise<void> {
  if (!active || active.kind !== "quiz" || !currentCard) return;
  currentCard.showLoading();
  let resp: GenerateQuizResponse;
  try {
    resp = await sendMessage<GenerateQuizResponse>({ type: "GENERATE_QUIZ", payload: active.payload });
  } catch (e) {
    currentCard?.showError(String(e instanceof Error ? e.message : e), true);
    return;
  }
  if (!currentCard || !active || active.kind !== "quiz") return; // closed while awaiting
  if (!resp || !resp.ok) {
    if (resp && resp.code === "NO_KEY") currentCard.showNeedsKey();
    else currentCard.showError((resp && resp.error) || "No response from the extension.", true);
    return;
  }
  active.quiz = resp.quiz;
  // Cache so other lines in the same file reuse this quiz instead of regenerating.
  if (active.container) {
    quizCache.set(active.container, { quiz: resp.quiz, rows: active.rows, payload: active.payload });
  }
  currentCard.showQuestion(resp.quiz);
}

async function requestExplain(): Promise<void> {
  if (!active || active.kind !== "explain" || !currentCard) return;
  currentCard.showLoading();
  let resp: GenerateExplanationResponse;
  try {
    resp = await sendMessage<GenerateExplanationResponse>({
      type: "EXPLAIN_CODE",
      payload: active.payload,
    });
  } catch (e) {
    currentCard?.showError(String(e instanceof Error ? e.message : e), true);
    return;
  }
  if (!currentCard || !active || active.kind !== "explain") return; // closed while awaiting
  if (!resp || !resp.ok) {
    if (resp && resp.code === "NO_KEY") currentCard.showNeedsKey();
    else currentCard.showError((resp && resp.error) || "No response from the extension.", true);
    return;
  }
  currentCard.showExplanation(resp.explanation, active.payload.code);
}

function grade(idx: number): void {
  if (!active || active.kind !== "quiz" || !active.quiz || !currentCard) return;
  const correct = idx === active.quiz.correctIndex;
  currentCard.showResult({
    correct,
    chosenIndex: idx,
    correctIndex: active.quiz.correctIndex,
    explanation: active.quiz.explanation,
  });
}

function openQuiz(rows: Element[], payload: QuizPayload, container: Element | null): void {
  closeCard();
  active = { kind: "quiz", payload, rows, container, quiz: null };
  currentCard = openCard(rows, handlers());
  requestQuiz();
}

function showCachedQuiz(
  cached: { quiz: Quiz; rows: Element[]; payload: QuizPayload },
  container: Element | null,
): void {
  closeCard();
  active = { kind: "quiz", payload: cached.payload, rows: cached.rows, container, quiz: cached.quiz };
  currentCard = openCard(cached.rows, handlers());
  currentCard.showQuestion(cached.quiz);
}

function openExplain(rows: Element[], payload: ExplainPayload): void {
  closeCard();
  active = { kind: "explain", payload, rows };
  currentCard = openCard(rows, handlers());
  requestExplain();
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

  const shift = e.shiftKey;
  const learnShift = mode === "learn" && shift;
  // Suppress when the click lands inside an active selection (the user just
  // selected this code) — except for a learn-mode shift+click, which is OUR
  // block gesture and legitimately produces a browser selection.
  const sel = window.getSelection?.();
  if (!learnShift && sel && !sel.isCollapsed && String(sel).trim() && sel.containsNode(target, true)) {
    return;
  }

  const rowEl = target.closest(".diff-line-row, tr");
  if (!rowEl) return;
  const view = selectors.rowView(rowEl);
  if (!selectors.isCodeRow(rowEl, view)) return;
  const container = selectors.getFileContainer(rowEl);

  if (mode === "quiz") {
    // Already showing this file's quiz — leave it untouched.
    if (active?.kind === "quiz" && active.container === container) return;
    const cached = container ? quizCache.get(container) : undefined;
    if (cached) {
      showCachedQuiz(cached, container);
      return;
    }
    // Quiz covers the WHOLE file (all hunks), so a change that depends on code
    // elsewhere in the same file is captured. Fall back to the clicked hunk if
    // the file container can't be resolved.
    const rows = container ? selectors.getFileRows(rowEl) : selectors.getHunkRows(rowEl);
    if (!rows.length) return;
    const code = container ? selectors.getRowsText(rows, 12000) : selectors.getHunkText(rowEl);
    if (!code) return;
    const info = selectors.getRowInfo(rowEl);
    openQuiz(rows, { code, fileName: info.fileName, language: info.language, kind: "file changes" }, container);
    return;
  }

  // Learn mode: single click = one line; shift+click = block from the anchor.
  let rows: Element[];
  let kind: string;
  if (shift && lastLearnRow && selectors.getFileContainer(lastLearnRow) === container) {
    rows = selectors.getRowRange(lastLearnRow, rowEl);
    kind = "block";
    sel?.removeAllRanges(); // clear the selection the shift+click just made
  } else {
    rows = [rowEl];
    kind = "line";
  }
  lastLearnRow = rowEl;
  if (!rows.length) return;
  const code = selectors.getRowsText(rows);
  if (!code) return;
  const info = selectors.getRowInfo(rowEl);
  openExplain(rows, { code, fileName: info.fileName, language: info.language, kind });
}

// ---- mode toggle -------------------------------------------------------

// Persistent top-right badge so the active mode is always visible (the toast
// only flashes on change). Click it to toggle, same as the keyboard shortcut.
let modeBadge: HTMLDivElement | null = null;

function renderModeBadge(): void {
  if (!modeBadge) return;
  modeBadge.textContent = mode === "learn" ? "PRep · Learn" : "PRep · Quiz";
  modeBadge.style.borderColor = mode === "learn" ? "#3fb950" : "#ff7a17";
}

function mountModeBadge(): void {
  if (modeBadge) return;
  const el = document.createElement("div");
  el.id = "pq-mode-badge";
  Object.assign(el.style, {
    position: "fixed",
    top: "60px",
    right: "12px",
    zIndex: "9997",
    cursor: "pointer",
    userSelect: "none",
    background: "#0a0a0a",
    color: "#ffffff",
    border: "1px solid #ff7a17",
    borderRadius: "9999px",
    padding: "6px 12px",
    font: '600 12px/1 ui-monospace, "Geist Mono", SFMono-Regular, Menlo, monospace',
    letterSpacing: "0.5px",
    boxShadow: "0 4px 12px rgba(0,0,0,.4)",
  });
  el.title = "Click or press Cmd/Ctrl+Shift+L to swap Quiz / Learn mode";
  el.addEventListener("click", () => applyMode(mode === "quiz" ? "learn" : "quiz"));
  document.body.appendChild(el);
  modeBadge = el;
  renderModeBadge();
}

function unmountModeBadge(): void {
  modeBadge?.remove();
  modeBadge = null;
}

let toastEl: HTMLDivElement | null = null;
let toastTimer = 0;

function showModeToast(m: Mode): void {
  toastEl?.remove();
  const el = document.createElement("div");
  el.textContent = m === "learn" ? "PRep · Learning mode" : "PRep · Quiz mode";
  Object.assign(el.style, {
    position: "fixed",
    left: "50%",
    bottom: "24px",
    transform: "translateX(-50%)",
    zIndex: "2147483647",
    background: "#0a0a0a",
    color: "#ffffff",
    border: "1px solid #212327",
    borderRadius: "9999px",
    padding: "8px 16px",
    font: '500 13px/1 Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
    boxShadow: "0 8px 24px rgba(0,0,0,.5)",
    pointerEvents: "none",
  });
  document.body.appendChild(el);
  toastEl = el;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.remove();
    if (toastEl === el) toastEl = null;
  }, 1600);
}

function applyMode(m: Mode): void {
  mode = m;
  lastLearnRow = null;
  void chrome.storage.local.set({ prepMode: m });
  renderModeBadge();
  showModeToast(m);
}

function onKeydown(e: KeyboardEvent): void {
  // Cmd/Ctrl+Shift+L swaps Quiz <-> Learn. Chosen over Shift+Tab to avoid
  // clobbering native focus traversal / screen-reader navigation.
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "L" || e.key === "l")) {
    if (!isActivePage()) return;
    e.preventDefault();
    applyMode(mode === "quiz" ? "learn" : "quiz");
  }
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
  document.addEventListener("keydown", onKeydown, { signal: lifecycle.signal });
  hintStyle = document.createElement("style");
  hintStyle.textContent = ".blob-code-inner, .diff-text-inner { cursor: pointer; }";
  document.head.appendChild(hintStyle);
  mountModeBadge();
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
  lastLearnRow = null;
  unmountModeBadge();
  closeCard();
  destroyExisting();
}

// Restore the persisted mode once, then wire up the page.
void chrome.storage.local.get("prepMode").then((s) => {
  if ((s as { prepMode?: string }).prepMode === "learn") mode = "learn";
});

// Re-init on every soft navigation. init() calls teardown() first, so it is
// idempotent. We deliberately do NOT tear down on turbo:before-fetch-request /
// turbo:visit — GitHub fires those on link prefetch-on-hover, which would wipe
// the card while the user is still on the page.
init();
document.addEventListener("turbo:render", init);
document.addEventListener("turbo:load", init);
document.addEventListener("pjax:end", init); // older GHES
window.addEventListener("popstate", init);

// GitHub's React "Files changed" view navigates client-side and does NOT always
// fire the Turbo/pjax events above, leaving the extension inactive until a hard
// refresh. The Navigation API fires on every client-side navigation (no polling)
// and covers that case; init() is idempotent. Guarded for engines without it,
// which still rely on the Turbo/popstate listeners above.
const nav = (window as unknown as { navigation?: EventTarget }).navigation;
nav?.addEventListener("navigatesuccess", init);
