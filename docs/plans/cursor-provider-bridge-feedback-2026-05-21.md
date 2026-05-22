# Cursor Provider Bridge Feedback: Plan

## Goal

Implement the smallest valid pi-cursor-sdk changes from the smoke-test feedback: clearer bridge/tool-boundary behavior, clearer live-vs-replay contracts, and opt-in bridge diagnostics. Do not turn this repo into a general desktop-app automation guide.

## Verdict

The pi-cursor-sdk-specific feedback is valid, with scope cuts:

- **Valid:** workflow discoverability for the Cursor provider bridge, overlapping tool namespaces, replay-vs-live ambiguity, opaque bridge state during debugging, unclear multi-turn bridge contract, and unclear Cursor-native vs pi-bridged capability boundaries.
- **Already partly handled:** README/replay docs and prompt text already describe the bridge/replay split, and replay wrappers fail closed. The issue is that the contract is not packaged clearly at the prompt, MCP discovery, docs, and debug seams.
- **Out of scope:** browser-driver wait/snapshot/navigation issues, generic desktop/CDP automation recipes, and Cursor-side intent-to-skill routing.

## Background

- User scope decisions: runtime + docs are allowed; capability manifest is docs-only; no general desktop-automation recipe.
- Smoke evidence from a local redacted session shows real tool-boundary confusion: the Cursor agent first treated pi/browser tools as outside Cursor SDK boundaries, then used a bridged MCP tool after explicit prompting, but the transcript exposed both pi tool names and bridge MCP names in a confusing way.
- Current user docs already explain the core bridge: Cursor SDK local tools/settings/plugins/MCP remain available; active bridgeable pi tools are exposed through loopback MCP; overlapping built-ins are hidden by default; bridged calls map back to real pi tool names; replay is separate and display-only (`README.md:201-239`).
- `docs/cursor-native-tool-replay.md` is the clearest existing contract: two tool paths, replay is not execution, `pi__*` names are bridge MCP names, bridged calls queue real pi `toolCall`s and resolve matching `toolResult`s back into the same Cursor SDK run (`docs/cursor-native-tool-replay.md:1-24`).
- `buildCursorPrompt()` already injects a static boundary section saying only Cursor SDK-exposed tools are callable; pi tool names, replay names, and transcript names are context only; replay is display-only (`src/context.ts:166-179`). The smoke test shows this text needs sharper `pi__*` guidance.
- `buildCursorPiToolBridgeSnapshot()` is the runtime capability source: it snapshots `pi.getActiveTools()`/`pi.getAllTools()`, excludes replay/internal names, hides overlapping built-ins unless opted in, creates collision-safe MCP names, and stores pi↔MCP mappings (`src/cursor-pi-tool-bridge.ts:175-216`). Do not add a second capability source.
- Bridge state exists but is internal: run ID, tokenized endpoint path, queued requests, pending maps by pi tool call ID / bridge call ID / Cursor MCP call ID, and `mcpServers` config (`src/cursor-pi-tool-bridge.ts:279-358`). This can support scrubbed opt-in diagnostics.
- The provider emits bridged requests as real pi tool calls with real pi tool names and ends the assistant turn with `toolUse` (`src/cursor-provider.ts:645-668`). Multi-turn resume scans trailing tool results for pending bridge pi tool call IDs, resolves results from context, and continues the existing live Cursor SDK run before creating any new agent (`src/cursor-provider.ts:373-392`, `src/cursor-provider.ts:753-797`).
- Prior PR #9 investigation fixed related replay/bridge bugs: prompt sanitization, bridge suppression, replay safety, abort races, and startup log containment (`docs/investigations/pr9-review-deep-dive-2026-05-21.md:5-17`, `docs/investigations/pr9-review-deep-dive-2026-05-21.md:59-87`). Do not reopen those unless implementation changes reveal a new regression.

## Approach

Keep the existing architecture. Cursor still discovers exact per-run bridge capabilities through MCP `listTools`; `buildCursorPiToolBridgeSnapshot()` remains the runtime source of truth. There is no default run-start manifest, footer/status manifest, or per-turn visible tool list.

Use four seams:

1. **Shared bridge contract wording:** create one small source for prompt/MCP wording so the prompt boundary and tool descriptions do not drift.
2. **Prompt + MCP discovery:** sharpen static prompt text and enrich each bridged MCP tool description. Treat prompt text as the primary control because Cursor SDK may not always surface MCP descriptions strongly to the model; descriptions are the tool-discovery reinforcement.
3. **Opt-in diagnostics:** add `PI_CURSOR_PI_TOOL_BRIDGE_DEBUG=1` with scrubbed single-line JSONL records to `process.stderr`, off by default.
4. **Docs contract:** update README, replay docs, and UX spec around pi-cursor-sdk’s provider/bridge contract, not desktop automation.

## Orchestration Progress

