# Cursor Native Tool Visual Audit Workflow

This workflow is the canonical repo path for verifying Cursor SDK tool replay the way a human sees it in pi's interactive TUI, without stealing macOS focus.

Use it before accepting replay-card commits or PRs, and for every Cursor provider/runtime release where TUI card/color behavior could regress. Text logs and JSONL are necessary, but they are not enough when the claim is visual parity: always keep PNGs for the exact prompt, and keep before/after PNGs when reviewing a rendering change.

Current cutover baseline: pi 0.76.0+, exact `@cursor/sdk@1.0.14`, local validation packages `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, and `@earendil-works/pi-tui` at 0.76.0.

## Cursor SDK 1.0.14 / pi 0.76.0 cutover visual record

Record the required cutover validation here or in the final release handoff. Do not commit raw ANSI logs, screenshots, terminal recordings, debug artifacts, or `.debug/visual-smoke` scratch files.

| Field | Required value / evidence |
| --- | --- |
| Command/session used | `pi -e . --cursor-no-fast --cursor-mode plan --session-id cursor-sdk-1014-visual --model cursor/composer-2.5` with a fresh temp `--session-dir` |
| Baseline versions | `pi --version` = 0.76.0; `npm ls` = `@cursor/sdk@1.0.14` and local `@earendil-works/*@0.76.0` |
| Card categories checked | read/find/grep/list, shell success, write/edit/diff, neutral plan/todo/task/mode activity, true read failure |
| Observed status/card colors | Confirm native-looking cards use native pi styling; neutral Cursor activity is not red; true errors are distinct; diff previews show red/green; plan status is readable |
| Screenshot/ANSI evidence location | External path only, for example `/tmp/pi-cursor-sdk-1014-visual.*/visual.ansi` and optional screenshots/recordings |
| Debug artifact location | External `.debug/cursor-sdk-events/...` or temp artifact directory path only; do not commit raw artifacts |
| Pass/fail notes | Summarize any mismatch, blocker, or auth/environment limitation |

Required prompts for this cutover:

1. `Use your file tools to inspect package.json and src/cursor-provider.ts, then summarize only the Cursor SDK and Pi package versions you saw.`
2. `Run a safe shell command that prints "cursor visual smoke" and report the output.`
3. `Create .debug/visual-smoke/cursor-mode.txt with two short lines, then change one line. Use your normal file editing tools.`
4. `Stay in Cursor plan mode. Create a concise numbered plan for adding a tiny unit test, but do not edit files.`
5. `Try to read .debug/visual-smoke/does-not-exist.txt and explain the result.`

## When to use this

Use this workflow when changing or reviewing:

- Cursor native tool replay cards.
- Tool-call turn ordering.
- Tool-result error styling.
- Truncation, continuation hints, timeout labels, or path display.
- Any PR claiming native TUI parity.

Do not use this for ordinary unit-only logic changes.

## Canonical visual inspection path

Earlier manual verification used a visible Terminal window plus `screencapture`. That worked, but it stole system focus and made it easy for the user to type into the audit window by accident.

The canonical workflow is now offscreen and browser-rendered:

1. Spawn `pi` in a pseudo-terminal at a fixed size.
2. Feed the prompt programmatically.
3. Save raw ANSI output and stripped plain text output.
4. Render the terminal buffer through a browser-backed terminal renderer, preferably xterm.js.
5. Save PNG screenshots with `agent_browser` when the harness is available, or Playwright directly when running outside that harness.
6. Inspect the session JSONL for exact persisted `toolCall` / `toolResult` data.

This is the best default release path because it exercises the real pi TUI, captures card class/color/label/order/truncation issues before users see them, avoids desktop focus stealing, and leaves reviewable artifacts. Use visible Terminal/Ghostty screenshots only for terminal-specific or pixel-level bugs that cannot be judged through browser-rendered ANSI.

## Tool stack

Install the renderer harness outside this repo so generated assets and temporary dependencies do not pollute commits:

```bash
HARNESS=/tmp/pi-visual-harness
rm -rf "$HARNESS"
mkdir -p "$HARNESS"
cd "$HARNESS"
npm init -y
npm install node-pty @xterm/xterm playwright
npm rebuild node-pty
```

`npm rebuild node-pty` is useful after Node upgrades; without it, `node-pty` may fail with `posix_spawnp failed`.

When running inside the pi agent harness, `agent_browser` is the preferred screenshot tool for rendered HTML/ANSI output because it can open local files, verify saved artifacts, and capture exact evidence paths. Outside the harness, use Playwright directly against the same generated HTML/xterm view.

## Runner contract

A runner script should:

- Spawn `pi -e <extension-dir> --model cursor/composer-2.5` with:
  - `PI_CURSOR_NATIVE_TOOL_DISPLAY=1`
  - `TERM=xterm-256color`
  - fixed PTY size, for example `150x45`
  - cwd set to the target audit repo.
- Wait for startup.
- Write the exact prompt and carriage return to the PTY.
- Wait a bounded amount of time.
- Save:
  - `<label>.ansi` raw terminal bytes.
  - `<label>.txt` stripped text for quick search.
  - `<label>.html` browser-renderable terminal output.
  - `<label>.png` rendered browser/xterm screenshot captured with `agent_browser` or Playwright.
  - `<label>.jsonl.path` pointing to the latest pi session JSONL.
- Kill the PTY child after capture.
- Check for leftover commands when prompts can background work, especially shell timeout tests.

Example invocation shape:

```bash
node /tmp/pi-visual-harness/run-pi-visual.mjs \
  --label after-shell-nonzero \
  --ext /path/to/pi-cursor-sdk \
  --cwd /path/to/test-workspace \
  --prompt "Run \`printf 'cursor-shell-stderr\\n' >&2; exit 7\` using only the shell/terminal tool. Do not use read, grep, glob, find, ls, edit, or write. Print the command result exactly, then stop." \
  --wait-ms 30000 \
  --out-dir /tmp/pi-visual-harness/review-current
