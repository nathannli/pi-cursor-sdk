import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { SessionCursorAgentSendState } from "./cursor-session-agent.js";
import { asRecord } from "./cursor-record-utils.js";
import { getCursorSessionScopeKey } from "./cursor-session-scope.js";

export const CURSOR_SESSION_AGENT_RESUME_ENTRY_TYPE = "cursor-sdk-agent-resume";

const RESUME_ENTRY_VERSION = 1;
const EMPTY_BRANCH_HASH = hashParts(["cursor-sdk-agent-resume-branch", "v1"]);

export interface CursorSessionAgentResumeEntryData {
	version: 1;
	runtime: "local";
	agentId: string;
	scopeKey: string;
	sessionFile?: string;
	sessionId?: string;
	cwd: string;
	repoRoot?: string;
	poolKey: string;
	branchPathHash: string;
	compactionGeneration: number;
	sendState: SessionCursorAgentSendState;
	createdAt: string;
	cleanupCandidateAgentIds?: string[];
}

interface PendingCursorSessionAgentResumeHandle {
	runtime: "local";
	agentId: string;
	poolKey: string;
	sendState: SessionCursorAgentSendState;
}

interface CursorSessionResumeState {
	appendEntry?: ExtensionAPI["appendEntry"];
	scopeKey: string;
	sessionFile?: string;
	sessionId?: string;
	cwd: string;
	repoRoot?: string;
	branchPathHash: string;
	compactionGeneration: number;
	activeHandle?: CursorSessionAgentResumeEntryData;
	lastBranchHandle?: CursorSessionAgentResumeEntryData;
	pendingHandle?: PendingCursorSessionAgentResumeHandle;
}

const state: CursorSessionResumeState = {
	scopeKey: getCursorSessionScopeKey(),
	cwd: process.cwd(),
	branchPathHash: EMPTY_BRANCH_HASH,
	compactionGeneration: 0,
};

function hashParts(parts: readonly string[]): string {
	const hash = createHash("sha256");
	for (const part of parts) {
		hash.update(part);
		hash.update("\0");
	}
	return hash.digest("hex").slice(0, 32);
}

function hashBranchStep(previous: string, entry: SessionEntry): string {
	return hashParts([
		previous,
		entry.type,
		entry.id,
		entry.parentId ?? "",
		entry.type === "custom" ? entry.customType : "",
	]);
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

function isSendState(value: unknown): value is SessionCursorAgentSendState {
	const record = asRecord(value);
	return typeof record?.bootstrapped === "boolean" &&
		typeof record.contextFingerprint === "string" &&
		typeof record.incrementalSendCount === "number";
}

export function parseCursorSessionAgentResumeEntryData(value: unknown): CursorSessionAgentResumeEntryData | undefined {
	const record = asRecord(value);
	if (!record) return undefined;
	if (record.version !== RESUME_ENTRY_VERSION || record.runtime !== "local") return undefined;
	if (
		typeof record.agentId !== "string" ||
		typeof record.scopeKey !== "string" ||
		typeof record.cwd !== "string" ||
		typeof record.poolKey !== "string" ||
		typeof record.branchPathHash !== "string" ||
		typeof record.compactionGeneration !== "number" ||
		typeof record.createdAt !== "string" ||
		!isSendState(record.sendState)
	) return undefined;
	if (record.sessionFile !== undefined && typeof record.sessionFile !== "string") return undefined;
	if (record.sessionId !== undefined && typeof record.sessionId !== "string") return undefined;
	if (record.repoRoot !== undefined && typeof record.repoRoot !== "string") return undefined;
	const cleanupCandidateAgentIds = Array.isArray(record.cleanupCandidateAgentIds)
		? record.cleanupCandidateAgentIds.filter((id): id is string => typeof id === "string")
		: undefined;
	return {
		version: RESUME_ENTRY_VERSION,
		runtime: "local",
		agentId: record.agentId,
		scopeKey: record.scopeKey,
		...(record.sessionFile ? { sessionFile: record.sessionFile } : {}),
		...(record.sessionId ? { sessionId: record.sessionId } : {}),
		cwd: record.cwd,
		...(record.repoRoot ? { repoRoot: record.repoRoot } : {}),
		poolKey: record.poolKey,
		branchPathHash: record.branchPathHash,
		compactionGeneration: record.compactionGeneration,
		sendState: {
			bootstrapped: record.sendState.bootstrapped,
			contextFingerprint: record.sendState.contextFingerprint,
			incrementalSendCount: record.sendState.incrementalSendCount,
		},
		createdAt: record.createdAt,
		...(cleanupCandidateAgentIds?.length ? { cleanupCandidateAgentIds: [...new Set(cleanupCandidateAgentIds)] } : {}),
	};
}

function matchesCurrentSession(
	data: CursorSessionAgentResumeEntryData,
	branchPathHash: string,
	compactionGeneration = state.compactionGeneration,
): boolean {
	if (data.scopeKey !== state.scopeKey) return false;
	if (data.sessionFile !== state.sessionFile) return false;
	if (data.sessionId !== state.sessionId) return false;
	if (data.cwd !== state.cwd) return false;
	if (data.repoRoot !== state.repoRoot) return false;
	if (data.compactionGeneration !== compactionGeneration) return false;
	return data.branchPathHash === branchPathHash;
}

function canResumeHandleSpanEntry(entry: SessionEntry): boolean {
	if (entry.type === "custom" || entry.type === "label" || entry.type === "session_info") return true;
	return entry.type === "message" && entry.message.role === "user";
}

function isSameResumeAgentLineage(a: CursorSessionAgentResumeEntryData, b: CursorSessionAgentResumeEntryData): boolean {
	return a.agentId === b.agentId &&
		a.scopeKey === b.scopeKey &&
		a.sessionFile === b.sessionFile &&
		a.sessionId === b.sessionId &&
		a.cwd === b.cwd &&
		a.repoRoot === b.repoRoot &&
		a.poolKey === b.poolKey;
}

function isResumeHandleSuperseded(data: CursorSessionAgentResumeEntryData, entries: readonly SessionEntry[]): boolean {
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== CURSOR_SESSION_AGENT_RESUME_ENTRY_TYPE) continue;
		const candidate = parseCursorSessionAgentResumeEntryData(entry.data);
		if (!candidate || !isSameResumeAgentLineage(data, candidate)) continue;
		if (candidate.createdAt > data.createdAt) return true;
	}
	return false;
}

