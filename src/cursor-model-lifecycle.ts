import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionContext,
	ExtensionHandler,
	SessionStartEvent,
	TurnStartEvent,
} from "@earendil-works/pi-coding-agent";

export type CursorModelLifecycleContext = ExtensionContext;

type CursorModelSelectEvent = { model: ExtensionContext["model"] };

type CursorModelLifecycleSyncHandler = (ctx: CursorModelLifecycleContext) => Promise<void> | void;
type CursorModelSessionStartHandler = ExtensionHandler<SessionStartEvent>;
type CursorModelBeforeAgentStartHandler = ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>;

export interface CursorModelLifecycleExtensionApi {
	on(event: "session_start", handler: ExtensionHandler<SessionStartEvent>): void;
	on(event: "before_agent_start", handler: CursorModelBeforeAgentStartHandler): void;
	on(event: "model_select", handler: (event: CursorModelSelectEvent, ctx: ExtensionContext) => Promise<void> | void): void;
	on(event: "turn_start", handler: ExtensionHandler<TurnStartEvent>): void;
}

export interface CursorModelLifecycleHandlers {
	sessionStart?: CursorModelSessionStartHandler;
	sync?: CursorModelLifecycleSyncHandler;
	beforeAgentStart?: CursorModelBeforeAgentStartHandler;
	includeBeforeAgentStartInSync?: boolean;
}

function normalizeLifecycleHandlers(
	handlerOrHandlers: CursorModelLifecycleSyncHandler | CursorModelLifecycleHandlers,
): CursorModelLifecycleHandlers {
	return typeof handlerOrHandlers === "function" ? { sync: handlerOrHandlers } : handlerOrHandlers;
}

export function registerCursorModelLifecycle(
	pi: CursorModelLifecycleExtensionApi,
	handlerOrHandlers: CursorModelLifecycleSyncHandler | CursorModelLifecycleHandlers,
): void {
	const handlers = normalizeLifecycleHandlers(handlerOrHandlers);
	const sync = handlers.sync;
	if (handlers.sessionStart || sync) {
		pi.on("session_start", async (event, ctx) => {
			await handlers.sessionStart?.(event, ctx);
			await sync?.(ctx);
		});
	}
	if (sync) {
		pi.on("model_select", async (event, ctx) => {
			await sync({ ...ctx, model: event.model });
		});
		pi.on("turn_start", async (_event, ctx) => {
			await sync(ctx);
		});
	}
	if (sync && handlers.includeBeforeAgentStartInSync !== false && !handlers.beforeAgentStart) {
		pi.on("before_agent_start", async (_event, ctx) => {
			await sync(ctx);
		});
		return;
	}
	if (handlers.beforeAgentStart) {
		pi.on("before_agent_start", async (event, ctx) => {
			if (sync && handlers.includeBeforeAgentStartInSync !== false) await sync(ctx);
			return await handlers.beforeAgentStart?.(event, ctx);
		});
	}
}
