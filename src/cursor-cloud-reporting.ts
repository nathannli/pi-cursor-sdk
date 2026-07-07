import type { Run, RunResult, SDKAgent, SDKArtifact, TokenUsage } from "@cursor/sdk";
import { scrubSensitiveText } from "./cursor-sensitive-text.js";
import { asRecord, getArray, getNumber, getRecord, getString } from "./cursor-record-utils.js";

const DEFAULT_CURSOR_CLOUD_API_BASE_URL = "https://api.cursor.com";
const CLOUD_REPORT_TIMEOUT_MS = 5000;
const MAX_BRANCHES = 5;
const MAX_ARTIFACTS = 10;

export interface CursorCloudUsageReport {
	totalUsage?: TokenUsage;
	runUsage?: TokenUsage;
}

export interface CursorCloudRunBranch {
	repoUrl: string;
	branch?: string;
	prUrl?: string;
}

export interface CursorCloudRunReport {
	agentId: string;
	runId: string;
	branches: CursorCloudRunBranch[];
	artifacts?: SDKArtifact[];
	usage?: CursorCloudUsageReport;
}

export interface FetchCursorCloudRawUsageOptions {
	agentId: string;
	runId: string;
	apiKey: string | undefined;
	baseUrl?: string;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = CLOUD_REPORT_TIMEOUT_MS): Promise<T | undefined> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<undefined>((resolve) => {
		timer = setTimeout(() => resolve(undefined), timeoutMs);
		timer.unref?.();
	});
	return Promise.race([promise.catch(() => undefined), timeout]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}

function fetchJsonWithAbortTimeout(
	fetchImpl: typeof fetch,
	url: URL,
	init: RequestInit,
	timeoutMs = CLOUD_REPORT_TIMEOUT_MS,
): Promise<unknown> {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const request = (async () => {
		const response = await fetchImpl(url, { ...init, signal: controller.signal });
		if (!response.ok) return undefined;
		return response.json();
	})().catch(() => undefined);
	const timeout = new Promise<undefined>((resolve) => {
		timer = setTimeout(() => {
			controller.abort();
			resolve(undefined);
		}, timeoutMs);
		timer.unref?.();
	});
	return Promise.race([request, timeout]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}

function readTokenUsage(value: unknown): TokenUsage | undefined {
	const record = asRecord(value);
	const inputTokens = getNumber(record, "inputTokens");
	const outputTokens = getNumber(record, "outputTokens");
	const cacheReadTokens = getNumber(record, "cacheReadTokens");
	const cacheWriteTokens = getNumber(record, "cacheWriteTokens");
	const totalTokens = getNumber(record, "totalTokens");
	if (
		inputTokens === undefined ||
		outputTokens === undefined ||
		cacheReadTokens === undefined ||
		cacheWriteTokens === undefined ||
		totalTokens === undefined
	) return undefined;
	const reasoningTokens = getNumber(record, "reasoningTokens");
	return {
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheWriteTokens,
		totalTokens,
		...(reasoningTokens === undefined ? {} : { reasoningTokens }),
	};
}

export async function fetchCursorCloudRawUsage(
	options: FetchCursorCloudRawUsageOptions,
): Promise<CursorCloudUsageReport | undefined> {
	if (!options.apiKey || typeof options.fetchImpl !== "function" && typeof fetch !== "function") return undefined;
	try {
		const baseUrl = options.baseUrl ?? DEFAULT_CURSOR_CLOUD_API_BASE_URL;
		const url = new URL(`/v1/agents/${encodeURIComponent(options.agentId)}/usage`, baseUrl);
		url.searchParams.set("runId", options.runId);
		const fetchImpl = options.fetchImpl ?? fetch;
		const body = asRecord(await fetchJsonWithAbortTimeout(fetchImpl, url, {
			headers: {
				Authorization: `Bearer ${options.apiKey}`,
				"x-cursor-client-type": "sdk",
			},
		}, options.timeoutMs));
		const runs = getArray(body, "runs") ?? [];
		const matchingRun = runs.map(asRecord).find((run) => getString(run, "id") === options.runId);
		const usage = {
			totalUsage: readTokenUsage(getRecord(body, "totalUsage")),
			runUsage: readTokenUsage(getRecord(matchingRun, "usage")),
		};
		return usage.totalUsage || usage.runUsage ? usage : undefined;
	} catch {
		return undefined;
	}
}

export async function collectCursorCloudRunReport(options: {
	agent: SDKAgent;
	run: Run;
	waitResult: RunResult;
	apiKey: string | undefined;
}): Promise<CursorCloudRunReport> {
	const listArtifacts = options.agent.listArtifacts;
	const [artifacts, usage] = await Promise.all([
		typeof listArtifacts === "function" ? withTimeout(listArtifacts.call(options.agent)) : undefined,
		fetchCursorCloudRawUsage({ agentId: options.run.agentId, runId: options.run.id, apiKey: options.apiKey }),
	]);
	return {
		agentId: options.run.agentId,
		runId: options.run.id,
		branches: options.waitResult.git?.branches ?? options.run.git?.branches ?? [],
		artifacts,
		usage,
	};
}

function formatTokenUsage(usage: TokenUsage): string {
	const parts = [
		`input ${usage.inputTokens.toLocaleString("en-US")}`,
		`output ${usage.outputTokens.toLocaleString("en-US")}`,
		`cache read ${usage.cacheReadTokens.toLocaleString("en-US")}`,
		`cache write ${usage.cacheWriteTokens.toLocaleString("en-US")}`,
		`total ${usage.totalTokens.toLocaleString("en-US")}`,
	];
	if (usage.reasoningTokens !== undefined) parts.splice(2, 0, `reasoning ${usage.reasoningTokens.toLocaleString("en-US")}`);
	return parts.join(", ");
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function formatBranchLine(branch: CursorCloudRunBranch): string[] {
	const lines: string[] = [];
	if (branch.branch) {
		lines.push(`- branch: ${branch.branch}${branch.repoUrl ? ` (${branch.repoUrl})` : ""}`);
		lines.push(`  fetch: git fetch origin ${shellQuote(branch.branch)} && git checkout ${shellQuote(branch.branch)}`);
	}
	if (branch.prUrl) lines.push(`- PR: ${branch.prUrl}`);
	return lines;
}

export function formatCursorCloudRunReport(report: CursorCloudRunReport, options: { apiKey?: string } = {}): string {
	const lines = ["Cursor cloud run:", `- agent: ${report.agentId}`, `- run: ${report.runId}`];
	for (const branch of report.branches.slice(0, MAX_BRANCHES)) lines.push(...formatBranchLine(branch));
	if (report.branches.length > MAX_BRANCHES) lines.push(`- branches: +${report.branches.length - MAX_BRANCHES} more`);
	if (report.artifacts) {
		if (report.artifacts.length === 0) {
			lines.push("- artifacts: none");
		} else {
			lines.push("- artifacts:");
			for (const artifact of report.artifacts.slice(0, MAX_ARTIFACTS)) {
				lines.push(`  - ${artifact.path} (${artifact.sizeBytes.toLocaleString("en-US")} bytes, updated ${artifact.updatedAt})`);
			}
			if (report.artifacts.length > MAX_ARTIFACTS) lines.push(`  - +${report.artifacts.length - MAX_ARTIFACTS} more`);
		}
	}
	const usage = report.usage?.runUsage ?? report.usage?.totalUsage;
	if (usage) lines.push(`- raw usage (display only): ${formatTokenUsage(usage)}`);
	return scrubSensitiveText(`${lines.join("\n")}\n`, options.apiKey);
}
