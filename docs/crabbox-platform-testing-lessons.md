# Crabbox Platform Testing Lessons

## Purpose

This document is a portable field guide for agents adding local cross-platform smoke tests to other pi extension repositories. It records what worked in `pi-cursor-sdk` without making this repository's exact implementation mandatory elsewhere.

Use it as a pattern library. Each project must keep its own source of truth, package names, artifact roots, environment variables, and release criteria.

## Core rule: copy the architecture, not the state

Do **not** copy project-specific paths, package names, VM names, credentials, or artifact folders into another extension. Start by defining the other project's own:

- package name;
- supported operating systems;
- release-blocking user paths;
- target fixtures;
- required visual/JSONL/tool evidence;
- artifact root;
- environment variable prefix;
- Crabbox work roots and slugs.

Good portable shape:

```text
platform-smoke.config.mjs       # project-specific targets/suites
scripts/platform-smoke.mjs      # doctor/run entrypoint
scripts/platform-smoke/*.mjs    # target runner, artifacts, assertions, scenario helpers
.artifacts/<project>-smoke/     # gitignored project-local artifacts
```

Bad portable shape:

```text
# Hard-coded state from this repo in another project
.artifacts/platform-smoke/
PLATFORM_SMOKE_WINDOWS_NATIVE_WORK_ROOT=C:\crabbox\pi-cursor-sdk
pi-cursor-sdk-windows-native
cursor/composer-2-5 when the target project does not use Cursor
```

## Keep the release gate local and explicit

The useful split is:

```bash
npm run smoke:platform:doctor   # no live model/API calls; validates local prerequisites
npm run smoke:platform:all      # release gate; all required targets and suites
```

`doctor` should fail before expensive work when prerequisites are missing:

- Crabbox binary exists and is the expected version/commit;
- Docker/local-container backend works;
- SSH/static macOS backend works if used;
- Parallels/Windows template and snapshot are usable if used;
- Node/npm/git/rsync/tar are present on host and targets;
- required auth is present but redacted;
- artifact root is writable;
- working tree status is visible;
- forbidden files such as `.env` or package tarballs are absent.

Do not hide missing platform setup as a skip. A missing required target is a doctor failure, not a green release.

## Namespace everything per project

To avoid collisions between multiple pi extensions using Crabbox on the same machine:

| Surface | Recommendation |
| --- | --- |
| Artifact root | `.artifacts/<project>-platform-smoke` or `.artifacts/platform-smoke` inside that repo only |
| Env prefix | `<PROJECT>_SMOKE_*` or a documented repo-specific prefix |
| Crabbox slug | `<project>-<target>` |
| macOS work root | `~/crabbox/<project>` |
| Windows work root | `C:\crabbox\<project>` |
| Remote run roots | `.platform-smoke-runs/<suite>-<timestamp>-<pid>` under that target checkout |
| Session IDs | include project, suite, and timestamp |
| Debug dirs | suite-scoped under the artifact/run root |

Never reuse another repo's `.artifacts`, `.debug`, session dirs, Windows work root, or Crabbox slug unless the repositories are intentionally sharing state and the owner has documented why.

## Use target sessions, not one fresh lease per suite

A release run should normally use one Crabbox lease per target:

```text
warm target once
sync checkout once
run platform-build
run live/visual suite 1
run live/visual suite 2
run abort/cleanup suite
stop lease
```

Benefits:

- much lower Windows runtime;
- one target checkout per target;
- less repeated npm install/setup work;
- easier artifact grouping.

Still keep per-suite commands for diagnosis, but do not make one-lease-per-suite the normal release path unless the target cannot safely share state.

## Run targets concurrently when the host can handle it

If the maintainer machine can run Docker, local SSH, and Parallels together, run required targets concurrently. Keep suites serial **within** each target so target-local state is predictable and failure output stays readable.

Do not parallelize inside one VM/container unless the project has proven its tests, ports, sessions, and filesystem fixtures are isolated.

## Packed install is the release contract

For release gates, prefer:

```text
npm pack
npm install --no-save <tarball> in a test workspace
pi install -l ./node_modules/<package>
pi list assertion
run the live/visual smoke against the installed package
```

Do **not** treat `pi -e .` as release proof. It is useful for inner-loop debugging because it loads the working tree directly, but it can miss packaging and install bugs.

If repeated live suites are slow, share one target-local packed-install prep per target session:

```text
first live suite:
  npm pack
  npm install --no-save <tarball> into shared packed-workspace

all live suites:
  create fresh suite workspace
  pi install -l <shared packed package path>
  pi list
  run with fresh session/artifact dirs
```

This keeps packed-install coverage while avoiding repeated tarball installs.

## Assert artifacts as part of pass/fail

Writing an artifact manifest is not enough. The suite must fail if required artifacts are missing.

Recommended invariant:

```text
summary.ok === assertions.ok
artifact-manifest.missing.length === 0 for any passing suite
missing required artifact => assertion failure + summary.ok=false
```

Required artifacts should include enough evidence to debug failures without rerunning:

- command and exit code;
- Crabbox stdout/stderr and timing;
- suite/target metadata;
- assertions and failures markdown;
- terminal ANSI/text/HTML/PNG for visual suites;
- session JSONL and discovered JSONL path list;
- tool/result summaries;
- bridge/diagnostic files if applicable;
- redaction scan output when violations exist;
- cleanup/abort evidence for abort suites.

