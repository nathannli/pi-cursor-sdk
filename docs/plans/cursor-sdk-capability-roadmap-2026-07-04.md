# Cursor SDK capability roadmap — 2026-07-04

Status: **Active planning source of truth** for aligning `pi-cursor-sdk` with current `@cursor/sdk@1.0.23` capabilities. Last updated 2026-07-05. Older completed or stale plan files were removed so future sessions do not treat stale SDK/runtime guidance as current.

## Non-negotiable product constraints

1. **Local agents stay the default.** A plain `cursor/*` pi model run continues to use Cursor local agents.
2. **Pi tools stay available to local Cursor agents by default.** Any MCP-to-`local.customTools` migration is only acceptable as a transport swap. It must not make Pi tools opt-in, hidden by default, or less dynamic.
3. **Cursor cloud agents are explicit opt-in.** Cloud support must not silently replace local runs or degrade local Pi tool access. Project config may propose cloud runtime defaults, but it must not make a user's first Cursor run in that project use cloud without a user-level acknowledgement or explicit non-interactive allow.
4. **Cloud UX should feel like local Cursor UX.** Cloud runs should use the same streaming shape, TUI rhythm, status visibility, activity cards, abort expectations, and model IDs where the SDK/runtime allows it. Differences must be explicit only where cloud forces them.
5. **Cloud mode must be honest about Pi-local tools.** Until a separate secure remote bridge exists, Cursor cloud agents do not get local Pi tools through loopback MCP or `local.customTools`.
6. **The bridge invariant stays:** Cursor tool call → real pi `toolCall` → matching pi `toolResult` → Cursor result. Do not call pi tool `execute()` directly from a Cursor adapter.
7. **Full platform smoke remains required** for SDK/runtime/provider/bridge changes: `npm run smoke:platform:all`.

## Configuration and rollout policy

New behavior should start behind feature flags/config while current behavior remains the default. Use feature flags for maintainer validation and user/project config when the behavior is a real preference. After validation, defaults may flip, but keep an opt-out/fallback for a few releases when the behavior replaces a proven path such as MCP.

Default precedence for ordinary Cursor runtime/config decisions:

1. CLI flag
2. Environment variable
3. Project config
4. User config
5. Built-in default

Environment variable names should mirror CLI/config fields with `PI_CURSOR_*` names, for example `PI_CURSOR_RUNTIME`, `PI_CURSOR_CLOUD_REPO`, and `PI_CURSOR_CLOUD_BRANCH` for runtime, repo, and branch/ref overrides. New cloud/config fields must define their env names next to their CLI/config names instead of relying on an unnamed env layer.

Safety and privacy caps use stricter precedence. Project config may set defaults, but user-level denials win over project defaults for cloud runtime auto-selection, sending prior pi context to cloud, env forwarding, direct push / `workOnCurrentBranch`, and any future remote Pi bridge. Precedence for these safety-sensitive allows is: explicit one-shot CLI allow > user deny/cap > explicit env allow > project default > built-in safe default. A trusted project config must not override user config such as `cloudContextHandoff: "never"` or `cloudEnvForwarding: "disabled"`; ambient env vars cannot bypass a user deny unless a separate break-glass policy is explicitly designed later.

Non-interactive cloud runs fail closed unless all required choices are supplied by CLI/env/config and are not blocked by user safety caps. Never hang waiting for a TUI/setup prompt in print, JSON, RPC, CI, or other non-interactive modes.

Config files:

- User config stays in `~/.pi/agent/cursor-sdk.json` and must not store secret values.
- Project config lives under pi's project config directory, implemented with `CONFIG_DIR_NAME` rather than a hardcoded `.pi`; the intended path is `.pi/cursor-sdk.json`.
- `.pi/cursor-sdk.json` is project-local and shareable by design, but repo policy may ignore `.pi/` as this repo currently does. It must not store secret values. It may store repo URLs, runtime preferences, tool-transport preferences, env variable names, and similar non-secret project preferences. Per-work-item state such as the active cloud branch/ref does not belong in shareable project config unless the user explicitly saves it as a project default.
- Project config is honored only through pi's normal project trust flow.
- First-run confirmation does not automatically write project config. Flows that learn repo/runtime defaults should offer explicit choices: use for this session, save for me, or save for project.

