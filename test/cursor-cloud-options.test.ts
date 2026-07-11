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
					environment: { type: "pool", name: "large-linux" },
				},
			},
		});

		const result = buildCursorCloudAgentOptions({
			apiKey: "test-key",
			modelSelection: { id: "composer-2.5" },
			agentMode: "agent",
			resolvedConfig,
			name: "pi session",
		});

		expect(result).toEqual({
			apiKey: "test-key",
			model: { id: "composer-2.5" },
			mode: "agent",
			name: "pi session",
			cloud: {
				env: { type: "pool", name: "large-linux" },
				repos: [{ url: "https://github.com/example/repo.git", startingRef: "feature/demo" }],
				workOnCurrentBranch: true,
			},
		});
		expect(result).not.toHaveProperty("local");
		expect(result).not.toHaveProperty("mcpServers");
		expect(result).not.toHaveProperty("agentId");
	});

	it.each([
		{ directPush: false, label: "branch-only" },
		{ directPush: true, label: "branch plus direct push" },
	])("fails closed for $label config without a repo", ({ directPush }) => {
		const result = preflightCursorCloudRuntime({
			resolvedConfig: resolveCursorSdkConfig({
				cli: {
					runtime: "cloud",
					cloud: { acknowledged: true, branch: "feature/demo", directPush },
				},
			}),
		});

		expect(result.ok).toBe(false);
		expect(result.issues.map((issue) => issue.code)).toEqual(["cloud_branch_repo_required"]);
		expect(formatCursorCloudPreflightError(result)).toContain("startingRef only on cloud.repos entries");
	});

	it("accepts a branch when its repo is configured", () => {
		const result = preflightCursorCloudRuntime({
			resolvedConfig: resolveCursorSdkConfig({
				cli: {
					runtime: "cloud",
					cloud: {
						acknowledged: true,
						repo: "https://github.com/example/repo.git",
						branch: "feature/demo",
					},
				},
			}),
		});

		expect(result).toEqual({ ok: true, issues: [] });
	});

	it.each([
		"https://user:secret@example.com/org/repo.git",
		"http://example.com/org/repo.git",
		"https://example.com/org/repo.git?token=secret",
		"git@example.com:org/repo.git",
	])("rejects unsafe cloud repository URL %s without echoing it", (repo) => {
		const resolvedConfig = resolveCursorSdkConfig({
			cli: { runtime: "cloud", cloud: { acknowledged: true, repo } },
		});
		const result = preflightCursorCloudRuntime({ resolvedConfig });
		const message = formatCursorCloudPreflightError(result);

		expect(result.issues.map((issue) => issue.code)).toEqual(["cloud_repo_invalid"]);
		expect(message).toContain("HTTPS repository URL without embedded credentials");
		expect(message).not.toContain(repo);
		expect(() => buildCursorCloudAgentOptions({
			apiKey: "test-key",
			modelSelection: { id: "composer-2.5" },
			agentMode: "agent",
			resolvedConfig,
		})).toThrow("HTTPS repository URL without embedded credentials");
	});

	it("fails closed with exact remediation for missing safety choices and disabled env forwarding", () => {
		const result = preflightCursorCloudRuntime({
			resolvedConfig: resolveCursorSdkConfig({
				cli: { runtime: "cloud", cloud: { envNames: ["SAFE_FLAG"], envFromFiles: true } },
				user: { cloud: { contextHandoff: "never" } },
			}),
			hasPriorContext: true,
			localState: { insideGitRepo: true, dirty: true, unpushed: true },
		});

		expect(result.ok).toBe(false);
		expect(result.issues.map((issue) => issue.code)).toEqual([
			"cloud_ack_required",
			"context_handoff_required",
			"local_state_not_allowed",
			"env_forwarding_not_implemented",
		]);
		expect(formatCursorCloudPreflightError(result)).toContain(".cursor/environment.json");
		expect(formatCursorCloudPreflightError(result)).toContain("--cursor-runtime local");
	});

	it("fails closed when a cloud environment name is supplied without a type", () => {
		const result = preflightCursorCloudRuntime({
			resolvedConfig: resolveCursorSdkConfig({
				cli: { runtime: "cloud", cloud: { acknowledged: true, allowLocalState: true, environment: { name: "gpu-pool" } } },
			}),
		});

		expect(result.ok).toBe(false);
		expect(result.issues.map((issue) => issue.code)).toEqual(["cloud_environment_type_required"]);
		expect(formatCursorCloudPreflightError(result)).toContain("--cursor-cloud-env-type");
	});

	it("fails closed when a named Cursor cloud environment is combined with an explicit repo", () => {
		const result = preflightCursorCloudRuntime({
			resolvedConfig: resolveCursorSdkConfig({
				cli: {
					runtime: "cloud",
					cloud: {
						acknowledged: true,
						allowLocalState: true,
						repo: "https://github.com/example/repo.git",
						environment: { type: "cloud", name: "dashboard-env" },
					},
				},
			}),
		});

		expect(result.ok).toBe(false);
		expect(result.issues.map((issue) => issue.code)).toEqual(["cloud_environment_repo_conflict"]);
		expect(formatCursorCloudPreflightError(result)).toContain("cannot be combined with --cursor-cloud-repo");
	});

	it("fails closed when a cloud environment type is invalid", () => {
		const result = preflightCursorCloudRuntime({
			resolvedConfig: resolveCursorSdkConfig({
				env: { PI_CURSOR_CLOUD_ENV_TYPE: " poll " },
				cli: { runtime: "cloud", cloud: { acknowledged: true, allowLocalState: true } },
			}),
		});

		expect(result.ok).toBe(false);
		expect(result.issues.map((issue) => issue.code)).toEqual(["cloud_environment_type_invalid"]);
		expect(formatCursorCloudPreflightError(result)).toContain('Invalid Cursor cloud environment type "poll"');
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
					cloud: { allowLocalState: true, acknowledged: true },
				},
			}),
			hasPriorContext: false,
			localState: { insideGitRepo: true, dirty: true, unpushed: true },
		});

		expect(result).toEqual({ ok: true, issues: [] });
	});
});
