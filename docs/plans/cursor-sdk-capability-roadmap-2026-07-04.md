# Cursor SDK capability roadmap — 2026-07-04

Status: **Active planning source of truth** for aligning `pi-cursor-sdk` with current `@cursor/sdk@1.0.23` capabilities. Older completed or stale plan files were removed so future sessions do not treat stale SDK/runtime guidance as current.

## Non-negotiable product constraints

1. **Local agents stay the default.** A plain `cursor/*` pi model run continues to use Cursor local agents.
2. **Pi tools stay available to local Cursor agents by default.** Any MCP-to-`local.customTools` migration is only acceptable as a transport swap. It must not make Pi tools opt-in, hidden by default, or less dynamic.
3. **Cursor cloud agents are explicit opt-in.** Cloud support must not silently replace local runs or degrade local Pi tool access.
4. **Cloud UX should feel like local Cursor UX.** Cloud runs should use the same streaming shape, TUI rhythm, status visibility, activity cards, abort expectations, and model IDs where the SDK/runtime allows it. Differences must be explicit only where cloud forces them.
5. **Cloud mode must be honest about Pi-local tools.** Until a separate secure remote bridge exists, Cursor cloud agents do not get local Pi tools through loopback MCP or `local.customTools`.
6. **The bridge invariant stays:** Cursor tool call → real pi `toolCall` → matching pi `toolResult` → Cursor result. Do not call pi tool `execute()` directly from a Cursor adapter.
7. **Full platform smoke remains required** for SDK/runtime/provider/bridge changes: `npm run smoke:platform:all`.

## Configuration and rollout policy

New behavior should start behind feature flags/config while current behavior remains the default. Use feature flags for maintainer validation and user/project config when the behavior is a real preference. After validation, defaults may flip, but keep an opt-out/fallback for a few releases when the behavior replaces a proven path such as MCP.

Precedence for Cursor runtime/config decisions:

1. CLI flag
2. Environment variable
3. Project config
4. User config
5. Built-in default

Config files:

- User config stays in `~/.pi/agent/cursor-sdk.json`.
- Project config lives in `.pi/cursor-sdk.json`.
- `.pi/cursor-sdk.json` is shareable by default and must not store secret values. It may store repo URLs, branch defaults, runtime preferences, tool-transport preferences, env variable names, and similar non-secret project preferences. Users can gitignore it if they want local-only behavior.
- Project config is honored only through pi's normal project trust flow.

Slash commands:

- Runtime commands such as `/cursor-runtime cloud` ask the first time whether the change is session-only or should save a project default, then remember that save behavior in project config.
- Other Cursor preference slash commands can write project config by default when the setting is project behavior.
- CLI and env always override slash/config choices for that invocation.

## Current capability gaps against `@cursor/sdk@1.0.23`

