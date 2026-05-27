import { describe, expect, it } from "vitest";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { SDKAgent } from "@cursor/sdk";
import { buildIncompleteCursorToolRunOutcome } from "../src/cursor-incomplete-tool-visibility.js";
import { CursorRunFinalizer } from "../src/cursor-provider-run-finalizer.js";
import { CursorSdkTurnCoordinator } from "../src/cursor-provider-turn-coordinator.js";
import type { CursorProviderTurnTerminalResources } from "../src/cursor-provider-turn-types.js";
import { installCursorSdkAbortErrorSuppression } from "../src/cursor-sdk-abort-error-guard.js";
import type { SessionCursorAgentLease } from "../src/cursor-session-agent.js";
import { collectAssistantEvents, makeAssistantMessage, makeContext, makeModel } from "./helpers/pi-harness.js";

describe("CursorRunFinalizer", () => {
	it("allows the error terminal path after direct terminal handling throws before emitting", async () => {
		const stream = createAssistantMessageEventStream();
		const partial = makeAssistantMessage("");
		const context = makeContext();
		const model = makeModel();
		const sdkAbortErrorSuppression = installCursorSdkAbortErrorSuppression();
		const turnCoordinator = new CursorSdkTurnCoordinator({
			stream,
			partial,
			cwd: process.cwd(),
			useNativeToolReplay: false,
			nativeReplayId: "replay-1",
			textDeltas: [],
		});
		const terminalResources: CursorProviderTurnTerminalResources = {
			sessionAgentScopeKey: "scope-1",
			sessionAgentLease: {
				scopeKey: "scope-1",
				poolKey: "pool-1",
				instanceId: 1,
				agent: { agentId: "agent-1" } as SDKAgent,
				sendState: { bootstrapped: false, contextFingerprint: "", incrementalSendCount: 0 },
				created: true,
				commitSend: () => {
					throw new Error("commit failed before terminal event");
				},
				trackRunCompletion: () => {},
			} satisfies SessionCursorAgentLease,
			bootstrap: false,
			promptInputTokens: 0,
			liveRun: undefined,
			turnCoordinator,
			restoreCursorSdkOutputFilter: () => {},
		};
		const finalizer = new CursorRunFinalizer({
			runnerParams: {
				model,
				context,
				stream,
				partial,
				sdkEventDebugRef: {},
			},
			sdkEventDebug: () => undefined,
			sdkAbortErrorSuppression,
			resolvedApiKey: () => undefined,
		});

		await expect(
			finalizer.applyTerminalEvent({
				kind: "direct",
				terminalResources,
				outcome: {
					kind: "finished",
					waitResult: {
						id: "run-1",
						status: "finished",
						result: "ok",
						durationMs: 1,
						model: { id: "composer-2.5" },
					},
					finalText: "ok",
					incompleteTools: buildIncompleteCursorToolRunOutcome({ status: "finished", assistantTextProduced: true }),
					assistantTextProduced: true,
				},
			}),
		).rejects.toThrow("commit failed before terminal event");

		await finalizer.applyTerminalEvent({
			kind: "error",
			prepared: {
				sendRequest: {
					agent: { agentId: "agent-1" } as SDKAgent,
					cwd: process.cwd(),
					payload: { text: "hello" },
					meta: {
						sendPlan: { mode: "incremental", reason: "incremental", resetAgent: false },
						prompt: { text: "hello", images: [] },
						bootstrap: false,
						promptInputTokens: 0,
						useNativeToolReplay: false,
						bridgeEnabled: false,
						nativeReplayId: "replay-1",
					},
					liveRun: undefined,
					turnCoordinator,
				},
				finalizeInputs: {
					cwd: process.cwd(),
					contextWindowAgentId: "agent-1",
					turnCoordinator,
					textDeltas: [],
					liveRun: undefined,
				},
				terminalResources,
			},
			error: new Error("commit failed before terminal event"),
		});

		stream.end();
		const events = await collectAssistantEvents(stream);
		expect(events.some((event) => event.type === "error" && event.error.errorMessage?.includes("commit failed"))).toBe(true);
		sdkAbortErrorSuppression.dispose();
	});
});