Slash commands:

- Runtime commands such as `/cursor-runtime cloud` apply to the current session immediately. Offer a one-line hint for saving, for example `/cursor-runtime cloud --save-user` or `/cursor-runtime cloud --save-project`; do not ask session-vs-project on every switch.
- Other Cursor preference slash commands can write config by default only when the setting is clearly a persistent preference and the destination is explicit.
- CLI and env always override ordinary slash/config choices for that invocation. For safety-sensitive behavior, use the safety precedence above: only an explicit one-shot CLI allow can override a user denial; env vars cannot.

## Current capability gaps against `@cursor/sdk@1.0.23`

Impact numbers rank product/user risk, not implementation order; sequencing is intentionally handled separately below.

| Impact | Gap | Current code | SDK capability | Direction |
| ---: | --- | --- | --- | --- |
| 1 | Pi tool bridge uses per-run loopback HTTP MCP instead of SDK customTools callbacks. | `src/cursor-pi-tool-bridge-run.ts` starts an HTTP MCP endpoint; `src/cursor-session-agent.ts` passes `mcpServers` into `Agent.create`. | `LocalAgentOptions.customTools` / `LocalSendOptions.customTools` expose caller functions through the SDK's synthetic `custom-user-tools` MCP server. | Explore `customTools` only if it preserves default local Pi tool access and the bridge invariant. Keep loopback MCP otherwise. |
| 2 | No `Agent.resume()` integration. | `src/cursor-session-agent.ts` uses `Agent.create()` and in-memory pooling. | `Agent.resume(agentId)` can reattach to local/cloud persisted agent state after process restart. | Add branch/path-scoped resume behind feature flag/config first. Persist SDK agent IDs in pi session custom entries, not config. |
| 3 | No `send({ local: { force: true } })` stuck-run recovery. | `src/cursor-provider-turn-send.ts` send options include only `mode`, `onDelta`, and `onStep`. | `LocalSendOptions.force` expires a stuck local active run before sending. | Use `local.force` only with ownership/staleness evidence or explicit manual override; pair retry paths with `idempotencyKey`. |
| 4 | No local Cursor safety controls exposed. | `src/cursor-session-agent.ts` passes only `cwd` and `settingSources` under `local`. | `local.autoReview` and `local.sandboxOptions.enabled` gate/sandbox headless local tools. | Expose through CLI flags, env vars, slash commands, and user/project config. Defaults stay off to preserve current behavior. |
| 5 | `RunResult.usage` is not consumed as fallback. | `src/cursor-provider-run-finalizer.ts` applies only `turnCoordinator.lastSdkTurnUsage`; `waitResult` is recorded but not parsed. | `RunResult.usage` and `Run.usage` expose cumulative token usage. | Prefer current per-turn `turn-ended` usage. Use `RunResult.usage` only when it maps cleanly into the same fields without double-counting. |
| 6 | No `agent.reload()` path. | Session lifecycle invalidates/resets pooled agents. | `agent.reload()` refreshes filesystem config such as hooks, project MCP, and subagents without disposal. | Add an explicit refresh command such as `/cursor-refresh-config`; do not reload before every send. |
| 7 | SDK `agents` subagent definitions are not wired. | Cursor `task` activity is displayed, but `Agent.create` omits `agents`. | `AgentOptions.agents` defines Cursor-native subagents; file-based `.cursor/agents/*.md` also load from setting sources. | Do not auto-map Pi subagents. Let Cursor load `.cursor/agents/*.md`; add explicit config later only if needed. |
| 8 | Cloud runtime surface is unused. | Provider is local-agent-only. | `Agent.create({ cloud })`, cloud repos/env/PR/artifacts/list/resume APIs. | Add explicit cloud runtime mode with local default preserved and local-like UX. |

## Local customTools feasibility

