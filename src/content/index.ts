// Orchestrator. Runs in the page (semi-trusted; never sees the API key).
//
// Two modes, toggled with Cmd/Ctrl+Shift+L:
//   - Quiz  (default): click a changed line -> resolve its hunk -> a SET of 1-3
//     multiple-choice questions PER FILE (count scales with the change's size /
//     complexity; generated once, cached; clicking other lines in the same file
//     reuses the set). A "Next question" button steps through the set.
//   - Learn: click a line -> plain-language explanation of that line; shift+click
//     another line -> explanation of the block between them.

import * as selectors from "./selectors";
import { openCard, destroyExisting, type CardController, type CardHandlers } from "./card";
import {
  sendMessage,
  type GenerateQuizResponse,
  type GenerateExplanationResponse,
  type GenerateFileOverviewResponse,
  type QuizPayload,
  type ExplainPayload,
} from "../shared/messages";
import type { Quiz } from "../shared/quiz";
import { buildFeedbackUrl } from "../shared/feedback";

type Mode = "quiz" | "learn";

type Active =
  | {
      kind: "quiz";
      payload: QuizPayload;
      rows: Element[];
      container: Element | null;
      quizzes: Quiz[] | null;
      index: number; // cursor into quizzes for the "Next question" stepper
    }
  | { kind: "explain"; payload: ExplainPayload; rows: Element[]; container: Element | null }
  | { kind: "fileexplain"; payload: ExplainPayload; rows: Element[]; container: Element | null };

let lifecycle: AbortController | null = null; // AbortController for the active page
let hintStyle: HTMLStyleElement | null = null; // injected "this is clickable" cursor hint
let currentCard: CardController | null = null; // active card controller
let active: Active | null = null;

let mode: Mode = "quiz";
// One quiz SET per file, generated once. Keyed by the file container element so it
// is naturally dropped when GitHub swaps the DOM on navigation.
const quizCache = new WeakMap<Element, { quizzes: Quiz[]; rows: Element[]; payload: QuizPayload }>();
let lastLearnRow: Element | null = null; // anchor for learn-mode shift+click ranges

// ---- quiz / explain flow ----------------------------------------------

// Bumped on every new/closed request so a superseded in-flight generation (e.g.
// the single-line request still running when you shift+click a block) never
// renders its stale result into the current card.
let genSeq = 0;

function closeCard(): void {
  genSeq++;
  if (currentCard) {
    currentCard.destroy();
    currentCard = null;
  }
  active = null;
  destroyExisting();
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
      else if (active.kind === "fileexplain") requestFileOverview();
      else requestExplain();
    },
    onExplainFile: () => {
      if (!active || active.kind === "quiz") return;
      const container = active.container ?? selectors.closestFileContainer(active.rows[0]);
      if (container) openFileOverview(container);
    },
    onAnswer: (idx) => grade(idx),
    onPrev: () => {
      if (!active || active.kind !== "quiz" || !active.quizzes) return;
      if (active.index <= 0) return; // already on the first one
      active.index--;
      showCurrentQuestion();
    },
    onNext: () => {
      if (!active || active.kind !== "quiz" || !active.quizzes) return;
      if (active.index >= active.quizzes.length - 1) return; // already on the last one
      active.index++;
      showCurrentQuestion();
    },
    onFinish: () => closeCard(),
    // Open a prefilled GitHub issue in a new tab, carrying whatever the card is
    // currently showing (file, language, code) so the triage automation has context.
    onFeedback: () => {
      const payload = active?.payload;
      window.open(
        buildFeedbackUrl({
          version: chrome.runtime.getManifest().version,
          mode,
          pageUrl: location.href,
          fileName: payload?.fileName,
          language: payload?.language,
          code: payload?.code,
        }),
        "_blank",
        "noopener",
      );
      // Confirm the click worked — the issue form opens in a new background tab,
      // which is easy to miss otherwise.
      showToast("PRep · Opening feedback…");
    },
  };
}

