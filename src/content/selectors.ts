// The SINGLE place all GitHub DOM coupling lives. If GitHub changes its diff
// markup, this is the only file to edit.
//
// Two diff views exist and BOTH are supported:
//   - React "Files changed" view  (default on github.com since 2026-01-22)
//   - Classic table view          (still common on GitHub Enterprise Server)
// React CSS-module classes are hashed, so we match them by PREFIX only.

export type DiffView = "react" | "classic" | "none";
type CodeView = "react" | "classic";

export interface RowInfo {
  fileName: string;
  language: string;
  kind: string;
}

export function detectView(): DiffView {
  if (document.querySelector('.diff-line-row, [class^="Diff-module__diffTargetable"]')) return "react";
  if (document.querySelector(".js-diff-table, .js-file, td.blob-num")) return "classic";
  return "none";
}

export function rowView(row: Element): CodeView {
  return row.matches(".diff-line-row") ? "react" : "classic";
}

// Is `el` a real code line row (not a hunk header / expander / file boundary)?
export function isCodeRow(el: Element | null, view: CodeView): boolean {
  if (!el || el.nodeType !== 1) return false;
  if (view === "react") {
    if (!el.matches(".diff-line-row")) return false;
    if (el.querySelector("button[data-direction]")) return false; // expander boundary
    return !!el.querySelector(".diff-text-inner");
  }
  if (el.tagName !== "TR") return false;
  if (el.classList.contains("js-expandable-line")) return false;
  if (el.querySelector("td.blob-num-hunk")) return false;
  return !!el.querySelector("td.blob-code .blob-code-inner, td.blob-code-inner");
}

function codeTextOfRow(row: Element, view: CodeView): string {
  const sel = view === "react" ? ".diff-text-inner" : ".blob-code-inner";
  const el = row.querySelector(sel);
  return el?.textContent ?? "";
}

function fileContainer(row: Element, view: CodeView): Element | null {
  return view === "react"
    ? row.closest('[class^="Diff-module__diffTargetable"]')
    : row.closest(".js-file, [data-tagsearch-path]");
}

function fileName(row: Element, view: CodeView): string {
  const c = fileContainer(row, view);
  if (!c) return "";
  if (view === "classic") {
    const header = c.querySelector(".file-header");
    const titleEl = c.querySelector(".file-info a[title]");
    return (
      header?.getAttribute("data-path") ||
      c.getAttribute("data-tagsearch-path") ||
      titleEl?.getAttribute("title") ||
      ""
    );
  }
  // React: file-name location is not stably documented — try a few, then heuristic.
  const candidate =
    c.querySelector('[data-testid="file-name"]') ||
    c.querySelector("a[title]") ||
    c.querySelector("h3 a, h2 a");
  const text = candidate ? (candidate.getAttribute("title") || candidate.textContent || "").trim() : "";
  return text;
}

// Add/remove/context. Non-blocking metadata — the quiz only needs the code text.
function changeKind(row: Element, view: CodeView): string {
  if (view === "classic") {
    if (row.querySelector(".blob-code-addition")) return "added lines";
    if (row.querySelector(".blob-code-deletion")) return "removed lines";
    return "context";
  }
  // React encodes line type in undocumented/hashed data-* — best effort only.
  if (row.querySelector('[data-code-marker="+"], [class*="addition" i]')) return "added lines";
  if (row.querySelector('[data-code-marker="-"], [class*="deletion" i]')) return "removed lines";
  return "";
}

const EXT_LANG: Record<string, string> = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
  kt: "kotlin", swift: "swift", c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp",
  cs: "csharp", php: "php", scala: "scala", sh: "bash", bash: "bash",
  sql: "sql", html: "html", css: "css", scss: "scss", json: "json",
  yml: "yaml", yaml: "yaml", xml: "xml", md: "markdown",
};

function languageFromName(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name || "");
  return m ? EXT_LANG[m[1].toLowerCase()] || "" : "";
}

export function getRowInfo(row: Element): RowInfo {
  const view = rowView(row);
  const name = fileName(row, view);
  return { fileName: name, language: languageFromName(name), kind: changeKind(row, view) };
}

// Collect the contiguous code-line rows of the hunk containing `row`.
export function getHunkRows(row: Element): Element[] {
  const view = rowView(row);
  if (!isCodeRow(row, view)) return [];

  const before: Element[] = [];
  for (let p: Element | null = row; isCodeRow(p, view); p = p!.previousElementSibling) before.push(p!);
  before.reverse(); // now ends with `row`

  const after: Element[] = [];
  for (let n = row.nextElementSibling; isCodeRow(n, view); n = n!.nextElementSibling) after.push(n!);

  return before.concat(after);
}

// The file container element for a row — used as a stable per-file cache key and
// to bound shift+click ranges to a single file.
export function getFileContainer(row: Element): Element | null {
  return fileContainer(row, rowView(row));
}

// All code-line rows within a file container, in document order.
function allCodeRows(container: Element, view: CodeView): Element[] {
  const sel = view === "react" ? ".diff-line-row" : "tr";
  return Array.from(container.querySelectorAll(sel)).filter((r) => isCodeRow(r, view));
}

// Inclusive range of code rows between two clicked rows in the SAME file. Used by
// learn-mode shift+click. Returns [] if the rows are in different files.
export function getRowRange(a: Element, b: Element): Element[] {
  const view = rowView(a);
  const container = fileContainer(a, view);
  if (!container || fileContainer(b, view) !== container) return [];
  const all = allCodeRows(container, view);
  const ia = all.indexOf(a);
  const ib = all.indexOf(b);
  if (ia === -1 || ib === -1) return [];
  const [lo, hi] = ia <= ib ? [ia, ib] : [ib, ia];
  return all.slice(lo, hi + 1);
}

// Concatenated code text of an arbitrary set of rows (learn-mode line/block,
// or a whole file for quiz mode). `limit` caps the characters sent to the model.
export function getRowsText(rows: Element[], limit = 4000): string {
  if (!rows.length) return "";
  const view = rowView(rows[0]);
  let text = rows
    .map((r) => codeTextOfRow(r, view))
    .join("\n")
    .replace(new RegExp(String.fromCharCode(160), "g"), " ");
  if (text.length > limit) text = text.slice(0, limit) + "\n… (truncated)";
  return text.trim();
}

// Every code row in the file containing `row`, across all hunks (changed +
// context). Used for whole-file quiz generation and its highlight box.
export function getFileRows(row: Element): Element[] {
  const view = rowView(row);
  const container = fileContainer(row, view);
  if (!container) return [];
  return allCodeRows(container, view);
}

// Concatenated code text of the hunk containing `row`.
export function getHunkText(row: Element): string {
  const view = rowView(row);
  const rows = getHunkRows(row);
  if (!rows.length) return "";
  let text = rows
    .map((r) => codeTextOfRow(r, view))
    .join("\n")
    // GitHub uses U+00A0 (nbsp) for some indentation — normalize to a plain space.
    .replace(new RegExp(String.fromCharCode(160), "g"), " ");
  if (text.length > 4000) text = text.slice(0, 4000) + "\n… (truncated)";
  return text.trim();
}
