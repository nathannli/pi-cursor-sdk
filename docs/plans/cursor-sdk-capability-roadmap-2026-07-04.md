# Cursor SDK capability roadmap

Status: **Active current-state capability ledger and remaining-work plan**. Reconciled 2026-07-18 against baseline `a2d574b` and installed `@cursor/sdk@1.0.23`.

This document separates landed behavior, open work, deliberate product exclusions, and SDK/API contract gaps. Historical probes are context only; current source, tests, installed SDK types/source, and retained smoke evidence are the acceptance authorities.

## Status taxonomy

Every capability in this roadmap has exactly one status:

| Status | Meaning |
| --- | --- |
| **Implemented** | Landed behavior with current source and test or smoke anchors. |
| **Still open** | In-scope work with explicit acceptance criteria. |
| **Intentionally deferred/rejected** | Not scheduled under the current product/security contract; the reason or revisit condition is explicit. |
| **Blocked on SDK/API** | No implementation should start until the exact missing external contract is available or Pi explicitly accepts the listed adapter burden. |

## Non-negotiable product constraints

1. Local agents remain the default for plain `cursor/*` model runs.
2. Local Cursor agents retain Pi tools by default through the canonical loopback MCP bridge.
3. Cloud is explicit opt-in and cannot be acknowledged or safety-weakened by project config.
4. Cloud uses the local streaming/coordinator shape where the SDK permits it, while clearly reporting cloud runtime and cloud-only limitations.
5. Pi does not automatically inject or forward the local bridge, local MCP, `local.customTools`, local settings or skill metadata, or process environment values to cloud. Explicit bootstrap is cloud-bound, requires explicit consent, and sends prior Pi context, which may include file contents, tool outputs, paths or skill references, environment values, or secrets.
6. The bridge invariant remains Cursor tool call → real Pi `toolCall` → matching Pi `toolResult` → Cursor result.
7. `npm run smoke:platform:all` remains required for provider/runtime/bridge changes; `npm run smoke:cloud` is additionally required when actual cloud execution changes.

## Current configuration and runtime contract

**Status: Implemented.** `src/cursor-config.ts` and `src/cursor-runtime-state.ts` own field-specific precedence, stricter safety caps, first-use acknowledgement, trust-gated project loading, explicit save destinations, runtime status, cloud context/repo/ref/direct-push/local-state choices, and Cursor-managed environment selection. Coverage is in `test/cursor-config.test.ts` and `test/cursor-runtime-state.test.ts`.

Field-specific effective source precedence:

- Runtime: CLI > environment > session > trusted project > user > built-in.
- Cloud acknowledgement: CLI > environment > session > user > built-in.
- Other cloud fields (repo/ref, context handoff, direct push, local-state allow, env names/file forwarding, and Cursor-managed environment): CLI > environment > user > built-in, subject to field-specific validation and safety caps.
- Local `autoReview`, `sandbox`, and `resume`: CLI > environment > trusted project > user > built-in.
- Local `force`: CLI > environment > built-in.

Safety-sensitive cloud fields preserve explicit one-shot CLI intent. Below CLI, a stricter user setting may cap a riskier environment choice; field-specific validation still applies. The effective session layer currently populates only runtime and cloud acknowledgement, so it cannot supply other cloud fields. Project config is excluded from acknowledgement and all other cloud fields; trusted project config may select runtime only. It cannot acknowledge cloud or provide repo/ref, bootstrap, env names, direct-push, local-state, environment, or cleanup choices. Local `autoReview`, `sandbox`, and `resume` may load from trusted project config; local `force` cannot.

