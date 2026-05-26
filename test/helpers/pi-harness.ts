import { vi, type MockedFunction } from "vitest";
import type { AssistantMessage, AssistantMessageEvent, Context, Model } from "@earendil-works/pi-ai";
import type {
	BeforeAgentStartEvent,
	ExtensionAPI,
	ExtensionContext,
	ExtensionHandler,
	ModelSelectEvent,
	ProviderConfig,
	SessionStartEvent,
	ToolDefinition,
	ToolInfo,
	TurnStartEvent,
} from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";

export type RegisteredTool = ToolDefinition<TSchema, unknown, unknown>;

export type TestExtensionContext = Pick<ExtensionContext, "cwd" | "hasUI" | "model"> & {
	ui: Pick<ExtensionContext["ui"], "notify" | "setStatus" | "select" | "input">;
	sessionManager: Pick<ExtensionContext["sessionManager"], "getBranch">;
};

export type HarnessEventName = "session_start" | "model_select" | "before_agent_start" | "turn_start" | "session_shutdown";

export type HarnessEventMap = {
	session_start: SessionStartEvent;
	model_select: ModelSelectEvent;
	before_agent_start: BeforeAgentStartEvent;
	turn_start: TurnStartEvent;
	session_shutdown: { type: "session_shutdown"; reason: "quit" | "reload" | "new" | "resume" | "fork"; targetSessionFile?: string };
};

type MockFn<T extends (...args: never[]) => unknown> = MockedFunction<T>;

export interface PiHarnessOptions {
	/** Tool catalog available before extension registration. */
	initialTools?: ToolInfo[];
	/** Active tool names returned by getActiveTools. */
	activeTools?: string[];
	/** Default value returned by getFlag. */
	defaultFlagValue?: boolean;
}

export interface EventHarness {
	on: MockFn<ExtensionAPI["on"]>;
	invokeEvent: <E extends HarnessEventName>(
		event: E,
		payload: HarnessEventMap[E] | Record<string, never>,
		ctxOverrides?: Partial<TestExtensionContext>,
	) => Promise<void>;
	runSessionStart: (
		ctxOverrides?: Partial<TestExtensionContext>,
		eventOverrides?: Partial<SessionStartEvent>,
	) => Promise<void>;
	runModelSelect: (model: ExtensionContext["model"], ctxOverrides?: Partial<TestExtensionContext>) => Promise<void>;
	runBeforeAgentStart: (ctxOverrides?: Partial<TestExtensionContext>) => Promise<void>;
	runTurnStart: (ctxOverrides?: Partial<TestExtensionContext>) => Promise<void>;
}

export interface PiHarness extends EventHarness {
	registerProvider: MockFn<ExtensionAPI["registerProvider"]>;
	registerFlag: MockFn<ExtensionAPI["registerFlag"]>;
	registerCommand: MockFn<ExtensionAPI["registerCommand"]>;
	registerTool: MockFn<ExtensionAPI["registerTool"]>;
	getAllTools: MockFn<ExtensionAPI["getAllTools"]>;
	getActiveTools: MockFn<ExtensionAPI["getActiveTools"]>;
	setActiveTools: MockFn<ExtensionAPI["setActiveTools"]>;
	sendMessage: MockFn<ExtensionAPI["sendMessage"]>;
	getFlag: MockFn<ExtensionAPI["getFlag"]>;
	appendEntry: MockFn<ExtensionAPI["appendEntry"]>;
	_registered: Array<{ name: string; config: ProviderConfig }>;
	_commands: Map<string, { description?: string; handler: (args: string, ctx: TestExtensionContext) => Promise<void> | void }>;
	_tools: RegisteredTool[];
	_activeToolNames: () => string[];
}

export interface BridgePiHarness {
	getActiveTools: MockFn<ExtensionAPI["getActiveTools"]>;
	getAllTools: MockFn<ExtensionAPI["getAllTools"]>;
	setActiveTools: MockFn<ExtensionAPI["setActiveTools"]>;
	on: MockFn<ExtensionAPI["on"]>;
}