`local.customTools` removes the pi-owned loopback HTTP MCP server, but it does **not** remove MCP semantics. The SDK exposes custom tools as a synthetic `custom-user-tools` MCP server, and the model discovers/calls them through the same GetMcpTools / CallMcpTool path. Preserve that fact in permission, display-name, cancellation, and debugging expectations.

`local.customTools` can still support dynamic per-user Pi tool surfaces because the current bridge already has the needed dynamic snapshot:

- `buildCursorPiToolBridgeSnapshot(pi, options)` reads `pi.getActiveTools()` and `pi.getAllTools()`.
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

- The pi-owned loopback MCP bridge remains the default initially.
- customTools opt-in exists from the start through environment variables and user/project config, not env-only.
- Keep the loopback MCP bridge as fallback while customTools is validated.
- Do not flip the default to customTools until validation plus user feedback show it is a safe replacement. After the default flips, the loopback MCP bridge remains available as opt-out for a few releases.
- Do not remove the loopback MCP bridge until additional user feedback and platform smoke evidence show customTools is a safe replacement.

### customTools cancellation probe

`SDKCustomToolContext` exposes `toolCallId` but no `AbortSignal`, while the current MCP bridge has explicit abort tracking in `src/cursor-pi-tool-bridge-abort.ts`. Before investing in migration beyond a spike, write a contract probe/test for what happens to an in-flight `customTools.execute()` promise when the run is cancelled. The answer sets the cancellation design. The installed types expose no custom-tool cancellation channel, so this is a gating integration contract, not optional polish.

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

If these cannot be met, **do not switch away from the pi-owned loopback MCP bridge**.

## Branch-scoped SDK Agent.resume plan

Resume is desirable for both local and cloud agents, but it must respect pi's session tree semantics. Do not persist one SDK `agentId` per pi session file and reuse it across all branches.

Persistence:

- Store SDK agent identity in pi session custom entries because agent IDs are session/branch state.
- Store concrete pi branch/path identity metadata with the SDK agent ID so reuse can be strict. Candidate fields include pi session id/file, active leaf id, active path prefix or ancestor-chain hash, SDK agent id, model/tool surface signature, and post-compaction generation.
- Do not store SDK agent IDs in user/project config.

Identity and fallback rules:

- Bind recorded SDK agent IDs to the originating pi session file/id plus active branch/path metadata. A copied custom entry in a forked/cloned/imported session is not enough to reuse an SDK agent.
- If `Agent.resume(agentId)` fails because state was deleted, archived, garbage-collected, moved to a different machine/store, or is otherwise unavailable, fall back to create + bootstrap from the current pi context. Show one continuity card such as “Could not resume prior Cursor agent; continuing from current pi transcript in a new Cursor agent.” Do not hard-fail unless create also fails.
- Anchor implementation to the SDK's resolved default store and state root; do not assume SQLite is available. The SDK default `stateRoot` comes from `getDefaultSdkStateRoot(workspaceRef)`. When opening a store explicitly, follow `SqliteLocalAgentStore.open()` docs and reuse one store per workspace/state root across `Agent.create` / `resume`; use JSONL/custom stores only through a deliberate config path.
- After `Agent.resume`, the first `send()` must pass the current pi model selection through `SendOptions.model`; ideally every send passes the current pi model because pi model selection is the source of truth. Add tests proving a stale/default SDK model cannot survive resume or model switch.
- On every `Agent.resume`, restore the current inline tool transport through `Agent.resume(...options)` or the first send: `mcpServers` for the MCP bridge or `local.customTools` for a customTools path. Inline MCP/custom tool config, hooks/settings layers, and other in-memory config must not be assumed to survive resume. Add a contract test that resumed agents still get Pi tools. If the current model/tool surface cannot be restored, create a new SDK agent and bootstrap from pi context rather than silently running without Pi tools.

Reuse rules:

- Same active branch/path after process restart: resume the recorded SDK agent when the session file/id and branch/path match.
- `/compact` is an SDK-agent boundary. Pi compaction shrinks pi's transcript; it does not shrink Cursor's existing agent thread. After compaction, create or resume a post-compaction SDK agent bootstrapped from the compacted pi context and record that new agent for the active branch.
- Overflow recovery relies on the compaction boundary. A Cursor context overflow is rewritten to `context_length_exceeded` so pi compacts and retries; preserving the pre-compaction SDK agent would retry against the same full Cursor-side thread and likely overflow again.
- In cloud mode, compaction should show a clear continuity card such as: “Context compacted; continuing in a new Cursor cloud agent from the compacted pi summary.” Do not hide the agent handoff.
- `/tree` to a branch/path with a matching recorded SDK agent: resume that agent.
- `/tree` to a branch/path with no matching SDK agent: create a new SDK agent and bootstrap from pi's active context.
- `/tree` moving back to an earlier point must not reuse an SDK agent that has seen messages beyond the selected leaf. If the active pi context path is not an exact match for the SDK agent's recorded path prefix, create a new SDK agent.
- `/fork` and `/clone` create a new SDK agent by default. They may record the parent SDK agent ID for traceability only.
- Session switch/resume/import must apply the same session file/id binding rules before reusing any copied SDK agent entry.
- If a resumed local branch sees a changed Pi tool surface, use the current Pi tool surface for the next send. If the active transport cannot safely update tools per send, recreate the branch SDK agent and bootstrap from pi context.

Garbage collection:

- Every new branch agent, compaction boundary, tool-surface fallback, or periodic rebootstrap can mint another SDK agent. Record predecessors and add cleanup of superseded local agents when safe.
- Cleanup must only delete/archive SDK agent IDs that pi-cursor-sdk recorded for this session/project lineage. Never sweep the SDK store globally because other SDK consumers may share the same state root.
- Cleanup code must reject empty delete filters and only delete recorded agent/run/checkpoint IDs; SDK local-store delete filters treat omitted or empty IDs as match-all.
- Preserve cloud agents after normal pi exit, but provide list/archive/delete cleanup commands before cloud resume becomes default-on.
- Periodic rebootstrap after `MAX_COMPLETED_INCREMENTAL_SENDS_BEFORE_REBOOTSTRAP` must re-record the replacement SDK agent and mark the predecessor eligible for cleanup.

Rollout:

- Branch-scoped resume starts behind feature flag/config.
- Current create/bootstrap behavior remains default until live validation proves resume handles tree, fork, clone, compaction, abort, tool-surface changes, resume failure fallback, and cleanup.

## Local force and retry behavior

Preserve SDK `local.enableAgentRetries` default behavior unless a live failure shows it conflicts with pi retry semantics. Treat SDK transport/stall retries and pi provider retries as separate layers; do not add another retry loop without idempotency and ownership checks.

`send({ local: { force: true } })` is a recovery tool, not normal behavior. It expires a currently active persisted local run before starting a new follow-up run.

Use it only when:

- ownership/staleness evidence shows the active run belongs to this pi session and is stale from a crashed/wedged process; or
- the user explicitly invokes a manual override for debugging/recovery.

Do not auto-force when another live pi process may legitimately own the active run. If ownership cannot be proven, surface recovery guidance and require manual force. Minimum ownership/staleness evidence before automatic force: recorded pi session id/file, SDK agent id, SDK run id/request id, process id or heartbeat, active run status from the SDK store, a stale threshold, and an idempotency key derived from stable pi turn/session data. If process/heartbeat ownership cannot be observed, automatic force is forbidden; show manual recovery only. Any retry path should use SDK `idempotencyKey` deliberately so retried sends do not duplicate work.

## Usage accounting

Current behavior should remain the baseline:

- Prefer real per-turn SDK usage from `turn-ended` events.
- Preserve existing mapping: `inputTokens` → `usage.input`, `outputTokens` → `usage.output`, `cacheReadTokens` → `usage.cacheRead`, `cacheWriteTokens` → `usage.cacheWrite`.
- Preserve existing `totalTokens = input + output`, not `input + cacheRead + output`.
- Never copy SDK `usage.totalTokens` directly into pi usage. Recompute pi totals from mapped fields using pi semantics.
- `RunResult.usage` is cumulative across reported turns. For reused/resumed agents, record a field-wise cumulative usage baseline before send and apply only the delta. Use `RunResult.usage` only when no per-turn usage was applied for the turn, or diff it against already-applied per-turn usage so pi does not double-count. If no trustworthy baseline exists, prefer approximate pi usage over raw cumulative SDK usage.
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