| Setting | Current behavior | Status |
| --- | --- | --- |
| Runtime | `--cursor-runtime`, `PI_CURSOR_RUNTIME`, `runtime`; built-in default is `local`. | **Implemented** |
| First cloud acknowledgement | `--cursor-cloud-ack`, `PI_CURSOR_CLOUD_ACK`, session/user acknowledgement; project config excluded. | **Implemented** |
| Explicit repo/ref | HTTPS repo override; branch/ref requires repo and maps to `repos[].startingRef`. | **Implemented** |
| Direct push | Explicit CLI/environment/user choice maps to `workOnCurrentBranch`; default false. | **Implemented** |
| Local-only state allow | Explicit CLI/environment/user escape hatch; default is fail closed. | **Implemented** |
| Context handoff | Fresh by default; bootstrap requires explicit CLI/environment/user consent because it sends prior Pi context to cloud, which may include file contents, tool outputs, paths or skill references, environment values, or secrets. | **Implemented** |
| Cursor-managed environment | Explicit `cloud` / `pool` / `machine` selection; Pi does not automatically forward process environment values. | **Implemented** |
| Pi env forwarding and `.env` reads | Parsed reserved shapes fail preflight with Cursor-native environment guidance. | **Intentionally deferred/rejected** — avoids a parallel secret-management path. |
| Inline cloud MCP | No create/send path supplies it. | **Intentionally deferred/rejected** — live historical probes showed unsafe first-run/replacement persistence behavior. |
| Local resume | Default-on branch-scoped resume with strict session/tree/compaction/tool-surface identity and explicit cleanup. | **Implemented** |
| Cloud resume | Every cloud turn creates a new cloud agent. | **Intentionally deferred/rejected** — lifecycle, privacy, compaction, and broader live evidence decisions remain unresolved. |

Automatic provider startup in print/JSON/RPC does not prompt and fails closed when acknowledgement or required Pi-owned safety choices are absent. The `/cursor-runtime cloud` command is separate: it may request confirmation whenever the host exposes UI (`ctx.hasUI`), including an RPC host with UI. The unit-tested trust gate is implemented; the exact packed `--no-approve` automatic-startup acceptance proof remains P0.2 below.

## Capability ledger