- [x] Items 1–2: shared bridge contract wording, prompt boundary, MCP tool descriptions, tests. Verified by agent: `npm test -- test/context.test.ts test/cursor-pi-tool-bridge.test.ts`; `npm run typecheck`.
- [x] Item 3: opt-in scrubbed bridge diagnostics and tests. Verified by agent: `npm test -- test/cursor-pi-tool-bridge.test.ts`; `npm test -- test/cursor-provider.test.ts`; `npm run typecheck`; `npm test`.
- [x] Item 4: README/replay/spec docs contract. Verified by agent: `git diff --check -- README.md docs/cursor-native-tool-replay.md docs/cursor-model-ux-spec.md`; orchestrator spot-check of debug flag/sink and same-run invariant.
- [x] Item 5: focused/full validation and package-readiness check. Verified by agent: focused tests (126 tests), `npm test` (216 tests), `npm run typecheck`, `npm pack --dry-run`, `git diff --check`.

## Work Items

### Item 1 — Centralize bridge contract wording

**Goal:** Prevent prompt and MCP tool-description wording from diverging.

**Done when:**
- A small shared helper/source defines the core bridge contract text used by both prompt boundary and MCP descriptions.
- The contract covers:
  - `pi__*` names are live Cursor MCP bridge names only when exposed in the current run;
  - Cursor must call the `pi__*` MCP name, not the real pi name shown in pi history;
  - bridged calls execute through normal pi tool flow;
  - replay IDs/labels/transcript names are display-only/context-only;
  - Cursor-native host tools/settings/plugins/MCP are separate from the pi bridge.
- The helper does not enumerate per-run tools and does not create a capability manifest.

**Key files:**
- `src/context.ts:166-179`
- `src/cursor-pi-tool-bridge.ts:209-216`
- likely new shared helper near `src/cursor-tool-names.ts`

**Dependencies:** None.

**Size:** S

### Item 2 — Apply the contract to prompt and MCP tool discovery

**Goal:** Make the live bridge contract visible where the Cursor agent reasons about tools.

**Done when:**
- `buildCursorPrompt()` uses the shared contract text and still emits one static boundary section before pi system instructions.
- `snapshotToolToMcpTool()` enriches MCP `Tool.description` with the shared bridge contract plus the original pi tool description.
- `CursorPiBridgeToolDefinition.description` can remain the original pi description; only MCP-facing descriptions need enrichment.
- Tool schemas, MCP names, pi↔MCP maps, bridge enablement flags, endpoint lifecycle, and execution/resume behavior are unchanged.
- Tests assert:
  - prompt boundary wording includes the `pi__*` live bridge contract;
  - literal user/transcript text sanitization remains unchanged;
  - MCP `listTools()` returns enriched descriptions;
  - snapshot/mapping tests still preserve original pi descriptions and mappings.

**Key files:**
- `src/context.ts:166-179`
- `src/cursor-pi-tool-bridge.ts:175-216`
- `src/cursor-pi-tool-bridge.ts:373-392`
- `test/context.test.ts`
- `test/cursor-pi-tool-bridge.test.ts`

**Dependencies:** Item 1.

**Size:** S

### Item 3 — Add opt-in scrubbed bridge diagnostics

**Goal:** Make bridge state debuggable in smoke tests without adding a default manifest or TUI/footer noise.

**Done when:**
- `PI_CURSOR_PI_TOOL_BRIDGE_DEBUG=1` enables diagnostics; unset/false leaves output unchanged.
- The sink is canonical: single-line JSONL records written to `process.stderr` with a stable prefix such as `[pi-cursor-sdk:bridge]`.
- Records cover:
  - run created/skipped/disposed, with run ID, enabled state, and exposed tool count;
  - exposed pi↔MCP tool name pairs only when debug is enabled;
  - queued bridge request, with bridge call ID, Cursor MCP call ID, pi tool call ID, MCP tool name, and real pi tool name;
  - result resolution, rejection, cancellation, and pending count.
- Records never include endpoint paths/URLs/tokens, API keys, bearer tokens, cookies, raw args, raw results, stdout/stderr payloads, file contents, or Cursor settings output.
- Diagnostics do not call `ctx.ui.setStatus()`, `ctx.ui.notify()`, or `ctx.ui.setFooter()`.
- Tests spy on `process.stderr.write` or the logger helper to prove output is off by default, opt-in when enabled, and scrubbed.

**Key files:**
- `src/cursor-pi-tool-bridge.ts:279-358`
- `src/cursor-pi-tool-bridge.ts:394-455`
- `src/cursor-provider.ts:827-897`
- `test/cursor-pi-tool-bridge.test.ts`
- `test/cursor-provider.test.ts`

**Dependencies:** Item 1 if diagnostics reuse contract labels; otherwise none.

**Size:** M

### Item 4 — Document the provider/bridge contract

**Goal:** Make valid smoke-test feedback discoverable from repo docs without adding generic desktop automation guidance.