Also provide `/cursor-runtime` for interactive use. Keep one concise Cursor status string that combines runtime with existing Cursor-only state, for example `cursor:local · fast:on · plan` or `cursor:cloud · fast:n/a`.

### Non-interactive cloud policy

Non-interactive cloud runs must never prompt. They fail closed with a specific error and exact remediation flags/config when any required decision is missing or unsafe:

- no confirmed repo: require `--cursor-cloud-repo` / `PI_CURSOR_CLOUD_REPO` / config;
- missing or unsafe branch/ref: require `--cursor-cloud-branch` / `PI_CURSOR_CLOUD_BRANCH` / config;
- dirty or unpushed local-only state: require an explicit override such as `--cursor-cloud-allow-local-state` / `PI_CURSOR_CLOUD_ALLOW_LOCAL_STATE=true` / config;
- prior pi context would be sent to cloud: require `--cursor-cloud-context=fresh|bootstrap` / `PI_CURSOR_CLOUD_CONTEXT` / config, with user `never` caps honored;
- direct push to the current branch: require an explicit direct-push opt-in, not just a visible upstream branch.

The error should name the missing decision and show the shortest safe command to proceed.

### Runtime defaults and persistence

- Built-in default is local runtime.
- Cloud can be selected with CLI flag, env var, slash command, project config, or user config using the standard precedence above.
- Project config may propose cloud runtime defaults, but first use by a user must still require TUI acknowledgement or an explicit user/CLI/env non-interactive allow.
- Runtime slash commands apply to the current session immediately. Saving a project default requires an explicit save flag/subcommand and is the only path that writes project config.
- Cloud mode notes that Pi-local tools are unavailable as part of the first-run cloud setup flow. If future recurring warnings are added because cloud output references unavailable Pi tools, that recurring warning may be permanently silenced in user config.

### Cloud UX expectations

Cloud should feel like the current local Cursor provider as much as possible:

- Show footer/status so users always know whether the current agent is local or cloud.
- Show local-like activity/tool cards for cloud activity when the SDK reports it.
- Stream with the same shape as local runs where possible; cloud SDK surfaces support the same delta/step/stream style and should use the same pi display path when possible.
- Use the same `cursor/*` model IDs in pi, but cloud availability is a curated catalog and cloud runs are Max Mode only. Validate cloud model availability before cloud create/send and show a friendly error with available alternatives if the selected model/variant is unavailable.
- Make model UX runtime-aware before cloud ships: `/model` should show cloud availability when runtime is cloud, `/cursor-runtime cloud` should warn if the current model/variant is not cloud-compatible, and `--list-models cursor` should expose cloud-compatible models/variants or document that cloud validation happens at run start. Choose the model-picker representation before cloud implementation: one `cursor/*` provider with runtime annotations, a separate `cursor-cloud/*` view/provider, or a runtime filter/scope.
- Treat `:fast`, `:slow`, local context variants, and thinking params as unsupported in cloud unless the cloud model catalog proves exact support. Treat Cursor-only local state such as `cursor-fast` as `n/a` in cloud.
- Abort cancels the cloud run by default in both interactive and non-interactive modes, matching local abort semantics and pi's expectation that abort is fast. Add an explicit detach/keep-running command or config later; do not prompt in the abort path.
- The first-run setup card should include one non-blocking cost row: “Cloud Agents run in Max Mode and are billed at Cursor API pricing; Cursor may require spend-limit setup on first use.” Do not repeat this as a generic billing warning unless an auth/billing error blocks the run.

### First-run cloud setup flow

Do not implement first cloud run as a chain of separate dialogs. Use one setup card/flow that summarizes smart defaults and warnings, then asks for one confirmation when defaults are safe:

