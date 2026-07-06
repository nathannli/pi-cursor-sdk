import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveCursorSdkConfig } from "../src/cursor-config.js";
import {
	buildCursorCloudAgentOptions,
	formatCursorCloudPreflightError,
	inspectCursorCloudLocalState,
	preflightCursorCloudRuntime,
} from "../src/cursor-cloud-options.js";

function git(cwd: string, args: string[]): void {
	execFileSync("git", args, { cwd, stdio: "ignore" });
}

describe("Cursor cloud options", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "pi-cursor-cloud-options-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("builds cloud Agent options without local tools, MCP servers, or agent ids", () => {
		const resolvedConfig = resolveCursorSdkConfig({
			cli: {
				runtime: "cloud",
				cloud: {
					repo: "https://github.com/example/repo.git",
					branch: "feature/demo",
					directPush: true,
					envNames: ["SAFE_FLAG", "MISSING_FLAG"],
				},
			},
		});

		const result = buildCursorCloudAgentOptions({
			apiKey: "test-key",
			modelSelection: { id: "composer-2.5" },
			agentMode: "agent",
			resolvedConfig,
			env: { SAFE_FLAG: "enabled" },
			name: "pi session",
		});

		expect(result.forwardedEnvNames).toEqual(["SAFE_FLAG"]);
		expect(result.options).toEqual({
			apiKey: "test-key",
			model: { id: "composer-2.5" },
			mode: "agent",
			name: "pi session",
			cloud: {
				repos: [{ url: "https://github.com/example/repo.git", startingRef: "feature/demo" }],
				workOnCurrentBranch: true,
				envVars: { SAFE_FLAG: "enabled" },
			},
		});
		expect(result.options).not.toHaveProperty("local");
		expect(result.options).not.toHaveProperty("mcpServers");
		expect(result.options).not.toHaveProperty("agentId");
	});

	it("fails closed with exact remediation for missing choices and unsafe local state", () => {
		const result = preflightCursorCloudRuntime({
			resolvedConfig: resolveCursorSdkConfig({ cli: { runtime: "cloud", cloud: { envFromFiles: true } } }),
			hasPriorContext: true,
			localState: { insideGitRepo: true, dirty: true, unpushed: true },
		});

		expect(result.ok).toBe(false);
		expect(result.issues.map((issue) => issue.code)).toEqual([
			"missing_repo",
			"missing_branch",
			"context_handoff_required",
			"local_state_not_allowed",
			"env_from_files_not_implemented",
		]);
		expect(formatCursorCloudPreflightError(result)).toContain("--cursor-cloud-repo");
		expect(formatCursorCloudPreflightError(result)).toContain("--cursor-runtime local");
	});

	it("treats no-upstream commits and dirty files as local-only cloud state", () => {
		git(root, ["init"]);
		git(root, ["config", "user.email", "test@example.com"]);
		git(root, ["config", "user.name", "Test User"]);
		mkdirSync(join(root, "src"));
		writeFileSync(join(root, "src", "file.txt"), "base");
		git(root, ["add", "."]);
		git(root, ["commit", "-m", "base"]);
		appendFileSync(join(root, "src", "file.txt"), "dirty");

		expect(inspectCursorCloudLocalState(root)).toMatchObject({ insideGitRepo: true, dirty: true, unpushed: true });
	});

	it("fails closed when git state inside a repo is unknown", () => {
		const result = inspectCursorCloudLocalState(root, (_cwd, args) => {
			const key = args.join(" ");
			if (key === "rev-parse --is-inside-work-tree") return "true";
			if (key === "rev-parse --verify HEAD") return "abc123";
			if (key === "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") return "origin/main";
			return undefined;
		});

		expect(result).toEqual({ insideGitRepo: true, dirty: true, unpushed: true });
	});

	it("fails closed when git metadata exists but the root git probe fails", () => {
		mkdirSync(join(root, ".git"));

		expect(inspectCursorCloudLocalState(root, () => undefined)).toEqual({
			insideGitRepo: true,
			dirty: true,
			unpushed: true,
		});
	});

	it("does not require context handoff for a first cloud user prompt", () => {
		const result = preflightCursorCloudRuntime({
			resolvedConfig: resolveCursorSdkConfig({
				cli: {
					runtime: "cloud",
					cloud: { repo: "https://github.com/example/repo.git", branch: "main", allowLocalState: true },
				},
			}),
			hasPriorContext: false,
			localState: { insideGitRepo: true, dirty: true, unpushed: true },
		});

		expect(result).toEqual({ ok: true, issues: [] });
	});
});
