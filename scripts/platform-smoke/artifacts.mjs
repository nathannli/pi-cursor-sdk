/**
 * Artifact management — directory layout, manifest, redaction scanning, packaging.
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, renameSync } from "node:fs";
import { resolve, relative, basename, dirname } from "node:path";

const PLATFORM_SMOKE_RUN_DIR_PATTERN = /^run-(\d+)-[a-z0-9]+$/i;
const HOURS_TO_MS = 60 * 60 * 1000;
const DAYS_TO_MS = 24 * HOURS_TO_MS;
const LATEST_INDEX_NAME = "latest.json";

function finiteNonNegativeNumber(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finiteNonNegativeInteger(value) {
	return Number.isInteger(value) && value >= 0;
}

/** Prune old top-level platform-smoke run artifact directories. */
export function prunePlatformSmokeArtifacts(artifactRoot, retention = {}, options = {}) {
	const root = resolve(process.cwd(), artifactRoot);
	const maxRunDirs = finiteNonNegativeInteger(retention.maxRunDirs) ? retention.maxRunDirs : undefined;
	const maxAgeDays = finiteNonNegativeNumber(retention.maxAgeDays) ? retention.maxAgeDays : undefined;
	const preserveRecentHours = finiteNonNegativeNumber(retention.preserveRecentHours) ? retention.preserveRecentHours : 24;
	const enabled = retention.enabled !== false && (maxRunDirs !== undefined || maxAgeDays !== undefined);
	const result = { root, enabled, removed: [], kept: [], ignored: [] };
	if (!enabled || !existsSync(root)) return result;

	const nowMs = finiteNonNegativeNumber(options.nowMs) ? options.nowMs : Date.now();
	const preserveRecentMs = preserveRecentHours * HOURS_TO_MS;
	const maxAgeMs = maxAgeDays === undefined ? undefined : maxAgeDays * DAYS_TO_MS;
	const runDirs = [];

	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			result.ignored.push(entry.name);
			continue;
		}
		const match = PLATFORM_SMOKE_RUN_DIR_PATTERN.exec(entry.name);
		if (!match) {
			result.ignored.push(entry.name);
			continue;
		}
		runDirs.push({ name: entry.name, path: resolve(root, entry.name), timestampMs: Number(match[1]) });
	}

	const recentCutoffMs = nowMs - preserveRecentMs;
	const protectedRecent = new Set(runDirs.filter((dir) => dir.timestampMs > recentCutoffMs).map((dir) => dir.name));
	const removeNames = new Set();

	if (maxAgeMs !== undefined) {
		const staleCutoffMs = nowMs - maxAgeMs;
		for (const dir of runDirs) {
			if (dir.timestampMs < staleCutoffMs) removeNames.add(dir.name);
		}
	}

	if (maxRunDirs !== undefined && runDirs.length > maxRunDirs) {
		const sortedNewestFirst = [...runDirs].sort((a, b) => b.timestampMs - a.timestampMs);
		let remainingKeepSlots = maxRunDirs - protectedRecent.size;
		for (const dir of sortedNewestFirst) {
			if (protectedRecent.has(dir.name)) continue;
			if (remainingKeepSlots > 0) {
				remainingKeepSlots--;
				continue;
			}
			removeNames.add(dir.name);
		}
	}

	for (const dir of runDirs) {
		if (!removeNames.has(dir.name)) {
			result.kept.push(dir.name);
			continue;
		}
		rmSync(dir.path, { recursive: true, force: true });
		result.removed.push(dir.name);
	}
	result.kept.sort();
	result.removed.sort();
	result.ignored.sort();
	return result;
}

