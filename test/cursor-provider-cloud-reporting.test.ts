import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	collectEvents,
	collectThinkingDeltas,
	getDoneEvent,
	getErrorEvent,
	makeContext,
	makeModel,
	mockCreatedAgent,
	resetCursorProviderTestState,
	type CursorDeltaHandler,
} from "./helpers/cursor-provider-harness.js";
import { streamCursor } from "../src/cursor-provider.js";
import {
	CLOUD_LIFECYCLE_ENTRY_TYPE,
	registerCursorCloudLifecycleLedger,
	__testUtils as cloudLifecycleTestUtils,
} from "../src/cursor-cloud-lifecycle.js";
import { createPiHarness } from "./helpers/pi-harness.js";

describe("streamCursor cloud reporting", () => {
	beforeEach(() => {
		resetCursorProviderTestState();
		cloudLifecycleTestUtils.reset();
	});

	afterEach(() => {
		cloudLifecycleTestUtils.reset();
	});

	it("streams bounded cloud completion telemetry, records lifecycle, and keeps raw usage out of pi usage", async () => {
		process.env.PI_CURSOR_RUNTIME = "cloud";
		process.env.PI_CURSOR_CLOUD_ALLOW_LOCAL_STATE = "1";
		process.env.PI_CURSOR_CLOUD_ACK = "1";
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
			totalUsage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 300, cacheWriteTokens: 40, totalTokens: 1540 },
			runs: [
				{ id: "run-1", usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 300, cacheWriteTokens: 40, totalTokens: 1540 } },
			],
		}), { status: 200 }));
		const listArtifacts = vi.fn().mockResolvedValue([
			{ path: "artifacts/report.txt", sizeBytes: 12, updatedAt: "2026-07-07T00:00:00Z" },
		]);
		const pi = createPiHarness();
		registerCursorCloudLifecycleLedger(pi);
		mockCreatedAgent({
			agentId: "bc-agent-1",
			listArtifacts,
			send: vi.fn().mockImplementation(async (_msg: unknown, opts: { onDelta: CursorDeltaHandler }) => {
				opts.onDelta({
					update: {
						type: "turn-ended",
						usage: {
							inputTokens: 7,
							outputTokens: 8,
							cacheReadTokens: 9,
							cacheWriteTokens: 10,
						},
					},
				});
				return {
					id: "run-1",
					agentId: "bc-agent-1",
					status: "finished",
					wait: vi.fn().mockResolvedValue({
						id: "run-1",
						status: "finished",
						result: "cloud done",
						git: { branches: [{ repoUrl: "github.com/acme/repo", branch: "cursor/work", prUrl: "https://github.com/acme/repo/pull/7" }] },
					}),
					cancel: vi.fn(),
					supports: () => true,
					unsupportedReason: () => undefined,
				};
			}),
		});

		try {
			const events = await collectEvents(streamCursor(makeModel("gpt-5.5@1m"), makeContext(), { apiKey: "test-key" }));

			const thinking = collectThinkingDeltas(events);
			expect(thinking).toContain("Cursor cloud run:");
			expect(thinking).toContain("- agent: bc-agent-1");
			expect(thinking).toContain("- run: run-1");
			expect(thinking).toContain("- branch: cursor/work (github.com/acme/repo)");
			expect(thinking).toContain("git fetch origin 'cursor/work' && git checkout 'cursor/work'");
			expect(thinking).toContain("- PR: https://github.com/acme/repo/pull/7");
			expect(thinking).toContain("artifacts/report.txt (12 bytes");
			expect(thinking).toContain("raw usage (display only): input 1,000, output 200, cache read 300, cache write 40, total 1,540");
			expect(listArtifacts).toHaveBeenCalledTimes(1);
			expect(fetchSpy.mock.calls[0]?.[0].toString()).toContain("/v1/agents/bc-agent-1/usage?runId=run-1");

			const done = getDoneEvent(events);
			expect(done.message.usage.input).toBe(7);
			expect(done.message.usage.output).toBe(8);
			expect(done.message.usage.cacheRead).toBe(9);
			expect(done.message.usage.cacheWrite).toBe(10);
			expect(done.message.usage.totalTokens).toBe(15);
			const doneContent = JSON.stringify(done.message.content);
			expect(doneContent).not.toContain("Cursor cloud run:");
			expect(doneContent).not.toContain("bc-agent-1");
			expect(doneContent).not.toContain("run-1");
			expect(doneContent).not.toContain("github.com/acme/repo");
			expect(doneContent).not.toContain("artifacts/report.txt");
			expect(doneContent).not.toContain("raw usage");
			expect(pi.appendEntry).toHaveBeenCalledWith(CLOUD_LIFECYCLE_ENTRY_TYPE, expect.objectContaining({
				action: "record",
				runtime: "cloud",
				agentId: "bc-agent-1",
				runId: "run-1",
				branches: [expect.objectContaining({ branch: "cursor/work", prUrl: "https://github.com/acme/repo/pull/7" })],
			}));
			expect(pi.appendEntry.mock.calls[0]?.[1]).not.toHaveProperty("artifacts");
		} finally {
			fetchSpy.mockRestore();
		}
	});

	it.each(["error", "cancelled"] as const)("skips cloud completion telemetry after %s runs", async (status) => {
		process.env.PI_CURSOR_RUNTIME = "cloud";
		process.env.PI_CURSOR_CLOUD_ALLOW_LOCAL_STATE = "1";
		process.env.PI_CURSOR_CLOUD_ACK = "1";
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
		const listArtifacts = vi.fn().mockResolvedValue([{ path: "artifacts/report.txt", sizeBytes: 12, updatedAt: "now" }]);
		mockCreatedAgent({
			agentId: "bc-agent-1",
			listArtifacts,
			send: vi.fn().mockResolvedValue({
				id: "run-1",
				agentId: "bc-agent-1",
				status,
				wait: vi.fn().mockResolvedValue({ id: "run-1", status }),
				cancel: vi.fn(),
				supports: () => true,
				unsupportedReason: () => undefined,
			}),
		});

		try {
			const events = await collectEvents(streamCursor(makeModel("gpt-5.5@1m"), makeContext(), { apiKey: "test-key" }));

			expect(getErrorEvent(events).reason).toBe(status === "cancelled" ? "aborted" : "error");
			expect(listArtifacts).not.toHaveBeenCalled();
			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			fetchSpy.mockRestore();
		}
	});

	it("keeps successful cloud runs done when completion telemetry fails", async () => {
		process.env.PI_CURSOR_RUNTIME = "cloud";
		process.env.PI_CURSOR_CLOUD_ALLOW_LOCAL_STATE = "1";
		process.env.PI_CURSOR_CLOUD_ACK = "1";
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
		mockCreatedAgent({
			agentId: "bc-agent-1",
			listArtifacts: vi.fn().mockResolvedValue([{ path: "artifacts/bad.txt" }]),
			send: vi.fn().mockResolvedValue({
				id: "run-1",
				agentId: "bc-agent-1",
				status: "finished",
				wait: vi.fn().mockResolvedValue({ id: "run-1", status: "finished", result: "cloud done" }),
				cancel: vi.fn(),
				supports: () => true,
				unsupportedReason: () => undefined,
			}),
		});

		try {
			const events = await collectEvents(streamCursor(makeModel("gpt-5.5@1m"), makeContext(), { apiKey: "test-key" }));

			expect(getDoneEvent(events).message.stopReason).toBe("stop");
			expect(collectThinkingDeltas(events)).not.toContain("Cursor cloud run:");
		} finally {
			fetchSpy.mockRestore();
		}
	});

	it("keeps local runs out of cloud completion telemetry", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
		const listArtifacts = vi.fn().mockResolvedValue([{ path: "artifacts/report.txt", sizeBytes: 12, updatedAt: "now" }]);
		mockCreatedAgent({
			listArtifacts,
			send: vi.fn().mockResolvedValue({
				id: "run-1",
				agentId: "agent-1",
				status: "finished",
				wait: vi.fn().mockResolvedValue({ id: "run-1", status: "finished", result: "local done" }),
				cancel: vi.fn(),
				supports: () => true,
				unsupportedReason: () => undefined,
			}),
		});

		try {
			const events = await collectEvents(streamCursor(makeModel("gpt-5.5@1m"), makeContext(), { apiKey: "test-key" }));

			expect(collectThinkingDeltas(events)).not.toContain("Cursor cloud run:");
			expect(listArtifacts).not.toHaveBeenCalled();
			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			fetchSpy.mockRestore();
		}
	});
});
