import { execFileSync } from "node:child_process";
import type { ExtensionAPI, ExtensionCommandContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { asRecord, getString } from "./cursor-record-utils.js";
import { scrubSensitiveText } from "./cursor-sensitive-text.js";
import { loadCursorSdk } from "./cursor-sdk-runtime.js";
import { getCursorSessionScopeKey } from "./cursor-session-scope.js";
import {
	CURSOR_SESSION_AGENT_RESUME_ENTRY_TYPE,
	parseCursorSessionAgentResumeEntryData,
	type CursorSessionAgentResumeEntryData,
} from "./cursor-session-agent-resume.js";

export const CURSOR_SESSION_AGENT_CLEANUP_ENTRY_TYPE = "cursor-sdk-agent-cleanup";

const MAX_AGENT_ID_LENGTH = 256;

type CleanupAction = "dry-run" | "delete";

export interface CursorSessionAgentCleanupFailure {
	agentId: string;
	error: string;
}

export interface CursorSessionAgentCleanupEntryData {
	action: CleanupAction;
	runtime: "local";
	timestamp: string;
	candidateAgentIds: string[];
	protectedAgentIds?: string[];
	deletedAgentIds?: string[];
	failedAgentIds?: CursorSessionAgentCleanupFailure[];
}

export interface CursorSessionAgentCleanupPlan {
	candidateAgentIds: string[];
	protectedAgentIds: string[];
}

export interface CursorSessionAgentCleanupScope {
	scopeKey: string;
	sessionFile?: string;
	sessionId?: string;
	cwd: string;
	repoRoot?: string;
}

type LocalResumeCleanupApi = Pick<ExtensionAPI, "appendEntry">;
type LocalResumeCleanupCommandContext = Pick<ExtensionCommandContext, "cwd"> & {
	sessionManager: Pick<ExtensionCommandContext["sessionManager"], "getEntries" | "getBranch" | "getSessionFile" | "getSessionId">;
	ui: Pick<ExtensionCommandContext["ui"], "notify">;
};
type LocalResumeCleanupSdkOperations = {
	delete(agentId: string, options?: { cwd?: string }): Promise<void>;
};

let sdkOperationsForTests: LocalResumeCleanupSdkOperations | undefined;

function isSafeLocalAgentId(agentId: string): boolean {
	return agentId.startsWith("agent-") && agentId.length <= MAX_AGENT_ID_LENGTH && !/[*?[\]{}]/.test(agentId);
}

function uniqueSorted(values: Iterable<string>): string[] {
	return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function readResumeEntries(entries: readonly SessionEntry[]): CursorSessionAgentResumeEntryData[] {
	const records: CursorSessionAgentResumeEntryData[] = [];
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== CURSOR_SESSION_AGENT_RESUME_ENTRY_TYPE) continue;
		const data = parseCursorSessionAgentResumeEntryData(entry.data);
		if (data) records.push(data);
	}
	return records;
}

function getGitRepoRoot(cwd: string): string | undefined {
	try {
		return execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 2_000,
		}).trim() || undefined;
	} catch {
		return undefined;
	}
}

function resumeEntryMatchesCleanupScope(data: CursorSessionAgentResumeEntryData, scope: CursorSessionAgentCleanupScope): boolean {
	return data.scopeKey === scope.scopeKey &&
		data.sessionFile === scope.sessionFile &&
		data.sessionId === scope.sessionId &&
		data.cwd === scope.cwd &&
		data.repoRoot === scope.repoRoot;
}

function getCurrentCleanupScope(ctx: LocalResumeCleanupCommandContext): CursorSessionAgentCleanupScope {
	const sessionFile = ctx.sessionManager.getSessionFile();
	const sessionId = ctx.sessionManager.getSessionId();
	const repoRoot = getGitRepoRoot(ctx.cwd);
	return {
		scopeKey: getCursorSessionScopeKey(),
		...(sessionFile ? { sessionFile } : {}),
		...(sessionId ? { sessionId } : {}),
		cwd: ctx.cwd,
		...(repoRoot ? { repoRoot } : {}),
	};
}

