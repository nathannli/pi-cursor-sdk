import type {
	ExtensionHandler,
	SessionBeforeTreeEvent,
	SessionCompactEvent,
	SessionShutdownEvent,
	SessionTreeEvent,
} from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { Agent } from "@cursor/sdk";
import type { ModelSelection, SDKAgent, SettingSource } from "@cursor/sdk";
import type { Context } from "@earendil-works/pi-ai";
import {
	getRegisteredCursorPiToolBridge,
	type CursorPiBridgeToolRequest,
	type CursorPiToolBridgeRun,
} from "./cursor-pi-tool-bridge.js";
import { computeCursorContextFingerprint } from "./context.js";
import { getCursorSessionScopeKey, onCursorSessionScopeKeyChange } from "./cursor-session-scope.js";
import type { CursorSdkEventDebugRecorder } from "./cursor-sdk-event-debug.js";

export interface SessionCursorAgentSendState {
	bootstrapped: boolean;
	contextFingerprint: string;
	incrementalSendCount: number;
}

export interface SessionCursorAgentLease {
	scopeKey: string;
	poolKey: string;
	instanceId: number;
	agent: SDKAgent;
	bridgeRun?: CursorPiToolBridgeRun;
	sendState: SessionCursorAgentSendState;
	created: boolean;
}

interface SessionCursorAgentPoolEntry {
	poolKey: string;
	instanceId: number;
	scopeKey: string;
	agent?: SDKAgent;
	bridgeRun?: CursorPiToolBridgeRun;
	sendState: SessionCursorAgentSendState;
	creating?: Promise<SessionCursorAgentPoolEntry>;
	creationGeneration?: number;
}

class SessionCursorAgentCreationSupersededError extends Error {
	constructor() {
		super("Cursor session agent creation was superseded");
		this.name = "SessionCursorAgentCreationSupersededError";
	}
}

export class SessionCursorAgentScopeClosedError extends Error {
	constructor() {
		super("Cursor session agent scope is closed");
		this.name = "SessionCursorAgentScopeClosedError";
	}
}

function assertScopeAcceptsAcquire(scopeKey: string): void {
	if (terminalDisposedScopeKeys.has(scopeKey)) {
		throw new SessionCursorAgentScopeClosedError();
	}
}

function rethrowSupersededWhenReplacedByDifferentPoolKey(scopeKey: string, poolKey: string, error: unknown): void {
	if (!(error instanceof SessionCursorAgentCreationSupersededError)) return;
	const replacement = sessionAgentsByScope.get(scopeKey);
	if (replacement && replacement.poolKey !== poolKey) {
		throw error;
	}
}

interface SessionCursorAgentCreateParams {
	apiKey: string;
	cwd: string;
	modelSelection: ModelSelection;
	settingSources?: SettingSource[];
	onBridgeToolRequest?: (request: CursorPiBridgeToolRequest) => void;
	debugRecorder?: CursorSdkEventDebugRecorder;
	createAgent?: typeof Agent.create;
}

interface CursorSessionAgentExtensionApi {
	on(event: "session_shutdown", handler: ExtensionHandler<SessionShutdownEvent>): void;
	on(event: "session_compact", handler: ExtensionHandler<SessionCompactEvent>): void;
	on(event: "session_before_tree", handler: ExtensionHandler<SessionBeforeTreeEvent>): void;
	on(event: "session_tree", handler: ExtensionHandler<SessionTreeEvent>): void;
	on(event: "model_select", handler: ExtensionHandler<{ model: unknown }>): void;
}

const sessionAgentsByScope = new Map<string, SessionCursorAgentPoolEntry>();
const invalidatedScopeKeys = new Set<string>();
const terminalDisposedScopeKeys = new Set<string>();
const scopeCreationGenerations = new Map<string, number>();
interface PendingSdkRunCompletion {
	instanceId: number;
	promise: Promise<void>;
}

const pendingSdkRunCompletionByScope = new Map<string, PendingSdkRunCompletion>();
let nextSessionAgentInstanceId = 1;

function allocateSessionAgentInstanceId(): number {
	return nextSessionAgentInstanceId++;
}

/**
 * Tracks fire-and-forget `run.wait()` work for the current pooled agent instance.
 * Completions are scoped to `instanceId` so disposal/replacement can drop stale tracking
 * and `commitSessionAgentSend(..., expectedInstanceId)` can ignore late commits from disposed agents.
 */
