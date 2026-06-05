// mock-inject.js — a MOCK version of the extension for local testing.
//
// It runs the real selectors.js + card.js UI logic in the page, but replaces the
// Portkey-backed background worker with a CANNED quiz generator and in-page scoring.
// This lets you exercise the full click -> box -> card -> answer -> explanation -> score
// flow on a real GitHub PR without an API key or the extension loaded.
//
// Inject it via DevTools (console or evaluate_script). It bypasses page CSP that way.
// correctIndex is always 1 (option "B"), so option B = correct, others = wrong.

(function () {
  const PQ = (window.PQ = window.PQ || {});

  // =========================================================================
  // selectors (mirrors selectors.js)
  // =========================================================================
  const ROW_SELECTOR = ".diff-line-row, tr:has(td.blob-code)";
  const NBSP = String.fromCharCode(160);

  function detectView() {
    if (document.querySelector('.diff-line-row, [class^="Diff-module__diffTargetable"]')) return "react";
    if (document.querySelector(".js-diff-table, .js-file, td.blob-num")) return "classic";
    return "none";
  }
  function rowView(row) {
    return row.matches(".diff-line-row") ? "react" : "classic";
  }
  function isCodeRow(el, view) {
    if (!el || el.nodeType !== 1) return false;
    if (view === "react") {
      if (!el.matches(".diff-line-row")) return false;
      if (el.querySelector("button[data-direction]")) return false;
      return !!el.querySelector(".diff-text-inner");
    }
    if (el.tagName !== "TR") return false;
    if (el.classList.contains("js-expandable-line")) return false;
    if (el.querySelector("td.blob-num-hunk")) return false;
    return !!el.querySelector("td.blob-code .blob-code-inner, td.blob-code-inner");
  }
  function codeTextOfRow(row, view) {
    const sel = view === "react" ? ".diff-text-inner" : ".blob-code-inner";
    const el = row.querySelector(sel);
    return el ? el.textContent : "";
  }
  function fileContainer(row, view) {
    return view === "react"
      ? row.closest('[class^="Diff-module__diffTargetable"]')
      : row.closest(".js-file, [data-tagsearch-path]");
  }
  function fileName(row, view) {
    const c = fileContainer(row, view);
    if (!c) return "";
    if (view === "classic") {
      const header = c.querySelector(".file-header");
      return (
        (header && header.getAttribute("data-path")) ||
        c.getAttribute("data-tagsearch-path") ||
        (c.querySelector(".file-info a[title]") || {}).title ||
        ""
      );
    }
    const candidate =
      c.querySelector('[data-testid="file-name"]') || c.querySelector("a[title]") || c.querySelector("h3 a, h2 a");
    const text = candidate ? (candidate.getAttribute("title") || candidate.textContent || "").trim() : "";
    if (text && (text.includes("/") || text.includes("."))) return text;
    return text || "";
  }
  function changeKind(row, view) {
    if (view === "classic") {
      if (row.querySelector(".blob-code-addition")) return "added lines";
      if (row.querySelector(".blob-code-deletion")) return "removed lines";
      return "context";
    }
    if (row.querySelector('[data-code-marker="+"], [class*="addition" i]')) return "added lines";
    if (row.querySelector('[data-code-marker="-"], [class*="deletion" i]')) return "removed lines";
    return "";
  }
  const EXT_LANG = {
    js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", py: "python",
    rb: "ruby", go: "go", rs: "rust", java: "java", md: "markdown", json: "json", yml: "yaml", yaml: "yaml",
  };
  function languageFromName(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || "");
    return m ? EXT_LANG[m[1].toLowerCase()] || "" : "";
  }
  function getRowInfo(row) {
    const view = rowView(row);
    const name = fileName(row, view);
    return { fileName: name, language: languageFromName(name), kind: changeKind(row, view) };
  }
  function getHunkRows(row) {
    const view = rowView(row);
    if (!isCodeRow(row, view)) return [];
    const before = [];
    for (let p = row; isCodeRow(p, view); p = p.previousElementSibling) before.push(p);
    before.reverse();
    const after = [];
    for (let n = row.nextElementSibling; isCodeRow(n, view); n = n.nextElementSibling) after.push(n);
    return before.concat(after);
  }
  function getHunkText(row) {
    const view = rowView(row);
    const rows = getHunkRows(row);
    if (!rows.length) return "";
    let text = rows.map((r) => codeTextOfRow(r, view)).join("\n").split(NBSP).join(" ");
    if (text.length > 4000) text = text.slice(0, 4000) + "\n… (truncated)";
    return text.trim();
  }
  function hashKey(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return "h" + (h >>> 0).toString(36);
  }
  PQ.selectors = { ROW_SELECTOR, detectView, getRowInfo, getHunkText, getHunkRows, isCodeRow, rowView, hashKey };

  // =========================================================================
  // card (mirrors card.js)
  // =========================================================================
  const HOST_ID = "pq-card-host";
  const BOX_ID = "pq-box";
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .card { font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color:#1f2328; background:#fff; border:1px solid #d0d7de; border-radius:8px; box-shadow:0 8px 24px rgba(31,35,40,.2); width:460px; max-width:calc(100vw - 24px); overflow:hidden; }
    .hd { display:flex; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid #eaeef2; background:#f6f8fa; }
    .hd .dot { width:8px; height:8px; border-radius:50%; background:#8250df; flex:none; }
    .hd .title { font-weight:600; font-size:12px; letter-spacing:.02em; text-transform:uppercase; color:#57606a; }
    .hd .spacer { flex:1; }
    .hd .x { cursor:pointer; border:0; background:transparent; color:#57606a; font-size:16px; line-height:1; padding:2px 6px; border-radius:6px; }
    .body { padding:12px; }
    .q { font-weight:600; margin:0 0 10px; }
    .opts { display:flex; flex-direction:column; gap:6px; }
    .opt { text-align:left; cursor:pointer; width:100%; padding:8px 10px; border:1px solid #d0d7de; border-radius:6px; background:#fff; color:#1f2328; font:inherit; display:flex; gap:8px; align-items:baseline; }
    .opt:hover:not(:disabled) { background:#f3f4f6; }
    .opt .key { font-weight:700; color:#57606a; flex:none; }
    .opt.correct { border-color:#1a7f37; background:#dafbe1; }
    .opt.correct .key { color:#1a7f37; }
    .opt.wrong { border-color:#cf222e; background:#ffebe9; }
    .opt.wrong .key { color:#cf222e; }
    .status { margin:0 0 10px; font-weight:600; }
    .status.ok { color:#1a7f37; }
    .status.bad { color:#cf222e; }
    .meta { font-weight:400; color:#57606a; font-size:12px; }
    .explain { margin-top:10px; padding:10px; background:#f6f8fa; border:1px solid #eaeef2; border-radius:6px; }
    .explain h5 { margin:0 0 6px; font-size:12px; text-transform:uppercase; color:#57606a; }
    .explain p { margin:0; white-space:pre-wrap; }
    .muted { color:#57606a; }
    .spinner { width:14px; height:14px; border:2px solid #d0d7de; border-top-color:#8250df; border-radius:50%; animation:pq-spin .7s linear infinite; flex:none; }
    @keyframes pq-spin { to { transform: rotate(360deg); } }
    .row { display:flex; gap:8px; align-items:center; }
  `;
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function unionRect(rows) {
    let top = Infinity, left = Infinity, right = -Infinity, bottom = -Infinity;
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      top = Math.min(top, b.top); left = Math.min(left, b.left);
      right = Math.max(right, b.right); bottom = Math.max(bottom, b.bottom);
    }
    return { top, left, right, bottom };
  }
  function destroyExisting() {
    const h = document.getElementById(HOST_ID); if (h) h.remove();
    const b = document.getElementById(BOX_ID); if (b) b.remove();
  }
  function open(rows, handlers) {
    handlers = handlers || {};
    destroyExisting();
    const box = document.createElement("div");
    box.id = BOX_ID;
    Object.assign(box.style, { position: "absolute", border: "2px solid #8250df", borderRadius: "6px", boxShadow: "0 0 0 4px rgba(130,80,223,.15)", pointerEvents: "none", zIndex: "9998" });
    const host = document.createElement("div");
    host.id = HOST_ID;
    Object.assign(host.style, { position: "absolute", zIndex: "9999" });
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style"); style.textContent = CSS;
    const card = document.createElement("div"); card.className = "card";
    root.append(style, card);
    document.body.append(box, host);
    function reposition() {
      if (!rows.length) return;
      const u = unionRect(rows), sx = window.scrollX, sy = window.scrollY;
      box.style.top = u.top + sy - 2 + "px"; box.style.left = u.left + sx - 2 + "px";
      box.style.width = u.right - u.left + 4 + "px"; box.style.height = u.bottom - u.top + 4 + "px";
      host.style.top = u.bottom + sy + 8 + "px"; host.style.left = u.left + sx + "px";
    }
    let rafId = 0, destroyed = false;
    function onSR() { if (destroyed || rafId) return; rafId = requestAnimationFrame(() => { rafId = 0; if (!destroyed) reposition(); }); }
    window.addEventListener("scroll", onSR, { passive: true, capture: true });
    window.addEventListener("resize", onSR, { passive: true });
    const ro = new ResizeObserver(onSR); ro.observe(document.body);
    function destroy() { destroyed = true; if (rafId) cancelAnimationFrame(rafId); ro.disconnect(); window.removeEventListener("scroll", onSR, { capture: true }); window.removeEventListener("resize", onSR); box.remove(); host.remove(); }
    function header(t) { return `<div class="hd"><span class="dot"></span><span class="title">${escapeHtml(t)}</span><span class="spacer"></span><button class="x" data-act="close" title="Close">×</button></div>`; }
    function wireClose() { const x = card.querySelector('[data-act="close"]'); if (x) x.addEventListener("click", () => { destroy(); if (handlers.onClose) handlers.onClose(); }); }
    const api = {
      reposition, destroy,
      showLoading() { card.innerHTML = header("Code Quiz") + `<div class="body"><div class="row muted"><span class="spinner"></span><span>Generating a question…</span></div></div>`; wireClose(); reposition(); },
      showQuestion(quiz) {
        const opts = quiz.options.map((o, i) => `<button class="opt" data-index="${i}"><span class="key">${"ABCD"[i]}</span><span>${escapeHtml(o)}</span></button>`).join("");
        card.innerHTML = header("What does this code do?") + `<div class="body"><p class="q">${escapeHtml(quiz.question)}</p><div class="opts">${opts}</div></div>`;
        wireClose();
        card.querySelectorAll(".opt").forEach((btn) => btn.addEventListener("click", () => { card.querySelectorAll(".opt").forEach((b) => (b.disabled = true)); if (handlers.onAnswer) handlers.onAnswer(Number(btn.dataset.index)); }));
        reposition();
      },
      showResult(r) {
        const opts = card.querySelectorAll(".opt");
        if (opts.length) { opts.forEach((b) => (b.disabled = true)); if (opts[r.correctIndex]) opts[r.correctIndex].classList.add("correct"); if (!r.correct && opts[r.chosenIndex]) opts[r.chosenIndex].classList.add("wrong"); }
        const body = card.querySelector(".body");
        const status = document.createElement("p");
        if (r.correct) { status.className = "status ok"; status.innerHTML = `✓ Correct! <span class="meta">${escapeHtml(String(r.points))} pts · streak ${escapeHtml(String(r.streak))}</span>`; }
        else { status.className = "status bad"; status.textContent = "✗ Not quite — here's what the code actually does:"; }
        body.insertBefore(status, body.firstChild);
        if (!r.correct && r.explanation) { const ex = document.createElement("div"); ex.className = "explain"; ex.innerHTML = `<h5>Explanation</h5><p>${escapeHtml(r.explanation)}</p>`; body.appendChild(ex); }
        reposition();
      },
      showError(m, retry) { card.innerHTML = header("Code Quiz") + `<div class="body"><p class="status bad">Couldn't generate a question.</p><p class="muted">${escapeHtml(m || "")}</p>${retry ? `<div class="row" style="margin-top:10px"><button class="opt" data-act="retry">Retry</button></div>` : ""}</div>`; wireClose(); const r = card.querySelector('[data-act="retry"]'); if (r) r.addEventListener("click", () => handlers.onRetry && handlers.onRetry()); reposition(); },
      showNeedsKey() { card.innerHTML = header("Setup needed") + `<div class="body"><p>Set your Portkey API key to start quizzing.</p></div>`; wireClose(); reposition(); },
    };
    return api;
  }
  PQ.card = { open, destroyExisting };

  // =========================================================================
  // MOCK content layer (replaces content.js + background worker)
  // =========================================================================
  const { selectors, card } = PQ;
  let currentCard = null, active = null;
  const stats = { points: 0, streak: 0, bestStreak: 0, answered: 0, correct: 0, accuracy: 0, badges: [], answeredHunks: {} };
  window.__pqStats = stats;

  function mockQuiz(payload) {
    const first = (payload.code || "").split("\n").map((l) => l.trim()).find(Boolean) || "this block";
    return {
      question: "What does this changed block in " + (payload.fileName || "the file") + " do?",
      options: [
        "It deletes the repository on save",
        "It handles: " + first.slice(0, 60),
        "It starts a web server on port 8080",
        "Nothing — it is only a comment",
      ],
      correctIndex: 1,
      explanation:
        "MOCK EXPLANATION (no Portkey call was made).\n\nThe selected block:\n" +
        (payload.code || "").slice(0, 280) +
        "\n\nThe real extension returns a model-generated, junior-friendly breakdown here.",
    };
  }

  function recordResult(correct, hunkKey) {
    if (hunkKey && Object.prototype.hasOwnProperty.call(stats.answeredHunks, hunkKey)) return stats;
    stats.answered += 1;
    if (correct) { stats.correct += 1; stats.streak += 1; stats.points += 10 + Math.max(0, stats.streak - 1) * 2; if (stats.streak > stats.bestStreak) stats.bestStreak = stats.streak; }
    else stats.streak = 0;
    stats.accuracy = stats.answered ? Math.round((100 * stats.correct) / stats.answered) : 0;
    if (hunkKey) stats.answeredHunks[hunkKey] = !!correct;
    return stats;
  }

  function closeCard() { if (currentCard) { currentCard.destroy(); currentCard = null; } active = null; }
  function handlers() {
    return {
      onClose: () => { currentCard = null; active = null; },
      onRetry: () => { if (active) requestQuiz(); },
      onOpenOptions: () => {},
      onAnswer: (idx) => grade(idx),
    };
  }
  function requestQuiz() {
    if (!active || !currentCard) return;
    currentCard.showLoading();
    setTimeout(() => { if (!currentCard) return; active.quiz = mockQuiz(active.payload); currentCard.showQuestion(active.quiz); }, 450);
  }
  function grade(idx) {
    if (!active || !active.quiz || !currentCard) return;
    const correct = idx === active.quiz.correctIndex;
    const s = recordResult(correct, active.hunkKey);
    currentCard.showResult({ correct, chosenIndex: idx, correctIndex: active.quiz.correctIndex, explanation: active.quiz.explanation, points: s.points, streak: s.streak });
  }
  function openQuiz(rows, info, code) {
    closeCard();
    const payload = { code, fileName: info.fileName, language: info.language, kind: info.kind };
    const hunkKey = selectors.hashKey((info.fileName || "") + "\n" + code);
    active = { payload, hunkKey, quiz: null };
    currentCard = card.open(rows, handlers());
    requestQuiz();
  }

  const IGNORE = "a, button, [role='button'], summary, input, textarea, label, .blob-num, .diff-line-number, [data-direction], [data-testid='comment-button']";
  function onClick(e) {
    if (e.button !== 0 || e.detail > 1) return;
    if (e.target.closest(IGNORE)) return;
    const sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed && String(sel).trim() && sel.containsNode(e.target, true)) return;
    const rowEl = e.target.closest(".diff-line-row, tr");
    if (!rowEl) return;
    const view = selectors.rowView(rowEl);
    if (!selectors.isCodeRow(rowEl, view)) return;
    const rows = selectors.getHunkRows(rowEl);
    if (!rows.length) return;
    const code = selectors.getHunkText(rowEl);
    if (!code) return;
    openQuiz(rows, selectors.getRowInfo(rowEl), code);
  }

  document.addEventListener("click", onClick);
  const hint = document.createElement("style");
  hint.textContent = ".blob-code-inner, .diff-text-inner { cursor: pointer; }";
  document.head.appendChild(hint);

  // Test hook: open a quiz on the Nth real code row without a click.
  PQ.__openOnRow = function (n) {
    n = n || 0;
    const view = selectors.detectView();
    const allRows = [...document.querySelectorAll("tr, .diff-line-row")].filter((r) => selectors.isCodeRow(r, selectors.rowView(r)));
    const row = allRows[n];
    if (!row) return { ok: false, codeRows: allRows.length };
    onClick({ button: 0, detail: 1, target: row.querySelector(".blob-code-inner, .diff-text-inner") || row });
    return { ok: true, codeRows: allRows.length, view };
  };

  window.__pqMockInstalled = true;
  console.log("[PR Quiz mock] installed — view:", selectors.detectView());
})();
