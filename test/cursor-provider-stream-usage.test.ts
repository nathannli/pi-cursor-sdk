import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	resetCursorProviderTestState,
	makeModel,
	makeContext,
	collectEvents,
	getDoneEvent,
	type CursorDeltaHandler,
	mockCreatedAgent,
	asMockCursorRun,
} from "./helpers/cursor-provider-harness.js";
import { streamCursor } from "../src/cursor-provider.js";

describe("streamCursor usage accounting", () => {
	beforeEach(resetCursorProviderTestState);

	it("uses real per-turn SDK usage instead of prompt estimates or cumulative RunResult usage", async () => {
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
});
