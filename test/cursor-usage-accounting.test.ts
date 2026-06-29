import { describe, expect, it } from "vitest";
import { InteractionUpdateSchema, TurnEndedUpdateSchema } from "@cursor/sdk";
import type { AssistantMessage, Context } from "@earendil-works/pi-ai/compat";
import {
	applyCursorApproximateUsage,
	applyCursorUsage,
	estimateCursorAssistantSessionOutputTokens,
	estimateCursorContextTotalTokens,
	readCursorSdkTurnUsageFromUpdate,
} from "../src/cursor-usage-accounting.js";
import { makeModel } from "./helpers/pi-harness.js";

function makeAssistantMessage(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
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
		timestamp: 2,
	};
}

describe("cursor usage accounting", () => {
	it("counts assistant session output from text, thinking, and tool calls", () => {
		const textOnly = makeAssistantMessage([{ type: "text", text: "Done." }]);
		const withThinking = makeAssistantMessage([
			{ type: "thinking", thinking: "Inspecting the repository." },
			{ type: "text", text: "Done." },
		]);
		const withToolCall = makeAssistantMessage([
			{ type: "text", text: "I will inspect it." },
			{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } },
		]);

		expect(estimateCursorAssistantSessionOutputTokens(textOnly)).toBeGreaterThan(0);
		expect(estimateCursorAssistantSessionOutputTokens(withThinking)).toBeGreaterThan(estimateCursorAssistantSessionOutputTokens(textOnly));
		expect(estimateCursorAssistantSessionOutputTokens(withToolCall)).toBeGreaterThan(estimateCursorAssistantSessionOutputTokens(textOnly));
	});

	it("applies real SDK usage when a turn reports it", () => {
		const model = makeModel();
		const context: Context = {
			systemPrompt: "Be helpful.",
			messages: [{ role: "user", content: "Hello", timestamp: 1 }],
		};
		const partial = makeAssistantMessage([{ type: "text", text: "Hello back." }]);

		applyCursorUsage(partial, model, context, 7, {
			turn: { inputTokens: 25_432, outputTokens: 612, cacheReadTokens: 24_000, cacheWriteTokens: 123 },
		});

		expect(partial.usage.input).toBe(25_432);
		expect(partial.usage.output).toBe(612);
		expect(partial.usage.cacheRead).toBe(24_000);
		expect(partial.usage.cacheWrite).toBe(123);
		expect(partial.usage.totalTokens).toBe(25_432 + 612);
	});

	it("reads the installed Cursor SDK turn-ended usage update contract", () => {
		const update = {
			type: "turn-ended",
			usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, reasoningTokens: 5 },
		};

		expect(TurnEndedUpdateSchema.safeParse(update).success).toBe(true);
		expect(InteractionUpdateSchema.safeParse(update).success).toBe(true);
		expect(readCursorSdkTurnUsageFromUpdate(update)).toEqual({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 });
		expect(InteractionUpdateSchema.safeParse({
			type: "usage",
			usage: { inputTokens: 5, outputTokens: 6, cacheReadTokens: 7, cacheWriteTokens: 8, totalTokens: 11 },
		}).success).toBe(false);
	});

	it("keeps the prompt/output estimate fallback when SDK usage is absent", () => {
		const model = makeModel();
		const context: Context = {
			systemPrompt: "Be helpful.",
			messages: [{ role: "user", content: "Hello", timestamp: 1 }],
		};
		const partial = makeAssistantMessage([
			{ type: "thinking", thinking: "Need a concise answer." },
			{ type: "text", text: "Hello back." },
		]);
		const sessionInputTokens = 7;

		applyCursorApproximateUsage(partial, model, context, sessionInputTokens);

		expect(partial.usage.output).toBe(estimateCursorAssistantSessionOutputTokens(partial));
		expect(partial.usage.cacheRead).toBe(0);
		expect(partial.usage.cacheWrite).toBe(0);
		expect(partial.usage.input).toBe(sessionInputTokens);
		expect(partial.usage.totalTokens).toBe(estimateCursorContextTotalTokens(partial, model, context));
		expect(partial.usage.totalTokens).toBeGreaterThan(partial.usage.input + partial.usage.output);
	});
});
