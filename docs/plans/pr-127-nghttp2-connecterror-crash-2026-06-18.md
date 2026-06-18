# PR #127 NGHTTP2 ConnectError Crash: Plan

## Goal

Acknowledge PR #127 as a real Cursor SDK/ConnectRPC hard-crash report, then land a maintainer-owned minimal fix: classify the observed HTTP/2 reset/backpressure shape as a retryable network error through the existing central error path. Do not broaden process-level suppression.

## Background

- PR #127 (`https://github.com/fitchmultz/pi-cursor-sdk/pull/127`) reports `ConnectError: [internal] Stream closed with error code NGHTTP2_ENHANCE_YOUR_CALM`; it has one commit, no linked issue, no comments/reviews, and touches `src/cursor-provider-errors.ts` plus `test/cursor-provider-errors.test.ts`.
- The PR's fixture models the top-level error as code `2`/unknown with `rawMessage` containing `NGHTTP2_ENHANCE_YOUR_CALM`, Cursor SDK stack provenance, and a first-level `cause` that also carries HTTP/2 stream-reset text.
- `classifyCursorConnectError()` is the source of truth for Cursor ConnectRPC auth/network/abort shapes (`src/cursor-provider-errors.ts:91`). `sanitizeCursorProviderError()` maps classified network failures to the standard scrubbed retry text (`src/cursor-provider-errors.ts:195`).
- The process guard suppresses only classified ConnectRPC process errors during active Cursor provider turns (`src/cursor-sdk-process-error-guard.ts:32`); its boundary is intentionally narrow, including no suppression after dispose and no suppression for provenance-free network errors (`test/cursor-sdk-process-error-guard.test.ts:274`, `test/cursor-sdk-process-error-guard.test.ts:291`).
- Prior crash work treats uncaught Cursor SDK `ConnectError` / network-reset exits as the #43/#107 family, not generic provider text echo (`docs/cursor-testing-lessons.md:339`, `docs/cursor-testing-lessons.md:402`). README already promises Cursor SDK connect-layer failures surface as scrubbed `Network error` messages instead of crashing pi (`README.md:369`).
- External fact needed here: `NGHTTP2_ENHANCE_YOUR_CALM` is HTTP/2 code 11 / `0x0b`, a peer overload/backpressure signal that can surface as Node HTTP/2 stream/session errors.

## Approach

Treat PR #127 as the bug report, not the patch source of truth. The fix belongs in `src/cursor-provider-errors.ts`, where caught provider errors and process-level guard decisions already converge.

Add the smallest classifier enhancement that recognizes transient HTTP/2 reset/backpressure signals in the same network path as `ETIMEDOUT` and `ECONNRESET`. Gather only bounded evidence already present on error-like objects: top-level `message`/`rawMessage`, plus at most a short `cause` chain's `name`/`message`/`rawMessage`/`code`/`syscall`. The process guard should start suppressing the new crash only because the central classifier now returns `{ kind: "network" }`, not because the guard learned a broader exception rule.

## Work Items

1. **Capture the PR shape as the primary regression fixture.** In `test/cursor-provider-errors.test.ts`, add a helper based on PR #127's diff: `ConnectError`, code `2`, raw message `Stream closed with error code NGHTTP2_ENHANCE_YOUR_CALM`, Cursor SDK stack provenance, and first-level cause evidence. Assert `classifyCursorConnectError()` returns `{ kind: "network", source: "cursor-sdk-stack" }` before asserting sanitized retry text, so the sanitizer fallback cannot mask a classifier miss.
2. **Add bounded HTTP/2 signal collection.** In `src/cursor-provider-errors.ts:91`, replace the ad hoc probe string with a tiny local helper that collects top-level and short cause-chain evidence. Keep it defensive and finite; no generic object walker, no new exported API, no new error kind.
3. **Classify HTTP/2 stream/session resets as network.** Extend the existing private network matcher around `src/cursor-provider-errors.ts:137` for the observed transient tokens/text: `NGHTTP2_ENHANCE_YOUR_CALM`, `ERR_HTTP2_STREAM_ERROR`, `ERR_HTTP2_SESSION_ERROR`, and `stream/session closed with error code`. Do not add code-`2` as a standalone signal; it is too broad.
4. **Prove the hard-crash boundary without editing the guard.** Add a `test/cursor-sdk-process-error-guard.test.ts` fixture using the same HTTP/2 error shape. Assert an active provider turn suppresses the Cursor-provenance error, and the existing post-dispose/provenance-free tests still protect the boundary. Edit `src/cursor-sdk-process-error-guard.ts` only if this test fails after the classifier change.
5. **Close PR #127 cleanly.** After the maintainer patch lands, comment on PR #127 thanking the contributor, acknowledging the real bug, and explaining that the fix was implemented centrally to preserve the existing narrow guard contract. Close/supersede the PR rather than merging it as-is.
6. **Skip new docs unless implementation proves broader scope.** For the expected classifier/tests-only diff, regression coverage plus the PR response is enough. Add docs only if implementation uncovers a new user-facing troubleshooting path beyond the existing #43/#107 notes.

## Verification

Run the focused local gate first:

```bash
npm test -- test/cursor-provider-errors.test.ts test/cursor-sdk-process-error-guard.test.ts
npm run typecheck
npm run typecheck:tests
```

Before any commit that touches provider/runtime crash handling, run the repository's required smoke gate or report it blocked by unavailable Cursor auth/platform resources:

```bash
npm run smoke:platform:all
```

## Open Questions

None blocking. The plan intentionally chooses the minimal central classifier fix; process guard policy stays unchanged unless a regression test proves otherwise.

## References

- PR #127: https://github.com/fitchmultz/pi-cursor-sdk/pull/127
- Node HTTP/2 constants: https://nodejs.org/api/http2.html
- HTTP/2 error codes: https://www.rfc-editor.org/rfc/rfc7540.html#section-7
- ConnectError source: https://github.com/connectrpc/connect-es/blob/main/packages/connect/src/connect-error.ts