- inferred repo and whether it is confirmed;
- selected branch/ref, preferring the current branch as the starting ref when remotely visible;
- whether the run uses this choice for the session, saves for the user, or saves for the project;
- env forwarding defaulting to none;
- Pi-local tools unavailable in cloud;
- whether prior pi context will be sent or a fresh cloud agent will start;
- dirty-tree/unpushed-commit status;
- the one-line Max Mode / API-pricing note.

Escalate to focused follow-up prompts only when a smart default is unsafe or missing, such as no usable remote, dirty/unpushed local state, or an existing local session whose context would be sent to cloud. Dirty/unpushed warnings should appear in the setup card, on the first affected send, and when the dirty/unpushed state changes; steady-state dirty work should degrade to a footer/status indicator so users are not trained to click through the same warning every run.

### Cloud repo, branch, and local-state honesty

- Infer the cloud repo from the current git remote. For multi-remote repos, prefer the current branch's tracked upstream remote, then `origin`, then prompt.
- Confirm the inferred repo in the first-run setup flow before the first cloud run.
- Confirmation alone does not persist the repo. Offer explicit session, save-for-me, and save-for-project choices; persist to project config only on save-for-project.
- Support `--cursor-cloud-repo` to override.
- Prefer the current branch when it has an upstream/remote ref that cloud can see, but use it as `repos[].startingRef` by default so Cursor can create a separate work branch.
- Do not set `workOnCurrentBranch: true` unless the user explicitly opts into pushing commits to that existing branch. Never infer direct-push behavior merely because the current branch is remotely visible.
- If the current branch is not visible remotely, prompt between the remote default branch and an explicit branch/ref.
- Do not persist the active branch/ref in shareable project config by default. Branch choice is usually per-developer/per-work-item state. Persist it only when the user explicitly saves a project default, or store it in session/user config for personal defaults.
- Support `--cursor-cloud-branch` to override and a separate explicit direct-push flag/config if `workOnCurrentBranch` is exposed.
- Before a cloud send, detect local uncommitted changes and commits not pushed to the selected remote/ref. Warn that cloud cannot see local-only work on the first affected send and whenever that local-only state changes, then let the user continue, switch branch/ref, or stop. Use a footer/status indicator for unchanged dirty/unpushed state after the warning has been acknowledged.

### Cloud environment and env vars

Do not prompt for local env forwarding on first cloud run. Cursor's native cloud environment setup is `.cursor/environment.json`, dashboard-managed secrets, snapshots, Dockerfiles, and agent-led setup. Prefer those paths rather than building a parallel secret-management system in pi.

- Default env forwarding is none.
- Add explicit `/cursor-cloud-env` and config support for users who need to forward local env values.
- Persist only allowlisted variable names, never secret values. Always preview variable names, not values.
- Reject or warn on unsupported cloud env variable names, including names starting with `CURSOR_`.
- At run time, read current values from process env only for explicitly allowlisted names by default.
- Reading `.env.local` / `.env` for cloud forwarding is an extra explicit opt-in such as `--cursor-cloud-env-from-files`; it must not happen merely because names are allowlisted.
- User-level `cloudEnvForwarding: "disabled"` or equivalent must beat project config.
- If a cloud run fails because an env var is missing, show a hint toward Cursor-native environment setup and the explicit pi env-forwarding command/config.

### Local-to-cloud context handoff

Switching an existing pi session from local runtime to cloud can send prior pi context to Cursor cloud. That context may include local file contents, tool outputs, paths, and secrets accidentally read earlier in the session.

- Any mid-session switch from local runtime to cloud with prior context must disclose what kind of prior context may be sent and offer at least two choices: start fresh with no prior pi transcript, or bootstrap cloud from the current pi context. This is per-switch, not only first-run-per-project, because the leak risk recurs in later sessions.
- The handoff preference can be remembered in user/project config to reduce friction, but the default must be explicit and safe.
- Non-interactive cloud switch must fail closed unless config explicitly allows sending current pi context to cloud.
- Keep the cloud bootstrap bounded by the same prompt-budget and redaction rules as local, but do not pretend that makes the handoff secret-free.

### Cloud settings, tools, and Pi bridge