| Priority | Gap | Current code | SDK capability | Direction |
| ---: | --- | --- | --- | --- |
| 1 | Pi tool bridge uses per-run loopback HTTP MCP instead of native in-process custom tools. | `src/cursor-pi-tool-bridge-run.ts` starts an HTTP MCP endpoint; `src/cursor-session-agent.ts` passes `mcpServers` into `Agent.create`. | `LocalAgentOptions.customTools` / `LocalSendOptions.customTools` expose caller functions as SDK custom tools. | Explore `customTools` only if it preserves default local Pi tool access and the bridge invariant. Keep MCP otherwise. |
| 2 | No `Agent.resume()` integration. | `src/cursor-session-agent.ts` uses `Agent.create()` and in-memory pooling. | `Agent.resume(agentId)` can reattach to local/cloud persisted agent state after process restart. | Add branch/path-scoped resume behind feature flag/config first. Persist SDK agent IDs in pi session custom entries, not config. |
| 3 | No `send({ local: { force: true } })` stuck-run recovery. | `src/cursor-provider-turn-send.ts` send options include only `mode`, `onDelta`, and `onStep`. | `LocalSendOptions.force` expires a stuck local active run before sending. | Retry once with `local.force` after a detected active-run/wedged-run failure, plus a manual override for users/debugging. |
| 4 | No local Cursor safety controls exposed. | `src/cursor-session-agent.ts` passes only `cwd` and `settingSources` under `local`. | `local.autoReview` and `local.sandboxOptions.enabled` gate/sandbox headless local tools. | Expose through CLI flags, env vars, slash commands, and user/project config. Defaults stay off to preserve current behavior. |
| 5 | `RunResult.usage` is not consumed as fallback. | `src/cursor-provider-run-finalizer.ts` applies only `turnCoordinator.lastSdkTurnUsage`; `waitResult` is recorded but not parsed. | `RunResult.usage` and `Run.usage` expose cumulative token usage. | Prefer current per-turn `turn-ended` usage. Use `RunResult.usage` only when it maps cleanly into the same fields without double-counting. |
| 6 | No `agent.reload()` path. | Session lifecycle invalidates/resets pooled agents. | `agent.reload()` refreshes filesystem config such as hooks, project MCP, and subagents without disposal. | Add an explicit refresh command such as `/cursor-refresh-config`; do not reload before every send. |
| 7 | SDK `agents` subagent definitions are not wired. | Cursor `task` activity is displayed, but `Agent.create` omits `agents`. | `AgentOptions.agents` defines Cursor-native subagents; file-based `.cursor/agents/*.md` also load from setting sources. | Do not auto-map Pi subagents. Let Cursor load `.cursor/agents/*.md`; add explicit config later only if needed. |
| 8 | Cloud runtime surface is unused. | Provider is local-agent-only. | `Agent.create({ cloud })`, cloud repos/env/PR/artifacts/list/resume APIs. | Add explicit cloud runtime mode with local default preserved and local-like UX. |

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

Start with create-time customTools and switch only if a real failure appears:

- It matches the current pool-key behavior: tool surface change → new pooled SDK agent.
- It keeps prompt/tool manifest and SDK tool surface aligned at bootstrap.
- It is the smallest migration.

Use per-send customTools only if we need to change the active Pi tool surface without recreating the SDK agent:

- Build the snapshot every send.
- Pass `agent.send(..., { local: { customTools } })`.
- Keep the prompt manifest and SDK tool set in lockstep for that send.

### customTools rollout

- MCP remains the default initially.
- customTools opt-in exists from the start through environment variables and user/project config, not env-only.
- Keep MCP as fallback while customTools is validated.
- Do not flip the default to customTools until validation plus user feedback show it is a safe replacement. After the default flips, MCP remains available as opt-out for a few releases.
- Do not remove MCP until additional user feedback and platform smoke evidence show customTools is a safe replacement.

### customTools migration acceptance criteria

A customTools path is acceptable only if all are true:

- Local Cursor agents still get active Pi tools by default.
- Dynamic per-user Pi tool surfaces still work from installed Pi extensions and active-tool settings.
- The real Pi `toolCall` / `toolResult` path is preserved.
- Built-in overlap policy remains unchanged unless explicitly approved.
- `/cursor-tools` still reports the callable Pi surface accurately.
- Visual cards/history remain equivalent.
- User-visible cancellation and leak cleanup are equivalent to MCP. Internal SDK abort signal details may differ if no tools/processes leak.
- `npm run smoke:platform:all` passes on macOS, Ubuntu, and Windows native.

If these cannot be met, **do not switch away from MCP**.

## Branch-scoped SDK Agent.resume plan

Resume is desirable for both local and cloud agents, but it must respect pi's session tree semantics. Do not persist one SDK `agentId` per pi session file and reuse it across all branches.

Persistence:

- Store SDK agent identity in pi session custom entries because agent IDs are session/branch state.
- Store branch/path metadata with the SDK agent ID so reuse can be strict.
- Do not store SDK agent IDs in user/project config.

Reuse rules:

- Same active branch/path after process restart: resume the recorded SDK agent.
- `/compact` on the same branch preserves the same SDK agent. Compaction is pi transcript/context maintenance, not a Cursor thread boundary.
- `/tree` to a branch/path with a matching recorded SDK agent: resume that agent.
- `/tree` to a branch/path with no matching SDK agent: create a new SDK agent and bootstrap from pi's active context.
- `/tree` moving back to an earlier point must not reuse an SDK agent that has seen messages beyond the selected leaf. If the active pi context path is not an exact match for the SDK agent's recorded path prefix, create a new SDK agent.
- `/fork` and `/clone` create a new SDK agent by default. They may record the parent SDK agent ID for traceability only.
- If a resumed local branch sees a changed Pi tool surface, use the current Pi tool surface for the next send. If the active transport cannot safely update tools per send, recreate the branch SDK agent and bootstrap from pi context.

Rollout:

- Branch-scoped resume starts behind feature flag/config.
- Current create/bootstrap behavior remains default until live validation proves resume handles tree, fork, clone, compaction, abort, and tool-surface changes.

## Local force recovery

`send({ local: { force: true } })` is a recovery tool, not normal behavior. It expires a currently active persisted local run before starting a new follow-up run.

Use it only when:

- the SDK reports an active-run/wedged-run failure that matches the known recovery shape; or
- the user explicitly invokes a manual override for debugging/recovery.

Do not send with `local.force` by default.

## Usage accounting

Current behavior should remain the baseline:

- Prefer real per-turn SDK usage from `turn-ended` events.
- Preserve existing mapping: `inputTokens` → `usage.input`, `outputTokens` → `usage.output`, `cacheReadTokens` → `usage.cacheRead`, `cacheWriteTokens` → `usage.cacheWrite`.
- Preserve existing `totalTokens = input + output`, not `input + cacheRead + output`.
- Use `RunResult.usage` only as fallback when it can be mapped without double-counting or changing the meaning of pi usage.
- Surface SDK `reasoningTokens` if pi has a safe usage field for it. Until then, keep it in debug/metadata rather than changing user-visible accounting semantics.

## Cloud agents support plan

Cloud support is a new explicit runtime mode, not a replacement for local mode.

Interface:

```bash
# default remains local
pi --model cursor/composer-2-5

# explicit cloud opt-in
pi --cursor-runtime cloud --model cursor/composer-2-5
```

Also provide `/cursor-runtime` for interactive use. Status labels should be `cursor-runtime:local` and `cursor-runtime:cloud`.

### Runtime defaults and persistence

- Built-in default is local runtime.
- Cloud can be selected with CLI flag, env var, slash command, project config, or user config using the standard precedence above.
- Runtime slash commands ask the first time whether the change is session-only or should save a project default, then remember that save behavior in project config.
- Cloud mode warns once that Pi-local tools are unavailable. The user can permanently silence this warning in user config because it is a user-level understanding of cloud limitations.

### Cloud UX expectations

Cloud should feel like the current local Cursor provider as much as possible:

- Show footer/status so users always know whether the current agent is local or cloud.
- Show local-like activity/tool cards for cloud activity when the SDK reports it.
- Stream with the same shape as local runs where possible.
- Use the same `cursor/*` model IDs. Before cloud create/send, validate cloud model availability and show a friendly error with available alternatives if the selected model is unavailable.
- In interactive mode, when the user aborts a cloud run, ask whether to cancel the cloud run or leave it running.
- In non-interactive mode, abort cancels the cloud run by default unless config says to keep it running.
- Do not add a billing warning. Cloud does not imply a separate billing pool here.

### Cloud repo and branch selection

- Infer the cloud repo from the current git remote.
- Prompt the user to confirm before the first cloud run.
- Persist the confirmed repo in project config.
- Support `--cursor-cloud-repo` to override.
- Default the branch to the remote default branch.
- Prompt the user to confirm before the first cloud run.
- Persist the confirmed branch in project config.
- Support `--cursor-cloud-branch` to override.

### Cloud env vars