/** Create a suite artifact directory. */
export function createSuiteDir(artifactRoot, runId, targetName, suiteName) {
	const dir = resolve(process.cwd(), artifactRoot, runId, targetName, suiteName);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** Write artifact-manifest.json. */
export function writeManifest(dir, expectedFiles) {
	const actual = [];
	function walk(d) {
		for (const entry of readdirSync(d, { withFileTypes: true })) {
			const fp = resolve(d, entry.name);
			if (entry.isDirectory()) walk(fp);
			else if (entry.isFile()) actual.push(relative(dir, fp));
		}
	}
	if (existsSync(dir)) walk(dir);

	const manifest = {
		expected: expectedFiles ?? [],
		present: actual,
		missing: (expectedFiles ?? []).filter(f => !actual.includes(f)),
		writtenAt: new Date().toISOString(),
	};
	writeFileSync(resolve(dir, "artifact-manifest.json"), JSON.stringify(manifest, null, 2));
	return manifest;
}

const SECRET_PATTERNS = [
	[/Authorization:\s*Bearer\s+[A-Za-z0-9\-._~+/]{20,}=*/gi, "Authorization header", "Authorization: Bearer [REDACTED_BEARER_TOKEN]"],
	[/(bearer\s+)[A-Za-z0-9\-._~+/]{20,}=*/gi, "bearer token", "$1[REDACTED_BEARER_TOKEN]"],
	[/connect\.sid=[A-Za-z0-9%]+/gi, "session cookie", "connect.sid=[REDACTED_SESSION_COOKIE]"],
	[/https?:\/\/[^/\s]*\/cursor-pi-tool-bridge\/[A-Za-z0-9_.:-]+\/mcp/gi, "bridge endpoint URL", "[REDACTED_BRIDGE_ENDPOINT_URL]"],
	[/"(apiKey|accessToken|refreshToken|session|cookie)"\s*:\s*"[^"\s]{12,}"/gi, "auth/token JSON field", '"$1":"[REDACTED_SECRET]"'],
];

/** Redact known secret material before writing logs/artifacts. */
export function redactSecrets(text) {
	let redacted = String(text ?? "");
	const cursorKey = process.env.CURSOR_API_KEY;
	if (cursorKey && cursorKey.length > 10) {
		redacted = redacted.split(cursorKey).join("[REDACTED_CURSOR_API_KEY]");
	}
	for (const [pattern, , replacement] of SECRET_PATTERNS) {
		redacted = redacted.replace(pattern, replacement);
	}
	return redacted;
}

/** Scan text content for secrets. Returns array of violation descriptions. */
export function scanForSecrets(text) {
	const violations = [];
	const cursorKey = process.env.CURSOR_API_KEY;
	if (cursorKey && cursorKey.length > 10 && String(text ?? "").includes(cursorKey)) {
		violations.push("CURSOR_API_KEY literal found");
	}
	for (const [pattern, label] of SECRET_PATTERNS) {
		pattern.lastIndex = 0;
		if (pattern.test(String(text ?? ""))) violations.push(`potential ${label}`);
	}
	return violations;
}

/** Scan all text files in a directory for secrets. */
export function scanArtifacts(dir) {
	const findings = [];
	function walk(d) {
		for (const entry of readdirSync(d, { withFileTypes: true })) {
			const fp = resolve(d, entry.name);
			if (entry.isDirectory()) { walk(fp); continue; }
			if (!entry.isFile()) continue;
			const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
			if (!["txt", "json", "jsonl", "md", "log", "ansi", "html", "yml", "yaml", "js", "mjs", "ts"].includes(ext)) continue;
			try {
				const content = readFileSync(fp, "utf-8");
				const violations = scanForSecrets(content);
				for (const v of violations) {
					findings.push({ file: relative(dir, fp), violation: v });
				}
			} catch { /* binary or unreadable */ }
		}
	}
	walk(dir);
	return findings;
}

/** Write summary.json for a suite. */
export function writeSummary(dir, data) {
	writeFileSync(resolve(dir, "summary.json"), JSON.stringify({
		...data,
		writtenAt: new Date().toISOString(),
	}, null, 2));
}

function readJsonFile(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
}

function collectFiles(root) {
	const files = [];
	function walk(dir) {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = resolve(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.isFile()) files.push(path);
		}
	}
	if (existsSync(root)) walk(root);
	files.sort();
	return files;
}

function existingPath(path) {
	return existsSync(path) ? path : undefined;
}

function providerDebugPathFields(debugRoot) {
	if (!existsSync(debugRoot)) return {};
	const providerDebugArtifacts = collectFiles(debugRoot);
	const keyArtifacts = providerDebugArtifacts.filter((path) => /(?:^|[\\/])(?:session|summary|timeline|provider-events|bridge-events|wait-result)\.(?:json|jsonl)$/i.test(path));
	const capped = keyArtifacts.slice(0, 40);
	return {
		providerDebugRoot: debugRoot,
		providerDebugArtifactCount: providerDebugArtifacts.length,
		providerDebugArtifacts: capped,
		...(providerDebugArtifacts.length > capped.length ? { providerDebugArtifactsTruncated: true } : {}),
	};
}

function pathFields(suiteDir) {
	const artifactsDir = resolve(suiteDir, "artifacts");
	const debugRoot = resolve(suiteDir, "cursor-sdk-events");
	const paths = {
		artifactManifest: existingPath(resolve(suiteDir, "artifact-manifest.json")),
		summary: existingPath(resolve(suiteDir, "summary.json")),
		assertions: existingPath(resolve(suiteDir, "assertions.json")),
		failures: existingPath(resolve(suiteDir, "failures.md")),
		terminalHtml: existingPath(resolve(artifactsDir, "terminal.html")),
		terminalFullPng: existingPath(resolve(artifactsDir, "terminal.full.png")),
		terminalFinalViewportPng: existingPath(resolve(artifactsDir, "terminal.final-viewport.png")),
		visualEvidence: existingPath(resolve(artifactsDir, "visual-evidence.json")),
		sessionJsonl: existingPath(resolve(artifactsDir, "session.jsonl")),
		jsonlToolResults: existingPath(resolve(artifactsDir, "jsonl-tool-results.json")),
		...providerDebugPathFields(debugRoot),
	};
	for (const [key, value] of Object.entries(paths)) {
		if (value === undefined) delete paths[key];
	}
	return paths;
}

