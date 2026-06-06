// The minimal quiz UI. Two absolutely-positioned elements appended to <body>, so
// GitHub's diff table is NEVER mutated:
//   1. an overlay "box" drawn around the targeted hunk
//   2. a Shadow-DOM card (CSS fully encapsulated)
//
// xAI design language: near-black canvas, white-pill interactives, hairline
// borders, Inter body + monospace uppercase eyebrows. Dark only.

import type { Quiz, Explanation, FileOverview } from "../shared/quiz";
import { fileHeaderBottom } from "./selectors";

const HOST_ID = "pq-card-host";
const BOX_ID = "pq-box";

// File-container selectors for both diff views (React "Files changed" + classic
// table). Used to clamp the highlight box to the file's width — see reposition.
const CONTAINER_SEL =
  '[class^="Diff-module__diffTargetable"], .js-file, [data-tagsearch-path], .js-diff-table';

export interface CardHandlers {
  onClose?: () => void;
  onRetry?: () => void;
  onAnswer?: (index: number) => void;
  onPrev?: () => void;
  onNext?: () => void;
  onFinish?: () => void;
  onExplainFile?: () => void;
}

// Where the current question sits in its 1-3 question set — drives the progress
// eyebrow and whether a "Next question" button is shown.
export interface QuizPosition {
  index: number;
  total: number;
}

export interface QuizResult {
  correct: boolean;
  chosenIndex: number;
  correctIndex: number;
  explanation: string;
}

export interface CardController {
  reposition(): void;
  destroy(): void;
  showLoading(): void;
  showQuestion(quiz: Quiz, position?: QuizPosition): void;
  showResult(result: QuizResult): void;
  showExplanation(explanation: Explanation): void;
  showFileOverview(overview: FileOverview): void;
  showError(message: string, canRetry: boolean): void;
  showNeedsKey(): void;
}

