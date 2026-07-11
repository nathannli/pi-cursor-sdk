#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	CHILD_PROCESS_TREE_SPAWN_OPTIONS,
	terminateChild,
} from "./lib/cursor-child-process.mjs";
import { buildCursorSmokeEnv } from "./lib/cursor-smoke-env.mjs";
import {
	CLOUD_AGENT_ID_PATTERN,
	CLOUD_LIFECYCLE_ENTRY_TYPE,
	CLOUD_LIFECYCLE_JOURNAL_PREFIX,
} from "../shared/cursor-cloud-lifecycle-constants.mjs";
import { scrubSensitiveText } from "../shared/cursor-sensitive-text.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const args = new Set(argv);
const CLOUD_ENV_NAMES = [
	"PI_CURSOR_RUNTIME",
	"PI_CURSOR_CLOUD_ACK",
	"PI_CURSOR_CLOUD_ALLOW_LOCAL_STATE",
	"PI_CURSOR_CLOUD_CONTEXT",
	"PI_CURSOR_CLOUD_REPO",
	"PI_CURSOR_CLOUD_BRANCH",
	"PI_CURSOR_CLOUD_DIRECT_PUSH",
	"PI_CURSOR_CLOUD_ENV",
	"PI_CURSOR_CLOUD_ENV_FROM_FILES",
	"PI_CURSOR_CLOUD_ENV_TYPE",
	"PI_CURSOR_CLOUD_ENV_NAME",
];

function scrubSmokeText(value) {
	return scrubSensitiveText(String(value), process.env.CURSOR_API_KEY);
}

class SmokeFailure extends Error {
	constructor(message, details = "") {
		super(message);
		this.details = details;
	}
}

function printHelp() {
	console.log(`Opt-in live Cursor cloud smoke for pi-cursor-sdk.

Usage:
  npm run smoke:cloud
  npm run smoke:cloud:context
  node scripts/cloud-runtime-smoke.mjs [--context-matrix]

Environment:
  CURSOR_API_KEY                    Required for the cloud run and archival cleanup.
  CURSOR_CLOUD_SMOKE_MODEL          Cursor model id (default: cursor/composer-2-5).
  CURSOR_CLOUD_SMOKE_TIMEOUT_MS     Timeout in ms (default: 300000).
  CURSOR_CLOUD_SMOKE_ENV_TYPE       Optional Cursor-managed env type: cloud, pool, or machine.
  CURSOR_CLOUD_SMOKE_ENV_NAME       Optional Cursor-managed env name, used only with type.
  CURSOR_CLOUD_SMOKE_KEEP_ARTIFACTS Keep temp artifacts when set to 1.

Options:
  --context-matrix                  Run sessionful fresh-vs-bootstrap context handoff proof.

Exit codes:
  0  cloud run passed and artifact contract matched
  1  missing entitlement/auth, run failure, assertion failure, or cleanup failure
  2  invalid command-line usage`);
}

if (args.has("-h") || args.has("--help")) {
	printHelp();
	process.exit(0);
}

const unknownArgs = argv.filter((arg) => arg !== "--context-matrix");
const laneArgs = argv.filter((arg) => arg === "--context-matrix");
if (unknownArgs.length > 0 || laneArgs.length > 1) {
	const message = unknownArgs.length > 0
		? `unknown argument(s): ${unknownArgs.join(", ")}`
		: "only one smoke lane may be selected";
	console.error(scrubSmokeText(`[cloud-smoke] usage error: ${message}\nRun with --help for usage.`));
	process.exit(2);
}

function fail(message, details = "") {
	throw new SmokeFailure(message, details);
}

function reportFailure(error) {
	console.error(scrubSmokeText(`[cloud-smoke] FAIL: ${error instanceof Error ? error.message : String(error)}`));
	if (error instanceof SmokeFailure && error.details) console.error(scrubSmokeText(error.details));
}

function findPiBin() {
	const local = join(root, "node_modules", ".bin", process.platform === "win32" ? "pi.cmd" : "pi");
	return existsSync(local) ? local : process.platform === "win32" ? "pi.cmd" : "pi";
}

function optionalSmokeValue(name) {
	const value = process.env[name]?.trim();
	return value ? value : undefined;
}

