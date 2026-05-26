import { vi } from "vitest";
import type { AssistantMessage, AssistantMessageEvent, Context, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext, ProviderConfig, ToolDefinition, ToolInfo } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";

export type RegisteredTool = ToolDefinition<TSchema, unknown, unknown>;

export type TestExtensionContext = Pick<ExtensionContext, "cwd" | "hasUI" | "model"> & {
	ui: Pick<ExtensionContext["ui"], "notify" | "setStatus" | "select" | "input">;
	sessionManager: Pick<ExtensionContext["sessionManager"], "getBranch">;
};

export type TestEventHandler = (event: unknown, ctx: TestExtensionContext) => Promise<void> | void;

export type TestRegisteredCommand = {
	description?: string;
	handler: (args: string, ctx: TestExtensionContext) => Promise<void> | void;
};

export type PiHarnessSurface = "full" | "bridge" | "events-only";

export interface PiHarnessOptions {
	/** Tool catalog available before extension registration. */
	initialTools?: ToolInfo[];
	/** Active tool names returned by getActiveTools. */
	activeTools?: string[];
	/** Mock surface: full extension API, bridge snapshot API, or event hooks only. */
	surface?: PiHarnessSurface;
	/** Default value returned by getFlag when surface is full. */
	defaultFlagValue?: boolean;
}

const DEFAULT_BUILTIN_TOOL_NAMES = ["read", "bash", "grep", "find", "ls", "edit", "write"] as const;
const DEFAULT_ACTIVE_TOOL_NAMES = ["read", "bash", "edit", "write"] as const;

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

/** @deprecated Prefer createTestToolInfo; kept for provider bridge tests. */
export const createBridgeToolInfo = createTestToolInfo;

