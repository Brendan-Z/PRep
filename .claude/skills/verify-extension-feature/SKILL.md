---
name: verify-extension-feature
description: >
  Validates that a PRep extension change actually works by building the extension,
  loading it in a real Chromium via the e2e harness, capturing Playwright
  screenshots of the affected UI, and posting them to the PR as visual evidence.
  Use after implementing a feedback/feature request, before marking the PR ready.
argument-hint: "<pr-number> <short description of the feature to verify>"
arguments: [pr_number, feature]
---

# Verify Extension Feature

End-to-end visual validation for the PRep MV3 extension. The card UI lives in a
Shadow DOM injected by the content script, so it can **only** be screenshotted with
the extension loaded — `mcp__playwright` alone cannot `--load-extension`. This skill
uses the repo's `e2e/` harness (persistent context + `--load-extension=dist`).

## When to use

- Right after `pw-fix-github-issue` implements a feedback/feature request.
- Whenever a PR needs proof the extension UI renders/behaves as claimed.

## Inputs

- **pr_number** (`$pr_number`): the PR to attach evidence to. If absent, detect with
  `gh pr view --json number -q .number`.
- **feature** (`$feature`): what to verify. If absent, infer from the PR title / diff.

## Step 1 — Build

```bash
bun install --frozen-lockfile
bun run typecheck
bun run build        # emits dist/ (the unpacked extension)
```
If build or typecheck fails, STOP — comment the failure on the PR and do not claim
the feature works.

## Step 2 — Extend the e2e spec for this feature

Add or adjust a spec under `e2e/` so it exercises `$feature` and writes a screenshot
to `e2e/screenshots/<feature>-<state>.png`. Reuse the `extension` fixture
(`e2e/fixtures/extension.ts`) which loads `dist/` and seeds Portkey settings. For UI
that needs a generated quiz/explanation, the seeded Portkey key (runner env) drives
the real flow; for static UI (e.g. the popup, the prefilled issue page) navigate
directly.

## Step 3 — Run the harness (captures screenshots)

```bash
xvfb-run -a bun run e2e
```
The harness runs headed Chromium under xvfb (MV3 requires headed). Screenshots land
in `e2e/screenshots/`.

For page-level checks that do NOT involve the extension UI (e.g. confirming the
prefilled GitHub issue form), you may instead use the `mcp__playwright` browser
tools directly and save via `browser_take_screenshot`.

## Step 4 — Validate

- Assert the spec passed (non-zero exit ⇒ feature NOT verified).
- Eyeball each screenshot: does the described behaviour actually appear?
- If it doesn't match the request, treat as a failed implementation: report back so
  the implementing skill can self-correct.

## Step 5 — Post evidence to the PR

Commit screenshots to the PR branch and embed them in the PR body, then report:

```bash
git add e2e/screenshots && git commit -m "test: visual evidence for $feature [skip ci]"
git push
```
Embed each image in the PR description (use `pw-github-communication` if available),
with a one-line PASS/FAIL verdict per screenshot. Mark the PR ready only if all
checks pass.

## Requirements

- `pw-github-communication` — to post the comment / update the PR body.