export function buildCloudSmokeEnv(artifactDir, options = {}) {
	const agentDir = join(artifactDir, "agent");
	mkdirSync(agentDir, { recursive: true });
	const env = buildCursorSmokeEnv({ settingSources: "none", eventDebugDir: artifactDir });
	for (const name of CLOUD_ENV_NAMES) delete env[name];
	const smokeEnvType = optionalSmokeValue("CURSOR_CLOUD_SMOKE_ENV_TYPE");
	const smokeEnvName = optionalSmokeValue("CURSOR_CLOUD_SMOKE_ENV_NAME");
	Object.assign(env, {
		PI_CURSOR_RUNTIME: "cloud",
		PI_CURSOR_CLOUD_ACK: "1",
		PI_CURSOR_CLOUD_ALLOW_LOCAL_STATE: "1",
		PI_CODING_AGENT_DIR: agentDir,
		PI_CURSOR_CLOUD_CONTEXT: options.contextHandoff ?? "fresh",
		...(smokeEnvType ? { PI_CURSOR_CLOUD_ENV_TYPE: smokeEnvType } : {}),
		...(smokeEnvType && smokeEnvName ? { PI_CURSOR_CLOUD_ENV_NAME: smokeEnvName } : {}),
	});
	delete env.PI_CURSOR_PI_TOOL_BRIDGE_DEBUG;
	return env;
}

export function buildCloudSmokeWorkspace(artifactDir) {
	const workspaceDir = join(artifactDir, "workspace");
	mkdirSync(workspaceDir, { recursive: true });
	return workspaceDir;
}

