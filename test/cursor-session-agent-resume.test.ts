import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { registerCursorSessionScope, __testUtils as scopeTestUtils } from "../src/cursor-session-scope.js";
import {
	CURSOR_SESSION_AGENT_RESUME_ENTRY_TYPE,
	getMatchingCursorSessionAgentResumeHandle,
	persistCursorSessionAgentResumeHandle,
	registerCursorSessionAgentResume,
	__testUtils as resumeTestUtils,
	type CursorSessionAgentResumeEntryData,
} from "../src/cursor-session-agent-resume.js";
import { createPiHarness, makeAssistantMessage } from "./helpers/pi-harness.js";

function messageEntry(id: string, parentId: string | null, role: "user" | "assistant" = "user"): SessionEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp: "2026-07-07T00:00:00.000Z",
		message: role === "assistant"
			? makeAssistantMessage("")
			: { role: "user", content: "hello", timestamp: 1 },
	};
}

function resumeEntry(id: string, parentId: string | null, data: CursorSessionAgentResumeEntryData): SessionEntry {
	return {
		type: "custom",
		id,
		parentId,
		timestamp: "2026-07-07T00:00:00.000Z",
		customType: CURSOR_SESSION_AGENT_RESUME_ENTRY_TYPE,
		data,
	};
}