const DEFAULT_BUILTIN_TOOL_NAMES = ["read", "bash", "grep", "find", "ls", "edit", "write"] as const;
const DEFAULT_ACTIVE_TOOL_NAMES = ["read", "bash", "edit", "write"] as const;

function createExtensionTestContextInternal(ctxOverrides: Partial<TestExtensionContext> = {}): TestExtensionContext {
	const notify = vi.fn();
	return {
		cwd: process.cwd(),
		hasUI: true,
		model: { provider: "cursor", api: "cursor-sdk", id: "composer-2.5" } as ExtensionContext["model"],
		ui: { notify, setStatus: vi.fn(), select: vi.fn(), input: vi.fn() },
		sessionManager: { getBranch: vi.fn(() => []) },
		...ctxOverrides,
	};
}

function createHarnessEventApi() {
	const handlers = new Map<string, ExtensionHandler<HarnessEventMap[HarnessEventName]>[]>();

	const on = vi.fn((event: string, handler: ExtensionHandler<HarnessEventMap[HarnessEventName]>) => {
		handlers.set(event, [...(handlers.get(event) ?? []), handler]);
	}) as MockFn<ExtensionAPI["on"]>;

	const invokeEvent = async <E extends HarnessEventName>(
		event: E,
		payload: HarnessEventMap[E] | Record<string, never>,
		ctxOverrides: Partial<TestExtensionContext> = {},
	): Promise<void> => {
		const ctx = createExtensionTestContextInternal(ctxOverrides);
		for (const handler of handlers.get(event) ?? []) {
			await handler(payload as HarnessEventMap[E], ctx as ExtensionContext);
		}
	};

	const runSessionStart = async (
		ctxOverrides: Partial<TestExtensionContext> = {},
		eventOverrides: Partial<SessionStartEvent> = {},
	): Promise<void> => {
		await invokeEvent(
			"session_start",
			{ type: "session_start", reason: "startup", ...eventOverrides },
			ctxOverrides,
		);
	};

	const runModelSelect = async (model: ExtensionContext["model"], ctxOverrides: Partial<TestExtensionContext> = {}): Promise<void> => {
		await invokeEvent(
			"model_select",
			{ type: "model_select", model, previousModel: undefined, source: "set" },
			{ ...ctxOverrides, model },
		);
	};

	const runBeforeAgentStart = async (ctxOverrides: Partial<TestExtensionContext> = {}): Promise<void> => {
		await invokeEvent(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: "start",
				systemPrompt: "",
				systemPromptOptions: {} as BeforeAgentStartEvent["systemPromptOptions"],
			},
			ctxOverrides,
		);
	};

	const runTurnStart = async (ctxOverrides: Partial<TestExtensionContext> = {}): Promise<void> => {
		await invokeEvent("turn_start", { type: "turn_start", turnIndex: 1, timestamp: Date.now() }, ctxOverrides);
	};

	return { on, invokeEvent, runSessionStart, runModelSelect, runBeforeAgentStart, runTurnStart };
}

export function createBuiltinToolInfo(
	name: string,
	parameters: TSchema = Type.Object({}),
	description = "",
): ToolInfo {
	return {
		name,
		description,
		parameters,
		sourceInfo: { source: "builtin", path: `<builtin:${name}>`, scope: "temporary", origin: "top-level" },
	};
}

/** Generic test-scoped tool metadata (extension-registered tools, bridge MCP tools, etc.). */
export function createTestToolInfo(
	name: string,
	parameters: TSchema = Type.Object({}),
	description = `${name} tool`,
): ToolInfo {
	return {
		name,
		description,
		parameters,
		sourceInfo: { source: "test", path: `test:${name}`, scope: "temporary", origin: "top-level" },
	};
}

export function createExtensionTestContext(ctxOverrides: Partial<TestExtensionContext> = {}): TestExtensionContext {
	return createExtensionTestContextInternal(ctxOverrides);
}

export function makeModel(id = "test-model"): Model<"cursor-sdk"> {
	return {
		id,
		name: "Test Model",
		api: "cursor-sdk" as const,
		provider: "cursor",
		baseUrl: "",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	};
}

