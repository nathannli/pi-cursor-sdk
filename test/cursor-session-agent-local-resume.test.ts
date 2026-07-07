import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeCursorContextFingerprint } from "../src/context.js";
import { __testUtils as cursorSessionScopeTestUtils } from "../src/cursor-session-scope.js";
import { __testUtils as resumeTestUtils } from "../src/cursor-session-agent-resume.js";
import {
	acquireSessionCursorAgent,
	__testUtils as sessionAgentTestUtils,
} from "../src/cursor-session-agent.js";
import { makeContext } from "./helpers/pi-harness.js";

describe("cursor-session-agent local resume", () => {
	beforeEach(async () => {
		cursorSessionScopeTestUtils.reset();
		resumeTestUtils.reset();
		await sessionAgentTestUtils.disposeAllSessionCursorAgents();
		vi.clearAllMocks();
	});

	it("resumes a recorded local SDK agent when branch identity and pool key match", async () => {
		const scopeKey = "/tmp/sessions/test.jsonl";
		const sendState = {
			bootstrapped: true,
			contextFingerprint: computeCursorContextFingerprint(makeContext()),
			incrementalSendCount: 3,
		};
		const resumedAgent = { agentId: "agent-recorded", [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined) };
		const createAgent = vi.fn().mockResolvedValue({ agentId: "agent-new", [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined) });
		const resumeAgent = vi.fn().mockResolvedValue(resumedAgent);
		cursorSessionScopeTestUtils.set("/tmp/project", scopeKey);
		const params = {
			apiKey: "test-key",
			agentMode: "agent" as const,
			cwd: "/tmp/project",
			modelSelection: { id: "composer-2.5" },
			localResume: true,
			createAgent,
			resumeAgent,
		};
		const poolKey = sessionAgentTestUtils.buildSessionAgentPoolKey(scopeKey, params);
		resumeTestUtils.set({
			scopeKey,
			sessionFile: scopeKey,
			cwd: "/tmp/project",
			repoRoot: undefined,
			branchPathHash: resumeTestUtils.EMPTY_BRANCH_HASH,
			compactionGeneration: 0,
			activeHandle: {
				version: 1,
				runtime: "local",
				agentId: "agent-recorded",
				scopeKey,
				sessionFile: scopeKey,
				cwd: "/tmp/project",
				poolKey,
				branchPathHash: resumeTestUtils.EMPTY_BRANCH_HASH,
				compactionGeneration: 0,
				sendState,
				createdAt: "2026-07-07T00:00:00.000Z",
			},
		});

		const lease = await acquireSessionCursorAgent(params);

		expect(lease.created).toBe(true);
		expect(lease.resumed).toBe(true);
		expect(lease.agent).toBe(resumedAgent);
		expect(lease.sendState).toEqual(sendState);
		expect(resumeAgent).toHaveBeenCalledWith(
			"agent-recorded",
			expect.objectContaining({
				apiKey: "test-key",
				model: { id: "composer-2.5" },
				mode: "agent",
				local: expect.objectContaining({ cwd: "/tmp/project" }),
			}),
		);
		expect(createAgent).not.toHaveBeenCalled();
	});

	it("does not resume recorded agents unless local resume is enabled", async () => {
		const scopeKey = "/tmp/sessions/test.jsonl";
		const createAgent = vi.fn().mockResolvedValue({ agentId: "agent-new", [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined) });
		const resumeAgent = vi.fn().mockResolvedValue({ agentId: "agent-recorded", [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined) });
		cursorSessionScopeTestUtils.set("/tmp/project", scopeKey);
		const params = {
			apiKey: "test-key",
			agentMode: "agent" as const,
			cwd: "/tmp/project",
			modelSelection: { id: "composer-2.5" },
			createAgent,
			resumeAgent,
		};
		resumeTestUtils.set({
			scopeKey,
			sessionFile: scopeKey,
			cwd: "/tmp/project",
			branchPathHash: resumeTestUtils.EMPTY_BRANCH_HASH,
			compactionGeneration: 0,
			activeHandle: {
				version: 1,
				runtime: "local",
				agentId: "agent-recorded",
				scopeKey,
				sessionFile: scopeKey,
				cwd: "/tmp/project",
				poolKey: sessionAgentTestUtils.buildSessionAgentPoolKey(scopeKey, params),
				branchPathHash: resumeTestUtils.EMPTY_BRANCH_HASH,
				compactionGeneration: 0,
				sendState: { bootstrapped: true, contextFingerprint: computeCursorContextFingerprint(makeContext()), incrementalSendCount: 0 },
				createdAt: "2026-07-07T00:00:00.000Z",
			},
		});

		const lease = await acquireSessionCursorAgent(params);

		expect(lease.resumed).toBe(false);
		expect(lease.agent.agentId).toBe("agent-new");
		expect(resumeAgent).not.toHaveBeenCalled();
		expect(createAgent).toHaveBeenCalledTimes(1);
	});

	it("falls back to create and bootstrap when Agent.resume fails", async () => {
		const scopeKey = "/tmp/sessions/test.jsonl";
		const createAgent = vi.fn().mockResolvedValue({ agentId: "agent-new", [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined) });
		const resumeAgent = vi.fn().mockRejectedValue(new Error("Agent agent-recorded not found"));
		cursorSessionScopeTestUtils.set("/tmp/project", scopeKey);
		const params = {
			apiKey: "test-key",
			agentMode: "agent" as const,
			cwd: "/tmp/project",
			modelSelection: { id: "composer-2.5" },
			localResume: true,
			createAgent,
			resumeAgent,
		};
		resumeTestUtils.set({
			scopeKey,
			sessionFile: scopeKey,
			cwd: "/tmp/project",
			branchPathHash: resumeTestUtils.EMPTY_BRANCH_HASH,
			compactionGeneration: 0,
			activeHandle: {
				version: 1,
				runtime: "local",
				agentId: "agent-recorded",
				scopeKey,
				sessionFile: scopeKey,
				cwd: "/tmp/project",
				poolKey: sessionAgentTestUtils.buildSessionAgentPoolKey(scopeKey, params),
				branchPathHash: resumeTestUtils.EMPTY_BRANCH_HASH,
				compactionGeneration: 0,
				sendState: { bootstrapped: true, contextFingerprint: computeCursorContextFingerprint(makeContext()), incrementalSendCount: 0 },
				createdAt: "2026-07-07T00:00:00.000Z",
			},
		});

		const lease = await acquireSessionCursorAgent(params);

		expect(resumeAgent).toHaveBeenCalledTimes(1);
		expect(createAgent).toHaveBeenCalledTimes(1);
		expect(lease.resumed).toBe(false);
		expect(lease.resumeNotice).toContain("Could not resume prior Cursor agent");
		expect(lease.sendState.bootstrapped).toBe(false);
	});

	it("does not resume when the recorded identity no longer matches", async () => {
		const scopeKey = "/tmp/sessions/test.jsonl";
		const createAgent = vi.fn().mockResolvedValue({ agentId: "agent-new", [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined) });
		const resumeAgent = vi.fn().mockResolvedValue({ agentId: "agent-recorded", [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined) });
		cursorSessionScopeTestUtils.set("/tmp/project", scopeKey);
		const params = {
			apiKey: "new-key",
			agentMode: "agent" as const,
			cwd: "/tmp/project",
			modelSelection: { id: "composer-2.5" },
			localResume: true,
			createAgent,
			resumeAgent,
		};
		resumeTestUtils.set({
			scopeKey,
			sessionFile: scopeKey,
			cwd: "/tmp/project",
			branchPathHash: resumeTestUtils.EMPTY_BRANCH_HASH,
			compactionGeneration: 1,
			activeHandle: {
				version: 1,
				runtime: "local",
				agentId: "agent-recorded",
				scopeKey,
				sessionFile: scopeKey,
				cwd: "/tmp/project",
				poolKey: "old-pool-key",
				branchPathHash: resumeTestUtils.EMPTY_BRANCH_HASH,
				compactionGeneration: 0,
				sendState: { bootstrapped: true, contextFingerprint: computeCursorContextFingerprint(makeContext()), incrementalSendCount: 0 },
				createdAt: "2026-07-07T00:00:00.000Z",
			},
		});

		const lease = await acquireSessionCursorAgent(params);

		expect(lease.resumed).toBe(false);
		expect(resumeAgent).not.toHaveBeenCalled();
		expect(createAgent).toHaveBeenCalledTimes(1);
	});

	it("schedules a local resume handle only after a successful send commit", async () => {
		const appendEntry = vi.fn();
		const createAgent = vi.fn().mockResolvedValue({ agentId: "agent-1", [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined) });
		const scopeKey = "/tmp/sessions/test.jsonl";
		cursorSessionScopeTestUtils.set("/tmp/project", scopeKey);
		resumeTestUtils.set({
			appendEntry,
			scopeKey,
			sessionFile: scopeKey,
			cwd: "/tmp/project",
			branchPathHash: resumeTestUtils.EMPTY_BRANCH_HASH,
			compactionGeneration: 0,
		});
		const context = makeContext([{ role: "user", content: "Hello", timestamp: 1 }]);

		const lease = await acquireSessionCursorAgent({
			apiKey: "test-key",
			agentMode: "agent",
			cwd: "/tmp/project",
			modelSelection: { id: "composer-2.5" },
			localResume: true,
			createAgent,
		});
		lease.commitSend(context, true);

		expect(appendEntry).not.toHaveBeenCalled();
		expect(resumeTestUtils.state.pendingHandle).toMatchObject({
			runtime: "local",
			agentId: "agent-1",
			poolKey: lease.poolKey,
			sendState: expect.objectContaining({
				bootstrapped: true,
				contextFingerprint: computeCursorContextFingerprint(context),
				incrementalSendCount: 0,
			}),
		});
	});

});