export function trackSessionCursorSdkRunCompletion(
	scopeKey: string,
	instanceId: number,
	completion: Promise<unknown>,
): void {
	const existing = pendingSdkRunCompletionByScope.get(scopeKey);
	const tracked = (existing?.instanceId === instanceId ? Promise.all([existing.promise, completion]) : completion).finally(() => {
		const current = pendingSdkRunCompletionByScope.get(scopeKey);
		if (current?.promise === tracked) {
			pendingSdkRunCompletionByScope.delete(scopeKey);
		}
	}) as Promise<void>;
	pendingSdkRunCompletionByScope.set(scopeKey, { instanceId, promise: tracked });
}

export async function awaitSessionCursorSdkRunIdle(scopeKey: string, instanceId: number): Promise<void> {
	const pending = pendingSdkRunCompletionByScope.get(scopeKey);
	if (pending?.instanceId === instanceId) {
		await pending.promise;
	}
}

function clearSessionCursorSdkRunCompletionTracking(scopeKey: string): void {
	pendingSdkRunCompletionByScope.delete(scopeKey);
}

function getScopeCreationGeneration(scopeKey: string): number {
	return scopeCreationGenerations.get(scopeKey) ?? 0;
}

function invalidateScopeCreations(scopeKey: string): void {
	scopeCreationGenerations.set(scopeKey, getScopeCreationGeneration(scopeKey) + 1);
}

function buildModelPoolKey(modelSelection: ModelSelection): string {
	return JSON.stringify(modelSelection);
}

function buildSettingSourcesPoolKey(settingSources?: SettingSource[]): string {
	return settingSources?.join(",") ?? "";
}

