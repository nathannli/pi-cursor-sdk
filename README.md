# pi-cursor-sdk

pi provider extension backed by `@cursor/sdk` local agents.

## What this is

This package lets pi use Cursor models through the local Cursor SDK while keeping model selection, thinking, context display, and the default footer native to pi.

Current behavior:

- discovers Cursor models with `Cursor.models.list()` when `CURSOR_API_KEY` is set
- registers Cursor models under the `cursor` provider
- registers one pi model per Cursor `context` value, using IDs like `gpt-5.5@1m`
- maps Cursor `reasoning`, `effort`, and boolean `thinking` to pi native thinking levels
- keeps Cursor `fast` as extension state, toggled with `/cursor-fast` or forced with `--cursor-fast`
- shows Cursor fast mode through `ctx.ui.setStatus()` and leaves pi's default footer intact
- creates a fresh local Cursor agent for each pi provider call

## Requirements

- Node.js
- pi
- a Cursor API key exposed as the `CURSOR_API_KEY` environment variable

No global `@cursor/sdk` install is required. This package depends on `@cursor/sdk`, so a normal package install brings in the SDK version the extension was built and tested against.

## Install

```bash
npm install
```

## API key

Set `CURSOR_API_KEY` in the environment before starting pi:

```bash
export CURSOR_API_KEY="your-key"
```

Or pass it for one command:

```bash
CURSOR_API_KEY="your-key" pi -e . --model cursor/gpt-5.5@1m -p "Say ok only."
```

Do not store the API key in `~/.pi/agent/cursor-sdk.json`; that file is only for non-secret extension state such as Cursor fast defaults. `PATH` is only for executable lookup and should not contain the API key.

## Run locally with pi

```bash
pi -e .
```

Pick a model with `/model`, or pass one directly:

```bash
pi -e . --model cursor/gpt-5.5@1m -p "Say ok only."
```

## Model IDs

Cursor-only parameters are not encoded into pi model IDs.

Examples:

- `cursor/composer-2`
- `cursor/gpt-5.5@1m`
- `cursor/gpt-5.5@272k`
- `cursor/claude-opus-4-7@300k`

Rules:

- Cursor `context` becomes a pi-visible model variant because it changes `contextWindow`.
- Cursor `reasoning`, `effort`, and `thinking` map to pi native thinking.
- Cursor `fast` is extension state, not model identity.

## Thinking support

Use pi's native thinking controls:

```bash
pi --model cursor/gpt-5.5@1m --thinking medium -p "Say ok only"
pi --model cursor/gpt-5.5@272k:xhigh -p "Say ok only"
```

The extension builds Cursor SDK params from the selected pi thinking level:

- `reasoning=none|low|medium|high|extra-high`
- `effort=low|medium|high|xhigh|max`
- `thinking=false|true` for boolean thinking models

For Claude models with both `thinking` and `effort`, pi thinking `off` sends `thinking=false` and omits `effort`.

### Why some Cursor models show `thinking=no`

In `pi --list-models`, the `thinking` column means pi can control the model's thinking level with `--thinking`, a final `:medium` model suffix, or shift+tab.

Some Cursor models can still reason internally, and Cursor may still emit thinking deltas for them, even when Cursor does not expose a `reasoning`, `effort`, or `thinking` parameter for the extension to set. Those models show `thinking=no` because there is no pi-controllable Cursor SDK parameter. The extension does not disable Cursor's own default/internal reasoning behavior.

## Fast mode

Use `/cursor-fast` to toggle fast mode for the selected Cursor model when supported.

Fast preferences are stored:

- in the current session with `pi.appendEntry()`
- globally per Cursor base model in `~/.pi/agent/cursor-sdk.json`

For one print-mode run:

```bash
pi --model cursor/gpt-5.5@1m --cursor-fast -p "Say ok only"
```

When fast is enabled, the default pi footer gets an extension status line:

```text
cursor fast
```

## Images

Images from the latest user message are forwarded to Cursor. Historical images are kept out of the transcript. The extension advertises `text` and `image` input for Cursor models because Cursor's SDK accepts image messages and Cursor models are expected to support them.

## Fallback models

If `CURSOR_API_KEY` is missing or model discovery fails, the extension registers conservative fallback Cursor models with the same native shape:

- `composer-2`
- `gpt-5.5@1m`, `gpt-5.5@272k`
- `claude-sonnet-4-6@1m`, `claude-sonnet-4-6@300k`
- `claude-opus-4-7@1m`, `claude-opus-4-7@300k`

## Limits

- local agents only; no Cursor cloud agent support
- Cursor tool calls are not exposed as pi tool calls
- pi tool schemas are not passed through to Cursor
- one fresh Cursor agent per provider call
- Cursor SDK model metadata does not currently expose output token limits, so the extension uses conservative token defaults

## Development

Run checks:

```bash
npm test
npm run typecheck
```

## License

MIT