// Quiz correctness needs a clear pass/fail cue the brand palette doesn't cover,
// so green/red tints are added sparingly — tuned to sit on the dark canvas.
const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .card {
    font: 400 14px/1.5 Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #ffffff; background: #0a0a0a;
    border: 1px solid #212327; border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,.5);
    width: 460px; max-width: calc(100vw - 24px);
    /* Cap to the viewport and let the body scroll — long explanations (esp.
       learn mode) would otherwise run off the bottom of the screen. */
    max-height: calc(100vh - 24px);
    display: flex; flex-direction: column; overflow: hidden;
  }
  .hd { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid #212327; flex: none; }
  .hd .dot { width: 8px; height: 8px; border-radius: 9999px; background: #ff7a17; flex: none; }
  .hd .title {
    font-family: ui-monospace, "Geist Mono", SFMono-Regular, Menlo, Monaco, monospace;
    font-size: 12px; letter-spacing: 1.2px; text-transform: uppercase; color: #7d8187;
  }
  .hd .spacer { flex: 1; }
  .hd .x { cursor: pointer; border: 1px solid #212327; background: transparent; color: #dadbdf; font-size: 15px; line-height: 1; width: 24px; height: 24px; border-radius: 9999px; }
  .hd .x:hover { background: #1a1c20; color: #ffffff; }
  .body { padding: 16px; flex: 1 1 auto; min-height: 0; overflow-y: auto; }
  .q { font-size: 16px; line-height: 24px; margin: 0 0 14px; color: #ffffff; }
  .opts { display: flex; flex-direction: column; gap: 8px; }
  .opt {
    text-align: left; cursor: pointer; width: 100%;
    padding: 10px 14px; border: 1px solid #212327; border-radius: 9999px;
    background: transparent; color: #dadbdf; font: inherit; display: flex; gap: 10px; align-items: center;
  }
  .opt:hover:not(:disabled) { background: #1a1c20; border-color: #363a3f; color: #ffffff; }
  .opt:disabled { cursor: default; }
  .opt .key { font-family: ui-monospace, "Geist Mono", SFMono-Regular, Menlo, monospace; font-size: 13px; color: #7d8187; flex: none; }
  .opt.correct { border-color: #3fb950; background: rgba(63,185,80,.10); color: #ffffff; }
  .opt.correct .key { color: #3fb950; }
  .opt.wrong { border-color: #f85149; background: rgba(248,81,73,.10); color: #ffffff; }
  .opt.wrong .key { color: #f85149; }
  .status { margin: 0 0 12px; font-size: 15px; }
  .status.ok { color: #3fb950; }
  .status.bad { color: #f85149; }
  .explain { margin-top: 14px; padding: 14px; background: #191919; border: 1px solid #212327; border-radius: 8px; }
  .explain h5 {
    margin: 0 0 8px; font-weight: 400;
    font-family: ui-monospace, "Geist Mono", SFMono-Regular, Menlo, monospace;
    font-size: 12px; letter-spacing: 1.2px; text-transform: uppercase; color: #7d8187;
  }
  .explain p { margin: 0; white-space: pre-wrap; color: #dadbdf; }
  code {
    font-family: ui-monospace, "Geist Mono", SFMono-Regular, Menlo, Monaco, monospace;
    font-size: .9em; padding: 1px 5px; border-radius: 4px;
    background: #1a1c20; border: 1px solid #2a2d33; color: #ffb27a;
  }
  em { font-style: italic; color: #ffffff; }
  .exlines { display: flex; flex-direction: column; gap: 10px; margin-top: 6px; }
  .exline { border-left: 2px solid #ff7a17; padding-left: 12px; }
  .exline .ln {
    display: block; margin-bottom: 3px; padding: 0;
    background: none; border: none; color: #ffb27a;
    font-family: ui-monospace, "Geist Mono", SFMono-Regular, Menlo, Monaco, monospace;
    font-size: 12px; line-height: 1.45; white-space: pre-wrap; word-break: break-word;
  }
  .exline .exp { margin: 0; color: #dadbdf; font-size: 13.5px; line-height: 1.5; }
  .muted { color: #7d8187; }
  .btn { cursor: pointer; padding: 8px 16px; border: 1px solid #212327; border-radius: 9999px; background: transparent; color: #ffffff; font: inherit; }
  .btn:hover { background: #1a1c20; }
  .btn.primary { background: #ffffff; border-color: #ffffff; color: #0a0a0a; }
  .btn.primary:hover { background: #fafaf7; }
  .btn:disabled { opacity: .4; cursor: default; }
  .btn:disabled:hover { background: transparent; }
  .row { display: flex; gap: 8px; align-items: center; }
  .footer { margin-top: 16px; padding-top: 14px; border-top: 1px solid #212327; justify-content: flex-end; }
  /* Previous sits hard-left; Next/Finish stays right. */
  .footer .prev { margin-right: auto; }
  .hint { margin: 12px 0 0; font-size: 12px; line-height: 1.6; color: #7d8187; }
  .hint kbd {
    font-family: ui-monospace, "Geist Mono", SFMono-Regular, Menlo, Monaco, monospace;
    font-size: 11px; padding: 1px 5px; border-radius: 4px;
    border: 1px solid #363a3f; background: #141414; color: #dadbdf;
  }
  .spinner { width: 14px; height: 14px; border: 2px solid #212327; border-top-color: #ffffff; border-radius: 50%; animation: pq-spin .7s linear infinite; flex: none; }
  @keyframes pq-spin { to { transform: rotate(360deg); } }
`;

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Render light markdown inline: `code` -> <code>, *emph* -> <em>. The source
// text is escaped FIRST, so the only HTML we emit is our own fixed tags around
// already-escaped content — no injection risk from quiz/explanation text.
function renderInline(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
}

// Explanations cram every option's verdict into one paragraph. Start each
// "Option N …" clause on its own line so the reasoning is scannable.
function renderExplanation(s: string): string {
  return renderInline(s).replace(/\s+(Option\s+(?:[A-D]|\d+)\b)/g, "<br><br>$1");
}

// Union (viewport coords) of a set of rows — the extent of the highlighted code.
function unionRect(rows: Element[]): { top: number; left: number; right: number; bottom: number } {
  let top = Infinity,
    left = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const r of rows) {
    const b = r.getBoundingClientRect();
    top = Math.min(top, b.top);
    left = Math.min(left, b.left);
    right = Math.max(right, b.right);
    bottom = Math.max(bottom, b.bottom);
  }
  return { top, left, right, bottom };
}

export function destroyExisting(): void {
  document.getElementById(HOST_ID)?.remove();
  document.getElementById(BOX_ID)?.remove();
}

export type CardMode = "quiz" | "learn";

export function openCard(
  rows: Element[],
  handlers: CardHandlers = {},
  mode: CardMode = "quiz",
): CardController {
  // Singleton: remove any prior card/box.
  destroyExisting();

  const isLearn = mode === "learn";
  // Learn mode highlights in green, quiz in the brand orange.
  const accent = isLearn ? "#3fb950" : "#ff7a17";

  const box = document.createElement("div");
  box.id = BOX_ID;
  Object.assign(box.style, {
    position: "fixed",
    border: `2px solid ${accent}`,
    borderRadius: "8px",
    boxShadow: `0 0 0 4px ${isLearn ? "rgba(63,185,80,.15)" : "rgba(255,122,23,.15)"}`,
    pointerEvents: "none",
    zIndex: "9998",
  });

  const host = document.createElement("div");
  host.id = HOST_ID;
  Object.assign(host.style, { position: "absolute", zIndex: "9999" });
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = CSS;
  const card = document.createElement("div");
  card.className = "card";
  root.append(style, card);

  document.body.append(box, host);

  function reposition(): void {
    if (!rows.length) return;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const margin = 12;

    // Highlight box: hug the actual highlighted code (the clicked hunk in quiz
    // mode, the clicked line/block in learn mode), clamped to the file container's
    // width and pinned just UNDER that file's sticky filename header so the top
    // border never crosses the header or the page chrome above it. Fixed
    // positioning = pure viewport coordinates, no scroll math. Hidden when the
    // selection is fully scrolled out of view; reappears when it scrolls back.
    const container = rows[0].closest(CONTAINER_SEL);
    const cb = container?.getBoundingClientRect();
    const u = unionRect(rows);
    const left = Math.max(u.left, cb ? cb.left : 0, 0);
    const right = Math.min(u.right, cb ? cb.right : vw, vw);
    const top = Math.max(u.top, container ? fileHeaderBottom(container) : 0, 0);
    const bottom = Math.min(u.bottom, vh);
    if (bottom <= top || right <= left) {
      box.style.display = "none";
    } else {
      box.style.display = "block";
      box.style.top = top - 2 + "px";
      box.style.left = left - 2 + "px";
      box.style.width = right - left + 4 + "px";
      box.style.height = bottom - top + 4 + "px";
    }

    // Card: fixed in the bottom-right, nested just INSIDE the file column's right
    // edge (not the viewport's) so the popup sits within the file's outline rather
    // than poking past it. Anchored to the column right, not the selection box,
    // so it stays put regardless of how small the highlighted code is.
    const colRight = Math.min(cb ? cb.right : vw, vw);
    host.style.position = "fixed";
    host.style.left = "auto";
    host.style.top = "auto";
    host.style.right = Math.max(margin, vw - colRight + margin) + "px";
    host.style.bottom = margin + "px";
  }

  let rafId = 0;
  let destroyed = false;
  function onScrollResize(): void {
    if (destroyed || rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (!destroyed) reposition();
    });
  }
  window.addEventListener("scroll", onScrollResize, { passive: true, capture: true });
  window.addEventListener("resize", onScrollResize, { passive: true });
  // Rows can shift without a scroll/resize event (an inline comment opens, an
  // adjacent file expands, fonts/images finish layout). Re-position on any body
  // layout change so the box stays glued to the hunk.
  const ro = new ResizeObserver(onScrollResize);
  ro.observe(document.body);

  function destroy(): void {
    destroyed = true;
    if (rafId) cancelAnimationFrame(rafId);
    ro.disconnect();
    window.removeEventListener("scroll", onScrollResize, { capture: true });
    window.removeEventListener("resize", onScrollResize);
    box.remove();
    host.remove();
  }

  function header(title: string): string {
    // Dot is colour-coded by mode: green for learn, orange for quiz.
    return `<div class="hd"><span class="dot" style="background:${accent}"></span><span class="title">${escapeHtml(title)}</span><span class="spacer"></span><button class="x" data-act="close" title="Close">×</button></div>`;
  }

  function wireClose(): void {
    const x = card.querySelector('[data-act="close"]');
    if (x)
      x.addEventListener("click", () => {
        destroy();
        handlers.onClose?.();
      });
  }

  function wireExplainFile(): void {
    card
      .querySelector('[data-act="explainfile"]')
      ?.addEventListener("click", () => handlers.onExplainFile?.());
  }

  function wireStepper(): void {
    card
      .querySelector('[data-act="prev"]')
      ?.addEventListener("click", () => handlers.onPrev?.());
    card
      .querySelector('[data-act="next"]')
      ?.addEventListener("click", () => handlers.onNext?.());
    card
      .querySelector('[data-act="finish"]')
      ?.addEventListener("click", () => handlers.onFinish?.());
  }

  // Stepper footer: "← Previous" hard-left (shown only in a multi-question set,
  // disabled on the first), and on the right either "Next question →" or, on the
  // last question, "Finish" (which closes the card).
  function stepperFooter(position?: QuizPosition): string {
    if (!position) return "";
    const { index, total } = position;
    const prev =
      total > 1
        ? `<button class="btn prev" data-act="prev"${index <= 0 ? " disabled" : ""}>← Previous</button>`
        : "";
    const right =
      index >= total - 1
        ? `<button class="btn primary" data-act="finish">Finish</button>`
        : `<button class="btn primary" data-act="next">Next question →</button>`;
    return `<div class="row footer">${prev}${right}</div>`;
  }
  // Shortcut reminder shown at the bottom of every card view.
  const modeHint = `<p class="hint">Press <kbd>⌘⇧L</kbd> (or <kbd>Ctrl⇧L</kbd>) to swap between Quiz and Learn mode.</p>`;

  const api: CardController = {
    reposition,
    destroy,

    showLoading() {
      card.innerHTML =
        header(isLearn ? "PRep · Learning" : "PRep · Quiz") +
        `<div class="body"><div class="row muted"><span class="spinner"></span><span>Generating ${isLearn ? "an explanation" : "a question"}…</span></div></div>`;
      wireClose();
      reposition();
    },

    showQuestion(quiz: Quiz, position?: QuizPosition) {
      const opts = quiz.options
        .map(
          (o, i) =>
            `<button class="opt" data-index="${i}"><span class="key">${"ABCD"[i]}</span><span>${renderInline(o)}</span></button>`,
        )
        .join("");
      const title =
        position && position.total > 1
          ? `Question ${position.index + 1} of ${position.total}`
          : "What does this code do?";
      card.innerHTML =
        header(title) +
        `<div class="body"><p class="q">${renderInline(quiz.question)}</p><div class="opts">${opts}</div>${stepperFooter(position)}${modeHint}</div>`;
      wireClose();
      wireStepper();
      card.querySelectorAll<HTMLButtonElement>(".opt").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.index);
          card.querySelectorAll<HTMLButtonElement>(".opt").forEach((b) => (b.disabled = true));
          handlers.onAnswer?.(idx);
        });
      });
      reposition();
    },

    showResult(result: QuizResult) {
      const opts = card.querySelectorAll<HTMLButtonElement>(".opt");
      if (opts.length) {
        opts.forEach((b) => (b.disabled = true));
        opts[result.correctIndex]?.classList.add("correct");
        if (!result.correct) opts[result.chosenIndex]?.classList.add("wrong");
      }
      const body = card.querySelector(".body")!;
      body.querySelector(".status")?.remove();
      const status = document.createElement("p");
      status.className = "status " + (result.correct ? "ok" : "bad");
      status.textContent = result.correct ? "✓ Correct" : "✗ Not quite";
      body.insertBefore(status, body.firstChild);
      // Explanation shown after every answer — right or wrong.
      if (result.explanation) {
        const ex = document.createElement("div");
        ex.className = "explain";
        ex.innerHTML = `<h5>Explanation</h5><p>${renderExplanation(result.explanation)}</p>`;
        body.appendChild(ex);
      }
      // Keep the "New question" footer + hint at the very bottom, below the explanation.
      const footer = body.querySelector(".footer");
      if (footer) body.appendChild(footer);
      const hint = body.querySelector(".hint");
      if (hint) body.appendChild(hint);
      reposition();
    },

    showExplanation(explanation: Explanation) {
      // No full code block — the highlighted GitHub hunk is already visible.
      // Just the summary, then short per-line notes below.
      const lines = explanation.lines
        .map(
          (l) =>
            `<div class="exline"><code class="ln">${escapeHtml(l.code)}</code><p class="exp">${renderInline(l.explanation)}</p></div>`,
        )
        .join("");
      // Offer a step up to a whole-file overview from any line/block explanation.
      const fileFooter = `<div class="row footer"><button class="btn" data-act="explainfile">Explain whole file</button></div>`;
      card.innerHTML =
        header("What does this do?") +
        `<div class="body">` +
        `<p class="q">${renderInline(explanation.summary)}</p>` +
        `<div class="exlines">${lines}</div>${fileFooter}${modeHint}</div>`;
      wireClose();
      wireExplainFile();
      reposition();
    },

    showFileOverview(overview: FileOverview) {
      // Sectioned overview of the whole file — one summary plus a handful of
      // logical sections (function/type/responsibility), not a per-line dump.
      const sections = overview.sections
        .map(
          (s) =>
            `<div class="exline"><code class="ln">${escapeHtml(s.title)}</code><p class="exp">${renderInline(s.explanation)}</p></div>`,
        )
        .join("");
      card.innerHTML =
        header("What does this file do?") +
        `<div class="body">` +
        `<p class="q">${renderInline(overview.summary)}</p>` +
        `<div class="exlines">${sections}</div>${modeHint}</div>`;
      wireClose();
      reposition();
    },

    showError(message: string, canRetry: boolean) {
      card.innerHTML =
        header("PRep") +
        `<div class="body"><p class="status bad">Couldn't generate a question.</p><p class="muted">${escapeHtml(message || "Unknown error")}</p>${canRetry ? `<div class="row" style="margin-top:10px"><button class="btn primary" data-act="retry">Retry</button></div>` : ""}</div>`;
      wireClose();
      const retry = card.querySelector('[data-act="retry"]');
      if (retry) retry.addEventListener("click", () => handlers.onRetry?.());
      reposition();
    },

    showNeedsKey() {
      card.innerHTML =
        header("Setup needed") +
        `<div class="body"><p>Set your Portkey API key to start quizzing.</p><p class="muted" style="margin-top:8px">Click the <b>PRep</b> icon in your browser toolbar to open settings.</p></div>`;
      wireClose();
      reposition();
    },
  };

  return api;
}
