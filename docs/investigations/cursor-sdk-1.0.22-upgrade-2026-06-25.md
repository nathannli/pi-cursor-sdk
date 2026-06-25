# Cursor SDK 1.0.22 upgrade and issue #128/#131 investigation

Date: 2026-06-25

## Scope

This investigation covers the `@cursor/sdk` 1.0.19 to 1.0.22 upgrade, the npm package install failure in #131, and the network-outage crash shape in #128.

## Evidence read

- Installed package tarballs: `@cursor/sdk@1.0.19` and `@cursor/sdk@1.0.22` from npm.
- Official Cursor SDK docs: <https://cursor.com/docs/sdk/typescript>.
- Official Cursor SDK June 2026 changelog: <https://cursor.com/changelog/sdk-updates-jun-2026>.
- Local pi package/provider docs from installed pi 0.80.2: `docs/packages.md`, `docs/providers.md`, `docs/models.md`, and `docs/custom-provider.md`.
- GitHub issues/PRs: #128, #131, #130, #122.

Local evidence artifacts are under `.artifacts/cursor-sdk-1.0.22-upgrade/` and `.artifacts/issues-128-131/`.

## SDK package delta

Confirmed from npm metadata and tarball `package.json`:

- `@cursor/sdk@1.0.22` keeps the same public package entry points as 1.0.19: `main`, `module`, `types`, and `exports` are unchanged.
- Node engine remains `>=22.13`; this repo already requires Node `>=22.19.0`.
- The important dependency fix is that 1.0.22 moves `@connectrpc/connect-node` into runtime `dependencies` (`^1.6.1`). In 1.0.19 it was only a dev dependency even though runtime output imported it.
- Optional platform packages are the same five OS/CPU packages, version-bumped to 1.0.22.

Public `.d.ts` deltas are additive:

- New exported types: `TokenUsage` and `SDKUsageMessage`.
- `Run` and `RunResult` add optional `usage?: TokenUsage`.
- `SDKMessage` includes a new `type: "usage"` event.
- `turn-ended.usage` adds optional `reasoningTokens`.
- `SendOptions`, `Agent.create` options, `ModelSelection`, `ModelListItem`, and local custom tool types have no material signature change for this repo's current integration.
- The minified MCP protocol timeout seam remains present, but the private `_setupTimeout` parameter names changed from the 1.0.19 bundle. `test/cursor-mcp-timeout-override.test.ts` was updated to track the 1.0.22 signature while keeping the runtime stack-matching behavior unchanged.

## Usage/accounting decision

The new SDK usage surface is not copied into pi `AssistantMessage.usage` in this change. Existing repo docs and tests intentionally keep raw Cursor SDK counters out of pi usage and compaction because Cursor counters include internal agent/tool/cache work, not just replayable pi prompt context. `src/cursor-usage-accounting.ts` remains the owner of the pi-visible estimate. This avoids changing terminal/session usage display as part of the #128/#131 bugfix release.

## #131 package install reproduction and fix

Published `pi-cursor-sdk@0.1.50` repro:

```text
root @connectrpc dirs: connect connect-web
pi nested @connectrpc dirs: connect-node
MODULE_NOT_FOUND: Cannot find module '@connectrpc/connect-node'
```

Current packed tarball after the SDK bump:

```text
root @connectrpc dirs: connect connect-node connect-web
sdk version: 1.0.22 ^1.6.1
connect-node from SDK path: .../node_modules/@connectrpc/connect-node/dist/cjs/index.js
sdk import ok
```

The fix is the SDK pin to 1.0.22 plus package metadata tests asserting the SDK now declares `@connectrpc/connect-node`. The extension does not directly declare or bundle `@connectrpc/connect-node` or `undici`, and it does not bundle `@cursor/sdk`; npm resolves the SDK and SDK-owned transport tree for each consumer platform. Bundling `@cursor/sdk` is avoided because packing from one maintainer OS risks shipping only that host's optional SDK platform binary.

Known upstream caveat: `npm audit` for this repo and for a packed consumer install reports 3 advisories through `@cursor/sdk -> @connectrpc/connect-node -> undici@5.29.0` with no npm-provided fix. This is an upstream dependency-range issue (`@connectrpc/connect-node@1.7.0` depends on `undici@^5.28.4`). Package-level overrides would not be inherited by downstream consumers and bundling a mismatched `undici` creates `npm ls` `ELSPROBLEMS`, so this release keeps the npm tree coherent and does not claim audit-zero.

## #128 network-outage crash reproduction and fix

The reported stack is a Cursor SDK stall abort wrapper:

- top-level `ConnectError`, code `2`, raw message `[canceled] This operation was aborted`;
- nested cause `ConnectError`, code `1`, cause `AbortError`;
- combined stack includes `@cursor/sdk`, `@connectrpc/connect-node`, and SDK `onStall`/stall detection frames.

Before the fix, `classifyCursorConnectError()` returned `undefined` for this wrapper shape, so `installCursorSdkProcessErrorGuard()` did not suppress it during an active Cursor provider turn.

The fix adds a narrow classifier path for SDK stall abort wrappers and maps them to `{ kind: "network", source: "cursor-sdk-stack" }`. User/caller abort shapes remain `kind: "abort"` and still require explicit abort suppression. Provenance-free generic ConnectRPC network errors remain unsuppressed.

Regression coverage:

- `test/cursor-provider-errors.test.ts` classifies the #128 wrapper as retryable network and sanitizes it to the standard `Network error` retry message.
- `test/cursor-sdk-process-error-guard.test.ts` suppresses the wrapper only while a provider turn guard is active and does not suppress it after guard disposal.

## Validation commands run during investigation

- `npm view @cursor/sdk@1.0.19 ...`
- `npm view @cursor/sdk@1.0.22 ...`
- `npm pack @cursor/sdk@1.0.19`
- `npm pack @cursor/sdk@1.0.22`
- `diff -ru` over `dist/esm` tarball contents.
- Published package repro for #131 using `npm install pi-cursor-sdk@0.1.50` in a temp consumer.
- Current packed tarball validation using `npm pack` plus temp consumer install (`pi-cursor-sdk-0.1.51.tgz`).
- `npm run refresh:cursor-snapshots -- --write` fetched 31 live Cursor models and refreshed `src/cursor-fallback-models.generated.ts`.
- `npm run verify` passed for package version 0.1.51.
- `npm run smoke:platform:all` passed for package version 0.1.51 on macOS, Ubuntu, and Windows native. Artifact index: `.artifacts/platform-smoke/latest.json`.