function parseCleanupEntryData(value: unknown): CursorSessionAgentCleanupEntryData | undefined {
	const record = asRecord(value);
	if (!record || (record.action !== "dry-run" && record.action !== "delete") || record.runtime !== "local") return undefined;
	if (typeof record.timestamp !== "string") return undefined;
	const candidateAgentIds = Array.isArray(record.candidateAgentIds) ? record.candidateAgentIds.filter((id): id is string => typeof id === "string") : [];
	const protectedAgentIds = Array.isArray(record.protectedAgentIds) ? record.protectedAgentIds.filter((id): id is string => typeof id === "string") : undefined;
	const deletedAgentIds = Array.isArray(record.deletedAgentIds) ? record.deletedAgentIds.filter((id): id is string => typeof id === "string") : undefined;
	const failedAgentIds = Array.isArray(record.failedAgentIds)
		? record.failedAgentIds.flatMap((item): CursorSessionAgentCleanupFailure[] => {
			const failure = asRecord(item);
			return typeof failure?.agentId === "string" && typeof failure.error === "string" ? [{ agentId: failure.agentId, error: failure.error }] : [];
		})
		: undefined;
	return {
		action: record.action,
		runtime: "local",
		timestamp: record.timestamp,
		candidateAgentIds: uniqueSorted(candidateAgentIds.filter(isSafeLocalAgentId)),
		...(protectedAgentIds?.length ? { protectedAgentIds: uniqueSorted(protectedAgentIds.filter(isSafeLocalAgentId)) } : {}),
		...(deletedAgentIds?.length ? { deletedAgentIds: uniqueSorted(deletedAgentIds.filter(isSafeLocalAgentId)) } : {}),
		...(failedAgentIds?.length ? { failedAgentIds } : {}),
	};
}

function readDeletedAgentIds(entries: readonly SessionEntry[]): Set<string> {
	const deleted = new Set<string>();
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== CURSOR_SESSION_AGENT_CLEANUP_ENTRY_TYPE) continue;
		const data = parseCleanupEntryData(entry.data);
		if (data?.action !== "delete") continue;
		for (const agentId of data.deletedAgentIds ?? []) deleted.add(agentId);
	}
	return deleted;
}

function readLatestBranchAgentId(branch: readonly SessionEntry[], scope: CursorSessionAgentCleanupScope): string | undefined {
	return readResumeEntries(branch).filter((entry) => resumeEntryMatchesCleanupScope(entry, scope)).at(-1)?.agentId;
}

export function readCursorSessionAgentCleanupPlan(
	entries: readonly SessionEntry[],
	branch: readonly SessionEntry[],
	scope: CursorSessionAgentCleanupScope,
): CursorSessionAgentCleanupPlan {
	const deleted = readDeletedAgentIds(entries);
	const latestBranchAgentId = readLatestBranchAgentId(branch, scope);
	const protectedAgentIds = latestBranchAgentId && isSafeLocalAgentId(latestBranchAgentId) ? new Set([latestBranchAgentId]) : new Set<string>();
	const candidates = new Set<string>();
	for (const resume of readResumeEntries(entries)) {
		if (!resumeEntryMatchesCleanupScope(resume, scope)) continue;
		for (const agentId of resume.cleanupCandidateAgentIds ?? []) {
			if (!isSafeLocalAgentId(agentId) || protectedAgentIds.has(agentId) || deleted.has(agentId)) continue;
			candidates.add(agentId);
		}
	}
	return {
		candidateAgentIds: uniqueSorted(candidates),
		protectedAgentIds: uniqueSorted(protectedAgentIds),
	};
}

