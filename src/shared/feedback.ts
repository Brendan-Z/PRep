// Builds a prefilled GitHub "new issue" URL so the user can file feedback without
// the extension ever holding a token: the button opens this URL in a tab and the
// user submits using their own GitHub login. The body carries a structured,
// auto-collected context block so the triage automation can parse intent.

// Single source of truth for the slug. Update here if the repo moves orgs.
export const FEEDBACK_REPO = "Brendan-Z/PRep";

// The label the triage workflow gates on. Every feedback issue carries it.
export const FEEDBACK_LABEL = "feedback";

export interface FeedbackContext {
  version?: string;
  mode?: "quiz" | "learn";
  pageUrl?: string;
  fileName?: string;
  language?: string;
  code?: string;
}

// Markdown body: a free-text prompt for the user on top, then a fenced,
// machine-parseable context block the agent reads. Kept pure for unit testing.
export function buildFeedbackBody(ctx: FeedbackContext): string {
  const lines: string[] = [
    "<!-- Describe your feedback above this line, then click Submit. -->",
    "",
    "### What's this about?",
    "",
    "_Bug report or feature request? What did you expect, and what happened?_",
    "",
    "",
    "---",
    "<sub>Auto-collected by PRep — please keep for triage.</sub>",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Version | ${ctx.version ?? "unknown"} |`,
    `| Mode | ${ctx.mode ?? "n/a"} |`,
    `| Page | ${ctx.pageUrl ?? "n/a"} |`,
    `| File | ${ctx.fileName ?? "n/a"} |`,
  ];
  if (ctx.code?.trim()) {
    lines.push("", "<details><summary>Code in context</summary>", "");
    lines.push("```" + (ctx.language ?? ""));
    lines.push(ctx.code.trim());
    lines.push("```", "", "</details>");
  }
  return lines.join("\n");
}

function buildFeedbackTitle(ctx: FeedbackContext): string {
  return ctx.fileName ? `[feedback] ${ctx.fileName}` : "[feedback] ";
}

export function buildFeedbackUrl(ctx: FeedbackContext = {}): string {
  const params = new URLSearchParams({
    labels: FEEDBACK_LABEL,
    title: buildFeedbackTitle(ctx),
    body: buildFeedbackBody(ctx),
  });
  return `https://github.com/${FEEDBACK_REPO}/issues/new?${params.toString()}`;
}