export function makeContext(messages: Context["messages"] = [{ role: "user", content: "Hello", timestamp: 1 }]): Context {
	return {
		systemPrompt: "Be helpful.",
		messages,
	};
}

export function makeAssistantMessage(text = "Done", timestamp = 2): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "cursor-sdk",
		provider: "cursor",
		model: "test-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
	};
}

export async function collectEvents<TEvent>(stream: AsyncIterable<TEvent>): Promise<TEvent[]> {
	const events: TEvent[] = [];
	for await (const event of stream) {
		events.push(event);
	}
	return events;
}

export async function collectAssistantEvents(
	stream: AsyncIterable<AssistantMessageEvent>,
): Promise<AssistantMessageEvent[]> {
	return collectEvents(stream);
}

/** Event-hook-only fake pi surface (session cwd, scoped listeners, etc.). */
export function createEventHarness(): EventHarness {
	return createHarnessEventApi();
}

export function createBridgePiHarness(options: { active: string[]; tools: ToolInfo[] }): BridgePiHarness {
	return {
		getActiveTools: vi.fn<ExtensionAPI["getActiveTools"]>(() => [...options.active]),
		getAllTools: vi.fn<ExtensionAPI["getAllTools"]>(() => [...options.tools]),
		setActiveTools: vi.fn<ExtensionAPI["setActiveTools"]>(),
		on: vi.fn<ExtensionAPI["on"]>(),
	};
}

/** Canonical configurable fake pi surface for extension, provider, and session tests. */
export function createPiHarness(options: PiHarnessOptions = {}): PiHarness {
	const eventApi = createHarnessEventApi();
	const registered: Array<{ name: string; config: ProviderConfig }> = [];
	const commands = new Map<
		string,
		{ description?: string; handler: (args: string, ctx: TestExtensionContext) => Promise<void> | void }
	>();
	const tools: RegisteredTool[] = [];
	const initialTools =
		options.initialTools ?? [...DEFAULT_BUILTIN_TOOL_NAMES].map((name) => createBuiltinToolInfo(name));
	let activeToolNames = [...(options.activeTools ?? DEFAULT_ACTIVE_TOOL_NAMES)];

	return {
		...eventApi,
		registerProvider: vi.fn<ExtensionAPI["registerProvider"]>((name: string, config: ProviderConfig) => {
			registered.push({ name, config });
		}),
		registerFlag: vi.fn<ExtensionAPI["registerFlag"]>(),
		registerCommand: vi.fn<ExtensionAPI["registerCommand"]>((name: string, command) => {
			commands.set(name, command);
		}),
		registerTool: vi.fn<ExtensionAPI["registerTool"]>((tool: RegisteredTool) => {
			tools.push(tool);
		}),
		getAllTools: vi.fn<ExtensionAPI["getAllTools"]>(() => {
			const toolsByName = new Map<string, ToolInfo>();
			for (const tool of initialTools) toolsByName.set(tool.name, tool);
			for (const tool of tools) {
				toolsByName.set(tool.name, {
					name: tool.name,
					description: tool.description,
					parameters: tool.parameters,
					sourceInfo: { source: "test", path: "pi-cursor-sdk-test", scope: "temporary", origin: "top-level" },
				});
			}
			return [...toolsByName.values()];
		}),
		getActiveTools: vi.fn<ExtensionAPI["getActiveTools"]>(() => [...activeToolNames]),
		setActiveTools: vi.fn<ExtensionAPI["setActiveTools"]>((toolNames: string[]) => {
			activeToolNames = [...toolNames];
		}),
		sendMessage: vi.fn<ExtensionAPI["sendMessage"]>(),
		getFlag: vi.fn<ExtensionAPI["getFlag"]>().mockReturnValue(options.defaultFlagValue ?? false),
		appendEntry: vi.fn<ExtensionAPI["appendEntry"]>(),
		_registered: registered,
		_commands: commands,
		_tools: tools,
		_activeToolNames: () => [...activeToolNames],
	};
}
