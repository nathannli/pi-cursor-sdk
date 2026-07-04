# Cursor SDK capability roadmap — 2026-07-04

Status: **Active planning source of truth** for aligning `pi-cursor-sdk` with current `@cursor/sdk@1.0.23` capabilities. Older completed or stale plan files were removed so future sessions do not treat stale SDK/runtime guidance as current.

## Non-negotiable product constraints

1. **Local agents stay the default.** A plain `cursor/*` pi model run continues to use Cursor local agents.
2. **Pi tools stay available to local Cursor agents by default.** Any MCP-to-`local.customTools` migration is only acceptable as a transport swap. It must not make Pi tools opt-in, hidden by default, or less dynamic.
3. **Cursor cloud agents are explicit opt-in.** Cloud support must not silently replace local runs or degrade local Pi tool access.
4. **Cloud mode must be honest about Pi-local tools.** Until a separate secure remote bridge exists, Cursor cloud agents do not get local Pi tools through loopback MCP or `local.customTools`.
5. **The bridge invariant stays:** Cursor tool call → real pi `toolCall` → matching pi `toolResult` → Cursor result. Do not call pi tool `execute()` directly from a Cursor adapter.
6. **Full platform smoke remains required** for SDK/runtime/provider/bridge changes: `npm run smoke:platform:all`.

## Current capability gaps against `@cursor/sdk@1.0.23`

| Priority | Gap | Current code | SDK capability | Direction |
| ---: | --- | --- | --- | --- |
| 1 | Pi tool bridge uses per-run loopback HTTP MCP instead of native in-process custom tools. | `src/cursor-pi-tool-bridge-run.ts` starts an HTTP MCP endpoint; `src/cursor-session-agent.ts` passes `mcpServers` into `Agent.create`. | `LocalAgentOptions.customTools` / `LocalSendOptions.customTools` expose caller functions as SDK custom tools. | Explore `customTools` only if it preserves default local Pi tool access and the bridge invariant. Keep MCP otherwise. |
| 2 | No `Agent.resume()` integration. | `src/cursor-session-agent.ts` uses `Agent.create()` and in-memory pooling. | `Agent.resume(agentId)` can reattach to local/cloud persisted agent state after process restart. | Product decision: decide whether pi session files should persist SDK `agentId` and resume instead of bootstrap replay after restart. |
| 3 | No `send({ local: { force: true } })` stuck-run recovery. | `src/cursor-provider-turn-send.ts` send options include only `mode`, `onDelta`, and `onStep`. | `LocalSendOptions.force` expires a stuck local active run before sending. | Add targeted recovery path for wedged local runs before resetting the whole agent. |
| 4 | No local Cursor safety controls exposed. | `src/cursor-session-agent.ts` passes only `cwd` and `settingSources` under `local`. | `local.autoReview` and `local.sandboxOptions.enabled` gate/sandbox headless local tools. | Add explicit flags/env/settings for users who want Cursor-native safety controls. Defaults should preserve current behavior unless deliberately changed. |
| 5 | `RunResult.usage` is not consumed as fallback. | `src/cursor-provider-run-finalizer.ts` applies only `turnCoordinator.lastSdkTurnUsage`; `waitResult` is recorded but not parsed. | `RunResult.usage` and `Run.usage` expose cumulative token usage. | Fall back to `waitResult.usage` when no per-turn usage was attributed in time. |
| 6 | No `agent.reload()` path. | Session lifecycle invalidates/resets pooled agents. | `agent.reload()` refreshes filesystem config such as hooks, project MCP, and subagents without disposal. | Use only if it deletes reset complexity without weakening prompt/session invariants. |
| 7 | SDK `agents` subagent definitions are not wired. | Cursor `task` activity is displayed, but `Agent.create` omits `agents`. | `AgentOptions.agents` defines Cursor-native subagents; file-based `.cursor/agents/*.md` also load from setting sources. | Treat as optional after cloud/local runtime decisions. Do not conflate with Pi subagents. |
| 8 | Cloud runtime surface is unused. | Provider is local-agent-only. | `Agent.create({ cloud })`, cloud repos/env/PR/artifacts/list/resume APIs. | Add explicit cloud runtime mode; keep local default. |

## Local customTools feasibility

`local.customTools` can still support dynamic per-user Pi tool surfaces because the current bridge already has the needed dynamic snapshot:

- `buildCursorPiToolBridgeSnapshot(pi)` reads `pi.getActiveTools()` and `pi.getAllTools()`.
- It filters inactive tools, excluded replay wrappers, and overlapping built-ins according to current policy.
- It preserves descriptions, prompt guidelines, schemas, and source info.
- `buildCursorPiToolBridgeSurfaceSignature(snapshot)` already hashes the effective tool surface for agent-pool identity.

A customTools adapter should reuse that snapshot as the single source of truth:

```ts
const snapshot = buildCursorPiToolBridgeSnapshot(pi, options);
const customTools = snapshotToSdkCustomTools(snapshot);
const signature = buildCursorPiToolBridgeSurfaceSignature(snapshot);
```

### Create-time vs per-send customTools

Start with **create-time customTools** unless a real dynamic-tool case requires per-send tools:

- It matches the current pool-key behavior: tool surface change → new pooled SDK agent.
- It keeps prompt/tool manifest and SDK tool surface aligned at bootstrap.
- It is the smallest migration.

Use **per-send customTools** only if we need to change the active Pi tool surface without recreating the SDK agent:

- Build the snapshot every send.
- Pass `agent.send(..., { local: { customTools } })`.
- Keep the prompt manifest and SDK tool set in lockstep for that send.

### customTools migration acceptance criteria

A customTools path is acceptable only if all are true:

- Local Cursor agents still get active Pi tools by default.
- Dynamic per-user Pi tool surfaces still work from installed Pi extensions and active-tool settings.
- The real Pi `toolCall` / `toolResult` path is preserved.
- Built-in overlap policy remains unchanged unless explicitly approved.
- `/cursor-tools` still reports the callable Pi surface accurately.
- Visual cards/history remain equivalent.
- Abort/cancel cleanup has live evidence, including long-running tool cancellation.
- `npm run smoke:platform:all` passes on macOS, Ubuntu, and Windows native.

If these cannot be met, **do not switch away from MCP**.

## Cloud agents support plan

Cloud support should be a new explicit runtime mode, not a replacement for local mode.

Possible interface:

```bash
# default remains local
pi --model cursor/composer-2-5

# explicit cloud opt-in
pi --cursor-runtime cloud --model cursor/composer-2-5
```

### First cloud release scope

- Create/send/wait/stream via `Agent.create({ cloud })`.
- Support repo selection/configuration only through explicit user-approved settings or flags.
- Surface cloud lifecycle/status messages clearly in TUI/JSON/RPC.
- Use cloud-native MCP/settings/subagents supported by Cursor.
- Support cloud artifacts if useful and safe.
- Keep local provider behavior unchanged.

### Cloud exclusions for first release

- No local Pi tool bridge in cloud mode.
- No loopback MCP bridge; cloud VM cannot call `127.0.0.1` on the user's machine.
- No `local.customTools`; SDK marks it local-only.
- No implicit repo/PR mutation without explicit user configuration.
- No credential forwarding except explicit cloud `envVars` design with redaction and docs.

### Future remote Pi bridge, if ever needed

A cloud Pi-tool bridge is a separate high-risk feature. It would need:

- public or tunneled HTTPS endpoint;
- per-run auth tokens;
- narrow allowlist of tools;
- explicit user opt-in;
- cancellation and timeout design;
- secret redaction;
- remote trust model;
- cleanup guarantees.

Do not let cloud-agent support depend on this.

## Next implementation slices

1. **Cloud runtime design doc / flags.** Define `--cursor-runtime local|cloud`, config shape, repo/env behavior, and explicit cloud limitations.
2. **Usage fallback.** Add `waitResult.usage` fallback because it is small and low-risk.
3. **Local recovery knob.** Add controlled `local.force` recovery for wedged local runs.
4. **Safety flags.** Add `autoReview` / sandbox controls as explicit opt-ins.
5. **customTools spike behind an env flag.** Prove dynamic Pi tool exposure, display suppression, and abort behavior before any default change.
6. **Resume decision.** Decide whether SDK `agentId` belongs in pi session state and how it interacts with pi branch/tree/compaction.

## Evidence anchors

- SDK official docs captured 2026-07-04 from `https://cursor.com/docs/sdk/typescript`.
- Installed SDK: `@cursor/sdk@1.0.23`.
- SDK type anchors:
  - `node_modules/@cursor/sdk/dist/esm/options.d.ts` — `LocalAgentOptions.customTools`, `autoReview`, `sandboxOptions`, `LocalSendOptions.force`, cloud options.
  - `node_modules/@cursor/sdk/dist/esm/agent.d.ts` — `SDKAgent.send`, `reload`, artifacts, per-send `local` / `cloud` options.
  - `node_modules/@cursor/sdk/dist/esm/run.d.ts` — `RunResult.error`, `RunResult.usage`, `Run.usage`.
- Current implementation anchors:
  - `src/cursor-session-agent.ts` — agent create/pool key/local options.
  - `src/cursor-provider-turn-send.ts` — send options.
  - `src/cursor-pi-tool-bridge-snapshot.ts` — dynamic Pi tool snapshot and surface signature.
  - `src/cursor-pi-tool-bridge-run.ts` — current loopback MCP bridge.
  - `src/cursor-provider-run-finalizer.ts` / `src/cursor-provider-turn-finalize.ts` — usage and wait-result handling.
