import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	CURSOR_SESSION_AGENT_CLEANUP_ENTRY_TYPE,
	readCursorSessionAgentCleanupPlan,
	runCursorSessionAgentCleanupCommand,
	__testUtils as cleanupTestUtils,
	type CursorSessionAgentCleanupEntryData,
} from "../src/cursor-session-agent-cleanup.js";
import {
	CURSOR_SESSION_AGENT_RESUME_ENTRY_TYPE,
	type CursorSessionAgentResumeEntryData,
} from "../src/cursor-session-agent-resume.js";
import { __testUtils as scopeTestUtils } from "../src/cursor-session-scope.js";

function resumeData(agentId: string, extra: Partial<CursorSessionAgentResumeEntryData> = {}): CursorSessionAgentResumeEntryData {
	return {
		version: 1,
		runtime: "local",
		agentId,
		scopeKey: "/tmp/session.jsonl",
		sessionFile: "/tmp/session.jsonl",
		sessionId: "session-1",
		cwd: "/tmp/project",
		poolKey: "pool-1",
		branchPathHash: "hash",
		compactionGeneration: 0,
		sendState: { bootstrapped: true, contextFingerprint: "fp", incrementalSendCount: 0 },
		createdAt: "2026-07-08T00:00:00.000Z",
		...extra,
	};
}

const cleanupScope = {
	scopeKey: "/tmp/session.jsonl",
	sessionFile: "/tmp/session.jsonl",
	sessionId: "session-1",
	cwd: "/tmp/project",
};

function resumeEntry(id: string, data: CursorSessionAgentResumeEntryData): SessionEntry {
	return {
		type: "custom",
		id,
		parentId: null,
		timestamp: data.createdAt,
		customType: CURSOR_SESSION_AGENT_RESUME_ENTRY_TYPE,
		data,
	};
}

function cleanupEntry(id: string, data: CursorSessionAgentCleanupEntryData): SessionEntry {
	return {
		type: "custom",
		id,
		parentId: null,
		timestamp: data.timestamp,
		customType: CURSOR_SESSION_AGENT_CLEANUP_ENTRY_TYPE,
		data,
	};
}

function makeContext(entries: SessionEntry[], branch: SessionEntry[] = entries) {
	return {
		cwd: "/tmp/project",
		sessionManager: {
			getEntries: vi.fn(() => entries),
			getBranch: vi.fn(() => branch),
			getSessionFile: vi.fn(() => "/tmp/session.jsonl"),
			getSessionId: vi.fn(() => "session-1"),
		},
		ui: { notify: vi.fn() },
	};
}