| Capability | Status | Current evidence, acceptance, or reason |
| --- | --- | --- |
| One runtime-aware `cursor/*` provider; local default; explicit cloud opt-in | **Implemented** | Defaults: `src/cursor-config.ts`; dispatch: `src/cursor-provider-turn-prepare.ts`; coverage: `test/cursor-config.test.ts`, `test/cursor-provider-stream-config.test.ts`. |
| Field-specific runtime/cloud/local precedence, user safety caps, trust-gated project loading, cloud project saves limited to runtime | **Implemented** | `src/cursor-config.ts`; `test/cursor-config.test.ts`. P0.2 adds a non-interactive contract proof without changing the landed policy. |
| First-use disclosure and acknowledgement, including remote execution, tools/context, branching/retention, and Max Mode cost | **Implemented** | `src/cursor-runtime-state.ts`; `test/cursor-runtime-state.test.ts`. |
| Project config cannot acknowledge cloud or set cloud safety/repo/environment choices | **Implemented** | Project source is omitted for those fields in `src/cursor-config.ts`; covered by `test/cursor-config.test.ts`. |
| Fresh cloud context by default; explicit, consented bootstrap; original Pi project instructions preserved | **Implemented** | Bootstrap is cloud-bound and sends prior Pi context, which may include file contents, tool outputs, paths or skill references, environment values, or secrets. Anchors: `src/cursor-provider-turn-prepare.ts`, `src/cursor-agents-context.ts`; `test/cursor-provider-stream-config.test.ts`, `test/cursor-agents-context.test.ts`. |
| Per-switch interactive fresh/bootstrap chooser | **Intentionally deferred/rejected** | Fresh is the safe default; explicit CLI/environment/user consent already covers higher-trust bootstrap without another prompt. |
| Session-scoped cloud choices beyond runtime and acknowledgement | **Intentionally deferred/rejected** | Current session state persists only runtime and acknowledgement. CLI, environment, and user config already cover explicit repo/ref/context/direct-push/local-state/environment choices. Revisit only if a temporary session-only UX is approved. |
| Explicit HTTPS repo/ref/direct-push mapping | **Implemented** | `src/cursor-cloud-options.ts`; `test/cursor-cloud-options.test.ts`. |
| Dirty/unpushed local-state validation against the explicit cloud repo/ref target | **Still open** | Current code checks the working tree and current branch upstream only. P0.1 defines target-aware acceptance. |
| Fingerprinted interactive warn-once/status behavior for unchanged dirty state | **Intentionally deferred/rejected** | Current runs fail every time unless explicitly allowed; no repeated-click UX is needed until product feedback justifies it. |
| Pi env forwarding and `.env` reading | **Intentionally deferred/rejected** | `src/cursor-cloud-options.ts` rejects configured forwarding and directs users to Cursor-native environments; covered by `test/cursor-provider-cloud-env-validation.test.ts`. |
| Explicit Cursor-managed cloud/pool/machine environment selection | **Implemented** | `src/cursor-cloud-options.ts`; `test/cursor-provider-stream-config.test.ts`. |
| No automatic injection or forwarding of the local Pi bridge, local MCP, `local.customTools`, local settings or skill metadata, or process environment values to cloud | **Implemented** | This excludes automatic metadata forwarding, not content explicitly included in consented bootstrap context. Anchors: `src/cursor-cloud-options.ts`, `src/cursor-provider-turn-prepare.ts`; `test/cursor-provider-stream-config.test.ts`, `test/cursor-skill-tool.test.ts`. |
| Inline cloud MCP | **Intentionally deferred/rejected** | SDK types expose `mcpServers`, but the current product omits them because historical first-run/replacement probes showed hidden persistence and replacement failure. Revisit only with a deterministic SDK contract and retained passing evidence. |
| Cursor-native SDK `agents` / Pi-subagent mapping | **Intentionally deferred/rejected** | SDK exposes `AgentOptions.agents`; no automatic Pi mapping is approved. Cursor may load native `.cursor/agents/*.md` from its own settings. |
| Runtime-aware footer; cloud fast state is `n/a` | **Implemented** | `src/cursor-state.ts`; `test/cursor-runtime-state.test.ts`. |
| Best-effort catalog ID/alias preflight through public `Agent.create()` | **Implemented** | `src/cursor-provider-turn-prepare.ts` calls `Agent.create()`. Installed SDK code checks the base model ID/alias against `Cursor.models.list()`, but does not validate variant parameters or cloud runtime availability, and catalog lookup failures can fall through; backend create/send errors are authoritative. The mocked provider coverage in `test/cursor-provider-stream-config.test.ts` proves only that Pi calls the public `Agent.create()` path. |
| `/model` cloud annotations, compatibility warning, and cloud-aware `--list-models` | **Blocked on SDK/API** | Missing contract: installed `ModelListItem` has no local/cloud availability field, and no maintained account-scoped availability/preflight source exists. Preserve best-effort catalog ID/alias preflight through `Agent.create()` while backend create/send errors remain authoritative; P1.5 states the acceptance trigger. |
| Cloud streaming through the shared coordinator | **Implemented** | `src/cursor-provider-turn-prepare.ts` and `src/cursor-provider-turn-send.ts` use `CursorSdkTurnCoordinator`; `test/cursor-provider-stream-config.test.ts` covers direct cloud mode. P2.7 adds retained cloud activity-card evidence. |
| Abort cancels the active cloud run | **Implemented** | `src/cursor-provider-turn-send.ts`; `test/cursor-provider-cloud-reporting.test.ts`. |
| Detach/keep-running control | **Intentionally deferred/rejected** | Abort stays fast and canceling; no detach lifecycle or ownership contract is approved. |
| Cloud agent naming from Pi session title | **Implemented** | `src/cursor-provider-turn-prepare.ts`; `test/cursor-provider-stream-config.test.ts`. |
| Agent/run IDs, branch/PR, passive artifacts, and raw usage completion telemetry | **Implemented** | `src/cursor-cloud-reporting.ts`, `src/cursor-provider-turn-finalize.ts`; `test/cursor-provider-cloud-reporting.test.ts`, `test/cursor-cloud-reporting.test.ts`. Raw usage remains display-only and outside Pi accounting/transcript. |
| Artifact auto-download or download command | **Intentionally deferred/rejected** | Runtime lists passive artifacts only; Cursor UI remains the download surface unless explicit product scope is added. |
| Durable cloud create intent, returned run ID, branch-scoped ledger, malformed-line isolation | **Implemented** | `src/cursor-cloud-lifecycle.ts`, `src/cursor-provider-turn-prepare.ts`, `src/cursor-provider-turn-send.ts`; `test/cursor-cloud-lifecycle.test.ts`. |
| Exact recorded-ID `/cursor-cloud list`, `/cursor-cloud archive <bc-agentId>`, and `/cursor-cloud delete <bc-agentId> --yes` commands with durable mutation intent/result | **Implemented** | `src/cursor-cloud-lifecycle.ts`; `test/cursor-cloud-lifecycle.test.ts`. No bulk or raw filters. |
| Automatic cleanup, exit prompt, bulk deletion, raw filters, or global sweeping | **Intentionally deferred/rejected** | Exact recorded-ID commands are the safety boundary; normal exit leaves cloud agents archiveable. |
| Cloud resume/default-on | **Intentionally deferred/rejected** | Local remains default. Cloud resume needs explicit lifecycle/privacy/compaction policy and broader live evidence before reconsideration. |
| Agent/run URL display | **Intentionally deferred/rejected** | Public `SDKAgentInfo` exposes no URL. Current reporting shows IDs and PR URL; do not depend on private raw shapes. |
| Remote Pi bridge | **Intentionally deferred/rejected** | No approved public endpoint, per-run auth, tool allowlist, trust model, cancellation, redaction, or cleanup contract exists. Cloud must not depend on it. |
| Cloud-specific auth/integration remediation | **Still open** | Generic sanitization does not preserve `IntegrationNotConnectedError.helpUrl`/`provider` or distinguish Cloud API operational auth. P1.3 defines acceptance. |
| PR controls beyond direct push (`autoCreatePR`, `skipReviewerRequest`) | **Still open** | Installed SDK supports both; Pi config/flags do not. P1.4 requires either complete exposure or an explicit product rejection. |
| Minimal cloud runtime and fresh/bootstrap smoke scripts | **Implemented** | `scripts/cloud-runtime-smoke.mjs`, `package.json`, and `docs/platform-smoke.md` define `smoke:cloud` and `smoke:cloud:context`, assertions, and archival verification. There is no retained tracked cloud smoke report at the reconciled baseline. |
| Expanded repo/ref/direct-push/missing-branch/cancel/delete/artifact/usage smoke matrix | **Still open** | P2.6 defines durable release-evidence acceptance. |
| Cloud activity-card fixture and visual contract | **Still open** | Shared coordinator wiring exists, but no cloud-specific retained tool/activity fixture or visual assertion exists. P2.7 defines acceptance. |
| Default Pi-tool transport via SDK `local.customTools` | **Blocked on SDK/API** | Missing contract: `SDKCustomToolContext` provides no `AbortSignal`, deadline, or cancellation channel. Revisit only if the SDK adds them or Pi accepts an adapter owning aborts, timeouts, child cleanup, diagnostics, permissions, and platform-smoke parity. The loopback MCP bridge remains canonical. |
| Guarded branch-scoped local `Agent.resume()` and recorded-ID cleanup | **Implemented** | `src/cursor-session-agent.ts`, `src/cursor-session-agent-resume.ts`, `src/cursor-session-agent-cleanup.ts`; session-agent resume/cleanup tests and `npm run smoke:platform:all` lanes cover restart, tree, compaction, copy/fork, tool-surface, abort, fallback, opt-out, and cleanup. |
| Automatic local force recovery | **Intentionally deferred/rejected** | Manual `--cursor-local-force` is implemented. Automatic recovery lacks Pi ownership, heartbeat/staleness proof, active-run status, stable idempotency, and cross-handle cleanup guarantees. |
| Feeding `RunResult.usage` into Pi message/context accounting | **Intentionally deferred/rejected** | Real local evidence showed full-agent-context values that poison compaction. Pi uses valid `turn-ended` usage or bounded estimates; coverage is in usage/provider tests and retained local compaction evidence. |