- Cloud uses Cursor cloud defaults/project/team/plugins.
- Cloud may run repo `.cursor/hooks.json`, team/enterprise hooks, dashboard/cloud MCP, plugins, and cloud-managed settings. Local user Cursor settings, local user hooks, and pi `PI_CURSOR_SETTING_SOURCES` do not apply.
- Do not try to mirror local `PI_CURSOR_SETTING_SOURCES` into cloud.
- No local Pi tool bridge in cloud mode.
- No loopback MCP bridge; the cloud VM cannot call `127.0.0.1` on the user's machine.
- No `local.customTools`; SDK marks it local-only.
- Cursor Cloud MCP servers configured in Cursor/dashboard/team settings may still be available and are separate from pi-local tools.
- If users expect Pi tools in cloud mode, the UI/docs must explain that Pi-local tools require local runtime unless a future secure remote bridge exists.

### Cloud auth, PRs, artifacts, and lifecycle

- Cloud mode requires a Cursor API key accepted by Cursor cloud APIs. If local auth works but cloud auth is missing or unsupported, show a cloud-specific auth error. Use a user API key or service-account API key; Team Admin API keys are not supported by the SDK cloud path.
- Cloud also requires the user's plan/entitlements, an SCM integration connected for the repository provider, and read-write repository access. Catch `IntegrationNotConnectedError` and show its dashboard/help URL. `Cursor.repositories.list()` is only a weak URL precheck because SDK repository items contain just `url`; it cannot prove branch existence, write access, default branch, provider state, repo permissions, or protected-branch policy. Actual authority remains `Agent.create()` / send errors.
- Pi must call cloud model availability validation before create/send because the SDK notes `createCloudAgent` does not perform that preflight itself.
- Name SDK agents from the pi session title/name when available via `AgentOptions.name`, so Cursor cloud UI and `Agent.list()` are understandable.
- Expose cloud `env.type` selection (`cloud`, `pool`, `machine`) through config/flags before relying on non-default environments.
- Do not impose a pi-specific PR policy. Pass through Cursor SDK defaults, expose cloud PR options in config/flags, and show the PR URL if Cursor creates one.
- Leave cloud agents alive/archiveable after normal pi exit.
- If the SDK exposes a cloud agent/run URL, show it.
- Show artifact path/size lists when available. Treat artifact download as cloud-only until a local-runtime SDK contract says otherwise.
- Do not auto-download cloud artifacts by default. Users inspect/download from Cursor UI or a future explicit download command.
- When Cursor pushes a branch or opens a PR, show the pushed branch name, PR URL if present, and a one-line fetch/checkout hint so users can find the work without hunting through the dashboard.

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

No final implementation order is chosen yet. Do not start a large slice just because it appears high in the gap table.

Safe first slices:

1. Explicit `agent.reload()` command.
2. `RunResult.usage` fallback that preserves current usage semantics.
3. Config precedence and non-interactive policy spec/tests.
4. Safety flag/config exposure for `autoReview` and `sandboxOptions`, preserving off-by-default behavior.

Blockers before cloud implementation:

- config precedence, user safety caps, and non-interactive fail-closed policy;
- project/user/session persistence design and explicit save destinations;
- runtime-aware cloud model availability UX, including the model-picker representation decision;
- repo/branch/direct-push policy, including `startingRef` vs `workOnCurrentBranch`;
- cloud auth/entitlement/repo preflight and error mapping strategy.

Blockers before resume implementation:

- branch/path/session identity metadata shape, including active leaf/path identity rather than only git branch/path;
- model and inline tool transport re-supply contract/tests;
- visible continuity behavior for resume fallback;
- recorded-agent cleanup policy with empty-filter guards.

Blocker before customTools migration beyond a spike:

- contract probe for cancellation behavior of in-flight `customTools.execute()`.

Known larger/high-risk slices after blockers:

- Cloud runtime support, including the single first-run setup flow.
- Branch-scoped SDK resume with model/tool re-supply.
- customTools transport migration.
- `local.force` recovery with ownership/staleness guards.

No-work-now items:

- SDK `agents` / Cursor subagent definitions remain file/config-owned by Cursor; do not auto-map Pi subagents unless a separate product decision changes that.