function formatCleanupPlan(plan: CursorSessionAgentCleanupPlan): string {
	if (plan.candidateAgentIds.length === 0) return "No recorded superseded local Cursor SDK agents are cleanup-eligible.";
	return [
		"Recorded superseded local Cursor SDK agents eligible for cleanup:",
		...plan.candidateAgentIds.map((agentId) => `- ${agentId}`),
		"Run /cursor-local-resume-cleanup --yes to delete exactly these recorded agent IDs.",
	].join("\n");
}

async function getSdkOperations(): Promise<LocalResumeCleanupSdkOperations> {
	if (sdkOperationsForTests) return sdkOperationsForTests;
	const { Agent } = await loadCursorSdk();
	return {
		delete: (agentId, options) => Agent.delete(agentId, options),
	};
}

function appendCleanupEntry(pi: LocalResumeCleanupApi, data: CursorSessionAgentCleanupEntryData): void {
	pi.appendEntry<CursorSessionAgentCleanupEntryData>(CURSOR_SESSION_AGENT_CLEANUP_ENTRY_TYPE, data);
}

export async function runCursorSessionAgentCleanupCommand(pi: LocalResumeCleanupApi, args: string, ctx: LocalResumeCleanupCommandContext): Promise<void> {
	const usage = "Usage: /cursor-local-resume-cleanup [--dry-run|--yes]";
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	const dryRun = tokens.length === 0 || (tokens.length === 1 && tokens[0] === "--dry-run");
	const deleteNow = tokens.length === 1 && tokens[0] === "--yes";
	if (!dryRun && !deleteNow) {
		ctx.ui.notify(`Invalid Cursor local resume cleanup arguments. ${usage}`, "error");
		return;
	}

	const entries = ctx.sessionManager.getEntries();
	const branch = ctx.sessionManager.getBranch();
	const plan = readCursorSessionAgentCleanupPlan(entries, branch, getCurrentCleanupScope(ctx));
	const baseEntry = {
		runtime: "local" as const,
		timestamp: new Date().toISOString(),
		candidateAgentIds: plan.candidateAgentIds,
		...(plan.protectedAgentIds.length ? { protectedAgentIds: plan.protectedAgentIds } : {}),
	};
	if (dryRun) {
		appendCleanupEntry(pi, { action: "dry-run", ...baseEntry });
		ctx.ui.notify(formatCleanupPlan(plan), "info");
		return;
	}
	if (plan.candidateAgentIds.length === 0) {
		appendCleanupEntry(pi, { action: "delete", ...baseEntry, deletedAgentIds: [] });
		ctx.ui.notify("No recorded superseded local Cursor SDK agents to delete.", "info");
		return;
	}

	const operations = await getSdkOperations();
	const deletedAgentIds: string[] = [];
	const failedAgentIds: CursorSessionAgentCleanupFailure[] = [];
	for (const agentId of plan.candidateAgentIds) {
		try {
			await operations.delete(agentId, { cwd: ctx.cwd });
			deletedAgentIds.push(agentId);
		} catch (error) {
			failedAgentIds.push({ agentId, error: scrubSensitiveText(getString(asRecord(error), "message") ?? String(error)) });
		}
	}
	appendCleanupEntry(pi, {
		action: "delete",
		...baseEntry,
		deletedAgentIds,
		...(failedAgentIds.length ? { failedAgentIds } : {}),
	});
	if (failedAgentIds.length > 0) {
		ctx.ui.notify(
			`Deleted ${deletedAgentIds.length} recorded local Cursor SDK agent(s); ${failedAgentIds.length} failed.`,
			"error",
		);
		return;
	}
	ctx.ui.notify(`Deleted ${deletedAgentIds.length} recorded local Cursor SDK agent(s).`, "info");
}

export const __testUtils = {
	reset: () => {
		sdkOperationsForTests = undefined;
	},
	setSdkOperations: (operations: LocalResumeCleanupSdkOperations | undefined) => {
		sdkOperationsForTests = operations;
	},
	parseCleanupEntryData,
};
