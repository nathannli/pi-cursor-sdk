#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildCursorSmokeEnv } from "./lib/cursor-smoke-env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
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
  node scripts/cloud-runtime-smoke.mjs

Environment:
  CURSOR_API_KEY                    Required for the cloud run and archival cleanup.
  CURSOR_CLOUD_SMOKE_MODEL          Cursor model id (default: cursor/composer-2-5).
  CURSOR_CLOUD_SMOKE_TIMEOUT_MS     Timeout in ms (default: 300000).
  CURSOR_CLOUD_SMOKE_ENV_TYPE       Optional Cursor-managed env type: cloud, pool, or machine.
  CURSOR_CLOUD_SMOKE_ENV_NAME       Optional Cursor-managed env name, used only with type.
  CURSOR_CLOUD_SMOKE_KEEP_ARTIFACTS Keep temp artifacts when set to 1.

Exit codes:
  0  cloud run passed and artifact contract matched
  1  missing entitlement/auth, run failure, assertion failure, or cleanup failure`);
}

if (args.has("-h") || args.has("--help")) {
	printHelp();
	process.exit(0);
}

function fail(message, details = "") {
	throw new SmokeFailure(message, details);
}

function reportFailure(error) {
	console.error(`[cloud-smoke] FAIL: ${error instanceof Error ? error.message : String(error)}`);
	if (error instanceof SmokeFailure && error.details) console.error(error.details);
}

function findPiBin() {
	const local = join(root, "node_modules", ".bin", process.platform === "win32" ? "pi.cmd" : "pi");
	return existsSync(local) ? local : process.platform === "win32" ? "pi.cmd" : "pi";
}

function optionalSmokeValue(name) {
	const value = process.env[name]?.trim();
	return value ? value : undefined;
}

export function buildCloudSmokeEnv(artifactDir) {
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
		PI_CURSOR_CLOUD_CONTEXT: "fresh",
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
	const child = spawn(
		findPiBin(),
		["-e", root, "--model", model, "--no-session", "-p", "Reply exactly: cloud-smoke-ok"],
		{ cwd: workspaceDir, env: buildCloudSmokeEnv(artifactDir), stdio: ["ignore", "pipe", "pipe"] },
	);
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => { stdout += chunk; });
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	return new Promise((resolveRun) => {
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			setTimeout(() => child.kill("SIGKILL"), 5000).unref?.();
		}, timeoutMs);
		child.on("close", (code, signal) => {
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

async function archiveCloudAgent(agentId) {
	if (!agentId) return;
	const { Agent } = await import("@cursor/sdk");
	await Agent.archive(agentId, {});
	const archived = await Agent.get(agentId, {});
	if (archived.archived !== true) {
		fail(`cloud agent ${agentId} did not report archived after cleanup`, JSON.stringify(archived, null, 2));
	}
	console.error(`[cloud-smoke] archived agent ${agentId}`);
}

function assertCloudMetadata(metadata, metadataPath) {
	if (metadata.providerMeta?.runtime !== "cloud") fail("provider metadata did not record cloud runtime", metadataPath);
	if (metadata.send?.bridgeEnabled !== false) fail("cloud send unexpectedly enabled pi bridge", metadataPath);
	if (metadata.send?.useNativeToolReplay !== false) fail("cloud send unexpectedly enabled native replay live-run mode", metadataPath);
	if (metadata.send?.agentMode !== "agent") fail("cloud send did not use agent mode", metadataPath);
	if (!metadata.run?.agentId?.startsWith?.("bc-")) fail("cloud run did not return a cloud agent id", metadataPath);
	const providerEventsPath = resolveMetadataArtifactPath(metadataPath, metadata.artifacts?.providerEvents);
	const providerEvents = readJsonlIfPresent(providerEventsPath);
	const report = providerEvents.find((event) => event.phase === "cloud_run_report")?.payload;
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
	console.error(`[cloud-smoke] artifacts: ${artifactRoot}`);
	try {
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
	} catch (error) {
		failure = error;
	}
	try {
		await archiveCloudAgent(agentId);
	} catch (error) {
		console.error(`[cloud-smoke] cleanup failed for ${agentId}: ${error instanceof Error ? error.message : String(error)}`);
		failure ??= error;
	}
	if (process.env.CURSOR_CLOUD_SMOKE_KEEP_ARTIFACTS !== "1") {
		rmSync(artifactRoot, { recursive: true, force: true });
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
