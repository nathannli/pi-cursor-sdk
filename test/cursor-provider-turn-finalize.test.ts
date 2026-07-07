import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SDKAgent } from "@cursor/sdk";
import type { CursorProviderTurnPrepareResult } from "../src/cursor-provider-turn-types.js";
import type { CursorSdkEventDebugSink } from "../src/cursor-sdk-event-debug.js";

const { createAgentPlatform, loadLatest, saveCachedContextWindow } = vi.hoisted(() => ({
	createAgentPlatform: vi.fn(),
	loadLatest: vi.fn(),
	saveCachedContextWindow: vi.fn(),
}));

vi.mock("../src/cursor-sdk-runtime.js", () => ({
	loadCursorSdk: vi.fn(async () => ({ createAgentPlatform })),
}));

vi.mock("../src/context-window-cache.js", () => ({
	getCheckpointContextWindow: (checkpoint: unknown) =>
		(checkpoint as { tokenDetails?: { maxTokens?: number } } | null)?.tokenDetails?.maxTokens,
	saveCachedContextWindow,
}));

import { awaitFinalizeCursorRunOutcome, cacheSdkContextWindow } from "../src/cursor-provider-turn-finalize.js";

function makeCloudPrepared(agent: SDKAgent): CursorProviderTurnPrepareResult {
	return {
		runtimeTarget: "cloud",
		agent,
		cwd: process.cwd(),
		payload: { text: "hello" },
		meta: {},
		contextWindowAgentId: "bc-agent-1",
		textDeltas: [],
		restoreCursorSdkOutputFilter: () => {},
		runtime: {
			kind: "direct",
			turnCoordinator: {
				planTextCandidate: undefined,
				discardIncompleteStartedToolCalls: vi.fn(),
			},
		},
	} as unknown as CursorProviderTurnPrepareResult;
}

describe("awaitFinalizeCursorRunOutcome", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("records cloud reporting errors without changing a successful outcome or leaking the api key", async () => {
		const apiKey = "secret-cursor-key";
		const listArtifacts = vi.fn().mockResolvedValue([
			{
				path: "artifacts/report.txt",
				sizeBytes: {
					toLocaleString: () => {
						throw new Error(`Bearer ${apiKey}`);
					},
				},
				updatedAt: "now",
			},
		]);
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
		const sdkEventDebug = {
			recordWaitResult: vi.fn(),
			captureRunArtifacts: vi.fn(),
			recordProviderEvent: vi.fn(),
			recordError: vi.fn(),
		} as unknown as CursorSdkEventDebugSink;

		try {
			const finalized = await awaitFinalizeCursorRunOutcome({
				run: {
					id: "run-1",
					agentId: "bc-agent-1",
					wait: vi.fn(),
				} as unknown as Awaited<ReturnType<SDKAgent["send"]>>,
				prepared: makeCloudPrepared({ agentId: "bc-agent-1", listArtifacts } as unknown as SDKAgent),
				cursorAgentMessageOffset: undefined,
				modelId: "composer-2.5",
				waitResult: { id: "run-1", status: "finished", result: "cloud done" },
				resolvedApiKey: apiKey,
				sdkEventDebug,
			});

			expect(finalized.outcome.kind).toBe("finished");
			expect(finalized.displayOnlyTraceBlock).toBeUndefined();
			expect(sdkEventDebug.recordError).toHaveBeenCalledTimes(1);
			const [, error] = vi.mocked(sdkEventDebug.recordError).mock.calls[0];
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toContain("Bearer [redacted]");
			expect((error as Error).message).not.toContain(apiKey);
		} finally {
			fetchSpy.mockRestore();
		}
	});
});

describe("cacheSdkContextWindow", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createAgentPlatform.mockResolvedValue({ checkpointStore: { loadLatest } });
		loadLatest.mockResolvedValue({ tokenDetails: { maxTokens: 200_000 } });
	});

	it("opens the Cursor SDK platform scoped to the pi session cwd", async () => {
		await cacheSdkContextWindow("agent-1", "composer-2.5", "/repo/session-cwd");

		expect(createAgentPlatform).toHaveBeenCalledWith({
			workspaceRef: "/repo/session-cwd",
			scopedWorkspaceRef: "/repo/session-cwd",
		});
		expect(loadLatest).toHaveBeenCalledWith("agent-1");
		expect(saveCachedContextWindow).toHaveBeenCalledWith("composer-2.5", 200_000);
	});

	it("keeps the SDK default platform path when no cwd is available", async () => {
		await cacheSdkContextWindow("agent-1", "composer-2.5");

		expect(createAgentPlatform).toHaveBeenCalledWith(undefined);
	});
});
