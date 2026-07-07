import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	resetCursorProviderTestState,
	mockedCreate,
	mockedResume,
	mockCreatedAgent,
	makeModel,
	makeContext,
	collectEvents,
	collectThinkingDeltas,
	getDoneEvent,
	registerNativeToolDisplayForTest,
} from "./helpers/cursor-provider-harness.js";
import { streamCursor } from "../src/cursor-provider.js";
import { __testUtils as cursorSessionScopeTestUtils } from "../src/cursor-session-scope.js";
import { __testUtils as cursorSessionAgentTestUtils } from "../src/cursor-session-agent.js";
import { __testUtils as resumeTestUtils } from "../src/cursor-session-agent-resume.js";
import { buildCursorModelSelection } from "../src/model-discovery.js";

describe("streamCursor local resume", () => {
	beforeEach(resetCursorProviderTestState);

	function seedResumeHandle(scopeKey: string): void {
		cursorSessionScopeTestUtils.set(process.cwd(), scopeKey);
		const modelSelection = buildCursorModelSelection("gpt-5.5@1m", "off", false);
		const poolKey = cursorSessionAgentTestUtils.buildSessionAgentPoolKey(scopeKey, {
			apiKey: "test-key",
			agentMode: "agent",
			cwd: process.cwd(),
			modelSelection,
			settingSources: ["all"],
			localSafety: { autoReview: false, sandboxEnabled: false },
			localResume: true,
		});
		resumeTestUtils.set({
			scopeKey,
			sessionFile: scopeKey,
			cwd: process.cwd(),
			branchPathHash: resumeTestUtils.EMPTY_BRANCH_HASH,
			compactionGeneration: 0,
			activeHandle: {
				version: 1,
				runtime: "local",
				agentId: "agent-old",
				scopeKey,
				sessionFile: scopeKey,
				cwd: process.cwd(),
				poolKey,
				branchPathHash: resumeTestUtils.EMPTY_BRANCH_HASH,
				compactionGeneration: 0,
				sendState: { bootstrapped: true, contextFingerprint: "{}", incrementalSendCount: 0 },
				createdAt: "2026-07-07T00:00:00.000Z",
			},
		});
	}

	it("falls back from local Agent.resume with a display-only continuity note", async () => {
		process.env.PI_CURSOR_LOCAL_RESUME = "1";
		const mockSend = vi.fn().mockResolvedValue({
			id: "run-1",
			agentId: "agent-new",
			status: "finished",
			wait: vi.fn().mockResolvedValue({ id: "run-1", status: "finished", result: "done" }),
			cancel: vi.fn(),
			supports: () => true,
			unsupportedReason: () => undefined,
		});
		mockedResume.mockRejectedValueOnce(new Error("Agent agent-old not found"));
		mockCreatedAgent({ agentId: "agent-new", send: mockSend });
		seedResumeHandle("/tmp/resume-session.jsonl");

		const events = await collectEvents(streamCursor(makeModel("gpt-5.5@1m"), makeContext(), { apiKey: "test-key" }));
		const followUpEvents = await collectEvents(streamCursor(makeModel("gpt-5.5@1m"), makeContext(), { apiKey: "test-key" }));

		expect(mockedResume).toHaveBeenCalledTimes(1);
		expect(mockedCreate).toHaveBeenCalledTimes(1);
		expect(collectThinkingDeltas(events)).toContain("Could not resume prior Cursor agent");
		expect(JSON.stringify(getDoneEvent(events).message.content)).not.toContain("Could not resume prior Cursor agent");
		expect(collectThinkingDeltas(followUpEvents)).not.toContain("Could not resume prior Cursor agent");
	});

	it("emits the resume fallback continuity note on the live native replay path", async () => {
		process.env.PI_CURSOR_LOCAL_RESUME = "1";
		process.env.PI_CURSOR_NATIVE_TOOL_DISPLAY = "1";
		await registerNativeToolDisplayForTest([]);
		const mockSend = vi.fn().mockResolvedValue({
			id: "run-1",
			agentId: "agent-new",
			status: "finished",
			wait: vi.fn().mockResolvedValue({ id: "run-1", status: "finished", result: "done" }),
			cancel: vi.fn(),
			supports: () => true,
			unsupportedReason: () => undefined,
		});
		mockedResume.mockRejectedValueOnce(new Error("Agent agent-old not found"));
		mockCreatedAgent({ agentId: "agent-new", send: mockSend });
		seedResumeHandle("/tmp/resume-live-session.jsonl");

		const events = await collectEvents(streamCursor(makeModel("gpt-5.5@1m"), makeContext(), { apiKey: "test-key" }));

		expect(collectThinkingDeltas(events)).toContain("Could not resume prior Cursor agent");
		expect(JSON.stringify(getDoneEvent(events).message.content)).not.toContain("Could not resume prior Cursor agent");
	});

});
