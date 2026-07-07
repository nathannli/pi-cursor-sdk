import { describe, expect, it, vi } from "vitest";
import { fetchCursorCloudRawUsage, formatCursorCloudRunReport } from "../src/cursor-cloud-reporting.js";

describe("cursor cloud reporting", () => {
	it("fetches raw usage from the fixed Cursor API base unless tests inject a base URL", async () => {
		const previousBackendUrl = process.env.CURSOR_BACKEND_URL;
		process.env.CURSOR_BACKEND_URL = "https://evil.example";
		const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
			totalUsage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, totalTokens: 10 },
			runs: [{ id: "run-1", usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, totalTokens: 10 } }],
		}), { status: 200 }));
		try {
			const report = await fetchCursorCloudRawUsage({ agentId: "bc-agent", runId: "run-1", apiKey: "secret-key", fetchImpl });

			expect(fetchImpl.mock.calls[0]?.[0].toString()).toBe("https://api.cursor.com/v1/agents/bc-agent/usage?runId=run-1");
			expect(report?.runUsage?.totalTokens).toBe(10);
		} finally {
			if (previousBackendUrl === undefined) delete process.env.CURSOR_BACKEND_URL;
			else process.env.CURSOR_BACKEND_URL = previousBackendUrl;
		}
	});

	it("aborts the raw usage fetch when the timeout fires", async () => {
		let signal: AbortSignal | undefined;
		const fetchImpl = vi.fn((_url: URL | RequestInfo, init?: RequestInit) => {
			signal = init?.signal ?? undefined;
			return new Promise<Response>(() => {});
		}) as typeof fetch;

		const report = await fetchCursorCloudRawUsage({
			agentId: "bc-agent",
			runId: "run-1",
			apiKey: "secret-key",
			fetchImpl,
			timeoutMs: 1,
		});

		expect(report).toBeUndefined();
		expect(signal?.aborted).toBe(true);
	});

	it("aborts raw usage response body parsing when the timeout fires", async () => {
		let signal: AbortSignal | undefined;
		const fetchImpl = vi.fn((_url: URL | RequestInfo, init?: RequestInit) => {
			signal = init?.signal ?? undefined;
			return Promise.resolve({
				ok: true,
				json: () => new Promise(() => {}),
			} as Response);
		}) as typeof fetch;

		const report = await fetchCursorCloudRawUsage({
			agentId: "bc-agent",
			runId: "run-1",
			apiKey: "secret-key",
			fetchImpl,
			timeoutMs: 1,
		});

		expect(report).toBeUndefined();
		expect(signal?.aborted).toBe(true);
	});

	it("scrubs API keys from formatted cloud report text", () => {
		const report = formatCursorCloudRunReport({
			agentId: "bc-agent",
			runId: "run-1",
			branches: [{ repoUrl: "github.com/acme/secret-key", branch: "cursor/work", prUrl: "https://github.com/acme/repo/pull/1?token=secret-key" }],
			artifacts: [{ path: "artifacts/secret-key.txt", sizeBytes: 1, updatedAt: "2026-07-07T00:00:00Z" }],
		}, { apiKey: "secret-key" });

		expect(report).not.toContain("secret-key");
		expect(report).toContain("[redacted]");
	});
});
