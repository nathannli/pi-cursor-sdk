import { CursorLiveRunAbortError } from "./cursor-live-run-coordinator.js";
import { cursorLiveRuns } from "./cursor-provider-live-run-drain.js";
import { getCursorAgentMessageOffset } from "./cursor-provider-turn-finalize.js";
import type { installCursorSdkAbortErrorSuppression } from "./cursor-sdk-abort-error-guard.js";
import type {
	CursorProviderTurnCleanup,
	CursorProviderTurnPrepared,
	CursorProviderTurnRunnerParams,
	CursorProviderTurnSendResult,
} from "./cursor-provider-turn-types.js";
import type { CursorSdkEventDebugSink } from "./cursor-sdk-event-debug.js";

export interface SendCursorProviderTurnParams {
	params: CursorProviderTurnRunnerParams;
	cleanup: CursorProviderTurnCleanup;
	prepared: CursorProviderTurnPrepared;
	sdkEventDebug: CursorSdkEventDebugSink | undefined;
	sdkAbortErrorSuppression: ReturnType<typeof installCursorSdkAbortErrorSuppression>;
	throwIfAborted: () => void;
}

export async function sendCursorProviderTurn(sendParams: SendCursorProviderTurnParams): Promise<CursorProviderTurnSendResult> {
	const { params, cleanup, prepared, sdkEventDebug, sdkAbortErrorSuppression, throwIfAborted } = sendParams;
	const { options } = params;
	const { agent, turnCoordinator, sendPlan, bootstrap, liveRun, prompt, sendPayload, cwd } = prepared;
	const activeLiveRun = cleanup.prepare?.activeLiveRun;

	let sdkRun: Awaited<ReturnType<typeof agent.send>> | null = null;
	const abortListener = () => {
		sdkAbortErrorSuppression.suppressAbortErrors();
		activeLiveRun?.bridgeRun?.cancel("Cursor SDK run aborted");
		if (sdkRun) {
			sdkRun.cancel().catch(() => {});
		}
	};
	const abortSignal = options?.signal;
	const abortRegistration = abortSignal
		? { signal: abortSignal, listener: abortListener }
		: undefined;
	abortSignal?.addEventListener("abort", abortListener, { once: true });

	throwIfAborted();
	const cursorAgentMessageOffset = await getCursorAgentMessageOffset(agent.agentId, cwd, sdkEventDebug);
	throwIfAborted();
	sdkEventDebug?.recordSendMeta({
		mode: sendPlan.mode,
		reason: sendPlan.reason,
		resetAgent: sendPlan.resetAgent,
		bootstrap,
		promptText: prompt.text,
		imageCount: prompt.images.length,
		useNativeToolReplay: prepared.useNativeToolReplay,
		bridgeEnabled: prepared.bridgeRun !== undefined,
		nativeReplayId: prepared.nativeReplayId,
		promptInputTokens: prepared.promptInputTokens,
	});
	sdkEventDebug?.recordSendPayload(sendPayload);
	sdkEventDebug?.recordProviderEvent("agent_send_start", sendPayload);
	const run = await agent.send(sendPayload, {
		onDelta: (args) => {
			sdkEventDebug?.recordOnDelta(args.update);
			turnCoordinator.handleDelta(args.update);
		},
		onStep: (args) => {
			sdkEventDebug?.recordOnStep(args.step);
			turnCoordinator.handleStep(args.step);
		},
	});
	sdkRun = run;
	sdkEventDebug?.recordRunMeta({
		runId: run.id,
		agentId: run.agentId,
		status: run.status,
	});
	sdkEventDebug?.attachRunStream(run);
	sdkEventDebug?.recordProviderEvent("agent_send_returned", {
		runId: run.id,
		agentId: run.agentId,
		status: run.status,
	});
	if (liveRun) cursorLiveRuns.attachSdkRun(liveRun, run);
	if (options?.signal?.aborted) {
		sdkAbortErrorSuppression.suppressAbortErrors();
		liveRun?.bridgeRun?.cancel("Cursor SDK run aborted");
		await run.cancel().catch(() => {});
		throw new CursorLiveRunAbortError();
	}

	return {
		send: { run, prepared, cursorAgentMessageOffset },
		handles: { abortRegistration },
	};
}
