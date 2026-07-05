import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	resetCursorProviderTestState,
	makeModel,
	makeContext,
	collectEvents,
	getDoneEvent,
	getErrorEvent,
	type CursorDeltaHandler,
	mockCreatedAgent,
	asMockCursorRun,
} from "./helpers/cursor-provider-harness.js";
import { streamCursor } from "../src/cursor-provider.js";

describe("streamCursor usage accounting", () => {
	beforeEach(resetCursorProviderTestState);

	it("uses returned RunResult usage when no turn-ended usage was applied", async () => {
		const mockSend = vi.fn().mockResolvedValue(asMockCursorRun({
			id: "run-1",
			agentId: "agent-1",
			status: "finished",
			wait: vi.fn().mockResolvedValue({
				id: "run-1",
				status: "finished",
				result: "done",
				usage: {
					inputTokens: 100,
					outputTokens: 20,
					cacheReadTokens: 80,
					cacheWriteTokens: 5,
					totalTokens: 205,
				},
			}),
		}));
		mockCreatedAgent({
			send: mockSend,
			[Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
		});

		const stream = streamCursor(makeModel(), makeContext(), { apiKey: "test-key" });
		const events = await collectEvents(stream);
		const done = getDoneEvent(events);

		expect(done.message.usage).toMatchObject({ input: 100, output: 20, cacheRead: 80, cacheWrite: 5, totalTokens: 120 });
	});

	it("uses real per-turn SDK usage instead of prompt estimates or RunResult usage", async () => {
		const mockSend = vi.fn().mockImplementation(async (_msg: unknown, opts: { onDelta: CursorDeltaHandler }) => {
			opts.onDelta({ update: { type: "text-delta", text: "done" } });
			opts.onDelta({
				update: {
					type: "turn-ended",
					usage: {
						inputTokens: 25_432,
						outputTokens: 612,
						cacheReadTokens: 24_000,
						cacheWriteTokens: 123,
					},
				},
			});
			return asMockCursorRun({
				id: "run-1",
				agentId: "agent-1",
				status: "finished",
				wait: vi.fn().mockResolvedValue({
					id: "run-1",
					status: "finished",
					usage: {
						inputTokens: 6_746_960,
						outputTokens: 17_701,
						cacheReadTokens: 6_559_232,
						cacheWriteTokens: 0,
						totalTokens: 6_764_661,
					},
				}),
				cancel: vi.fn(),
				supports: () => true,
				unsupportedReason: () => undefined,
			});
		});
		mockCreatedAgent({
			send: mockSend,
			[Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
		});

		const stream = streamCursor(makeModel(), makeContext(), { apiKey: "test-key" });
		const events = await collectEvents(stream);
		const done = getDoneEvent(events);

		expect(done.message.usage.input).toBe(25_432);
		expect(done.message.usage.output).toBe(612);
		expect(done.message.usage.cacheRead).toBe(24_000);
		expect(done.message.usage.cacheWrite).toBe(123);
		expect(done.message.usage.totalTokens).toBe(25_432 + 612);
		expect(done.message.usage.totalTokens).toBeLessThan(done.message.usage.input + done.message.usage.cacheRead + done.message.usage.output);
	});

	it("uses each returned RunResult usage as-is across multiple sends", async () => {
		const usages = [
			{ inputTokens: 100, outputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 5, totalTokens: 205 },
			{ inputTokens: 90, outputTokens: 8, cacheReadTokens: 70, cacheWriteTokens: 0, totalTokens: 168 },
		];
		const mockSend = vi.fn().mockImplementation(async () => {
			const call = mockSend.mock.calls.length;
			return asMockCursorRun({
				id: `run-${call}`,
				agentId: "agent-1",
				status: "finished",
				wait: vi.fn().mockResolvedValue({
					id: `run-${call}`,
					status: "finished",
					result: `done ${call}`,
					usage: usages[call - 1],
				}),
			});
		});
		mockCreatedAgent({
			send: mockSend,
			[Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
		});

		const first = getDoneEvent(await collectEvents(streamCursor(makeModel(), makeContext(), { apiKey: "test-key" })));
		const second = getDoneEvent(await collectEvents(streamCursor(makeModel(), makeContext(), { apiKey: "test-key" })));

		expect(first.message.usage).toMatchObject({ input: 100, output: 20, cacheRead: 80, cacheWrite: 5, totalTokens: 120 });
		expect(second.message.usage).toMatchObject({ input: 90, output: 8, cacheRead: 70, cacheWrite: 0, totalTokens: 98 });
	});

	it("keeps failed runs with no SDK usage on the current zero-usage error path", async () => {
		const mockSend = vi.fn().mockResolvedValue(asMockCursorRun({
			id: "run-1",
			agentId: "agent-1",
			status: "error",
			wait: vi.fn().mockResolvedValue({
				id: "run-1",
				status: "error",
				error: { message: "boom" },
			}),
		}));
		mockCreatedAgent({
			send: mockSend,
			[Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
		});

		const stream = streamCursor(makeModel(), makeContext(), { apiKey: "test-key" });
		const events = await collectEvents(stream);
		const error = getErrorEvent(events);

		expect(error.error.usage).toMatchObject({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 });
	});
});