## Prioritized remaining work

These are separate implementation flights. This roadmap records them only.

### P0.1 — Target-aware repo/ref local-state validation

**Status: Still open.**

Current limitation: `src/cursor-cloud-options.ts` checks the working tree and current branch upstream, but does not compare explicit `cloud.repo` / `cloud.branch` with a matching local remote/tracking ref.

Acceptance criteria:

- Normalize observable local remote URLs and match the explicit cloud repo without accepting ambiguous matches.
- Detect unpushed commits relative to the matching explicit target ref.
- Fail closed for unknown or ambiguous state unless `allowLocalState` is explicitly active.
- Cover URL normalization, remote mismatch, missing tracking ref, ahead/behind, dirty state, and Git failure.

Likely anchors: `src/cursor-cloud-options.ts`, `test/cursor-cloud-options.test.ts`.

### P0.2 — Non-interactive project-trust proof

**Status: Still open.**

Current limitation: trust gating is unit-tested, but the exact packed/CLI `--no-approve` automatic provider-startup behavior in print/JSON/RPC is not retained as a contract proof.

Acceptance criteria:

- A project `.pi/cursor-sdk.json` selecting cloud is ignored under `--no-approve`.
- Trusted/approved project runtime still cannot supply cloud acknowledgement.
- No UI confirmation is attempted during automatic provider startup under `--no-approve` in print/JSON/RPC.
- SDK create/send is not reached when required choices are absent.
- Slash-command RPC behavior is outside this proof: `/cursor-runtime cloud` currently follows `ctx.hasUI` and may confirm when an RPC host exposes UI.
- Use an isolated CLI/provider contract test; do not make a live cloud call.