Cloud validation must have its own strategy: unit/contract tests for option building and error handling, plus a live cloud smoke scenario gated on cloud-capable auth/entitlements. If cloud credentials or entitlements are unavailable, report cloud smoke as blocked, not skipped-ready. Platform smoke should include cloud only when those resources are configured.

## Evidence anchors

- SDK official docs captured 2026-07-04 from `https://cursor.com/docs/sdk/typescript`; cloud agent docs refreshed 2026-07-05 from `https://cursor.com/docs/cloud-agent`, `https://cursor.com/docs/cloud-agent/setup`, `https://cursor.com/docs/cloud-agent/capabilities`, `https://cursor.com/docs/cloud-agent/choose-runtime`, `https://cursor.com/docs/cloud-agent/security-network`, `https://cursor.com/docs/cloud-agent/settings`, and `https://cursor.com/docs/cloud-agent/best-practices`. Official docs are behavior guidance and may lag package text; installed `@cursor/sdk@1.0.23` types are the implementation contract for this repo. Contract-probe unclear runtime behavior.
- Installed SDK: `@cursor/sdk@1.0.23`.
- SDK type anchors:
  - `node_modules/@cursor/sdk/dist/esm/options.d.ts` — `LocalAgentOptions.customTools`, `autoReview`, `sandboxOptions`, `enableAgentRetries`, `LocalSendOptions.force`, `idempotencyKey`, `AgentOptions.name`, cloud options, `workOnCurrentBranch`, `repos[].startingRef`, and cloud `env.type`.
  - `node_modules/@cursor/sdk/dist/esm/agent.d.ts` — `SDKAgent.send`, `reload`, artifacts, per-send `local` / `cloud` options, and `Agent.model` being set only after successful `send({ model })`.
  - `node_modules/@cursor/sdk/dist/esm/cloud-agent.d.ts` — cloud create/resume/list/cancel/archive/delete/model/repository APIs and model preflight helper.
  - `node_modules/@cursor/sdk/dist/esm/artifacts.d.ts` — artifact path/size/update metadata.
  - `node_modules/@cursor/sdk/dist/esm/run.d.ts` — `RunResult.error`, cumulative `RunResult.usage`, `Run.usage`, and run cancel/status APIs.
  - `node_modules/@cursor/sdk/dist/esm/agent/store/local-agent-store.d.ts` — local agent store documents, statuses, checkpoints, runs, run events, cleanup/delete surfaces, and delete-filter match-all footguns.
  - `node_modules/@cursor/sdk/dist/esm/store/sqlite-local-agent-store.d.ts` and `node_modules/@cursor/sdk/dist/esm/store/sdk-state-root.d.ts` — SQLite default state-root behavior and reuse guidance.
  - `node_modules/@cursor/sdk/dist/esm/custom-tools.d.ts` — SDK customTools are exposed through synthetic `custom-user-tools` MCP definitions/executor.
- Pi behavior anchors:
  - Pi sessions are JSONL trees; `/tree` changes active leaf in the same file, while `/fork` and `/clone` create new session files.
  - Pi compaction appends compaction entries and sends compacted context; it is not the same as Cursor SDK checkpoint state, and preserving the same SDK agent after compaction would preserve Cursor-side pre-compaction context.
  - Project settings/config are loaded through pi's project trust flow.
- Current implementation anchors:
  - `src/cursor-session-agent.ts` — agent create/pool key/local options.
  - `src/cursor-session-agent-lifecycle.ts` — current invalidation/reset hooks for tree, compaction, shutdown, model select.
  - `src/cursor-session-compaction-prep.ts` — current pre-compaction live-run release and session-agent reset.
  - `src/cursor-provider-turn-send.ts` — send options.
  - `src/cursor-pi-tool-bridge-snapshot.ts` — dynamic Pi tool snapshot and surface signature.
  - `src/cursor-pi-tool-bridge-run.ts` — current loopback MCP bridge.
  - `src/cursor-provider-run-finalizer.ts` / `src/cursor-provider-turn-finalize.ts` — usage and wait-result handling.
