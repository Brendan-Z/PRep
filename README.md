# PRep

A Chrome extension that helps you actually understand pull-request changes before approving them.
It has two modes, toggled with **⌘⇧L** (or **Ctrl⇧L**) on any diff — the current mode shows in a
badge at the top-right of the page.

### 🧠 Quiz mode (default)

Click a changed line on a GitHub **Files changed** page. PRep asks one multiple-choice question
(4 options) about what the **whole file's** changes do, and after you answer — right or wrong —
shows a plain-language explanation that walks through each option. The quiz is generated once per
file (reused as you click around it); **New question** regenerates a fresh one.

### 📖 Learn mode

Press **⌘⇧L** to switch to Learn mode, then:

- **Click a line** → a short, plain-language explanation of that line.
- **Shift+click** another line → an explanation of the whole block between them.

Learn mode shows the selected code once, then a short one-sentence note per line — written for a
grad/junior to follow.

Both modes are powered by your **Portkey** AI gateway (e.g. Claude on AWS Bedrock).

## Install

1. Download `prep-v<version>.zip` from the [latest release](https://github.com/Brendan-Z/PRep/releases/latest)
   and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped folder.

> Prefer to build from source? Run `bun install && bun run build`, then **Load unpacked** the
> generated `dist/` folder.

## Set up

Click the **PRep** toolbar icon and fill in:

- **Portkey URL** — your gateway, default `https://api.portkey.ai/v1`.
- **API key** — your Portkey API key (stored locally on this device only).
- **Model** — the Bedrock model id for Claude Sonnet 4.6, e.g. `us.anthropic.claude-sonnet-4-6-...`.

Click **Save**, then **Test connection**. Open a PR's **Files changed** tab and click a changed
line to start. Press **⌘⇧L** / **Ctrl⇧L** any time to swap between Quiz and Learn mode.
