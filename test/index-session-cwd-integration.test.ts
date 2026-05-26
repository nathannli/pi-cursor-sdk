import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/model-discovery.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/model-discovery.js")>();
	return {
		...actual,
		discoverModels: vi.fn(),
	};
});

function createMockAgentRun() {
	return {
		id: "run-1",
		agentId: "agent-1",
		status: "finished",
		wait: vi.fn().mockResolvedValue({ id: "run-1", status: "finished" }),
		cancel: vi.fn(),
		supports: () => true,
		unsupportedReason: () => undefined,
	};
}

function createMockAgent() {
	const mockSend = vi.fn().mockResolvedValue(createMockAgentRun());
	return {
		send: mockSend,
		[Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
	};
}

vi.mock("@cursor/sdk", () => ({
	Agent: {
		create: vi.fn().mockResolvedValue(createMockAgent()),
	},
	createAgentPlatform: vi.fn().mockResolvedValue({
		checkpointStore: { loadLatest: vi.fn().mockResolvedValue(undefined) },
	}),
}));

import { Agent } from "@cursor/sdk";
import extensionFactory from "../src/index.js";
import { discoverModels } from "../src/model-discovery.js";
import { streamCursor, __testUtils as cursorProviderTestUtils } from "../src/cursor-provider.js";
import { __testUtils as cursorSessionCwdTestUtils } from "../src/cursor-session-cwd.js";
import { __testUtils as cursorPiToolBridgeTestUtils } from "../src/cursor-pi-tool-bridge.js";
import { collectEvents, createPiHarness, makeContext, makeModel } from "./helpers/pi-harness.js";

const mockedDiscover = vi.mocked(discoverModels);
const mockedAgentCreate = vi.mocked(Agent.create);

describe("extension session cwd integration", () => {
	beforeEach(async () => {
		await cursorPiToolBridgeTestUtils.resetRegisteredBridgeForTests();
		vi.clearAllMocks();
		delete process.env.PI_CURSOR_NATIVE_TOOL_DISPLAY;
		delete process.env.PI_CURSOR_REGISTER_NATIVE_TOOLS;
		delete process.env.PI_CURSOR_SETTING_SOURCES;
		expect(cursorProviderTestUtils.pendingCursorNativeRunCount()).toBe(0);
		cursorSessionCwdTestUtils.reset();
		mockedAgentCreate.mockResolvedValue(createMockAgent());
		mockedDiscover.mockResolvedValue([
			{
				id: "composer-2.5",
				name: "Cursor Composer 2.5",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 16384,
			},
		]);
	});

	afterEach(async () => {
		cursorSessionCwdTestUtils.reset();
		await cursorPiToolBridgeTestUtils.resetRegisteredBridgeForTests();
	});

	it("passes pi session cwd from extension registration through streamSimple to Agent.create", async () => {
		const sessionDir = mkdtempSync(join(tmpdir(), "pi-cursor-index-agent-cwd-"));
		try {
			const pi = createPiHarness();
			await extensionFactory(pi);
			await pi.runSessionStart({ cwd: sessionDir, hasUI: false });

			expect(pi.registerProvider).toHaveBeenCalledOnce();
			const streamSimple = pi._registered[0]?.config.streamSimple;
			expect(streamSimple).toBe(streamCursor);

			await collectEvents(streamSimple!(makeModel("composer-2.5"), makeContext(), { apiKey: "test-key" }));

			expect(mockedAgentCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					local: { cwd: sessionDir, settingSources: ["all"] },
				}),
			);
		} finally {
			rmSync(sessionDir, { recursive: true, force: true });
		}
	});
});
