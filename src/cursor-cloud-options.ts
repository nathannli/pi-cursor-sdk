import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentModeOption, AgentOptions, ModelSelection } from "@cursor/sdk";
import type { CursorResolvedSdkConfig } from "./cursor-config.js";

export interface CursorCloudLocalState {
	insideGitRepo: boolean;
	dirty: boolean;
	unpushed: boolean;
}

export interface CursorCloudOptionsBuildResult {
	options: AgentOptions;
	forwardedEnvNames: string[];
}

export interface CursorCloudPreflightIssue {
	code:
		| "missing_repo"
		| "missing_branch"
		| "cloud_ack_required"
		| "context_handoff_required"
		| "local_state_not_allowed"
		| "env_from_files_not_implemented";
	message: string;
}

export interface CursorCloudPreflightResult {
	ok: boolean;
	issues: CursorCloudPreflightIssue[];
}

type GitRunner = (cwd: string, args: string[]) => string | undefined;

function git(cwd: string, args: string[]): string | undefined {
	try {
		return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return undefined;
	}
}

function hasGitMetadata(cwd: string): boolean {
	let current = cwd;
	while (true) {
		if (existsSync(join(current, ".git"))) return true;
		const parent = dirname(current);
		if (parent === current) return false;
		current = parent;
	}
}

export function inspectCursorCloudLocalState(cwd: string, runGit: GitRunner = git): CursorCloudLocalState {
	const insideGitRepo = runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
	if (insideGitRepo !== "true") {
		return hasGitMetadata(cwd)
			? { insideGitRepo: true, dirty: true, unpushed: true }
			: { insideGitRepo: false, dirty: false, unpushed: false };
	}
	const status = runGit(cwd, ["status", "--porcelain=v1"]);
	const dirty = status === undefined || status.length > 0;
	const hasHead = runGit(cwd, ["rev-parse", "--verify", "HEAD"]) !== undefined;
	const upstream = runGit(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
	const ahead = upstream ? runGit(cwd, ["rev-list", "--count", "@{upstream}..HEAD"]) : undefined;
	const aheadCount = ahead === undefined ? Number.NaN : Number(ahead);
	const unpushed = hasHead && (!upstream || !Number.isFinite(aheadCount) || aheadCount > 0);
	return { insideGitRepo: true, dirty, unpushed };
}

export function buildCursorCloudAgentOptions(options: {
	apiKey: string;
	modelSelection: ModelSelection;
	agentMode: AgentModeOption;
	resolvedConfig: CursorResolvedSdkConfig;
	env?: Record<string, string | undefined>;
	name?: string;
}): CursorCloudOptionsBuildResult {
	const { resolvedConfig } = options;
	const env = options.env ?? process.env;
	const envVars = Object.fromEntries(
		resolvedConfig.cloud.envNames.value.flatMap((name) => {
			const value = env[name];
			return value === undefined ? [] : [[name, value]];
		}),
	);
	const cloud = {
		...(resolvedConfig.cloud.repo.value
			? {
					repos: [
						{
							url: resolvedConfig.cloud.repo.value,
							...(resolvedConfig.cloud.branch.value ? { startingRef: resolvedConfig.cloud.branch.value } : {}),
						},
					],
				}
			: {}),
		...(resolvedConfig.cloud.directPush.value ? { workOnCurrentBranch: true } : {}),
		...(Object.keys(envVars).length > 0 ? { envVars } : {}),
	};
	return {
		options: {
			apiKey: options.apiKey,
			model: options.modelSelection,
			mode: options.agentMode,
			...(options.name ? { name: options.name } : {}),
			cloud,
		},
		forwardedEnvNames: Object.keys(envVars).sort(),
	};
}

export function preflightCursorCloudRuntime(options: {
	resolvedConfig: CursorResolvedSdkConfig;
	localState?: CursorCloudLocalState;
	hasPriorContext?: boolean;
}): CursorCloudPreflightResult {
	const { resolvedConfig } = options;
	const issues: CursorCloudPreflightIssue[] = [];
	if (!resolvedConfig.cloud.acknowledged.value) {
		issues.push({
			code: "cloud_ack_required",
			message: "Cursor cloud runtime requires first-use acknowledgement; run /cursor-runtime cloud in an interactive session or pass --cursor-cloud-ack / PI_CURSOR_CLOUD_ACK=1.",
		});
	}
	if (!resolvedConfig.cloud.repo.value) {
		issues.push({
			code: "missing_repo",
			message: "Cursor cloud runtime requires --cursor-cloud-repo or PI_CURSOR_CLOUD_REPO.",
		});
	}
	if (!resolvedConfig.cloud.branch.value) {
		issues.push({
			code: "missing_branch",
			message: "Cursor cloud runtime requires --cursor-cloud-branch or PI_CURSOR_CLOUD_BRANCH.",
		});
	}
	if (options.hasPriorContext && resolvedConfig.cloud.contextHandoff.value === "never") {
		issues.push({
			code: "context_handoff_required",
			message: "Cursor cloud runtime needs --cursor-cloud-context=fresh or --cursor-cloud-context=bootstrap for sessions with prior pi context.",
		});
	}
	if (
		options.localState?.insideGitRepo &&
		(options.localState.dirty || options.localState.unpushed) &&
		!resolvedConfig.cloud.allowLocalState.value
	) {
		issues.push({
			code: "local_state_not_allowed",
			message: "Cursor cloud runtime cannot see dirty or unpushed local state; pass --cursor-cloud-allow-local-state only after accepting that risk.",
		});
	}
	if (resolvedConfig.cloud.envFromFiles.value) {
		issues.push({
			code: "env_from_files_not_implemented",
			message: "Cursor cloud env file forwarding is not implemented; pass explicit --cursor-cloud-env names or use Cursor-native environment setup.",
		});
	}
	return { ok: issues.length === 0, issues };
}

export function formatCursorCloudPreflightError(result: CursorCloudPreflightResult): string {
	const details = result.issues.map((issue) => `- ${issue.message}`).join("\n");
	return `Cursor cloud runtime is not ready to start.\n${details}\nUse --cursor-runtime local or /cursor-runtime local to run with the local Cursor SDK agent.`;
}
