import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	CLOUD_LIFECYCLE_ENTRY_TYPE,
	__testUtils as cloudLifecycleTestUtils,
	formatCursorCloudLifecycleList,
	recordCursorCloudLifecycleRun,
} from "../src/cursor-cloud-lifecycle.js";
import { MAX_CLOUD_REPORT_BRANCHES } from "../src/cursor-cloud-reporting.js";
import { registerCursorRuntimeControls } from "../src/cursor-state.js";
import { createPiHarness } from "./helpers/pi-harness.js";

function lifecycleEntry(id: string, data: Record<string, unknown>): SessionEntry {
	return {
		type: "custom",
		id,
		parentId: null,
		timestamp: "2026-07-07T00:00:00.000Z",
		customType: CLOUD_LIFECYCLE_ENTRY_TYPE,
		data,
	};
}

function recordEntry(agentId = "bc-agent-1"): SessionEntry {
	return lifecycleEntry(`record-${agentId}`, {
		action: "record",
		runtime: "cloud",
		agentId,
		runId: "run-1",
		timestamp: "2026-07-07T00:00:00.000Z",
		branches: [{ repoUrl: "github.com/acme/repo", branch: "cursor/work", prUrl: "https://github.com/acme/repo/pull/7" }],
	});
}

describe("Cursor cloud lifecycle ledger", () => {
	beforeEach(() => {
		cloudLifecycleTestUtils.reset();
	});

	afterEach(() => {
		cloudLifecycleTestUtils.reset();
		vi.clearAllMocks();
	});

	it("records successful cloud run lifecycle metadata in session custom entries", () => {
		const pi = createPiHarness();
		registerCursorRuntimeControls(pi);

		expect(recordCursorCloudLifecycleRun({
			agentId: "bc-agent-1",
			runId: "run-1",
			branches: [{ repoUrl: "github.com/acme/repo", branch: "cursor/work", prUrl: "https://github.com/acme/repo/pull/7" }],
			artifacts: [{ path: "artifacts/report.txt", sizeBytes: 12, updatedAt: "2026-07-07T00:00:00Z" }],
		})).toBe(true);

		expect(pi.appendEntry).toHaveBeenCalledWith(CLOUD_LIFECYCLE_ENTRY_TYPE, expect.objectContaining({
			action: "record",
			runtime: "cloud",
			agentId: "bc-agent-1",
			runId: "run-1",
			branches: [expect.objectContaining({ branch: "cursor/work", prUrl: "https://github.com/acme/repo/pull/7" })],
		}));
		expect(pi.appendEntry.mock.calls[0]?.[1]).not.toHaveProperty("artifacts");
		expect(pi.appendEntry.mock.calls[0]?.[1]).not.toHaveProperty("cwd");
		expect(pi.appendEntry.mock.calls[0]?.[1]).not.toHaveProperty("sessionFile");
		expect(pi.appendEntry.mock.calls[0]?.[1]).not.toHaveProperty("sessionName");
	});

	it("bounds recorded cloud lifecycle branches and ignores artifacts", () => {
		const pi = createPiHarness();
		registerCursorRuntimeControls(pi);
		const branches = Array.from({ length: MAX_CLOUD_REPORT_BRANCHES + 2 }, (_, index) => ({
			repoUrl: "github.com/acme/repo",
			branch: `cursor/work-${index}`,
		}));
		const artifacts = Array.from({ length: 12 }, (_, index) => ({
			path: `artifacts/report-${index}.txt`,
			sizeBytes: index,
			updatedAt: "2026-07-07T00:00:00Z",
		}));

		recordCursorCloudLifecycleRun({ agentId: "bc-agent-1", runId: "run-1", branches, artifacts });

		expect(pi.appendEntry).toHaveBeenCalledWith(CLOUD_LIFECYCLE_ENTRY_TYPE, expect.objectContaining({
			branches: branches.slice(0, MAX_CLOUD_REPORT_BRANCHES).map((branch) => ({ branch: branch.branch })),
		}));
		expect(pi.appendEntry.mock.calls[0]?.[1]).not.toHaveProperty("artifacts");
	});

	it("caps oversized branch and PR strings in ledger and list output", () => {
		const pi = createPiHarness();
		registerCursorRuntimeControls(pi);
		const hugeBranch = `cursor/${"b".repeat(1000)}`;
		const hugePrUrl = `https://github.com/acme/repo/pull/${"7".repeat(1000)}`;

		recordCursorCloudLifecycleRun({
			agentId: "bc-agent-1",
			runId: "run-1",
			branches: [{ repoUrl: "github.com/acme/repo", branch: hugeBranch, prUrl: hugePrUrl }],
		});

		const data = pi.appendEntry.mock.calls[0]?.[1] as { branches?: Array<{ branch?: string; prUrl?: string }> };
		expect(JSON.stringify(data).length).toBeLessThan(900);
		expect(data.branches?.[0]?.branch).not.toBe(hugeBranch);
		expect(data.branches?.[0]?.prUrl).not.toBe(hugePrUrl);
		expect(data.branches?.[0]?.branch).toContain("…");
		expect(data.branches?.[0]?.prUrl).toContain("…");

		const report = formatCursorCloudLifecycleList([lifecycleEntry("oversized", data as unknown as Record<string, unknown>)]);
		expect(report).not.toContain(hugeBranch);
		expect(report).not.toContain(hugePrUrl);
		expect(report.length).toBeLessThan(800);
	});

	it("caps list output for many recorded agents", () => {
		const entries = Array.from({ length: 30 }, (_, index) => recordEntry(`bc-agent-${index}`));
		const report = formatCursorCloudLifecycleList(entries);

		expect(report).toContain("bc-agent-0");
		expect(report).toContain("+5 more recorded agents");
		expect(report).not.toContain("bc-agent-29");
		expect(report.length).toBeLessThan(3000);
	});

	it("lists recorded non-deleted agents, ignores malformed entries, and hides deleted tombstones", () => {
		const report = formatCursorCloudLifecycleList([
			lifecycleEntry("malformed", {
				action: "record",
				runtime: "cloud",
				agentId: "bc-bad",
				runId: 7,
				timestamp: "2026-07-07T00:00:00.000Z",
				branches: [null],
			}),
			lifecycleEntry("mixed-arrays", {
				action: "record",
				runtime: "cloud",
				agentId: "bc-agent-3",
				runId: "run-3",
				timestamp: "2026-07-07T00:00:00.000Z",
				branches: [null, { repoUrl: 7 }, { repoUrl: "github.com/acme/repo", branch: "cursor/valid" }, "bad"],
				artifacts: [null, { path: 7 }, { path: "artifacts/valid.txt", updatedAt: "2026-07-07T00:00:00Z" }],
			}),
			recordEntry("bc-agent-1"),
			lifecycleEntry("archive-1", {
				action: "archive",
				runtime: "cloud",
				agentId: "bc-agent-1",
				timestamp: "2026-07-07T00:01:00.000Z",
			}),
			recordEntry("bc-agent-2"),
			lifecycleEntry("delete-2", {
				action: "delete",
				runtime: "cloud",
				agentId: "bc-agent-2",
				timestamp: "2026-07-07T00:02:00.000Z",
			}),
		]);

		expect(report).toContain("bc-agent-1 (archived)");
		expect(report).toContain("run run-1");
		expect(report).toContain("branch cursor/work");
		expect(report).toContain("bc-agent-3");
		expect(report).toContain("branch cursor/valid");
		expect(report).not.toContain("bc-agent-2");
		expect(report).not.toContain("bc-bad");
	});

	it("archives exactly one recorded bc- cloud agent and appends a tombstone", async () => {
		const archive = vi.fn().mockResolvedValue(undefined);
		const deleteAgent = vi.fn().mockResolvedValue(undefined);
		cloudLifecycleTestUtils.setSdkOperations({ archive, delete: deleteAgent });
		const pi = createPiHarness();
		registerCursorRuntimeControls(pi);

		await pi.runCommand("cursor-cloud", "archive bc-agent-1", { sessionManager: { getBranch: vi.fn(() => [recordEntry()]) } });

		expect(archive).toHaveBeenCalledTimes(1);
		expect(archive.mock.calls[0]?.[0]).toBe("bc-agent-1");
		expect(deleteAgent).not.toHaveBeenCalled();
		expect(pi.appendEntry).toHaveBeenCalledWith(CLOUD_LIFECYCLE_ENTRY_TYPE, expect.objectContaining({
			action: "archive",
			runtime: "cloud",
			agentId: "bc-agent-1",
		}));
	});

	it("deletes exactly one recorded bc- cloud agent only with --yes", async () => {
		const archive = vi.fn().mockResolvedValue(undefined);
		const deleteAgent = vi.fn().mockResolvedValue(undefined);
		cloudLifecycleTestUtils.setSdkOperations({ archive, delete: deleteAgent });
		const pi = createPiHarness();
		registerCursorRuntimeControls(pi);
		const branch = [recordEntry()];

		await pi.runCommand("cursor-cloud", "delete bc-agent-1", { sessionManager: { getBranch: vi.fn(() => branch) } });
		await pi.runCommand("cursor-cloud", "delete bc-agent-1 --yes", { sessionManager: { getBranch: vi.fn(() => branch) } });

		expect(deleteAgent).toHaveBeenCalledTimes(1);
		expect(deleteAgent.mock.calls[0]?.[0]).toBe("bc-agent-1");
		expect(pi.appendEntry).toHaveBeenCalledWith(CLOUD_LIFECYCLE_ENTRY_TYPE, expect.objectContaining({
			action: "delete",
			runtime: "cloud",
			agentId: "bc-agent-1",
		}));
	});

	it("rejects empty, non-cloud, wildcard, unrecorded, and bulk IDs before SDK calls", async () => {
		const archive = vi.fn().mockResolvedValue(undefined);
		const deleteAgent = vi.fn().mockResolvedValue(undefined);
		cloudLifecycleTestUtils.setSdkOperations({ archive, delete: deleteAgent });
		const pi = createPiHarness();
		registerCursorRuntimeControls(pi);
		const ctx = { sessionManager: { getBranch: vi.fn(() => [recordEntry()]) } };

		await pi.runCommand("cursor-cloud", "archive", ctx);
		await pi.runCommand("cursor-cloud", "archive local-agent-1", ctx);
		await pi.runCommand("cursor-cloud", "delete bc-* --yes", ctx);
		await pi.runCommand("cursor-cloud", "delete bc-agent-2 --yes", ctx);
		await pi.runCommand("cursor-cloud", "delete bc-agent-1 bc-agent-2 --yes", ctx);

		expect(archive).not.toHaveBeenCalled();
		expect(deleteAgent).not.toHaveBeenCalled();
		expect(pi.appendEntry).not.toHaveBeenCalled();
	});
});