// Render the question at the current cursor, with its position in the set so the
// card can show "Question X of Y" and decide whether a "Next question" button fits.
function showCurrentQuestion(): void {
  if (!active || active.kind !== "quiz" || !active.quizzes || !currentCard) return;
  currentCard.showQuestion(active.quizzes[active.index], {
    index: active.index,
    total: active.quizzes.length,
  });
}

async function requestQuiz(): Promise<void> {
  if (!active || active.kind !== "quiz" || !currentCard) return;
  const seq = ++genSeq;
  currentCard.showLoading();
  let resp: GenerateQuizResponse;
  try {
    resp = await sendMessage<GenerateQuizResponse>({ type: "GENERATE_QUIZ", payload: active.payload });
  } catch (e) {
    if (seq === genSeq) currentCard?.showError(String(e instanceof Error ? e.message : e), true);
    return;
  }
  if (seq !== genSeq || !currentCard || !active || active.kind !== "quiz") return; // superseded/closed
  if (!resp || !resp.ok) {
    if (resp && resp.code === "NO_KEY") currentCard.showNeedsKey();
    else currentCard.showError((resp && resp.error) || "No response from the extension.", true);
    return;
  }
  active.quizzes = resp.quizzes;
  active.index = 0;
  // Cache so other lines in the same file reuse this set instead of regenerating.
  if (active.container) {
    quizCache.set(active.container, {
      quizzes: resp.quizzes,
      rows: active.rows,
      payload: active.payload,
    });
  }
  showCurrentQuestion();
}

async function requestExplain(): Promise<void> {
  if (!active || active.kind !== "explain" || !currentCard) return;
  const seq = ++genSeq;
  currentCard.showLoading();
  let resp: GenerateExplanationResponse;
  try {
    resp = await sendMessage<GenerateExplanationResponse>({
      type: "EXPLAIN_CODE",
      payload: active.payload,
    });
  } catch (e) {
    if (seq === genSeq) currentCard?.showError(String(e instanceof Error ? e.message : e), true);
    return;
  }
  if (seq !== genSeq || !currentCard || !active || active.kind !== "explain") return; // superseded/closed
  if (!resp || !resp.ok) {
    if (resp && resp.code === "NO_KEY") currentCard.showNeedsKey();
    else currentCard.showError((resp && resp.error) || "No response from the extension.", true);
    return;
  }
  currentCard.showExplanation(resp.explanation);
}

async function requestFileOverview(): Promise<void> {
  if (!active || active.kind !== "fileexplain" || !currentCard) return;
  const seq = ++genSeq;
  currentCard.showLoading();
  let resp: GenerateFileOverviewResponse;
  try {
    resp = await sendMessage<GenerateFileOverviewResponse>({
      type: "EXPLAIN_FILE",
      payload: active.payload,
    });
  } catch (e) {
    if (seq === genSeq) currentCard?.showError(String(e instanceof Error ? e.message : e), true);
    return;
  }
  if (seq !== genSeq || !currentCard || !active || active.kind !== "fileexplain") return; // superseded/closed
  if (!resp || !resp.ok) {
    if (resp && resp.code === "NO_KEY") currentCard.showNeedsKey();
    else currentCard.showError((resp && resp.error) || "No response from the extension.", true);
    return;
  }
  currentCard.showFileOverview(resp.overview);
}

function grade(idx: number): void {
  if (!active || active.kind !== "quiz" || !active.quizzes || !currentCard) return;
  const quiz = active.quizzes[active.index];
  if (!quiz) return;
  const correct = idx === quiz.correctIndex;
  currentCard.showResult({
    correct,
    chosenIndex: idx,
    correctIndex: quiz.correctIndex,
    explanation: quiz.explanation,
  });
}

function openQuiz(rows: Element[], payload: QuizPayload, container: Element | null): void {
  closeCard();
  active = { kind: "quiz", payload, rows, container, quizzes: null, index: 0 };
  currentCard = openCard(rows, handlers(), "quiz");
  requestQuiz();
}