## Treat cleanup as a test result

`stopLease()` failures must not be ignored. A run that leaves a container, VM clone, or SSH lease running is not a clean pass.

Recommended behavior:

- capture `crabbox.stop.stdout.txt`, `crabbox.stop.stderr.txt`, and `crabbox.stop.exit-code.txt`;
- fail the owning suite when a one-off suite owns the lease;
- for a multi-suite target session, append a failing `lease-cleanup` result if final stop fails;
- still preserve all earlier suite artifacts.

Avoid throwing away the original test result when cleanup fails. Report both: test result and cleanup result.

## Render visuals host-side from target ANSI

For terminal/TUI projects, the portable visual contract is:

```text
target captures PTY/ConPTY ANSI
host renders ANSI through one xterm/Playwright path
host writes HTML + full PNG + viewport/cropped evidence
assert visual evidence from rendered output, not prompt text
```

This avoids browser dependency drift inside containers/VMs and gives one renderer across macOS, Linux, and Windows.

Do not use tmux as the canonical cross-platform visual contract when Windows native is required. Use PTY on POSIX targets and ConPTY on Windows targets.

## Prefer polling over fixed sleeps

Fixed sleeps create slow flakes. Poll for concrete readiness instead:

- TUI prompt/status visible;
- PTY output contains readiness text;
- session JSONL exists and contains expected final text/tool result;
- marker appears in the final assistant text block, not only in progress text;
- abort marker file exists before sending interrupt;
- process list no longer contains the marker after abort.

Keep bounded timeouts and write timeout artifacts. Do not spin forever.

## Check persisted state, not just stdout

Stdout can look correct while persisted JSONL or artifact state is wrong. For pi extensions, include structural checks over session JSONL where possible:

- expected tool calls/results exist;
- error tool results are absent unless expected;
- final answer markers are in the final text part;
- usage/cache counters meet the project's contract;
- replay/tool IDs are stable enough for later turns;
- abort runs do not contain false success claims.

Avoid naive substring scans over all JSONL. Restrict checks to the message type and field that proves the claim.

## Keep secrets out of every layer

Assume artifacts may contain prompts, paths, tool args, and local output. The runner should:

- redact known API keys before writing logs;
- scan stdout/stderr, JSONL, HTML, ANSI, and debug files for secrets;
- fail if a required redaction invariant is violated;
- keep auth files under user-owned locations, not repo state;
- document that debug artifacts may include sensitive local data.

Never paste API keys, auth JSON, endpoint tokens, cookies, or raw bridge URLs into docs or PR comments.

## Make false green states impossible

The most important guardrails from this setup:

- no target passes from stdout alone when visual/JSONL proof is required;
- no passing suite with missing required artifacts;
- no ignored lease cleanup failures;
- no `pi -e .` release proof when package install matters;
- no skipped required OS because local setup is missing;
- no prompt-text-only visual assertions;
- no one-prompt-per-card matrix that burns live model calls unnecessarily;
- no hidden target-specific assumptions without docs.

## Project adoption checklist

For another pi extension, ask these before implementation:

1. What package/install path must release prove?
2. Which OSes are truly release-blocking?
3. Is Windows native required, or is Linux/macOS enough for this extension?
4. What real user flows need visual proof?
5. What persisted session/artifact state proves those flows?
6. What target fixtures are deterministic and safe?
7. What secrets/auth are needed, and how are they redacted?
8. What exact Crabbox version/commit is supported?
9. What local resources are required: Docker, Parallels, SSH, browser renderer?
10. What docs become the source of truth for that project?

## Minimal portable file map

Use names that fit the target project, but this shape has worked well:

```text
platform-smoke.config.mjs
scripts/platform-smoke.mjs
scripts/platform-smoke/doctor.mjs
scripts/platform-smoke/crabbox-runner.mjs
scripts/platform-smoke/targets.mjs
scripts/platform-smoke/scenarios.mjs
scripts/platform-smoke/assertions.mjs
scripts/platform-smoke/artifacts.mjs
scripts/platform-smoke/pty-capture.mjs
scripts/platform-smoke/render-ansi.mjs
scripts/platform-smoke/visual-evidence.mjs
```

Add tests for cheap invariants:

- helper syntax checks with `node --check`;
- package `files` includes required smoke scripts/docs;
- manifest-missing fails a suite;
- cleanup failure fails a target result;
- path traversal is rejected when unpacking bundles;
- prompt-only visual matches are rejected;
- final marker semantics match the project contract.

## Documentation placement in other projects

To avoid conflicts with existing project instructions:

- put project-specific gate docs in that repo's `docs/` tree;
- add only a short pointer in that repo's `AGENTS.md`;
- do not overwrite existing smoke/checklist docs—link and reconcile them;
- label older smoke scripts as inner-loop/debug if they are no longer release gates;
- keep historical notes separate from current commands;
- if a project already has a local CI entrypoint, either make platform smoke call it or clearly document how the two relate.

## When not to adopt the full setup

Do not cargo-cult the whole matrix if the project does not need it. A smaller project may only need packed install plus one local OS. A UI/TUI extension may need visual proof. A provider/runtime extension usually needs all supported OSes and persisted session evidence.

The standard is not "use every file from `pi-cursor-sdk`." The standard is: define the failure modes that matter for that extension, then make the local smoke gate produce durable evidence for them without conflicting with other repositories.