```

Keep the runner in `/tmp` unless the project explicitly decides to check in a maintained audit harness.

## Before/after comparison

Use a clean worktree for the baseline and the active worktree for the candidate change:

```bash
BASE=/tmp/pi-cursor-visual-review
BEFORE_WT=$BASE/before-main
AFTER_WT=/path/to/pi-cursor-sdk
TARGET=/path/to/test-workspace

rm -rf "$BASE"
git fetch origin main
BASE_COMMIT=$(git merge-base origin/main HEAD)
git worktree add --detach "$BEFORE_WT" "$BASE_COMMIT"

# Optional speedup when the before worktree has no install of its own.
ln -s "$AFTER_WT/node_modules" "$BEFORE_WT/node_modules"
```

Then run the same prompt against both extension dirs:

```bash
node /tmp/pi-visual-harness/run-pi-visual.mjs \
  --label before-glob-single \
  --ext "$BEFORE_WT" \
  --cwd "$TARGET" \
  --prompt "Find files matching \`src/tools/reindex.ts\` using only the glob/file-search tool. Do not use shell, bash, grep, read, or ls. Print the matched files exactly as found, then stop." \
  --wait-ms 16000 \
  --out-dir /tmp/pi-visual-harness/review-current

node /tmp/pi-visual-harness/run-pi-visual.mjs \
  --label after-glob-single \
  --ext "$AFTER_WT" \
  --cwd "$TARGET" \
  --prompt "Find files matching \`src/tools/reindex.ts\` using only the glob/file-search tool. Do not use shell, bash, grep, read, or ls. Print the matched files exactly as found, then stop." \
  --wait-ms 16000 \
  --out-dir /tmp/pi-visual-harness/review-current
```

For review, create a simple HTML/PNG gallery that places `before-*.png` and `after-*.png` side by side. Keep the generated gallery in `/tmp` unless explicitly asked to commit visual artifacts. In agent-harness runs, use `agent_browser` to open that gallery or the generated single-run HTML and save verified screenshots.

## JSONL inspection

For each visual claim, inspect the JSONL path written by the runner. Confirm at least:

- `toolCall.name` is the expected pi-facing replay tool name.
- `toolCall.arguments` show the expected user-facing args.
- `toolResult.toolName` matches the call.
- `toolResult.content[0].text` contains the recorded body expected in the card.
- `toolResult.isError` matches the visual card state.

For local pi MCP bridge claims, also confirm:

- Bridged calls appear as the real pi tool name (for example `sem_reindex`), not the MCP bridge name (for example `pi__sem_reindex`; or `read`/`pi__read` when overlapping built-ins are explicitly exposed).
- The JSONL has no second Cursor MCP replay card for the same bridged call.
- Non-bridge Cursor MCP activity, if present, still renders as neutral Cursor activity instead of being suppressed.

Small helper pattern:

```bash
python3 - <<'PY'
import json, pathlib
path = pathlib.Path('/tmp/pi-visual-harness/review-current/after-shell-nonzero.jsonl.path').read_text().strip()
for line in pathlib.Path(path).read_text().splitlines():
    obj = json.loads(line)
    msg = obj.get('message', {})
    if msg.get('role') == 'assistant':
        for part in msg.get('content', []):
            if part.get('type') == 'toolCall':
                print('CALL', part.get('name'), part.get('arguments'))
    if msg.get('role') == 'toolResult':
        text = msg.get('content', [{}])[0].get('text', '')
        print('RESULT', msg.get('toolName'), 'isError=', msg.get('isError'), repr(text[:160]))
PY
```

## Safety rules

- Prefer the canonical offscreen PTY plus browser-rendered screenshot path. Do not use `osascript`, visible Terminal windows, or `screencapture` unless a user explicitly asks for a real desktop screenshot or the bug is terminal-specific.
- Keep generated screenshots, HTML galleries, ANSI logs, and temporary harness dependencies out of the repo by default.
- Use short, deterministic prompts with bounded wait times.
- For timeout/background prompts, always check for leftovers:

```bash
ps -axo pid,etime,command | rg "sleep 2|should-not-print|<audit-session-label>" || true
```

- If the model uses a different tool than requested, record it as model/provider behavior unless JSONL shows replay lost or misrendered a completed Cursor tool event.
- Visual output can differ slightly from macOS Terminal fonts because browser/xterm renderers run offscreen. Treat this workflow as authoritative release evidence for card class, color state, labels, ordering, truncation, footer/status readability, and content. Use a real terminal screenshot only for pixel-level terminal-specific bugs.

## Required evidence before commit or merge

Before accepting a replay-card change, provide:

- Browser-rendered PNG paths captured from offscreen ANSI output.
- Before and after PNG paths when comparing a rendering change.
- The prompt used for each pair.
- ANSI/text/HTML paths when helpful for review.
- JSONL paths for each run.
- A short statement of what changed visually.
- The relevant JSONL `toolCall` / `toolResult` facts.
- `npm test` and `npm run typecheck` results, unless the change is documentation-only.