function showCachedQuiz(
  cached: { quizzes: Quiz[]; rows: Element[]; payload: QuizPayload },
  container: Element | null,
): void {
  closeCard();
  active = {
    kind: "quiz",
    payload: cached.payload,
    rows: cached.rows,
    container,
    quizzes: cached.quizzes,
    index: 0,
  };
  currentCard = openCard(cached.rows, handlers(), "quiz");
  showCurrentQuestion();
}

function openExplain(rows: Element[], payload: ExplainPayload, container: Element | null): void {
  closeCard();
  active = { kind: "explain", payload, rows, container };
  currentCard = openCard(rows, handlers(), "learn");
  requestExplain();
}

function openFileOverview(container: Element): void {
  const rows = selectors.getContainerRows(container);
  if (!rows.length) return;
  const code = selectors.getRowsText(rows, 12000);
  if (!code) return;
  const info = selectors.getContainerInfo(container);
  closeCard();
  active = {
    kind: "fileexplain",
    payload: { code, fileName: info.fileName, language: info.language, kind: "file" },
    rows,
    container,
  };
  currentCard = openCard(rows, handlers(), "learn");
  requestFileOverview();
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
  if (!rowEl) {
    // Learn mode: clicking a file's header bar (not a code row) explains the
    // WHOLE file. Quiz mode already covers the whole file per click.
    if (mode === "learn") {
      const headerContainer = selectors.closestFileContainer(target);
      if (headerContainer && selectors.isFileHeaderClick(target, headerContainer)) {
        openFileOverview(headerContainer);
      }
    }
    return;
  }
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
    // The QUESTION covers the WHOLE file (all hunks), so a change that depends on
    // code elsewhere in the same file is captured. Fall back to the clicked hunk
    // if the file container can't be resolved.
    const fileRows = container ? selectors.getFileRows(rowEl) : selectors.getHunkRows(rowEl);
    if (!fileRows.length) return;
    const code = container ? selectors.getRowsText(fileRows, 12000) : selectors.getHunkText(rowEl);
    if (!code) return;
    // The BOX, however, outlines only the clicked hunk — outlining the whole file
    // produced a viewport-tall rail that painted across the sticky header on scroll.
    const boxRows = selectors.getHunkRows(rowEl);
    const info = selectors.getRowInfo(rowEl);
    openQuiz(
      boxRows.length ? boxRows : fileRows,
      { code, fileName: info.fileName, language: info.language, kind: "file changes" },
      container,
    );
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
  openExplain(rows, { code, fileName: info.fileName, language: info.language, kind }, container);
}

// ---- mode toggle -------------------------------------------------------

let toastEl: HTMLDivElement | null = null;
let toastTimer = 0;

function showModeToast(m: Mode): void {
  showToast(m === "learn" ? "PRep · Learning mode" : "PRep · Quiz mode");
}

// Small bottom-centre toast (auto-dismisses). Shared by the mode switch and the
// feedback confirmation.
function showToast(text: string): void {
  toastEl?.remove();
  const el = document.createElement("div");
  el.textContent = text;
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
  showModeToast(m);
}

function onKeydown(e: KeyboardEvent): void {
  // Esc closes the card + highlight box.
  if (e.key === "Escape" && currentCard) {
    e.preventDefault();
    closeCard();
    return;
  }
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
  closeCard();
  destroyExisting();
}

// Restore the persisted mode once, then wire up the page.
void chrome.storage.local.get("prepMode").then((s) => {
  if ((s as { prepMode?: string }).prepMode === "learn") mode = "learn";
});

// Keep in sync when the mode is changed elsewhere (e.g. toggled from the popup).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.prepMode) return;
  const next: Mode = changes.prepMode.newValue === "learn" ? "learn" : "quiz";
  if (next !== mode) {
    mode = next;
    lastLearnRow = null;
  }
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
