import type { AssistantMessage } from "@earendil-works/pi-ai";
import { cursorLiveRuns } from "./cursor-provider-live-run-drain.js";
import { abandonSessionCursorAgent } from "./cursor-provider-live-run-drain.js";
import {
	classifyCursorRunEmission,
	getCursorRunAbortMessage,
	type CursorRunOutcome,
} from "./cursor-provider-run-outcome.js";
import {
	formatCursorSdkAbortMessage,
	resolveCursorSdkAbortCause,
	sanitizeCursorProviderError,
} from "./cursor-provider-errors.js";
import { CursorLiveRunAbortError } from "./cursor-live-run-coordinator.js";
import type { IncompleteCursorToolRunOutcomeInput } from "./cursor-incomplete-tool-visibility.js";
import type { installCursorSdkAbortErrorSuppression } from "./cursor-sdk-abort-error-guard.js";
import type { CursorSdkEventDebugSink } from "./cursor-sdk-event-debug.js";
import { awaitFinalizeCursorRunOutcome } from "./cursor-provider-turn-finalize.js";
import type {
	CursorProviderTurnFinalizeInputs,
	CursorProviderTurnPrepareResult,
	CursorProviderTurnRunnerParams,
	CursorProviderTurnSend,
	CursorProviderTurnSendResult,
	CursorProviderTurnTerminalResources,
} from "./cursor-provider-turn-types.js";
import { applyCursorApproximateUsage } from "./cursor-usage-accounting.js";
import { hasUsableText } from "./cursor-record-utils.js";
import { buildIncompleteCursorToolRunOutcome } from "./cursor-incomplete-tool-visibility.js";

export type CursorTurnTerminalEvent =
	| {
			kind: "direct";
			terminalResources: CursorProviderTurnTerminalResources;
			outcome: CursorRunOutcome;
	  }
	| { kind: "error"; prepared: CursorProviderTurnPrepareResult | undefined; error: unknown };

function applyLiveRunOutcome(
	outcome: CursorRunOutcome,
	terminalResources: CursorProviderTurnTerminalResources,
	context: CursorProviderTurnRunnerParams["context"],
): void {
	const { liveRun, sessionAgentLease, bootstrap } = terminalResources;
	if (!liveRun || liveRun.disposed) return;
	switch (classifyCursorRunEmission(outcome)) {
		case "finished":
			sessionAgentLease.commitSend(context, bootstrap);
			cursorLiveRuns.markFinished(liveRun, outcome.kind === "finished" ? outcome.finalText : "");
			break;
		case "cancelled":
			cursorLiveRuns.markCancelled(liveRun, getCursorRunAbortMessage(outcome));
			break;
		case "failed":
			cursorLiveRuns.markError(liveRun, outcome.kind === "error" ? outcome.errorMessage : "Cursor SDK run failed.");
			break;
	}
}

export interface CursorLiveRunCompletion {
	waitCompletion: Promise<void>;
	terminalResources: CursorProviderTurnTerminalResources;
}

export interface CursorRunFinalizerParams {
	runnerParams: CursorProviderTurnRunnerParams;
	sdkEventDebug: () => CursorSdkEventDebugSink | undefined;
	sdkAbortErrorSuppression: ReturnType<typeof installCursorSdkAbortErrorSuppression>;
	resolvedApiKey: () => string | undefined;
}

export interface StartCursorLiveRunCompletionParams {
	send: CursorProviderTurnSend;
	finalizeInputs: CursorProviderTurnFinalizeInputs;
	terminalResources: CursorProviderTurnTerminalResources;
	modelId: string;
	discardIncompleteTools: (outcome: IncompleteCursorToolRunOutcomeInput) => void;
}

export class CursorRunFinalizer {
	private terminalApplied = false;

	constructor(private readonly params: CursorRunFinalizerParams) {}

	startLiveRunCompletion(startParams: StartCursorLiveRunCompletionParams): CursorLiveRunCompletion {
		const { runnerParams } = this.params;
		const sdkEventDebug = this.params.sdkEventDebug();
		const { send, finalizeInputs, terminalResources, modelId, discardIncompleteTools } = startParams;
		const { run, cursorAgentMessageOffset } = send;
		const { liveRun } = terminalResources;
		if (!liveRun) throw new Error("startLiveRunCompletion requires a live run");
		const waitCompletion = awaitFinalizeCursorRunOutcome({
			run,
			finalizeInputs,
			cursorAgentMessageOffset,
			modelId,
			signal: runnerParams.options?.signal,
			runResultFallback: run.result,
			resolvedApiKey: this.params.resolvedApiKey(),
			optionsApiKey: runnerParams.options?.apiKey,
			sdkEventDebug,
			cacheContextWindow: true,
			contextWindowAgentId: liveRun.agent.agentId,
		})
			.then(async (outcome) => {
				applyLiveRunOutcome(outcome, terminalResources, runnerParams.context);
			})
			.catch(async (error: unknown) => {
				sdkEventDebug?.recordWaitResult({ status: "error", error: String(error) });
				sdkEventDebug?.recordError("run_wait", error);
				discardIncompleteTools({ status: "error" });
				await sdkEventDebug?.captureRunArtifacts(run);
				if (liveRun.disposed) return;
				cursorLiveRuns.markError(
					liveRun,
					sanitizeCursorProviderError(error, this.params.resolvedApiKey() ?? runnerParams.options?.apiKey),
				);
			});
		return { waitCompletion, terminalResources };
	}