function restoreFromBranch(branch: readonly SessionEntry[], allEntries: readonly SessionEntry[] = branch): void {
	let branchPathHash = EMPTY_BRANCH_HASH;
	let compactionGeneration = 0;
	let activeHandle: CursorSessionAgentResumeEntryData | undefined;
	let lastBranchHandle: CursorSessionAgentResumeEntryData | undefined;
	for (const entry of branch) {
		if (entry.type === "custom" && entry.customType === CURSOR_SESSION_AGENT_RESUME_ENTRY_TYPE) {
			const data = parseCursorSessionAgentResumeEntryData(entry.data);
			if (
				data &&
				matchesCurrentSession(data, branchPathHash, compactionGeneration) &&
				!isResumeHandleSuperseded(data, allEntries)
			) {
				activeHandle = data;
				lastBranchHandle = data;
			}
			continue;
		}
		if (activeHandle && !canResumeHandleSpanEntry(entry)) activeHandle = undefined;
		if (entry.type === "compaction") compactionGeneration += 1;
		branchPathHash = hashBranchStep(branchPathHash, entry);
	}
	state.branchPathHash = branchPathHash;
	state.compactionGeneration = compactionGeneration;
	state.activeHandle = activeHandle;
	state.lastBranchHandle = lastBranchHandle;
}

export function getMatchingCursorSessionAgentResumeHandle(poolKey: string): CursorSessionAgentResumeEntryData | undefined {
	const handle = state.activeHandle;
	if (!handle) return undefined;
	if (handle.poolKey !== poolKey) return undefined;
	if (handle.scopeKey !== state.scopeKey) return undefined;
	if (handle.sessionFile !== state.sessionFile) return undefined;
	if (handle.sessionId !== state.sessionId) return undefined;
	if (handle.cwd !== state.cwd) return undefined;
	if (handle.repoRoot !== state.repoRoot) return undefined;
	if (handle.compactionGeneration !== state.compactionGeneration) return undefined;
	return {
		...handle,
		sendState: { ...handle.sendState },
	};
}

export function persistCursorSessionAgentResumeHandle(input: PendingCursorSessionAgentResumeHandle): void {
	state.pendingHandle = {
		runtime: input.runtime,
		agentId: input.agentId,
		poolKey: input.poolKey,
		sendState: { ...input.sendState },
	};
}