describe("cursor-session-agent-resume", () => {
	beforeEach(() => {
		scopeTestUtils.reset();
		resumeTestUtils.reset();
		vi.clearAllMocks();
	});

	it("restores only resume handles recorded on the active pi branch prefix", async () => {
		const pi = createPiHarness();
		registerCursorSessionScope(pi);
		registerCursorSessionAgentResume(pi);
		const first = messageEntry("u1", null);
		const branchHash = resumeTestUtils.hashBranchStep(resumeTestUtils.EMPTY_BRANCH_HASH, first);
		const handle: CursorSessionAgentResumeEntryData = {
			version: 1,
			runtime: "local",
			agentId: "agent-1",
			scopeKey: "/tmp/session.jsonl",
			sessionFile: "/tmp/session.jsonl",
			sessionId: "session-1",
			cwd: "/tmp/project",
			poolKey: "pool-1",
			branchPathHash: branchHash,
			compactionGeneration: 0,
			sendState: { bootstrapped: true, contextFingerprint: "fp", incrementalSendCount: 2 },
			createdAt: "2026-07-07T00:00:00.000Z",
		};

		await pi.runSessionStart({
			cwd: "/tmp/project",
			sessionManager: {
				getSessionFile: vi.fn(() => "/tmp/session.jsonl"),
				getSessionId: vi.fn(() => "session-1"),
				getBranch: vi.fn(() => [first, resumeEntry("r1", "u1", handle), messageEntry("u2", "r1")]),
			},
		});

		expect(getMatchingCursorSessionAgentResumeHandle("pool-1")).toMatchObject({
			agentId: "agent-1",
			sendState: { bootstrapped: true, contextFingerprint: "fp", incrementalSendCount: 2 },
		});
	});

	it("defers resume handle persistence until turn end so it records the completed assistant path", async () => {
		const pi = createPiHarness();
		registerCursorSessionScope(pi);
		registerCursorSessionAgentResume(pi);
		const first = messageEntry("u1", null);
		const second = messageEntry("u2", "u1");
		const assistant = messageEntry("a1", "u2", "assistant");
		await pi.runSessionStart({
			cwd: "/tmp/project",
			sessionManager: {
				getSessionFile: vi.fn(() => "/tmp/session.jsonl"),
				getSessionId: vi.fn(() => "session-1"),
				getBranch: vi.fn(() => [first]),
			},
		});
		await pi.runBeforeAgentStart({
			cwd: "/tmp/project",
			sessionManager: {
				getSessionFile: vi.fn(() => "/tmp/session.jsonl"),
				getSessionId: vi.fn(() => "session-1"),
				getBranch: vi.fn(() => [first, second]),
			},
		});

		pi.appendEntry.mockClear();
		persistCursorSessionAgentResumeHandle({
			runtime: "local",
			agentId: "agent-1",
			poolKey: "pool-1",
			sendState: { bootstrapped: true, contextFingerprint: "fp", incrementalSendCount: 0 },
		});

		expect(pi.appendEntry).not.toHaveBeenCalled();
		await pi.runTurnEnd({}, {
			cwd: "/tmp/project",
			sessionManager: {
				getSessionFile: vi.fn(() => "/tmp/session.jsonl"),
				getSessionId: vi.fn(() => "session-1"),
				getBranch: vi.fn(() => [first, second, assistant]),
			},
		});

		const expectedHash = resumeTestUtils.hashBranchStep(
			resumeTestUtils.hashBranchStep(
				resumeTestUtils.hashBranchStep(resumeTestUtils.EMPTY_BRANCH_HASH, first),
				second,
			),
			assistant,
		);
		expect(pi.appendEntry).toHaveBeenCalledWith(
			CURSOR_SESSION_AGENT_RESUME_ENTRY_TYPE,
			expect.objectContaining({ branchPathHash: expectedHash }),
		);
	});

	it("rejects restored handles when a later assistant exists without a newer resume entry", async () => {
		const pi = createPiHarness();
		registerCursorSessionScope(pi);
		registerCursorSessionAgentResume(pi);
		const first = messageEntry("u1", null);
		const branchHash = resumeTestUtils.hashBranchStep(resumeTestUtils.EMPTY_BRANCH_HASH, first);
		const handle: CursorSessionAgentResumeEntryData = {
			version: 1,
			runtime: "local",
			agentId: "agent-1",
			scopeKey: "/tmp/session.jsonl",
			sessionFile: "/tmp/session.jsonl",
			sessionId: "session-1",
			cwd: "/tmp/project",
			poolKey: "pool-1",
			branchPathHash: branchHash,
			compactionGeneration: 0,
			sendState: { bootstrapped: true, contextFingerprint: "fp", incrementalSendCount: 2 },
			createdAt: "2026-07-07T00:00:00.000Z",
		};

		await pi.runSessionStart({
			cwd: "/tmp/project",
			sessionManager: {
				getSessionFile: vi.fn(() => "/tmp/session.jsonl"),
				getSessionId: vi.fn(() => "session-1"),
				getBranch: vi.fn(() => [first, resumeEntry("r1", "u1", handle), messageEntry("a1", "r1", "assistant")]),
			},
		});

		expect(getMatchingCursorSessionAgentResumeHandle("pool-1")).toBeUndefined();
	});

	it("rejects old tree-selected handles superseded by a newer handle for the same SDK agent", async () => {
		const pi = createPiHarness();
		registerCursorSessionScope(pi);
		registerCursorSessionAgentResume(pi);
		const first = messageEntry("u1", null);
		const assistant = messageEntry("a1", "u1", "assistant");
		const baseHash = resumeTestUtils.hashBranchStep(
			resumeTestUtils.hashBranchStep(resumeTestUtils.EMPTY_BRANCH_HASH, first),
			assistant,
		);
		const oldHandle: CursorSessionAgentResumeEntryData = {
			version: 1,
			runtime: "local",
			agentId: "agent-1",
			scopeKey: "/tmp/session.jsonl",
			sessionFile: "/tmp/session.jsonl",
			sessionId: "session-1",
			cwd: "/tmp/project",
			poolKey: "pool-1",
			branchPathHash: baseHash,
			compactionGeneration: 0,
			sendState: { bootstrapped: true, contextFingerprint: "fp-old", incrementalSendCount: 0 },
			createdAt: "2026-07-07T00:00:00.000Z",
		};
		const oldResume = resumeEntry("r1", "a1", oldHandle);
		const futureUser = messageEntry("u2", "r1");
		const futureAssistant = messageEntry("a2", "u2", "assistant");
		const futureHash = resumeTestUtils.hashBranchStep(resumeTestUtils.hashBranchStep(baseHash, futureUser), futureAssistant);
		const newerHandle: CursorSessionAgentResumeEntryData = {
			...oldHandle,
			branchPathHash: futureHash,
			sendState: { bootstrapped: true, contextFingerprint: "fp-new", incrementalSendCount: 1 },
			createdAt: "2026-07-07T00:01:00.000Z",
		};
		const newerResume = resumeEntry("r2", "a2", newerHandle);
		const treeUser = messageEntry("u3", "r1");
		const allEntries = [first, assistant, oldResume, futureUser, futureAssistant, newerResume, treeUser];

		await pi.runSessionStart({
			cwd: "/tmp/project",
			sessionManager: {
				getSessionFile: vi.fn(() => "/tmp/session.jsonl"),
				getSessionId: vi.fn(() => "session-1"),
				getBranch: vi.fn(() => [first, assistant, oldResume, treeUser]),
				getEntries: vi.fn(() => allEntries),
			},
		});

		expect(getMatchingCursorSessionAgentResumeHandle("pool-1")).toBeUndefined();

		await pi.runSessionStart({
			cwd: "/tmp/project",
			sessionManager: {
				getSessionFile: vi.fn(() => "/tmp/session.jsonl"),
				getSessionId: vi.fn(() => "session-1"),
				getBranch: vi.fn(() => [first, assistant, oldResume, futureUser, futureAssistant, newerResume, treeUser]),
				getEntries: vi.fn(() => allEntries),
			},
		});

		expect(getMatchingCursorSessionAgentResumeHandle("pool-1")).toMatchObject({
			agentId: "agent-1",
			sendState: { contextFingerprint: "fp-new", incrementalSendCount: 1 },
		});
	});

	it("records the previous local agent as a cleanup candidate when a new agent replaces it", async () => {
		const pi = createPiHarness();
		registerCursorSessionScope(pi);
		registerCursorSessionAgentResume(pi);
		const first = messageEntry("u1", null);
		const branchHash = resumeTestUtils.hashBranchStep(resumeTestUtils.EMPTY_BRANCH_HASH, first);
		const oldHandle: CursorSessionAgentResumeEntryData = {
			version: 1,
			runtime: "local",
			agentId: "agent-old",
			scopeKey: "/tmp/session.jsonl",
			sessionFile: "/tmp/session.jsonl",
			sessionId: "session-1",
			cwd: "/tmp/project",
			poolKey: "pool-old",
			branchPathHash: branchHash,
			compactionGeneration: 0,
			sendState: { bootstrapped: true, contextFingerprint: "fp-old", incrementalSendCount: 1 },
			createdAt: "2026-07-07T00:00:00.000Z",
		};
		const oldResume = resumeEntry("r1", "u1", oldHandle);
		const branch = [first, oldResume, messageEntry("u2", "r1")];

		await pi.runSessionStart({
			cwd: "/tmp/project",
			sessionManager: {
				getSessionFile: vi.fn(() => "/tmp/session.jsonl"),
				getSessionId: vi.fn(() => "session-1"),
				getBranch: vi.fn(() => branch),
				getEntries: vi.fn(() => branch),
			},
		});
		persistCursorSessionAgentResumeHandle({
			runtime: "local",
			agentId: "agent-new",
			poolKey: "pool-new",
			sendState: { bootstrapped: true, contextFingerprint: "fp-new", incrementalSendCount: 0 },
		});

		await pi.runTurnEnd({}, { sessionManager: { getBranch: vi.fn(() => branch) } });

		expect(pi.appendEntry).toHaveBeenCalledWith(CURSOR_SESSION_AGENT_RESUME_ENTRY_TYPE, expect.objectContaining({
			agentId: "agent-new",
			cleanupCandidateAgentIds: ["agent-old"],
		}));
	});

	it("rejects copied resume entries from another session identity", async () => {
		const pi = createPiHarness();
		registerCursorSessionScope(pi);
		registerCursorSessionAgentResume(pi);
		const first = messageEntry("u1", null);
		const branchHash = resumeTestUtils.hashBranchStep(resumeTestUtils.EMPTY_BRANCH_HASH, first);
		const copied: CursorSessionAgentResumeEntryData = {
			version: 1,
			runtime: "local",
			agentId: "agent-1",
			scopeKey: "/tmp/original.jsonl",
			sessionFile: "/tmp/original.jsonl",
			sessionId: "original-session",
			cwd: "/tmp/project",
			poolKey: "pool-1",
			branchPathHash: branchHash,
			compactionGeneration: 0,
			sendState: { bootstrapped: true, contextFingerprint: "fp", incrementalSendCount: 0 },
			createdAt: "2026-07-07T00:00:00.000Z",
		};

		await pi.runSessionStart({
			cwd: "/tmp/project",
			sessionManager: {
				getSessionFile: vi.fn(() => "/tmp/clone.jsonl"),
				getSessionId: vi.fn(() => "clone-session"),
				getBranch: vi.fn(() => [first, resumeEntry("r1", "u1", copied)]),
			},
		});

		expect(getMatchingCursorSessionAgentResumeHandle("pool-1")).toBeUndefined();
	});

	it("clears restored handles on tree navigation and compaction", async () => {
		resumeTestUtils.set({
			scopeKey: "/tmp/session.jsonl",
			sessionFile: "/tmp/session.jsonl",
			cwd: "/tmp/project",
			branchPathHash: resumeTestUtils.EMPTY_BRANCH_HASH,
			compactionGeneration: 0,
			activeHandle: {
				version: 1,
				runtime: "local",
				agentId: "agent-1",
				scopeKey: "/tmp/session.jsonl",
				sessionFile: "/tmp/session.jsonl",
				cwd: "/tmp/project",
				poolKey: "pool-1",
				branchPathHash: resumeTestUtils.EMPTY_BRANCH_HASH,
				compactionGeneration: 0,
				sendState: { bootstrapped: true, contextFingerprint: "fp", incrementalSendCount: 0 },
				createdAt: "2026-07-07T00:00:00.000Z",
			},
		});
		const pi = createPiHarness();
		registerCursorSessionAgentResume(pi);

		await pi.runSessionTree();
		expect(getMatchingCursorSessionAgentResumeHandle("pool-1")).toBeUndefined();

		resumeTestUtils.set({
			activeHandle: {
				version: 1,
				runtime: "local",
				agentId: "agent-1",
				scopeKey: "/tmp/session.jsonl",
				sessionFile: "/tmp/session.jsonl",
				cwd: "/tmp/project",
				poolKey: "pool-1",
				branchPathHash: resumeTestUtils.EMPTY_BRANCH_HASH,
				compactionGeneration: 0,
				sendState: { bootstrapped: true, contextFingerprint: "fp", incrementalSendCount: 0 },
				createdAt: "2026-07-07T00:00:00.000Z",
			},
		});
		await pi.runSessionCompact();
		expect(getMatchingCursorSessionAgentResumeHandle("pool-1")).toBeUndefined();
	});
});