Likely anchors: `src/cursor-session-scope.ts`, `src/cursor-config.ts`, config/provider tests.

### P1.3 — Cloud auth/integration remediation

**Status: Still open.**

Acceptance criteria:

- Preserve a scrubbed HTTPS `helpUrl` and provider from installed `IntegrationNotConnectedError`.
- Identify Cloud API auth separately from local SDK auth and name accepted user/service-account operational key classes.
- Do not present Enterprise Admin API keys as Cloud Agents operational credentials.
- Preserve local error behavior and scrub API keys, URL userinfo, tokens, cookies, and headers.
- Test with installed SDK error classes.

Likely anchors: `src/cursor-provider-errors.ts`, provider-error tests, installed `errors.d.ts`.

### P1.4 — PR-control scope

**Status: Still open.**

Acceptance criteria if implemented:

- Add `autoCreatePR` and `skipReviewerRequest` to typed config, CLI/environment/user precedence, project exclusion/safety rules, cloud option building, docs, and focused tests. Add session precedence only if the deferred status for non-acknowledgement session-scoped cloud choices is explicitly revisited.
- Run a throwaway-repo live probe and retain sanitized results.

Decision acceptance if not implemented: change this capability to **Intentionally deferred/rejected** with the product reason. Do not leave partial flags or config.

Likely anchors: `src/cursor-config.ts`, `src/cursor-runtime-state.ts`, `src/cursor-cloud-options.ts`; installed `options.d.ts`.

### P1.5 — Model availability UX

**Status: Blocked on SDK/API.**

Exact missing contract: installed `@cursor/sdk@1.0.23` `ModelListItem` exposes catalog metadata but no local/cloud availability, and the SDK/API exposes no maintained account-scoped availability source suitable for picker/list annotations.

Acceptance trigger and criteria:

- Start only when SDK/API availability metadata or a maintained account-scoped preflight source exists.
- Then add `/model` annotations, runtime compatibility warnings, list filtering, and catalog-drift contract tests.
- Preserve best-effort catalog ID/alias preflight through `Agent.create()` while treating backend create/send errors as authoritative; never infer a compatibility map from catalog count or model parameters.

Likely anchors after the contract exists: `src/model-discovery.ts`, `src/cursor-state.ts`, model discovery tests.

### P2.6 — Expanded cloud smoke matrix

**Status: Still open.**

Highest-value lanes: cancel; explicit repo plus `startingRef` branch/PR; direct-push opt-in; missing branch; lifecycle delete; passive artifacts and raw usage when account output exists.

Acceptance criteria:

- Capture exact agent/run IDs.
- Archive/delete every throwaway agent and verify cleanup.
- Retain a sanitized report separately from secret-bearing raw artifacts.
- Treat missing credentials, entitlements, cleanup proof, or required output as a failed release gate, not a passing skip.

Likely anchors: `scripts/cloud-runtime-smoke.mjs`, `docs/platform-smoke.md`.

### P2.7 — Cloud activity-card contract check

**Status: Still open.**

Acceptance criteria:

- Capture a cloud `onDelta` / `onStep` fixture exercising shell, task, and tool activity through the shared coordinator.
- Assert bounded TUI/print output.
- Assert that no local bridge or native-replay assumption leaks into cloud mode.
- Retain visual/contract evidence suitable for release review.

Likely anchors: provider turn prepare/send/coordinator modules and cloud provider tests.