function runPi({ artifactDir, timeoutMs }) {
	const model = process.env.CURSOR_CLOUD_SMOKE_MODEL || "cursor/composer-2-5";
	const workspaceDir = buildCloudSmokeWorkspace(artifactDir);
	const sessionDir = join(artifactDir, "sessions");
	mkdirSync(sessionDir, { recursive: true });
	const child = spawn(
		findPiBin(),
		[
			"-e", root,
			"--model", model,
			"--session-dir", sessionDir,
			"--session-id", `cloud-smoke-${Date.now()}`,
			"-p", "Reply exactly: cloud-smoke-ok",
		],
		{
			cwd: workspaceDir,
			env: buildCloudSmokeEnv(artifactDir),
			stdio: ["ignore", "pipe", "pipe"],
			...CHILD_PROCESS_TREE_SPAWN_OPTIONS,
		},
	);
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => { stdout += chunk; });
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	return new Promise((resolveRun, rejectRun) => {
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			void terminateChild(child).then(
				() => rejectRun(new Error(`pi cloud smoke timed out after ${timeoutMs}ms`)),
				(error) => rejectRun(new Error(`pi cloud smoke timed out and process-tree cleanup failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })),
			);
		}, timeoutMs);
		child.once("error", (error) => {
			if (timedOut) return;
			clearTimeout(timer);
			rejectRun(error);
		});
		child.once("close", (code, signal) => {
			if (timedOut) return;
			clearTimeout(timer);
			resolveRun({ code, signal, stdout, stderr });
		});
	});
}

function metadataFiles(dir) {
	const files = [];
	const stack = [dir];
	while (stack.length > 0) {
		const current = stack.pop();
		try {
			for (const entry of readdirSync(current, { withFileTypes: true })) {
				const path = join(current, entry.name);
				if (entry.isDirectory()) stack.push(path);
				else if (entry.name === "metadata.json") files.push(path);
			}
		} catch {}
	}
	return files.sort();
}

function readLatestMetadataIfPresent(artifactDir) {
	const files = metadataFiles(artifactDir);
	if (files.length === 0) return undefined;
	const metadataPath = files.at(-1);
	return { metadataPath, metadata: JSON.parse(readFileSync(metadataPath, "utf8")) };
}

function addExactCloudAgentId(ids, value) {
	if (typeof value === "string" && CLOUD_AGENT_ID_PATTERN.test(value)) ids.add(value);
}

function cloudAgentIdsFromMetadata(artifactDir) {
	const ids = new Set();
	for (const metadataPath of metadataFiles(artifactDir)) {
		try {
			const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
			addExactCloudAgentId(ids, metadata.run?.agentId ?? metadata.providerMeta?.cloudAgentId);
		} catch {
			// One corrupt optional debug artifact must not hide IDs available from other evidence.
		}
	}
	return [...ids];
}

function lifecycleArtifactFiles(dir) {
	const files = [];
	const stack = [dir];
	while (stack.length > 0) {
		const current = stack.pop();
		try {
			for (const entry of readdirSync(current, { withFileTypes: true })) {
				const path = join(current, entry.name);
				if (entry.isDirectory()) stack.push(path);
				else if (entry.name.endsWith(".jsonl") || (entry.name.startsWith(`${CLOUD_LIFECYCLE_JOURNAL_PREFIX}-`) && entry.name.endsWith(".journal"))) files.push(path);
			}
		} catch {}
	}
	return files.sort();
}

export function cloudAgentIdsFromLifecycleArtifacts(artifactDir) {
	const ids = new Set();
	for (const path of lifecycleArtifactFiles(artifactDir)) {
		const journal = path.split(/[\\/]/).at(-1)?.startsWith(`${CLOUD_LIFECYCLE_JOURNAL_PREFIX}-`) === true;
		let lines;
		try {
			lines = readFileSync(path, "utf8").split(/\r?\n/);
		} catch {
			continue;
		}
		for (const line of lines) {
			if (!line) continue;
			try {
				const entry = JSON.parse(line);
				const data = journal
					? entry
					: entry?.type === "custom" && entry.customType === CLOUD_LIFECYCLE_ENTRY_TYPE
						? entry.data
						: undefined;
				addExactCloudAgentId(ids, data?.agentId);
			} catch {
				// Journals are newline-framed; one partial line must not hide later IDs.
			}
		}
	}
	return [...ids];
}

function resolveMetadataArtifactPath(metadataPath, artifactPath) {
	if (!artifactPath) return undefined;
	return resolve(artifactPath) === artifactPath ? artifactPath : join(dirname(metadataPath), artifactPath);
}

function readJsonlIfPresent(path) {
	if (!path || !existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split(/\n+/)
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

function startRpc({ artifactDir, contextHandoff, sessionId }) {
	const model = process.env.CURSOR_CLOUD_SMOKE_MODEL || "cursor/composer-2-5";
	const sessionDir = join(artifactDir, "sessions");
	mkdirSync(sessionDir, { recursive: true });
	const child = spawn(
		findPiBin(),
		["--mode", "rpc", "-e", root, "--model", model, "--approve", "--session-dir", sessionDir, "--session-id", sessionId],
		{
			cwd: buildCloudSmokeWorkspace(artifactDir),
			env: buildCloudSmokeEnv(artifactDir, { contextHandoff }),
			stdio: ["pipe", "pipe", "pipe"],
			...CHILD_PROCESS_TREE_SPAWN_OPTIONS,
		},
	);
	let stderr = "";
	const events = [];
	const pending = new Map();
	let requestId = 0;
	let stdoutBuffer = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	child.stdout.on("data", (chunk) => {
		stdoutBuffer += chunk;
		let newlineIndex;
		while ((newlineIndex = stdoutBuffer.indexOf("\n")) >= 0) {
			const line = stdoutBuffer.slice(0, newlineIndex);
			stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
			if (!line.trim()) continue;
			let message;
			try {
				message = JSON.parse(line);
			} catch {
				continue;
			}
			if (message.type === "response" && pending.has(message.id)) {
				const request = pending.get(message.id);
				pending.delete(message.id);
				clearTimeout(request.timer);
				request.resolve(message);
				continue;
			}
			events.push(message);
		}
	});
	const send = (type, extra = {}, timeoutMs = 120000) => new Promise((resolveRequest, rejectRequest) => {
		const id = `cloud_smoke_${++requestId}`;
		const timer = setTimeout(() => {
			pending.delete(id);
			rejectRequest(new Error(`timeout waiting for ${type}. Stderr: ${stderr}`));
		}, timeoutMs);
		pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
		child.stdin.write(`${JSON.stringify({ id, type, ...extra })}\n`);
	});
	const stop = async () => {
		for (const request of pending.values()) clearTimeout(request.timer);
		pending.clear();
		await terminateChild(child);
	};
	return { events, send, stop, get stderr() { return stderr; } };
}

async function waitForAgentEnd(rpc, fromIndex, timeoutMs) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (rpc.events.slice(fromIndex).some((event) => event.type === "agent_end")) return;
		await new Promise((resolveWait) => setTimeout(resolveWait, 250));
	}
	throw new Error(`timeout waiting for agent_end. Stderr: ${rpc.stderr}`);
}

async function promptAndRead({ rpc, artifactDir, message, timeoutMs, expectedContextHandoff }) {
	const fromIndex = rpc.events.length;
	await rpc.send("prompt", { message }, timeoutMs);
	await waitForAgentEnd(rpc, fromIndex, timeoutMs);
	const textResponse = await rpc.send("get_last_assistant_text", {}, 120000);
	if (!textResponse.success) fail("failed to read last assistant text", textResponse.error);
	const latestMetadata = readLatestMetadataIfPresent(artifactDir);
	if (!latestMetadata) fail("context smoke metadata missing", artifactDir);
	assertCloudMetadata(latestMetadata.metadata, latestMetadata.metadataPath, { requireReport: false });
	if (expectedContextHandoff && latestMetadata.metadata.providerMeta?.contextHandoff !== expectedContextHandoff) {
		fail("context smoke metadata recorded wrong handoff", JSON.stringify({ expected: expectedContextHandoff, actual: latestMetadata.metadata.providerMeta?.contextHandoff }, null, 2));
	}
	return {
		text: typeof textResponse.data?.text === "string" ? textResponse.data.text : "",
		agentId: latestMetadata.metadata.run?.agentId ?? latestMetadata.metadata.providerMeta?.cloudAgentId,
		runId: latestMetadata.metadata.run?.runId,
	};
}

async function runContextScenario({ artifactRoot, contextHandoff, timeoutMs }) {
	const artifactDir = join(artifactRoot, `context-${contextHandoff}`);
	mkdirSync(artifactDir, { recursive: true });
	const marker = `CLOUD_CONTEXT_${contextHandoff}_${Date.now()}`;
	const rpc = startRpc({ artifactDir, contextHandoff, sessionId: `cloud-context-${contextHandoff}-${Date.now()}` });
	try {
		const first = await promptAndRead({
			rpc,
			artifactDir,
			message: `Remember exact marker ${marker}. Reply exactly FIRST_OK.`,
			timeoutMs,
			expectedContextHandoff: contextHandoff,
		});
		if (firstNonEmptyLine(first.text) !== "FIRST_OK") fail(`cloud ${contextHandoff} setup turn did not return FIRST_OK`, first.text);
		const second = await promptAndRead({
			rpc,
			artifactDir,
			message: "What exact CLOUD_CONTEXT marker did I ask you to remember earlier in this pi session? Reply exactly MARKER=<marker> if visible, otherwise NO_MARKER.",
			timeoutMs,
			expectedContextHandoff: contextHandoff,
		});
		return { contextHandoff, marker, first, second };
	} finally {
		await rpc.stop();
	}
}

function nonEmptyLines(text) {
	return String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function firstNonEmptyLine(text) {
	return nonEmptyLines(text).at(0) ?? "";
}

function lastNonEmptyLine(text) {
	return nonEmptyLines(text).at(-1) ?? "";
}

async function runContextMatrix({ artifactRoot, timeoutMs }) {
	const fresh = await runContextScenario({ artifactRoot, contextHandoff: "fresh", timeoutMs });
	if (fresh.second.text.includes(fresh.marker) || lastNonEmptyLine(fresh.second.text) !== "NO_MARKER") {
		fail("fresh cloud context handoff leaked prior pi context", JSON.stringify({ expected: "NO_MARKER", actual: fresh.second.text, marker: fresh.marker }, null, 2));
	}
	const bootstrap = await runContextScenario({ artifactRoot, contextHandoff: "bootstrap", timeoutMs });
	if (lastNonEmptyLine(bootstrap.second.text) !== `MARKER=${bootstrap.marker}`) {
		fail("bootstrap cloud context handoff did not include prior pi context", JSON.stringify({ expected: `MARKER=${bootstrap.marker}`, actual: bootstrap.second.text }, null, 2));
	}
	return [fresh, bootstrap];
}

async function archiveCloudAgent(agentId) {
	if (!agentId) return;
	const { Agent } = await import("@cursor/sdk");
	await Agent.archive(agentId, {});
	const archived = await Agent.get(agentId, {});
	if (archived.archived !== true) {
		fail(`cloud agent ${agentId} did not report archived after cleanup`, JSON.stringify(archived, null, 2));
	}
	console.error(scrubSmokeText(`[cloud-smoke] archived agent ${agentId}`));
}

function assertCloudMetadata(metadata, metadataPath, options = {}) {
	if (metadata.providerMeta?.runtime !== "cloud") fail("provider metadata did not record cloud runtime", metadataPath);
	if (metadata.send?.bridgeEnabled !== false) fail("cloud send unexpectedly enabled pi bridge", metadataPath);
	if (metadata.send?.useNativeToolReplay !== false) fail("cloud send unexpectedly enabled native replay live-run mode", metadataPath);
	if (metadata.send?.agentMode !== "agent") fail("cloud send did not use agent mode", metadataPath);
	if (!metadata.run?.agentId?.startsWith?.("bc-")) fail("cloud run did not return a cloud agent id", metadataPath);
	const providerEventsPath = resolveMetadataArtifactPath(metadataPath, metadata.artifacts?.providerEvents);
	const providerEvents = readJsonlIfPresent(providerEventsPath);
	const report = providerEvents.find((event) => event.phase === "cloud_run_report")?.payload;
	if (!report && options.requireReport === false) return;
	if (report?.agentId !== metadata.run.agentId) fail("cloud report did not include the cloud agent id", providerEventsPath ?? metadataPath);
	if (report?.runId !== metadata.run.runId) fail("cloud report did not include the cloud run id", providerEventsPath ?? metadataPath);
	if (!Array.isArray(report.branches)) fail("cloud report branches were not an array", providerEventsPath ?? metadataPath);
	if (report.artifacts !== undefined && !Array.isArray(report.artifacts)) fail("cloud report artifacts were not an array", providerEventsPath ?? metadataPath);
	if (report.usage !== undefined && (typeof report.usage !== "object" || report.usage === null)) fail("cloud report usage was not an object", providerEventsPath ?? metadataPath);
}

async function main() {
	if (!process.env.CURSOR_API_KEY) fail("CURSOR_API_KEY is required for cloud smoke and cleanup");
	const timeoutMs = Number(process.env.CURSOR_CLOUD_SMOKE_TIMEOUT_MS || 300000);
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) fail("CURSOR_CLOUD_SMOKE_TIMEOUT_MS must be a positive number");

	const artifactRoot = mkdtempSync(join(tmpdir(), "pi-cursor-cloud-smoke-"));
	let agentId;
	let failure;
	console.error(scrubSmokeText(`[cloud-smoke] artifacts: ${artifactRoot}`));
	try {
		if (args.has("--context-matrix")) {
			await runContextMatrix({ artifactRoot, timeoutMs });
			console.error(scrubSmokeText("[cloud-smoke] context matrix passed"));
		} else {
			const run = await runPi({ artifactDir: artifactRoot, timeoutMs });
			const latestMetadata = readLatestMetadataIfPresent(artifactRoot);
			agentId = latestMetadata?.metadata.run?.agentId ?? latestMetadata?.metadata.providerMeta?.cloudAgentId;
			if (run.code !== 0) {
				fail(`pi cloud smoke exited ${run.code}${run.signal ? ` (${run.signal})` : ""}`, `${run.stderr}\n${run.stdout}`.trim());
			}
			if (!/cloud-smoke-ok/i.test(run.stdout)) {
				fail("cloud smoke output missing exact marker", `${run.stderr}\n${run.stdout}`.trim());
			}
			if (!latestMetadata) fail("no SDK event debug metadata was written", artifactRoot);
			assertCloudMetadata(latestMetadata.metadata, latestMetadata.metadataPath);
		}
	} catch (error) {
		failure = error;
	}
	for (const id of new Set([
		agentId,
		...cloudAgentIdsFromMetadata(artifactRoot),
		...cloudAgentIdsFromLifecycleArtifacts(artifactRoot),
	].filter((id) => typeof id === "string" && CLOUD_AGENT_ID_PATTERN.test(id)))) {
		try {
			await archiveCloudAgent(id);
		} catch (error) {
			console.error(scrubSmokeText(`[cloud-smoke] cleanup failed for ${id}: ${error instanceof Error ? error.message : String(error)}`));
			failure ??= error;
		}
	}
	if (process.env.CURSOR_CLOUD_SMOKE_KEEP_ARTIFACTS !== "1" && !failure) {
		rmSync(artifactRoot, { recursive: true, force: true });
	} else {
		console.error(scrubSmokeText(`[cloud-smoke] retained artifacts: ${artifactRoot}`));
	}
	if (failure) throw failure;
	console.log("cloud-smoke-ok");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		reportFailure(error);
		process.exit(1);
	});
}