function buildApiKeyPoolKeyFingerprint(apiKey: string): string {
	return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

function buildBridgePoolKeySuffix(): string {
	const registeredBridge = getRegisteredCursorPiToolBridge();
	if (!registeredBridge) return "bridge:absent";
	return registeredBridge.getToolSurfaceSignature();
}

function buildSessionAgentPoolKey(scopeKey: string, params: SessionCursorAgentCreateParams): string {
	return [
		scopeKey,
		params.cwd,
		buildModelPoolKey(params.modelSelection),
		buildSettingSourcesPoolKey(params.settingSources),
		buildApiKeyPoolKeyFingerprint(params.apiKey),
		buildBridgePoolKeySuffix(),
	].join("\0");
}

async function disposePoolEntry(entry: SessionCursorAgentPoolEntry): Promise<void> {
	entry.bridgeRun?.cancel("Cursor session agent disposed");
	try {
		await entry.bridgeRun?.dispose();
	} catch {
		// disposal failure should not block session replacement
	}
	if (!entry.agent) return;
	try {
		await entry.agent[Symbol.asyncDispose]();
	} catch {
		// disposal failure should not block session replacement
	}
}

async function disposePoolEntryForScope(scopeKey: string, options?: { terminal?: boolean }): Promise<void> {
	invalidateScopeCreations(scopeKey);
	clearSessionCursorSdkRunCompletionTracking(scopeKey);
	if (options?.terminal) {
		terminalDisposedScopeKeys.add(scopeKey);
	}
	const entry = sessionAgentsByScope.get(scopeKey);
	invalidatedScopeKeys.delete(scopeKey);
	if (!entry) return;
	const orphanedCreating = entry.creating;
	sessionAgentsByScope.delete(scopeKey);
	if (entry.creating || !entry.agent) {
		orphanedCreating?.catch(() => {
			// In-flight Agent.create was orphaned by scope disposal; active waiters surface errors elsewhere.
		});
		return;
	}
	await disposePoolEntry(entry);
}

function createInitialSendState(): SessionCursorAgentSendState {
	return { bootstrapped: false, contextFingerprint: "", incrementalSendCount: 0 };
}

function bindBridgeToolRequest(
	entry: SessionCursorAgentPoolEntry,
	onBridgeToolRequest?: (request: CursorPiBridgeToolRequest) => void,
): void {
	entry.bridgeRun?.setOnToolRequest(onBridgeToolRequest);
}

function leaseFromEntry(
	entry: SessionCursorAgentPoolEntry,
	scopeKey: string,
	params: SessionCursorAgentCreateParams,
	created: boolean,
): SessionCursorAgentLease {
	bindBridgeToolRequest(entry, params.onBridgeToolRequest);
	entry.bridgeRun?.setDebugRecorder(params.debugRecorder);
	return {
		scopeKey,
		poolKey: entry.poolKey,
		instanceId: entry.instanceId,
		agent: entry.agent!,
		bridgeRun: entry.bridgeRun,
		sendState: entry.sendState,
		created,
	};
}

function isCurrentPoolEntry(scopeKey: string, entry: SessionCursorAgentPoolEntry, poolKey: string): boolean {
	const current = sessionAgentsByScope.get(scopeKey);
	return (
		current === entry &&
		current.poolKey === poolKey &&
		Boolean(current.agent) &&
		!current.creating
	);
}

async function tryLeaseCurrentEntryAfterIdle(
	entry: SessionCursorAgentPoolEntry,
	scopeKey: string,
	params: SessionCursorAgentCreateParams,
	poolKey: string,
	created: boolean,
): Promise<SessionCursorAgentLease | undefined> {
	await awaitSessionCursorSdkRunIdle(scopeKey, entry.instanceId);
	assertScopeAcceptsAcquire(scopeKey);
	if (invalidatedScopeKeys.has(scopeKey)) {
		await disposePoolEntryForScope(scopeKey);
		return undefined;
	}
	if (!isCurrentPoolEntry(scopeKey, entry, poolKey)) {
		return undefined;
	}
	return leaseFromEntry(entry, scopeKey, params, created);
}

async function createSessionAgentEntry(
	scopeKey: string,
	poolKey: string,
	params: SessionCursorAgentCreateParams,
): Promise<SessionCursorAgentPoolEntry> {
	const registeredBridge = getRegisteredCursorPiToolBridge();
	let bridgeRun: CursorPiToolBridgeRun | undefined;
	if (registeredBridge) {
		bridgeRun = await registeredBridge.createRun({
			onToolRequest: params.onBridgeToolRequest,
			debugRecorder: params.debugRecorder,
		});
		if (!bridgeRun.enabled || !bridgeRun.mcpServers) {
			await bridgeRun.dispose();
			bridgeRun = undefined;
		}
	}

	const resolvedPoolKey = buildSessionAgentPoolKey(scopeKey, params);
	const createAgent = params.createAgent ?? Agent.create;
	let agent: SDKAgent;
	try {
		agent = await createAgent({
			apiKey: params.apiKey,
			model: params.modelSelection,
			local: params.settingSources ? { cwd: params.cwd, settingSources: params.settingSources } : { cwd: params.cwd },
			...(bridgeRun?.mcpServers ? { mcpServers: bridgeRun.mcpServers } : {}),
		});
	} catch (error) {
		if (bridgeRun) {
			bridgeRun.cancel("Cursor session agent create failed");
			try {
				await bridgeRun.dispose();
			} catch {
				// bridge disposal failure should not mask agent create failure
			}
		}
		throw error;
	}

	return {
		poolKey: resolvedPoolKey,
		instanceId: allocateSessionAgentInstanceId(),
		scopeKey,
		agent,
		bridgeRun,
		sendState: createInitialSendState(),
	};
}

export {
	buildCursorSessionSendPrompt,
	MAX_COMPLETED_INCREMENTAL_SENDS_BEFORE_REBOOTSTRAP,
	planCursorSessionSend,
	type CursorSessionSendPlan,
} from "./cursor-session-send-policy.js";
export { shouldBootstrapCursorContext, shouldBootstrapCursorSend } from "./context.js";

export function commitSessionAgentSend(
	scopeKey: string,
	context: Context,
	bootstrapped: boolean,
	expectedInstanceId?: number,
): void {
	const entry = sessionAgentsByScope.get(scopeKey);
	if (!entry) return;
	if (expectedInstanceId !== undefined && entry.instanceId !== expectedInstanceId) return;
	entry.sendState.bootstrapped = bootstrapped || entry.sendState.bootstrapped;
	entry.sendState.contextFingerprint = computeCursorContextFingerprint(context);
	if (bootstrapped) {
		entry.sendState.incrementalSendCount = 0;
		return;
	}
	entry.sendState.incrementalSendCount += 1;
}

export function invalidateSessionAgent(scopeKey: string = getCursorSessionScopeKey()): void {
	invalidatedScopeKeys.add(scopeKey);
}

export async function acquireSessionCursorAgent(params: SessionCursorAgentCreateParams): Promise<SessionCursorAgentLease> {
	const scopeKey = getCursorSessionScopeKey();

	while (true) {
		assertScopeAcceptsAcquire(scopeKey);
		if (invalidatedScopeKeys.has(scopeKey)) {
			await disposePoolEntryForScope(scopeKey);
		}

		const poolKey = buildSessionAgentPoolKey(scopeKey, params);
		const existing = sessionAgentsByScope.get(scopeKey);
		if (existing?.poolKey === poolKey && !existing.creating) {
			const lease = await tryLeaseCurrentEntryAfterIdle(existing, scopeKey, params, poolKey, false);
			if (lease) return lease;
			continue;
		}

		if (existing && existing.poolKey !== poolKey) {
			await disposePoolEntryForScope(scopeKey);
			continue;
		}

		const entry = sessionAgentsByScope.get(scopeKey);
		if (entry?.creating) {
			try {
				await entry.creating;
			} catch (error) {
				if (error instanceof SessionCursorAgentCreationSupersededError) {
					assertScopeAcceptsAcquire(scopeKey);
					rethrowSupersededWhenReplacedByDifferentPoolKey(scopeKey, poolKey, error);
					continue;
				}
				throw error;
			}
			continue;
		}

		const preCreate = sessionAgentsByScope.get(scopeKey);
		if (preCreate) {
			continue;
		}

		assertScopeAcceptsAcquire(scopeKey);
		const creationGeneration = getScopeCreationGeneration(scopeKey);
		const placeholder: SessionCursorAgentPoolEntry = {
			poolKey,
			instanceId: allocateSessionAgentInstanceId(),
			scopeKey,
			sendState: createInitialSendState(),
			creationGeneration,
		};
		const creating = createSessionAgentEntry(scopeKey, poolKey, params).then(async (createdEntry) => {
			const stillCurrent =
				sessionAgentsByScope.get(scopeKey) === placeholder &&
				getScopeCreationGeneration(scopeKey) === placeholder.creationGeneration;
			if (!stillCurrent) {
				await disposePoolEntry(createdEntry);
				if (sessionAgentsByScope.get(scopeKey) === placeholder) {
					sessionAgentsByScope.delete(scopeKey);
				}
				throw new SessionCursorAgentCreationSupersededError();
			}
			sessionAgentsByScope.set(scopeKey, createdEntry);
			return createdEntry;
		});
		placeholder.creating = creating;
		sessionAgentsByScope.set(scopeKey, placeholder);

		try {
			const createdEntry = await creating;
			const lease = await tryLeaseCurrentEntryAfterIdle(createdEntry, scopeKey, params, poolKey, true);
			if (lease) return lease;
			continue;
		} catch (error) {
			if (sessionAgentsByScope.get(scopeKey) === placeholder) {
				sessionAgentsByScope.delete(scopeKey);
			}
			if (error instanceof SessionCursorAgentCreationSupersededError) {
				assertScopeAcceptsAcquire(scopeKey);
				rethrowSupersededWhenReplacedByDifferentPoolKey(scopeKey, poolKey, error);
				continue;
			}
			throw error;
		}
	}
}

export async function resetSessionCursorAgent(scopeKey: string = getCursorSessionScopeKey()): Promise<void> {
	await disposePoolEntryForScope(scopeKey);
}

export async function disposeSessionCursorAgent(scopeKey: string = getCursorSessionScopeKey()): Promise<void> {
	await disposePoolEntryForScope(scopeKey, { terminal: true });
}

export async function disposeAllSessionCursorAgents(): Promise<void> {
	const scopeKeys = [...new Set([...sessionAgentsByScope.keys(), ...terminalDisposedScopeKeys])];
	await Promise.all(scopeKeys.map((scopeKey) => disposePoolEntryForScope(scopeKey, { terminal: true })));
	invalidatedScopeKeys.clear();
	terminalDisposedScopeKeys.clear();
	pendingSdkRunCompletionByScope.clear();
}

export function registerCursorSessionAgent(_pi: CursorSessionAgentExtensionApi): void {
	onCursorSessionScopeKeyChange((previousScopeKey) => {
		void disposePoolEntryForScope(previousScopeKey, { terminal: true });
	});
	_pi.on("session_shutdown", async (event) => {
		if (event.reason === "reload") {
			await resetSessionCursorAgent();
			return;
		}
		await disposeSessionCursorAgent();
	});
	_pi.on("session_compact", () => {
		invalidateSessionAgent();
	});
	_pi.on("session_before_tree", () => {
		invalidateSessionAgent();
	});
	_pi.on("session_tree", async () => {
		await resetSessionCursorAgent();
	});
	_pi.on("model_select", () => {
		invalidateSessionAgent();
	});
}

export const __testUtils = {
	sessionAgentsByScope,
	invalidateSessionAgent,
	disposeSessionCursorAgent,
	resetSessionCursorAgent,
	disposeAllSessionCursorAgents,
	buildApiKeyPoolKeyFingerprint,
	buildSessionAgentPoolKey,
	trackSessionCursorSdkRunCompletion,
	awaitSessionCursorSdkRunIdle,
	pendingSdkRunCompletionByScope,
	SessionCursorAgentCreationSupersededError,
	SessionCursorAgentScopeClosedError,
};