**Done when:**
- `README.md` “Tools and local pi bridge” becomes a compact “Cursor provider tool contract” that states:
  - Cursor local-agent tools/settings/plugins/configured MCP are separate from bridged pi tools;
  - active bridgeable pi tools appear as `pi__*` MCP tools only when exposed in the current run;
  - pi output uses real pi tool names;
  - bridged calls execute through normal pi tool flow and can span tool-use turns while the same Cursor SDK run stays alive;
  - replay cards are display-only;
  - bridge controls include `PI_CURSOR_PI_TOOL_BRIDGE`, `PI_CURSOR_EXPOSE_BUILTIN_TOOLS`, `PI_CURSOR_MCP_TOOL_TIMEOUT_*`, and `PI_CURSOR_PI_TOOL_BRIDGE_DEBUG`.
- `docs/cursor-native-tool-replay.md` includes a compact live bridge vs replay table covering:
  - live bridge MCP names (`pi__*`);
  - pi-visible real tool names;
  - bridge IDs (`cursor-pi-bridge-*`);
  - replay IDs (`cursor-replay-*`);
  - replay labels/cards as display-only;
  - host-native Cursor SDK tools/settings/plugins/MCP as neither pi bridge nor replay.
- `docs/cursor-model-ux-spec.md` records the decisions:
  - `buildCursorPiToolBridgeSnapshot()` + MCP `listTools` are the capability source;
  - prompt text is primary, MCP descriptions reinforce discovery;
  - diagnostics are opt-in JSONL to stderr and scrubbed;
  - no default run-start/status/footer manifest;
  - no desktop-automation recipe.
- Docs include the same-run resume invariant explicitly: a bridged call resolves a matching pi `toolResult` into the same live Cursor SDK run, without creating a new `Agent`, unless the run was disposed/aborted/cancelled.

**Key files:**
- `README.md:201-239`
- `README.md:293-319`
- `docs/cursor-native-tool-replay.md:1-85`
- `docs/cursor-model-ux-spec.md:22-25`
- `docs/cursor-model-ux-spec.md:635-671`

**Dependencies:** Items 1–3.

**Size:** M

### Item 5 — Preserve bridge execution and replay behavior with validation

**Goal:** Confirm clarity changes do not alter the provider contract.

**Done when:**
- Focused tests prove or preserve:
  - `Agent.create()` receives `mcpServers.pi_tools` only when the bridge is enabled and the active snapshot is non-empty;
  - bridge requests emit real pi tool names;
  - matching pi `toolResult`s resume the same live Cursor SDK run without a new `Agent.create()`;
  - pending bridge calls are rejected/cleared on disposal/cancel/abort;
  - bridge MCP activity is suppressed from Cursor replay;
  - non-bridge Cursor MCP activity remains visible;
  - prompt wording, MCP descriptions, and diagnostics match Items 1–3.
- Focused validation passes:
  - `npm test -- --run test/context.test.ts test/cursor-pi-tool-bridge.test.ts test/cursor-provider.test.ts test/cursor-tool-transcript.test.ts`
- Full validation passes:
  - `npm test`
  - `npm run typecheck`
- Package-readiness check passes because README/package-visible docs change:
  - `npm pack --dry-run`
- No visual audit is required unless implementation changes rendered replay/bridge cards.

**Key files:**
- `test/context.test.ts`
- `test/cursor-pi-tool-bridge.test.ts`
- `test/cursor-provider.test.ts`
- `test/cursor-tool-transcript.test.ts`
- `package.json`

**Dependencies:** Items 1–4.

**Size:** S

## Non-goals

- No general desktop-app/CDP automation playbook.
- No default run-start capability manifest, footer/status manifest, or per-turn visible tool list.
- No endpoint tokens, tool args/results, file contents, API keys, bearer tokens, cookies, or Cursor settings output in diagnostics.
- No direct calls to pi tool `execute()` handlers from the bridge.
- No replay execution or mutation; replay remains recorded-result display only.
- No changes to Cursor-native host tool availability.
- No intent-to-skill routing for Cursor-side automation skills.

## Open Questions

None blocking. The plan makes the diagnostics sink and flag canonical, keeps the capability manifest docs-only, and excludes general desktop automation.

## References

- Smoke session: `<local pi session JSONL>`
- `README.md:201-239`, `README.md:293-319`
- `docs/cursor-native-tool-replay.md:1-85`
- `docs/cursor-model-ux-spec.md`
- `docs/investigations/pr9-review-deep-dive-2026-05-21.md:5-87`
- `src/context.ts:166-179`
- `src/cursor-pi-tool-bridge.ts:175-216`, `src/cursor-pi-tool-bridge.ts:279-358`, `src/cursor-pi-tool-bridge.ts:394-455`
- `src/cursor-provider.ts:373-392`, `src/cursor-provider.ts:645-668`, `src/cursor-provider.ts:753-797`, `src/cursor-provider.ts:827-897`
- Installed pi docs: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`, `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/custom-provider.md`, `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/models.md`