export function createExtensionTestContext(ctxOverrides: Partial<TestExtensionContext> = {}): TestExtensionContext {
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

async function runHandlers(
	handlers: Map<string, TestEventHandler[]>,
	event: string,
	payload: unknown,
	ctxOverrides: Partial<TestExtensionContext> = {},
): Promise<void> {
	const ctx = createExtensionTestContext(ctxOverrides);
	for (const handler of handlers.get(event) ?? []) {
		await handler(payload, ctx);
	}
}

export interface PiHarness {
	registerProvider: ReturnType<typeof vi.fn>;
	registerFlag: ReturnType<typeof vi.fn>;
	registerCommand: ReturnType<typeof vi.fn>;
	registerTool: ReturnType<typeof vi.fn>;
	getAllTools: ReturnType<typeof vi.fn>;
	getActiveTools: ReturnType<typeof vi.fn>;
	setActiveTools: ReturnType<typeof vi.fn>;
	sendMessage: ReturnType<typeof vi.fn>;
	on: ReturnType<typeof vi.fn>;
	getFlag: ReturnType<typeof vi.fn>;
	appendEntry: ReturnType<typeof vi.fn>;
	_registered: Array<{ name: string; config: ProviderConfig }>;
	_commands: Map<string, TestRegisteredCommand>;
	_tools: RegisteredTool[];
	_handlers: Map<string, TestEventHandler[]>;
	_activeToolNames: () => string[];
	runSessionStart: (ctxOverrides?: Partial<TestExtensionContext>) => Promise<void>;
	runModelSelect: (model: ExtensionContext["model"], ctxOverrides?: Partial<TestExtensionContext>) => Promise<void>;
	runBeforeAgentStart: (ctxOverrides?: Partial<TestExtensionContext>) => Promise<void>;
	runTurnStart: (ctxOverrides?: Partial<TestExtensionContext>) => Promise<void>;
}

export interface BridgePiHarness {
	getActiveTools: ReturnType<typeof vi.fn<() => string[]>>;
	getAllTools: ReturnType<typeof vi.fn<() => ToolInfo[]>>;
	setActiveTools: ReturnType<typeof vi.fn<(toolNames: string[]) => void>>;
	on: ReturnType<typeof vi.fn>;
}

export function createBridgePiHarness(options: { active: string[]; tools: ToolInfo[] }): BridgePiHarness {
	return {
		getActiveTools: vi.fn(() => [...options.active]),
		getAllTools: vi.fn(() => [...options.tools]),
		setActiveTools: vi.fn(),
		on: vi.fn(),
	};
}

/** Canonical configurable fake pi surface for extension, bridge, provider, and session tests. */
export function createPiHarness(options: PiHarnessOptions = {}): PiHarness {
	const surface = options.surface ?? "full";
	const handlers = new Map<string, TestEventHandler[]>();
	const registered: Array<{ name: string; config: ProviderConfig }> = [];
	const commands = new Map<string, TestRegisteredCommand>();
	const tools: RegisteredTool[] = [];
	const initialTools =
		options.initialTools ?? [...DEFAULT_BUILTIN_TOOL_NAMES].map((name) => createBuiltinToolInfo(name));
	let activeToolNames = [...(options.activeTools ?? DEFAULT_ACTIVE_TOOL_NAMES)];

	const runSessionStart = async (ctxOverrides: Partial<TestExtensionContext> = {}) => {
		await runHandlers(handlers, "session_start", { reason: "startup" }, ctxOverrides);
	};
	const runModelSelect = async (model: ExtensionContext["model"], ctxOverrides: Partial<TestExtensionContext> = {}) => {
		await runHandlers(
			handlers,
			"model_select",
			{ model, previousModel: undefined, source: "set" },
			{ ...ctxOverrides, model },
		);
	};
	const runBeforeAgentStart = async (ctxOverrides: Partial<TestExtensionContext> = {}) => {
		await runHandlers(
			handlers,
			"before_agent_start",
			{ type: "before_agent_start", prompt: "start", systemPrompt: "", systemPromptOptions: {} },
			ctxOverrides,
		);
	};
	const runTurnStart = async (ctxOverrides: Partial<TestExtensionContext> = {}) => {
		await runHandlers(handlers, "turn_start", { type: "turn_start", turnIndex: 1, timestamp: Date.now() }, ctxOverrides);
	};

	if (surface === "bridge") {
		throw new Error("Use createBridgePiHarness() for bridge snapshot tests");
	}

	if (surface === "events-only") {
		return {
			registerProvider: vi.fn(),
			registerFlag: vi.fn(),
			registerCommand: vi.fn(),
			registerTool: vi.fn(),
			getAllTools: vi.fn(() => []),
			getActiveTools: vi.fn(() => []),
			setActiveTools: vi.fn(),
			sendMessage: vi.fn(),
			on: vi.fn((event: string, handler: TestEventHandler) => {
				handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			}),
			getFlag: vi.fn().mockReturnValue(options.defaultFlagValue ?? false),
			appendEntry: vi.fn(),
			_registered: registered,
			_commands: commands,
			_tools: tools,
			_handlers: handlers,
			_activeToolNames: () => [...activeToolNames],
			runSessionStart,
			runModelSelect,
			runBeforeAgentStart,
			runTurnStart,
		};
	}

	return {
		registerProvider: vi.fn((name: string, config: ProviderConfig) => {
			registered.push({ name, config });
		}),
		registerFlag: vi.fn(),
		registerCommand: vi.fn((name: string, command: TestRegisteredCommand) => {
			commands.set(name, command);
		}),
		registerTool: vi.fn((tool: RegisteredTool) => {
			tools.push(tool);
		}),
		getAllTools: vi.fn(() => {
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
		getActiveTools: vi.fn(() => [...activeToolNames]),
		setActiveTools: vi.fn((toolNames: string[]) => {
			activeToolNames = [...toolNames];
		}),
		sendMessage: vi.fn(),
		on: vi.fn((event: string, handler: TestEventHandler) => {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		}),
		getFlag: vi.fn().mockReturnValue(options.defaultFlagValue ?? false),
		appendEntry: vi.fn(),
		_registered: registered,
		_commands: commands,
		_tools: tools,
		_handlers: handlers,
		_activeToolNames: () => [...activeToolNames],
		runSessionStart,
		runModelSelect,
		runBeforeAgentStart,
		runTurnStart,
	};
}

/** @deprecated Prefer createPiHarness(); kept during harness migration. */
export const createMockPi = createPiHarness;

export const runSessionStart = (pi: PiHarness, ctxOverrides?: Partial<TestExtensionContext>) => pi.runSessionStart(ctxOverrides);
export const runModelSelect = (
	pi: PiHarness,
	model: ExtensionContext["model"],
	ctxOverrides?: Partial<TestExtensionContext>,
) => pi.runModelSelect(model, ctxOverrides);
export const runBeforeAgentStart = (pi: PiHarness, ctxOverrides?: Partial<TestExtensionContext>) =>
	pi.runBeforeAgentStart(ctxOverrides);
export const runTurnStart = (pi: PiHarness, ctxOverrides?: Partial<TestExtensionContext>) => pi.runTurnStart(ctxOverrides);