describe("cursor-session-agent-cleanup", () => {
	beforeEach(() => {
		cleanupTestUtils.reset();
		scopeTestUtils.set("/tmp/project", "/tmp/session.jsonl", "session-1");
		vi.clearAllMocks();
	});

	it("plans only recorded cleanup candidates and protects the active branch agent", () => {
		const oldEntry = resumeEntry("r1", resumeData("agent-old"));
		const activeEntry = resumeEntry("r2", resumeData("agent-active", {
			cleanupCandidateAgentIds: ["agent-old", "agent-old", "agent-*", "bc-cloud"],
		}));

		expect(readCursorSessionAgentCleanupPlan([oldEntry, activeEntry], [oldEntry, activeEntry], cleanupScope)).toEqual({
			candidateAgentIds: ["agent-old"],
			protectedAgentIds: ["agent-active"],
		});
	});

	it("does not plan agent IDs already recorded as deleted", () => {
		const oldEntry = resumeEntry("r1", resumeData("agent-old"));
		const activeEntry = resumeEntry("r2", resumeData("agent-active", { cleanupCandidateAgentIds: ["agent-old"] }));
		const deleted = cleanupEntry("c1", {
			action: "delete",
			runtime: "local",
			timestamp: "2026-07-08T00:01:00.000Z",
			candidateAgentIds: ["agent-old"],
			deletedAgentIds: ["agent-old"],
		});

		expect(readCursorSessionAgentCleanupPlan([oldEntry, activeEntry, deleted], [oldEntry, activeEntry], cleanupScope)).toEqual({
			candidateAgentIds: [],
			protectedAgentIds: ["agent-active"],
		});
	});

	it("ignores cleanup candidates copied from another session scope", () => {
		const copiedEntry = resumeEntry("r1", resumeData("agent-copied", {
			scopeKey: "/tmp/other-session.jsonl",
			sessionFile: "/tmp/other-session.jsonl",
			sessionId: "other-session",
			cleanupCandidateAgentIds: ["agent-foreign"],
		}));
		const activeEntry = resumeEntry("r2", resumeData("agent-active", { cleanupCandidateAgentIds: ["agent-old"] }));

		expect(readCursorSessionAgentCleanupPlan([copiedEntry, activeEntry], [activeEntry], cleanupScope)).toEqual({
			candidateAgentIds: ["agent-old"],
			protectedAgentIds: ["agent-active"],
		});
		expect(readCursorSessionAgentCleanupPlan([copiedEntry], [copiedEntry], cleanupScope)).toEqual({
			candidateAgentIds: [],
			protectedAgentIds: [],
		});
	});

	it("dry-runs without deleting and records exact candidates", async () => {
		const entries = [resumeEntry("r1", resumeData("agent-old")), resumeEntry("r2", resumeData("agent-active", { cleanupCandidateAgentIds: ["agent-old"] }))];
		const appendEntry = vi.fn();
		const deleteAgent = vi.fn();
		cleanupTestUtils.setSdkOperations({ delete: deleteAgent });

		await runCursorSessionAgentCleanupCommand({ appendEntry }, "--dry-run", makeContext(entries));

		expect(deleteAgent).not.toHaveBeenCalled();
		expect(appendEntry).toHaveBeenCalledWith(CURSOR_SESSION_AGENT_CLEANUP_ENTRY_TYPE, expect.objectContaining({
			action: "dry-run",
			candidateAgentIds: ["agent-old"],
			protectedAgentIds: ["agent-active"],
		}));
	});

	it("deletes only exact recorded candidate IDs", async () => {
		const entries = [resumeEntry("r1", resumeData("agent-old")), resumeEntry("r2", resumeData("agent-active", { cleanupCandidateAgentIds: ["agent-old"] }))];
		const appendEntry = vi.fn();
		const deleteAgent = vi.fn().mockResolvedValue(undefined);
		cleanupTestUtils.setSdkOperations({ delete: deleteAgent });

		await runCursorSessionAgentCleanupCommand({ appendEntry }, "--yes", makeContext(entries));

		expect(deleteAgent).toHaveBeenCalledTimes(1);
		expect(deleteAgent).toHaveBeenCalledWith("agent-old", { cwd: "/tmp/project" });
		expect(appendEntry).toHaveBeenCalledWith(CURSOR_SESSION_AGENT_CLEANUP_ENTRY_TYPE, expect.objectContaining({
			action: "delete",
			candidateAgentIds: ["agent-old"],
			deletedAgentIds: ["agent-old"],
		}));
	});

	it("does not call delete when no exact recorded candidates exist", async () => {
		const entries = [resumeEntry("r1", resumeData("agent-active"))];
		const appendEntry = vi.fn();
		const deleteAgent = vi.fn();
		cleanupTestUtils.setSdkOperations({ delete: deleteAgent });

		await runCursorSessionAgentCleanupCommand({ appendEntry }, "--yes", makeContext(entries));

		expect(deleteAgent).not.toHaveBeenCalled();
		expect(appendEntry).toHaveBeenCalledWith(CURSOR_SESSION_AGENT_CLEANUP_ENTRY_TYPE, expect.objectContaining({
			action: "delete",
			candidateAgentIds: [],
			deletedAgentIds: [],
		}));
	});
});
