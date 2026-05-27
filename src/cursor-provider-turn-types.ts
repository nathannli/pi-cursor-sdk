import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { SDKAgent, SDKImage } from "@cursor/sdk";
import type { CursorLiveRun } from "./cursor-live-run-coordinator.js";
import type { SessionCursorAgentLease } from "./cursor-session-agent.js";
import type { planCursorSessionSend } from "./cursor-session-agent.js";
import type { CursorSdkEventDebugSink } from "./cursor-sdk-event-debug.js";
import type { CursorSdkTurnCoordinator } from "./cursor-provider-turn-coordinator.js";
import type { CursorPrompt } from "./context.js";

export interface CursorProviderTurnRunnerParams {
	model: Model<Api>;
	context: Context;
	stream: AssistantMessageEventStream;
	partial: AssistantMessage;
	options?: SimpleStreamOptions;
	sdkEventDebugRef: { current?: CursorSdkEventDebugSink };
}

export interface CursorProviderTurnSendPayload {
	text: string;
	images?: SDKImage[];
}

export interface CursorProviderTurnSendMeta {
	sendPlan: ReturnType<typeof planCursorSessionSend>;
	prompt: CursorPrompt;
	bootstrap: boolean;
	promptInputTokens: number;
	useNativeToolReplay: boolean;
	bridgeEnabled: boolean;
	nativeReplayId: string;
}

export interface CursorProviderTurnSendRequest {
	agent: SDKAgent;
	cwd: string;
	payload: CursorProviderTurnSendPayload;
	meta: CursorProviderTurnSendMeta;
	liveRun: CursorLiveRun | undefined;
	turnCoordinator: CursorSdkTurnCoordinator;
}

export interface CursorProviderTurnFinalizeInputs {
	cwd: string;
	contextWindowAgentId: string;
	turnCoordinator: CursorSdkTurnCoordinator;
	textDeltas: string[];
	liveRun: CursorLiveRun | undefined;
}

export interface CursorProviderTurnTerminalResources {
	sessionAgentScopeKey: string;
	sessionAgentLease: SessionCursorAgentLease;
	bootstrap: boolean;
	promptInputTokens: number;
	liveRun: CursorLiveRun | undefined;
	turnCoordinator: CursorSdkTurnCoordinator;
	restoreCursorSdkOutputFilter: () => void;
}

export interface CursorProviderTurnPrepareResult {
	sendRequest: CursorProviderTurnSendRequest;
	finalizeInputs: CursorProviderTurnFinalizeInputs;
	terminalResources: CursorProviderTurnTerminalResources;
}

export interface CursorProviderTurnSend {
	run: Awaited<ReturnType<SDKAgent["send"]>>;
	cursorAgentMessageOffset: number | undefined;
}

export interface CursorProviderTurnSendResult {
	send: CursorProviderTurnSend;
	abortRegistration: { signal: AbortSignal; listener: () => void } | undefined;
}