function flushPendingCursorSessionAgentResumeHandle(branch: readonly SessionEntry[]): void {
	restoreFromBranch(branch);
	const pending = state.pendingHandle;
	state.pendingHandle = undefined;
	if (!pending || !state.appendEntry) return;
	const previousAgentId = state.activeHandle?.agentId ?? state.lastBranchHandle?.agentId;
	const cleanupCandidateAgentIds = previousAgentId && previousAgentId !== pending.agentId ? [previousAgentId] : undefined;
	const data: CursorSessionAgentResumeEntryData = {
		version: RESUME_ENTRY_VERSION,
		runtime: pending.runtime,
		agentId: pending.agentId,
		scopeKey: state.scopeKey,
		...(state.sessionFile ? { sessionFile: state.sessionFile } : {}),
		...(state.sessionId ? { sessionId: state.sessionId } : {}),
		cwd: state.cwd,
		...(state.repoRoot ? { repoRoot: state.repoRoot } : {}),
		poolKey: pending.poolKey,
		branchPathHash: state.branchPathHash,
		compactionGeneration: state.compactionGeneration,
		sendState: { ...pending.sendState },
		createdAt: new Date().toISOString(),
		...(cleanupCandidateAgentIds ? { cleanupCandidateAgentIds } : {}),
	};
	try {
		state.appendEntry<CursorSessionAgentResumeEntryData>(CURSOR_SESSION_AGENT_RESUME_ENTRY_TYPE, data);
		state.activeHandle = data;
	} catch {
		// Resume persistence is an optimization; a failed custom-entry append must not fail the completed turn.
	}
}

interface CursorSessionAgentResumeExtensionApi {
	appendEntry: ExtensionAPI["appendEntry"];
	on: ExtensionAPI["on"];
}

export function registerCursorSessionAgentResume(pi: CursorSessionAgentResumeExtensionApi): void {
	state.appendEntry = pi.appendEntry;
	const restoreFromSessionManager = (sessionManager: { getBranch(): SessionEntry[]; getEntries(): SessionEntry[] }): void => {
		const branch = sessionManager.getBranch();
		const entries = sessionManager.getEntries();
		restoreFromBranch(branch, entries.length > 0 ? entries : branch);
	};
	pi.on("session_start", (_event, ctx) => {
		state.scopeKey = getCursorSessionScopeKey();
		state.sessionFile = ctx.sessionManager.getSessionFile?.() ?? undefined;
		state.sessionId = ctx.sessionManager.getSessionId?.() ?? undefined;
		state.cwd = ctx.cwd;
		state.repoRoot = getGitRepoRoot(ctx.cwd);
		restoreFromSessionManager(ctx.sessionManager);
	});
	pi.on("before_agent_start", (_event, ctx) => {
		restoreFromSessionManager(ctx.sessionManager);
	});
	pi.on("turn_end", (_event, ctx) => {
		flushPendingCursorSessionAgentResumeHandle(ctx.sessionManager.getBranch());
	});
	pi.on("session_tree", (_event, ctx) => {
		restoreFromSessionManager(ctx.sessionManager);
	});
	pi.on("session_compact", (event, ctx) => {
		const branch = ctx.sessionManager.getBranch();
		if (branch.length > 0) {
			restoreFromSessionManager(ctx.sessionManager);
			return;
		}
		state.activeHandle = undefined;
		state.lastBranchHandle = undefined;
		state.compactionGeneration += 1;
		state.branchPathHash = hashBranchStep(state.branchPathHash, event.compactionEntry);
	});
}

function setStateForTests(next: Partial<CursorSessionResumeState>): void {
	Object.assign(state, next);
}

function resetStateForTests(): void {
	state.appendEntry = undefined;
	state.scopeKey = getCursorSessionScopeKey();
	state.sessionFile = undefined;
	state.sessionId = undefined;
	state.cwd = process.cwd();
	state.repoRoot = undefined;
	state.branchPathHash = EMPTY_BRANCH_HASH;
	state.compactionGeneration = 0;
	state.activeHandle = undefined;
	state.lastBranchHandle = undefined;
	state.pendingHandle = undefined;
}

export const __testUtils = {
	EMPTY_BRANCH_HASH,
	hashBranchStep,
	reset: resetStateForTests,
	set: setStateForTests,
	state,
};