	async applyTerminalEvent(event: CursorTurnTerminalEvent): Promise<void> {
		if (this.terminalApplied) return;
		if (event.kind === "direct") {
			await this.applyDirectOutcome(event.terminalResources, event.outcome);
			this.terminalApplied = true;
			return;
		}
		await this.applyErrorOutcome(event.prepared, event.error);
		this.terminalApplied = true;
	}

	async cleanup(
		prepared: CursorProviderTurnPrepareResult | undefined,
		sendResult: CursorProviderTurnSendResult | undefined,
		liveCompletion: CursorLiveRunCompletion | undefined,
	): Promise<void> {
		prepared?.terminalResources.restoreCursorSdkOutputFilter();
		const abortRegistration = sendResult?.abortRegistration;
		if (abortRegistration) {
			abortRegistration.signal.removeEventListener("abort", abortRegistration.listener);
		}
		this.params.runnerParams.sdkEventDebugRef.current = undefined;
		if (liveCompletion) {
			liveCompletion.terminalResources.sessionAgentLease.trackRunCompletion(liveCompletion.waitCompletion);
			void liveCompletion.waitCompletion
				.finally(async () => {
					try {
						await this.finalizeSdkEventDebug();
					} finally {
						this.params.sdkAbortErrorSuppression.dispose();
					}
				})
				.catch(() => {});
			return;
		}
		try {
			await this.finalizeSdkEventDebug();
		} finally {
			this.params.sdkAbortErrorSuppression.dispose();
		}
	}

	private async applyDirectOutcome(
		terminalResources: CursorProviderTurnTerminalResources,
		outcome: CursorRunOutcome,
	): Promise<void> {
		const { stream, partial, model, context } = this.params.runnerParams;
		terminalResources.turnCoordinator.closeTraceBlock();
		switch (classifyCursorRunEmission(outcome)) {
			case "cancelled":
				await abandonSessionCursorAgent(terminalResources.sessionAgentScopeKey);
				this.pushTerminalError(partial, "aborted", getCursorRunAbortMessage(outcome));
				break;
			case "failed":
				await abandonSessionCursorAgent(terminalResources.sessionAgentScopeKey);
				this.pushTerminalError(partial, "error", outcome.kind === "error" ? outcome.errorMessage : "Cursor SDK run failed.");
				break;
			case "finished":
				terminalResources.sessionAgentLease.commitSend(context, terminalResources.bootstrap);
				terminalResources.turnCoordinator.flushText(
					outcome.kind === "finished" && hasUsableText(outcome.finalText) ? [outcome.finalText] : [],
				);
				applyCursorApproximateUsage(partial, model, context, terminalResources.promptInputTokens);
				stream.push({ type: "done", reason: "stop", message: partial });
				break;
		}
	}

	private async applyErrorOutcome(prepared: CursorProviderTurnPrepareResult | undefined, error: unknown): Promise<void> {
		this.params.sdkEventDebug()?.recordError("provider_stream", error);
		prepared?.terminalResources.turnCoordinator.discardIncompleteStartedToolCalls(
			buildIncompleteCursorToolRunOutcome({
				status: error instanceof CursorLiveRunAbortError ? "cancelled" : "error",
				signalAborted: error instanceof CursorLiveRunAbortError,
			}),
		);
		const activeLiveRun = prepared?.terminalResources.liveRun;
		if (activeLiveRun && !activeLiveRun.disposed) {
			await cursorLiveRuns.release(activeLiveRun);
		} else {
			await abandonSessionCursorAgent(prepared?.terminalResources.sessionAgentScopeKey);
		}
		if (error instanceof CursorLiveRunAbortError) {
			this.params.sdkAbortErrorSuppression.suppressAbortErrors();
			this.pushTerminalError(this.params.runnerParams.partial, "aborted", this.abortMessage());
		} else {
			this.pushTerminalError(
				this.params.runnerParams.partial,
				"error",
				sanitizeCursorProviderError(error, this.params.resolvedApiKey() ?? this.params.runnerParams.options?.apiKey),
			);
		}
	}

	private pushTerminalError(partial: AssistantMessage, reason: "error" | "aborted", message: string): void {
		partial.stopReason = reason;
		partial.errorMessage = message;
		this.params.runnerParams.stream.push({ type: "error", reason, error: partial });
	}

	private abortMessage(): string {
		return formatCursorSdkAbortMessage(
			resolveCursorSdkAbortCause({ signalAborted: this.params.runnerParams.options?.signal?.aborted }),
		);
	}

	private async finalizeSdkEventDebug(): Promise<void> {
		this.params.sdkEventDebug()?.recordFinalPartial(this.params.runnerParams.partial);
		await this.params.sdkEventDebug()?.finalize();
	}
}