function suiteIndexFromResult(result, artifactRoot) {
	if (!result?.suiteDir) return undefined;
	const suiteDir = resolve(result.suiteDir);
	const summary = readJsonFile(resolve(suiteDir, "summary.json"));
	const target = readJsonFile(resolve(suiteDir, "target.json"));
	const suite = readJsonFile(resolve(suiteDir, "suite.json"));
	const rel = relative(resolve(process.cwd(), artifactRoot), suiteDir).split(/[\\/]/);
	return {
		target: summary?.target ?? target?.targetName ?? rel.at(-2),
		suite: summary?.suite ?? suite?.suiteName ?? rel.at(-1),
		runId: target?.runId ?? rel.at(-3),
		ok: result.ok === true,
		artifactDir: suiteDir,
		paths: pathFields(suiteDir),
	};
}

function targetIndexesFromRun(targetName, result, artifactRoot) {
	const suiteResults = Array.isArray(result?.results) ? result.results : [result];
	const suites = suiteResults.map((suiteResult) => suiteIndexFromResult(suiteResult, artifactRoot)).filter(Boolean);
	const runIds = [...new Set(suites.map((suite) => suite.runId).filter(Boolean))];
	return {
		target: targetName,
		ok: result?.ok === true,
		...(result?.error ? { error: redactSecrets(result.error) } : {}),
		runId: runIds.length === 1 ? runIds[0] : undefined,
		runIds,
		suites,
	};
}

/** Build a stable, agent-readable platform-smoke latest index from target run results. */
export function buildLatestPlatformSmokeIndex(config, runResults, metadata = {}) {
	const artifactRoot = resolve(process.cwd(), config?.artifactRoot ?? ".artifacts/platform-smoke");
	const targets = runResults.map(({ targetName, result }) => targetIndexesFromRun(targetName, result, artifactRoot));
	const runIds = [...new Set(targets.flatMap((target) => target.runIds).filter(Boolean))].sort();
	const newestRunId = runIds
		.map((runId) => ({ runId, match: PLATFORM_SMOKE_RUN_DIR_PATTERN.exec(runId) }))
		.filter((entry) => entry.match)
		.sort((a, b) => Number(b.match[1]) - Number(a.match[1]))[0]?.runId ?? runIds.at(-1);
	return {
		schemaVersion: 1,
		kind: "platform-smoke-latest",
		runId: runIds.length === 1 ? runIds[0] : newestRunId,
		runIds,
		artifactRoot,
		startedAt: metadata.startedAt,
		finishedAt: metadata.finishedAt,
		command: metadata.command,
		pid: process.pid,
		ok: targets.every((target) => target.ok),
		targets,
	};
}

/** Atomically write .artifacts/platform-smoke/latest.json. */
export function writeLatestPlatformSmokeIndex(config, runResults, metadata = {}) {
	const index = buildLatestPlatformSmokeIndex(config, runResults, metadata);
	mkdirSync(index.artifactRoot, { recursive: true });
	const outPath = resolve(index.artifactRoot, LATEST_INDEX_NAME);
	const tmpPath = resolve(dirname(outPath), `.${LATEST_INDEX_NAME}.${process.pid}.${Date.now()}.tmp`);
	writeFileSync(tmpPath, `${JSON.stringify(index, null, 2)}\n`);
	renameSync(tmpPath, outPath);
	return { index, path: outPath };
}

/** Return concise existing evidence paths for a failed suite result. */
export function platformSmokeSuiteEvidence(result, artifactRoot) {
	const suite = suiteIndexFromResult(result, artifactRoot ?? ".artifacts/platform-smoke");
	if (!suite) return undefined;
	return {
		suite: suite.suite,
		artifactDir: suite.artifactDir,
		paths: suite.paths,
	};
}

/** Write command.txt recording the command that was executed. */
export function writeCommand(dir, cmd) {
	writeFileSync(resolve(dir, "command.txt"), Array.isArray(cmd) ? cmd.join(" ") + "\n" : cmd + "\n");
}

/** Write exit-code.txt. */
export function writeExitCode(dir, code, signal) {
	writeFileSync(resolve(dir, "exit-code.txt"), `code=${code}\nsignal=${signal ?? "none"}\n`);
}

/** Package a directory as tar.gz (posix) or zip (powershell). */
export async function packageArtifacts(dir, archivePath) {
	const { execSync } = await import("node:child_process");
	const dirName = basename(dir);
	const parentDir = resolve(dir, "..");
	if (archivePath.endsWith(".tar.gz")) {
		execSync(`tar -czf "${archivePath}" -C "${parentDir}" "${dirName}"`, { stdio: "pipe" });
	} else if (archivePath.endsWith(".zip")) {
		execSync(`cd "${parentDir}" && zip -r "${archivePath}" "${dirName}"`, { stdio: "pipe" });
	}
	return archivePath;
}
