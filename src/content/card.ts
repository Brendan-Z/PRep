// The minimal quiz UI. Two absolutely-positioned elements appended to <body>, so
// GitHub's diff table is NEVER mutated:
//   1. an overlay "box" drawn around the targeted hunk
//   2. a Shadow-DOM card (CSS fully encapsulated)
//
// xAI design language: near-black canvas, white-pill interactives, hairline
// borders, Inter body + monospace uppercase eyebrows. Dark only.

import type { Quiz } from "../shared/quiz";

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
  showQuestion(quiz: Quiz): void;
  showResult(result: QuizResult): void;
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
    overflow: hidden;
  }
  .hd { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid #212327; }
  .hd .dot { width: 8px; height: 8px; border-radius: 9999px; background: #ff7a17; flex: none; }
  .hd .title {
    font-family: ui-monospace, "Geist Mono", SFMono-Regular, Menlo, Monaco, monospace;
    font-size: 12px; letter-spacing: 1.2px; text-transform: uppercase; color: #7d8187;
  }
  .hd .spacer { flex: 1; }
  .hd .x { cursor: pointer; border: 1px solid #212327; background: transparent; color: #dadbdf; font-size: 15px; line-height: 1; width: 24px; height: 24px; border-radius: 9999px; }
  .hd .x:hover { background: #1a1c20; color: #ffffff; }
  .body { padding: 16px; }
  .q { font-size: 16px; line-height: 24px; margin: 0 0 14px; color: #ffffff; }
  .opts { display: flex; flex-direction: column; gap: 8px; }
  .opt {
    text-align: left; cursor: pointer; width: 100%;
    padding: 10px 14px; border: 1px solid #212327; border-radius: 9999px;
    background: transparent; color: #dadbdf; font: inherit; display: flex; gap: 10px; align-items: baseline;
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
  .muted { color: #7d8187; }
  .btn { cursor: pointer; padding: 8px 16px; border: 1px solid #212327; border-radius: 9999px; background: transparent; color: #ffffff; font: inherit; }
  .btn:hover { background: #1a1c20; }
  .btn.primary { background: #ffffff; border-color: #ffffff; color: #0a0a0a; }
  .btn.primary:hover { background: #fafaf7; }
  .row { display: flex; gap: 8px; align-items: center; }
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

export function openCard(rows: Element[], handlers: CardHandlers = {}): CardController {
  // Singleton: remove any prior card/box.
  destroyExisting();

  const box = document.createElement("div");
  box.id = BOX_ID;
  Object.assign(box.style, {
    position: "fixed",
    border: "2px solid #ff7a17",
    borderRadius: "8px",
    boxShadow: "0 0 0 4px rgba(255,122,23,.15)",
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
    const u = unionRect(rows); // viewport coordinates
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    // Highlight box is clamped to the visible viewport slice of the hunk and
    // pinned with position:fixed. A large hunk (e.g. a whole newly-added file)
    // is taller/wider than the screen, so drawing its full union rect paints
    // orange side-rails that run the length of the page and linger as you
    // scroll past it. Clamping to [0, viewport] keeps the rails the height of
    // the visible slice; once the hunk scrolls fully out of view the box hides.
    const container = rows[0].closest(CONTAINER_SEL);
    const cb = container?.getBoundingClientRect();
    const vLeft = Math.max(u.left, cb ? cb.left : 0);
    const vRight = Math.min(u.right, cb ? cb.right : vw, vw);
    const vTop = Math.max(u.top, 0);
    const vBottom = Math.min(u.bottom, vh);
    if (vBottom <= vTop || vRight <= vLeft) {
      box.style.display = "none";
    } else {
      box.style.display = "block";
      box.style.top = vTop - 2 + "px";
      box.style.left = vLeft - 2 + "px";
      box.style.width = vRight - vLeft + 4 + "px";
      box.style.height = vBottom - vTop + 4 + "px";
    }

    // Card hovers on the right side of the diff (fixed to the viewport) so the
    // reviewer can scroll and read the code while answering. It tracks the
    // hunk vertically but is always clamped fully inside the viewport.
    const margin = 12;
    const cardH = card.getBoundingClientRect().height;
    const maxTop = Math.max(margin, vh - cardH - margin);
    const top = Math.min(Math.max(u.top, margin), maxTop);
    host.style.position = "fixed";
    host.style.left = "auto";
    host.style.right = margin + "px";
    host.style.top = top + "px";
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
    return `<div class="hd"><span class="dot"></span><span class="title">${escapeHtml(title)}</span><span class="spacer"></span><button class="x" data-act="close" title="Close">×</button></div>`;
  }

  function wireClose(): void {
    const x = card.querySelector('[data-act="close"]');
    if (x)
      x.addEventListener("click", () => {
        destroy();
        handlers.onClose?.();
      });
  }

  const api: CardController = {
    reposition,
    destroy,

    showLoading() {
      card.innerHTML =
        header("PRep") +
        `<div class="body"><div class="row muted"><span class="spinner"></span><span>Generating a question…</span></div></div>`;
      wireClose();
      reposition();
    },

    showQuestion(quiz: Quiz) {
      const opts = quiz.options
        .map(
          (o, i) =>
            `<button class="opt" data-index="${i}"><span class="key">${"ABCD"[i]}</span><span>${escapeHtml(o)}</span></button>`,
        )
        .join("");
      card.innerHTML =
        header("What does this code do?") +
        `<div class="body"><p class="q">${escapeHtml(quiz.question)}</p><div class="opts">${opts}</div></div>`;
      wireClose();
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
        ex.innerHTML = `<h5>Explanation</h5><p>${escapeHtml(result.explanation)}</p>`;
        body.appendChild(ex);
      }
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