## Historical probe context

**Evidence classification: Historical only; not current release evidence.**

The 2026-07-05/06 local/cloud probes described repo/ref behavior, protected-branch fallback, direct push, missing branch, env vars, inline MCP, cancel/archive/delete, artifacts, raw usage, auth, resume, force, and `customTools` cancellation. Temporary repositories and agents were reportedly cleaned up. No tracked cloud smoke report exists at baseline `a2d574b`, and successful `scripts/cloud-runtime-smoke.mjs` runs delete raw artifacts by default. These claims may guide future probes but cannot satisfy a current smoke gate.

Model catalog size is a separate fact from cloud compatibility:

- Historical 2026-07-06 live output reported 32 models.
- The current generated fallback records 34 SDK catalog models in `src/cursor-fallback-models.generated.ts`.
- Neither count proves cloud availability. Installed `ModelListItem` has no runtime-availability field, so no compatibility map may be inferred from catalog count.

Retained local evidence remains current only for its named local contracts, including `docs/evidence/cursor-local-compaction-boundary-2026-07-08.md` and the local resume evidence files. It is not cloud smoke evidence.

## Current implementation anchors

- `src/cursor-config.ts` — effective config, precedence, safety caps, project trust, fast-default migration.
- `src/cursor-runtime-state.ts` — runtime selection, acknowledgement, status, commands.
- `src/cursor-cloud-options.ts` — cloud preflight, repo/ref/direct-push/local-state validation, Cursor-managed environment mapping.
- `src/cursor-provider-turn-prepare.ts` — cloud agent creation, context handoff, bridge/replay exclusion, naming.
- `src/cursor-provider-turn-send.ts` — send options, run-ID persistence, abort cancellation.
- `src/cursor-provider-turn-finalize.ts` — successful cloud reporting and outcome finalization.
- `src/cursor-cloud-reporting.ts` — bounded branch/PR/artifact/raw-usage display reporting.
- `src/cursor-cloud-lifecycle.ts` — durable branch ledger and exact recorded-ID lifecycle commands.
- `scripts/cloud-runtime-smoke.mjs` — minimal runtime/context smoke and archival verification.
- `src/cursor-session-agent.ts` and local resume/lifecycle/cleanup modules — local pooling and guarded resume.
- `src/cursor-pi-tool-bridge-run.ts` and `src/cursor-pi-tool-bridge-snapshot.ts` — canonical local Pi-tool transport.
- `src/cursor-provider-errors.ts` — current generic sanitized provider errors; P1.3 target.

Primary focused coverage:

- `test/cursor-config.test.ts`
- `test/cursor-runtime-state.test.ts`
- `test/cursor-cloud-options.test.ts`
- `test/cursor-provider-stream-config.test.ts`
- `test/cursor-provider-cloud-env-validation.test.ts`
- `test/cursor-provider-cloud-reporting.test.ts`
- `test/cursor-cloud-reporting.test.ts`
- `test/cursor-cloud-lifecycle.test.ts`
- local resume, usage-accounting, bridge, and provider turn suites

## Installed SDK contract anchors

Installed package: `@cursor/sdk@1.0.23`.

- `options.d.ts` — cloud repo/ref/direct-push/environment/PR options, model catalog shape, `AgentOptions.agents`, `customTools` surfaces.
- `agent.d.ts` — create/send options, public agent info, artifacts.
- `cloud-agent.d.ts` and `stubs.d.ts` — cloud resume/list/get/cancel/archive/delete APIs.
- `run.d.ts` and `artifacts.d.ts` — branch/PR/usage and artifact metadata.
- `errors.d.ts` — `IntegrationNotConnectedError.helpUrl` and `.provider`.
- Installed bundled source — public `Agent.create()` performs best-effort base model ID/alias preflight through `Cursor.models.list()`; it does not validate variant parameters or cloud runtime availability, catalog lookup failures can fall through, and backend create/send errors remain authoritative. Also anchors current option forwarding.

Do not schedule Pi env forwarding, inline cloud MCP, remote Pi bridge, Pi-subagent mapping, cloud resume/default-on, agent/run URL display, detach/keep-running, automatic cleanup, bulk deletion, raw filters, or artifact auto-download without changing the explicit status and recording the new product/security or SDK/API decision here first.