- On first cloud run, detect keys from `.env` and `.env.local`, prompt the user to choose which keys may be forwarded, and persist only the allowlisted variable names.
- Do not persist secret values.
- At run time, read current values from process env / `.env.local` / `.env`.
- Value precedence should match normal local expectations: process env wins over `.env.local`, and `.env.local` wins over `.env`.
- Support user/project config allowlists and named profiles later if needed, but the first behavior should be prompt-and-persist names.

### Cloud settings, tools, and Pi bridge

- Cloud uses Cursor cloud defaults/project/team/plugins.
- Do not try to mirror local `PI_CURSOR_SETTING_SOURCES` into cloud.
- No local Pi tool bridge in cloud mode.
- No loopback MCP bridge; the cloud VM cannot call `127.0.0.1` on the user's machine.
- No `local.customTools`; SDK marks it local-only.
- If users expect Pi tools in cloud mode, the UI/docs must explain that Pi-local tools require local runtime unless a future secure remote bridge exists.

### Cloud PRs, artifacts, and lifecycle

- Do not impose a pi-specific PR policy. Pass through Cursor SDK defaults, expose cloud PR options in config/flags, and show the PR URL if Cursor creates one.
- Leave cloud agents alive/archiveable after normal pi exit.
- If the SDK exposes a cloud agent/run URL, show it.
- Show artifact path/size lists when available.
- Do not auto-download cloud artifacts by default. Users inspect/download from Cursor UI or a future explicit download command.

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

## Implementation order

No final implementation order is chosen yet. Do not assume cloud, resume, customTools, safety flags, or usage fallback should come first without a fresh sequencing discussion.

Known small/low-risk slices:

- `RunResult.usage` fallback that preserves current usage semantics.
- `local.force` recovery after a known active-run/wedged-run failure.
- Explicit `agent.reload()` command.

Known larger/high-risk slices:

- Cloud runtime support.
- Branch-scoped SDK resume.
- customTools transport migration.

## Evidence anchors

- SDK official docs captured 2026-07-04 from `https://cursor.com/docs/sdk/typescript`.
- Installed SDK: `@cursor/sdk@1.0.23`.
- SDK type anchors:
  - `node_modules/@cursor/sdk/dist/esm/options.d.ts` — `LocalAgentOptions.customTools`, `autoReview`, `sandboxOptions`, `LocalSendOptions.force`, cloud options.
  - `node_modules/@cursor/sdk/dist/esm/agent.d.ts` — `SDKAgent.send`, `reload`, artifacts, per-send `local` / `cloud` options.
  - `node_modules/@cursor/sdk/dist/esm/cloud-agent.d.ts` — cloud create/resume/list/cancel/archive/delete/model/repository APIs.
  - `node_modules/@cursor/sdk/dist/esm/artifacts.d.ts` — artifact path/size/update metadata.
  - `node_modules/@cursor/sdk/dist/esm/run.d.ts` — `RunResult.error`, `RunResult.usage`, `Run.usage`.
- Pi behavior anchors:
  - Pi sessions are JSONL trees; `/tree` changes active leaf in the same file, while `/fork` and `/clone` create new session files.
  - Pi compaction appends compaction entries and sends compacted context; it is not the same as Cursor SDK checkpoint state.
  - Project settings/config are loaded through pi's project trust flow.
- Current implementation anchors:
  - `src/cursor-session-agent.ts` — agent create/pool key/local options.
  - `src/cursor-session-agent-lifecycle.ts` — current invalidation/reset hooks for tree, compaction, shutdown, model select.
  - `src/cursor-session-compaction-prep.ts` — current pre-compaction live-run release and session-agent reset.
  - `src/cursor-provider-turn-send.ts` — send options.
  - `src/cursor-pi-tool-bridge-snapshot.ts` — dynamic Pi tool snapshot and surface signature.
  - `src/cursor-pi-tool-bridge-run.ts` — current loopback MCP bridge.
  - `src/cursor-provider-run-finalizer.ts` / `src/cursor-provider-turn-finalize.ts` — usage and wait-result handling.
