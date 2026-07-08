#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { terminateChild } from "./lib/cursor-child-process.mjs";
import { buildCursorSmokeEnv } from "./lib/cursor-smoke-env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));

const CLOUD_RUNTIME_ENV_NAMES = [
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

class SmokeFailure extends Error {
	constructor(message, details = "") {
		super(message);
		this.details = details;
	}
}

function printHelp() {
	console.log(`Live local Cursor resume smoke for pi-cursor-sdk.

Usage:
  npm run smoke:local-resume
  npm run smoke:local-resume:safety
  npm run smoke:local-resume:tool-surface
  node scripts/local-resume-smoke.mjs
  node scripts/local-resume-smoke.mjs --safety
  node scripts/local-resume-smoke.mjs --tool-surface

Environment:
  CURSOR_LOCAL_RESUME_SMOKE_MODEL          Cursor model id (default: cursor/composer-2-5:slow).
  CURSOR_LOCAL_RESUME_SMOKE_TIMEOUT_MS     Timeout in ms per model turn (default: 300000).
  CURSOR_LOCAL_RESUME_SMOKE_KEEP_ARTIFACTS Keep temp artifacts when set to 1.

Exit codes:
  0  local resume proof passed
  1  auth/run/assertion failure`);
}

if (args.has("-h") || args.has("--help")) {
	printHelp();
	process.exit(0);
}

function fail(message, details = "") {
	throw new SmokeFailure(message, details);
}

function reportFailure(error) {
	console.error(`[local-resume-smoke] FAIL: ${error instanceof Error ? error.message : String(error)}`);
	if (error instanceof SmokeFailure && error.details) console.error(error.details);
}

function findPiCommand() {
	const cli = join(root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
	if (existsSync(cli)) return { command: process.execPath, argsPrefix: [cli] };
	const local = join(root, "node_modules", ".bin", process.platform === "win32" ? "pi.cmd" : "pi");
	return { command: existsSync(local) ? local : process.platform === "win32" ? "pi.cmd" : "pi", argsPrefix: [] };
}

export function buildLocalResumeSmokeEnv(artifactDir, { baseEnv = process.env, bridge = false, exposeBuiltinTools = false } = {}) {
	const agentDir = join(artifactDir, "agent");
	mkdirSync(agentDir, { recursive: true });
	const env = buildCursorSmokeEnv({ baseEnv, settingSources: "none", bridge, nativeToolDisplay: false, registerNativeTools: false, exposeBuiltinTools, eventDebugDir: join(artifactDir, "debug") });
	for (const name of CLOUD_RUNTIME_ENV_NAMES) delete env[name];
	return {
		...env,
		PI_CODING_AGENT_DIR: agentDir,
		PI_CURSOR_RUNTIME: "local",
		PI_CURSOR_LOCAL_RESUME: "1",
	};
}

function startRpc({ artifactDir, sessionDir, sessionId, bridge = false, exposeBuiltinTools = false }) {
	const model = process.env.CURSOR_LOCAL_RESUME_SMOKE_MODEL || "cursor/composer-2-5:slow";
	const workspaceDir = join(artifactDir, "workspace");
	mkdirSync(workspaceDir, { recursive: true });
	const pi = findPiCommand();
	const child = spawn(
		pi.command,
		[...pi.argsPrefix, "--mode", "rpc", "-e", root, "--model", model, "--cursor-runtime", "local", "--approve", "--session-dir", sessionDir, "--session-id", sessionId],
		{ cwd: workspaceDir, env: buildLocalResumeSmokeEnv(artifactDir, { bridge, exposeBuiltinTools }), stdio: ["pipe", "pipe", "pipe"] },
	);
	let stdoutBuffer = "";
	let stderr = "";
	const events = [];
	const pending = new Map();
	let requestId = 0;
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
			try { message = JSON.parse(line); } catch { continue; }
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
		const id = `local_resume_smoke_${++requestId}`;
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

function metadataFiles(artifactDir) {
	const files = [];
	const stack = [join(artifactDir, "debug")];
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
	return files.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
}

function readMetadataSince(artifactDir, seenPaths) {
	return metadataFiles(artifactDir)
		.filter((metadataPath) => !seenPaths.has(metadataPath))
		.map((metadataPath) => ({ metadataPath, metadata: JSON.parse(readFileSync(metadataPath, "utf8")) }));
}

async function readLastAssistantText(rpc) {
	const started = Date.now();
	let lastResponse;
	while (Date.now() - started < 10000) {
		lastResponse = await rpc.send("get_last_assistant_text", {}, 120000);
		if (!lastResponse.success) fail("failed to read last assistant text", lastResponse.error);
		const text = typeof lastResponse.data?.text === "string" ? lastResponse.data.text : "";
		if (text.trim().length > 0) return text;
		await new Promise((resolveWait) => setTimeout(resolveWait, 250));
	}
	return typeof lastResponse?.data?.text === "string" ? lastResponse.data.text : "";
}

async function rpcData(rpc, type, extra = {}, timeoutMs = 120000) {
	const response = await rpc.send(type, extra, timeoutMs);
	if (!response.success) fail(`${type} RPC failed`, response.error ?? JSON.stringify(response));
	return response.data ?? {};
}

async function getState(rpc) {
	return rpcData(rpc, "get_state");
}

async function getEntries(rpc) {
	return rpcData(rpc, "get_entries");
}

function resumeEntries(entries) {
	return (entries.entries ?? []).filter((entry) => entry?.type === "custom" && entry.customType === "cursor-sdk-agent-resume");
}

function latestResumeEntry(entries) {
	return resumeEntries(entries).at(-1)?.data;
}

function resumeEntryCount(entries) {
	return resumeEntries(entries).length;
}

function userEntryContaining(entries, text) {
	return (entries.entries ?? []).find((entry) => entry?.type === "message" && entry.message?.role === "user" && String(entry.message?.content?.[0]?.text ?? entry.message?.content ?? "").includes(text));
}

async function promptAndRead({ rpc, artifactDir, message, timeoutMs, seenMetadata }) {
	const eventStart = rpc.events.length;
	await rpc.send("prompt", { message }, timeoutMs);
	await waitForAgentEnd(rpc, eventStart, timeoutMs);
	const text = await readLastAssistantText(rpc);
	const metadata = readMetadataSince(artifactDir, seenMetadata);
	for (const item of metadata) seenMetadata.add(item.metadataPath);
	const latest = metadata.at(-1);
	if (!latest) fail("no new metadata was written", artifactDir);
	return {
		text,
		metadataPath: latest.metadataPath,
		metadata: latest.metadata,
	};
}

function assertTurnMetadata(label, turn, expected) {
	const meta = turn.metadata.providerMeta ?? {};
	if (meta.runtime === "cloud") fail(`${label} unexpectedly recorded cloud runtime`, turn.metadataPath);
	if (meta.localResume !== true) fail(`${label} did not record localResume=true`, turn.metadataPath);
	if (meta.resumedAgent !== expected.resumedAgent) {
		fail(`${label} resumedAgent mismatch`, JSON.stringify({ expected: expected.resumedAgent, actual: meta.resumedAgent, metadataPath: turn.metadataPath }, null, 2));
	}
	if (!turn.metadata.run?.agentId?.startsWith?.("agent-")) fail(`${label} did not record local agent id`, turn.metadataPath);
}

function assertNotResumedFrom(label, turn, agentId) {
	assertTurnMetadata(label, turn, { resumedAgent: false });
	if (turn.metadata.run.agentId === agentId) fail(`${label} reused original local SDK agent`, JSON.stringify({ original: agentId, actual: turn.metadata.run.agentId }, null, 2));
}

function createRunContext(prefix) {
	const artifactRoot = mkdtempSync(join(tmpdir(), prefix));
	return {
		artifactRoot,
		sessionDir: join(artifactRoot, "sessions"),
		sessionId: `local-resume-${Date.now()}`,
		seenMetadata: new Set(),
	};
}

function parseTimeout() {
	const timeoutMs = Number(process.env.CURSOR_LOCAL_RESUME_SMOKE_TIMEOUT_MS || 300000);
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) fail("CURSOR_LOCAL_RESUME_SMOKE_TIMEOUT_MS must be a positive number");
	return timeoutMs;
}

async function runSmoke() {
	const timeoutMs = parseTimeout();
	const { artifactRoot, sessionDir, sessionId, seenMetadata } = createRunContext("pi-cursor-local-resume-smoke-");
	const token = `LOCAL_RESUME_${Date.now()}`;
	let first;
	let second;
	console.error(`[local-resume-smoke] artifacts: ${artifactRoot}`);
	try {
		let rpc = startRpc({ artifactDir: artifactRoot, sessionDir, sessionId });
		try {
			first = await promptAndRead({
				rpc,
				artifactDir: artifactRoot,
				message: `Remember exact token ${token}. Reply exactly FIRST_OK.`,
				timeoutMs,
				seenMetadata,
			});
		} finally {
			await rpc.stop();
		}
		assertTurnMetadata("first turn", first, { resumedAgent: false });

		rpc = startRpc({ artifactDir: artifactRoot, sessionDir, sessionId });
		try {
			second = await promptAndRead({
				rpc,
				artifactDir: artifactRoot,
				message: "What exact LOCAL_RESUME token did I ask you to remember earlier in this pi session? Reply exactly TOKEN=<token> if visible, otherwise NO_TOKEN.",
				timeoutMs,
				seenMetadata,
			});
		} finally {
			await rpc.stop();
		}
		if (!second.text.includes(`TOKEN=${token}`)) fail("second turn did not recall local resume token", JSON.stringify({ expected: `TOKEN=${token}`, actual: second.text }, null, 2));
		assertTurnMetadata("second turn", second, { resumedAgent: true });
		if (first.metadata.run.agentId !== second.metadata.run.agentId) {
			fail("second turn did not reuse the first local SDK agent", JSON.stringify({ first: first.metadata.run.agentId, second: second.metadata.run.agentId }, null, 2));
		}
		console.log("local-resume-smoke-ok");
		console.error(`[local-resume-smoke] agent ${second.metadata.run.agentId} resumed across restart`);
	} finally {
		if (process.env.CURSOR_LOCAL_RESUME_SMOKE_KEEP_ARTIFACTS !== "1") rmSync(artifactRoot, { recursive: true, force: true });
	}
}

async function runSafetySmoke() {
	const timeoutMs = parseTimeout();
	const { artifactRoot, sessionDir, sessionId, seenMetadata } = createRunContext("pi-cursor-local-resume-safety-smoke-");
	const baseToken = `LOCAL_BASE_${Date.now()}`;
	const futureToken = `LOCAL_FUTURE_${Date.now()}`;
	let originalSessionFile;
	let originalAgentId;
	let futureEntryId;
	console.error(`[local-resume-smoke] artifacts: ${artifactRoot}`);
	try {
		let rpc = startRpc({ artifactDir: artifactRoot, sessionDir, sessionId });
		try {
			const first = await promptAndRead({
				rpc,
				artifactDir: artifactRoot,
				message: `Remember exact base token ${baseToken}. Reply exactly BASE_OK.`,
				timeoutMs,
				seenMetadata,
			});
			assertTurnMetadata("base turn", first, { resumedAgent: false });
			const future = await promptAndRead({
				rpc,
				artifactDir: artifactRoot,
				message: `Remember exact future-only token ${futureToken}. Reply exactly FUTURE_OK.`,
				timeoutMs,
				seenMetadata,
			});
			assertTurnMetadata("future turn", future, { resumedAgent: false });
			if (future.metadata.run.agentId !== first.metadata.run.agentId) fail("same process did not keep one local SDK agent", JSON.stringify({ first: first.metadata.run.agentId, future: future.metadata.run.agentId }, null, 2));
			originalAgentId = future.metadata.run.agentId;
			const state = await getState(rpc);
			originalSessionFile = state.sessionFile;
			const entries = await getEntries(rpc);
			if (resumeEntryCount(entries) < 2) fail("original branch did not persist resume entries", JSON.stringify({ resumeEntries: resumeEntryCount(entries), sessionFile: originalSessionFile }, null, 2));
			futureEntryId = userEntryContaining(entries, futureToken)?.id;
			if (!futureEntryId) fail("could not find future-token user entry", originalSessionFile ?? "");
		} finally {
			await rpc.stop();
		}

		rpc = startRpc({ artifactDir: artifactRoot, sessionDir, sessionId });
		try {
			const same = await promptAndRead({
				rpc,
				artifactDir: artifactRoot,
				message: "What exact LOCAL_FUTURE token did I ask you to remember? Reply exactly TOKEN=<token> if visible, otherwise NO_TOKEN.",
				timeoutMs,
				seenMetadata,
			});
			if (!same.text.includes(`TOKEN=${futureToken}`)) fail("same-session restart did not recall future token", JSON.stringify({ expected: `TOKEN=${futureToken}`, actual: same.text }, null, 2));
			assertTurnMetadata("same-session restart", same, { resumedAgent: true });
			if (same.metadata.run.agentId !== originalAgentId) fail("same-session restart did not resume original agent", JSON.stringify({ original: originalAgentId, actual: same.metadata.run.agentId }, null, 2));

			const clone = await rpcData(rpc, "clone", {}, 120000);
			if (clone.cancelled === true) fail("clone was cancelled");
			const cloneState = await getState(rpc);
			if (cloneState.sessionFile === originalSessionFile) fail("clone did not switch session file", String(originalSessionFile));
			const cloneEntries = await getEntries(rpc);
			if (resumeEntryCount(cloneEntries) < 1) fail("clone did not carry any resume entries to reject", JSON.stringify({ sessionFile: cloneState.sessionFile }, null, 2));
			const cloneTurn = await promptAndRead({
				rpc,
				artifactDir: artifactRoot,
				message: "What exact LOCAL_FUTURE token is visible in this cloned pi transcript? Reply exactly TOKEN=<token> if visible, otherwise NO_TOKEN.",
				timeoutMs,
				seenMetadata,
			});
			assertNotResumedFrom("clone session", cloneTurn, originalAgentId);

			await rpcData(rpc, "switch_session", { sessionPath: originalSessionFile }, 120000);
			const fork = await rpcData(rpc, "fork", { entryId: futureEntryId }, 120000);
			if (fork.cancelled === true) fail("fork was cancelled");
			const forkEntries = await getEntries(rpc);
			if (JSON.stringify(forkEntries).includes(futureToken)) fail("fork branch already contained future token before prompt", String(futureEntryId));
			const forkTurn = await promptAndRead({
				rpc,
				artifactDir: artifactRoot,
				message: "What exact LOCAL_FUTURE token is visible on this forked earlier branch? Reply exactly TOKEN=<token> if visible, otherwise NO_TOKEN.",
				timeoutMs,
				seenMetadata,
			});
			assertNotResumedFrom("fork before future", forkTurn, originalAgentId);
			if (forkTurn.text.includes(futureToken)) fail("forked earlier branch leaked future token", forkTurn.text);
		} finally {
			await rpc.stop();
		}
		console.log("local-resume-safety-smoke-ok");
		console.error(`[local-resume-smoke] original ${originalAgentId} rejected for clone and fork-before-future`);
	} finally {
		if (process.env.CURSOR_LOCAL_RESUME_SMOKE_KEEP_ARTIFACTS !== "1") rmSync(artifactRoot, { recursive: true, force: true });
	}
}

async function runToolSurfaceSmoke() {
	const timeoutMs = parseTimeout();
	const { artifactRoot, sessionDir, sessionId, seenMetadata } = createRunContext("pi-cursor-local-resume-tool-surface-smoke-");
	const token = `LOCAL_TOOL_SURFACE_${Date.now()}`;
	let originalAgentId;
	let originalPoolKey;
	console.error(`[local-resume-smoke] artifacts: ${artifactRoot}`);
	try {
		let rpc = startRpc({ artifactDir: artifactRoot, sessionDir, sessionId });
		try {
			const first = await promptAndRead({
				rpc,
				artifactDir: artifactRoot,
				message: `Remember exact tool-surface token ${token}. Reply exactly TOOL_SURFACE_OK.`,
				timeoutMs,
				seenMetadata,
			});
			assertTurnMetadata("baseline tool surface", first, { resumedAgent: false });
			originalAgentId = first.metadata.run.agentId;
			originalPoolKey = latestResumeEntry(await getEntries(rpc))?.poolKey;
			if (!originalPoolKey) fail("baseline turn did not persist a resume pool key");
		} finally {
			await rpc.stop();
		}

		rpc = startRpc({ artifactDir: artifactRoot, sessionDir, sessionId });
		try {
			const sameSurface = await promptAndRead({
				rpc,
				artifactDir: artifactRoot,
				message: "What exact LOCAL_TOOL_SURFACE token did I ask you to remember? Reply exactly TOKEN=<token> if visible, otherwise NO_TOKEN.",
				timeoutMs,
				seenMetadata,
			});
			if (!sameSurface.text.includes(`TOKEN=${token}`)) fail("same tool surface did not recall token", JSON.stringify({ expected: `TOKEN=${token}`, actual: sameSurface.text }, null, 2));
			assertTurnMetadata("same tool surface restart", sameSurface, { resumedAgent: true });
			if (sameSurface.metadata.run.agentId !== originalAgentId) fail("same tool surface restart did not resume original agent", JSON.stringify({ original: originalAgentId, actual: sameSurface.metadata.run.agentId }, null, 2));
		} finally {
			await rpc.stop();
		}

		rpc = startRpc({ artifactDir: artifactRoot, sessionDir, sessionId, bridge: true, exposeBuiltinTools: true });
		try {
			const changedSurface = await promptAndRead({
				rpc,
				artifactDir: artifactRoot,
				message: "What exact LOCAL_TOOL_SURFACE token is visible in this pi transcript? Reply exactly TOKEN=<token> if visible, otherwise NO_TOKEN.",
				timeoutMs,
				seenMetadata,
			});
			if (!changedSurface.text.includes(`TOKEN=${token}`)) fail("changed tool surface did not bootstrap transcript token", JSON.stringify({ expected: `TOKEN=${token}`, actual: changedSurface.text }, null, 2));
			assertNotResumedFrom("changed tool surface", changedSurface, originalAgentId);
			if (!changedSurface.metadata.providerMeta?.bridgeRunId) fail("changed tool surface did not start a bridge run", changedSurface.metadataPath);
			const changedHandle = latestResumeEntry(await getEntries(rpc));
			if (!changedHandle?.poolKey) fail("changed tool surface did not persist a resume pool key");
			if (changedHandle.agentId !== changedSurface.metadata.run.agentId) fail("changed tool surface persisted handle for a different agent", JSON.stringify({ handle: changedHandle.agentId, run: changedSurface.metadata.run.agentId }, null, 2));
			if (changedHandle.poolKey === originalPoolKey) fail("changed tool surface reused the original pool key");
		} finally {
			await rpc.stop();
		}
		console.log("local-resume-tool-surface-smoke-ok");
		console.error(`[local-resume-smoke] original ${originalAgentId} rejected after bridge builtin tool surface change`);
	} finally {
		if (process.env.CURSOR_LOCAL_RESUME_SMOKE_KEEP_ARTIFACTS !== "1") rmSync(artifactRoot, { recursive: true, force: true });
	}
}

function selectedRun() {
	if (args.has("--tool-surface")) return runToolSurfaceSmoke;
	if (args.has("--safety")) return runSafetySmoke;
	return runSmoke;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const run = selectedRun();
	run().catch((error) => {
		reportFailure(error);
		process.exit(1);
	});
}
