import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	registerCursorCloudLifecycleLedger,
	runCursorCloudLifecycleCommand,
} from "./cursor-cloud-lifecycle.js";
import {
	CURSOR_AUTO_REVIEW_ENV,
	CURSOR_CLOUD_ACK_ENV,
	CURSOR_CLOUD_ALLOW_LOCAL_STATE_ENV,
	CURSOR_CLOUD_AUTO_CREATE_PR_ENV,
	CURSOR_CLOUD_BRANCH_ENV,
	CURSOR_CLOUD_CONTEXT_ENV,
	CURSOR_CLOUD_DIRECT_PUSH_ENV,
	CURSOR_CLOUD_ENV_ENV,
	CURSOR_CLOUD_ENV_FROM_FILES_ENV,
	CURSOR_CLOUD_ENV_NAME_ENV,
	CURSOR_CLOUD_ENV_TYPE_ENV,
	CURSOR_CLOUD_REPO_ENV,
	CURSOR_CLOUD_SKIP_REVIEWER_REQUEST_ENV,
	CURSOR_LOCAL_FORCE_ENV,
	CURSOR_LOCAL_RESUME_ENV,
	CURSOR_RUNTIME_ENV,
	CURSOR_SANDBOX_ENV,
	getCursorSdkProjectConfigPath,
	getCursorSdkUserConfigPath,
	loadCursorSdkConfig,
	mergeCursorSdkConfigForUpdate,
	parseCursorSdkConfig,
	parseExplicitCursorCloudEnvNames,
	resolveCursorSdkConfig,
	updateCursorSdkConfig,
	type CursorExplicitSdkConfig,
	type CursorResolvedSdkConfig,
	type CursorResolvedSetting,
	type CursorRuntime,
	type CursorSdkConfig,
} from "./cursor-config.js";
import { asRecord } from "./cursor-record-utils.js";
import { getCursorSessionCwd, getCursorSessionProjectTrusted } from "./cursor-session-scope.js";

export const CURSOR_RUNTIME_ENTRY_TYPE = "cursor-runtime-state";

export const CURSOR_CLOUD_ACK_DISCLOSURE = [
	"Cursor Cloud executes this work remotely.",
	"Fresh context is used by default; prior Pi context is included only with explicit bootstrap opt-in.",
	"Pi-local tools and the Pi bridge are unavailable, and Pi environment variables are not forwarded.",
	"Cursor may create branches, commit, push, and open pull requests.",
	"Cloud agents remain until you archive or delete them.",
	"Cloud Agents run in Max Mode, are billed at Cursor API pricing, and may require spend-limit setup.",
].join("\n\n");

interface CursorRuntimeEntryData {
	runtime: CursorRuntime;
	cloudAcknowledged?: boolean;
}

export type CursorRuntimeStateExtensionApi = Pick<
	ExtensionAPI,
	"appendEntry" | "getFlag" | "registerFlag" | "registerCommand" | "on"
>;

type CursorRuntimeContext = Pick<ExtensionContext, "cwd">;

type CursorStatusRefresh = (ctx: ExtensionContext) => void;

let cliAutoReview = false;
let cliSandbox = false;
let cliLocalForce = false;
let cliLocalForceConsumed = false;
let cliLocalResume = false;
let cliNoLocalResume = false;
let envLocalForceConsumed = false;
let cliCursorRuntime: string | undefined;
let cliCursorCloudRepo: string | undefined;
let cliCursorCloudBranch: string | undefined;
let cliCursorCloudContext: string | undefined;
let cliCursorCloudDirectPush = false;
let cliCursorCloudAutoCreatePR = false;
let cliCursorCloudSkipReviewerRequest = false;
let cliCursorCloudAllowLocalState = false;
let cliCursorCloudEnv: string | undefined;
let cliCursorCloudEnvFromFiles = false;
let cliCursorCloudEnvType: string | undefined;
let cliCursorCloudEnvName: string | undefined;
let cliCursorCloudAck = false;
let sessionCursorRuntime: CursorRuntime | undefined;
let sessionCursorCloudAcknowledged = false;

function isCursorRuntimeEntryData(value: unknown): value is CursorRuntimeEntryData {
	const record = asRecord(value);
	if (!record) return false;
	return (record.runtime === "local" || record.runtime === "cloud")
		&& (record.cloudAcknowledged === undefined || typeof record.cloudAcknowledged === "boolean");
}

function stringFlagValue(value: boolean | string | undefined): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function getCursorCliConfig(): CursorExplicitSdkConfig {
	const parsed = parseCursorSdkConfig({
		cloud: {
			repo: cliCursorCloudRepo,
			branch: cliCursorCloudBranch,
			...(cliCursorCloudDirectPush ? { directPush: true } : {}),
			...(cliCursorCloudAutoCreatePR ? { autoCreatePR: true } : {}),
			...(cliCursorCloudSkipReviewerRequest ? { skipReviewerRequest: true } : {}),
			...(cliCursorCloudAllowLocalState ? { allowLocalState: true } : {}),
			envNames: parseExplicitCursorCloudEnvNames(cliCursorCloudEnv, "--cursor-cloud-env"),
			...(cliCursorCloudEnvFromFiles ? { envFromFiles: true } : {}),
			environment: {
				type: cliCursorCloudEnvType,
				name: cliCursorCloudEnvName,
			},
			...(cliCursorCloudAck ? { acknowledged: true } : {}),
		},
		local: {
			...(cliAutoReview ? { autoReview: true } : {}),
			...(cliSandbox ? { sandboxOptions: { enabled: true } } : {}),
			...(cliLocalForce ? { force: true } : {}),
			...(cliNoLocalResume ? { resume: false } : cliLocalResume ? { resume: true } : {}),
		},
	}) ?? {};
	return {
		...parsed,
		...(cliCursorRuntime ? { runtime: cliCursorRuntime } : {}),
		...(cliCursorCloudContext
			? { cloud: { ...parsed.cloud, contextHandoff: cliCursorCloudContext } }
			: {}),
	};
}

export function getCursorSessionConfig(): CursorSdkConfig {
	return sessionCursorRuntime
		? {
				runtime: sessionCursorRuntime,
				...(sessionCursorCloudAcknowledged ? { cloud: { acknowledged: true } } : {}),
			}
		: {};
}

export function resolveEffectiveCursorConfig(options: {
	cwd: string;
	projectTrusted?: boolean;
}): CursorResolvedSdkConfig {
	const loadedConfig = loadCursorSdkConfig({ cwd: options.cwd, projectTrusted: options.projectTrusted === true });
	return resolveCursorSdkConfig({
		cli: getCursorCliConfig(),
		session: getCursorSessionConfig(),
		user: loadedConfig.user,
		project: loadedConfig.project,
	});
}

export function resolveEffectiveCursorConfigForContext(ctx: CursorRuntimeContext): CursorResolvedSdkConfig {
	return resolveEffectiveCursorConfig({
		cwd: ctx.cwd,
		projectTrusted: getCursorSessionCwd() === ctx.cwd && getCursorSessionProjectTrusted(),
	});
}

export type CursorRuntimeResolution =
	| { kind: "valid"; runtime: CursorResolvedSetting<CursorRuntime> }
	| { kind: "invalid"; message: string };

export function resolveCursorStatusRuntime(ctx: CursorRuntimeContext): CursorRuntimeResolution {
	try {
		return { kind: "valid", runtime: resolveEffectiveCursorConfigForContext(ctx).runtime };
	} catch (error) {
		return { kind: "invalid", message: error instanceof Error ? error.message : String(error) };
	}
}

export function formatResolvedCursorRuntime(runtime: CursorResolvedSetting<CursorRuntime>): string {
	const cap = runtime.cappedBy;
	return cap
		? `${runtime.value} (source: ${runtime.source} safety cap over ${cap.cappedSource} ${cap.cappedValue})`
		: `${runtime.value} (source: ${runtime.source})`;
}

export function formatCursorStatus(
	runtime: CursorRuntime | "invalid",
	fast: boolean | undefined,
	mode: "agent" | "plan" | "invalid",
): string {
	const parts = [`cursor:${runtime}`, fast === true ? "fast:on" : fast === false ? "fast:off" : "fast:n/a"];
	if (mode === "invalid") parts.push("mode invalid");
	else if (mode === "plan") parts.push("plan");
	return parts.join(" · ");
}

export function consumeCursorLocalForceOverride(resolved: { value: boolean; source: string }): boolean {
	if (!resolved.value) return false;
	if (resolved.source === "cli" && !cliLocalForceConsumed) {
		cliLocalForce = false;
		cliLocalForceConsumed = true;
		return true;
	}
	if (resolved.source === "environment" && !envLocalForceConsumed) {
		envLocalForceConsumed = true;
		return true;
	}
	return false;
}

export function restoreSessionCursorRuntimeState(branch: readonly SessionEntry[]): void {
	sessionCursorRuntime = undefined;
	sessionCursorCloudAcknowledged = false;
	for (const entry of branch) {
		if (entry.type !== "custom" || entry.customType !== CURSOR_RUNTIME_ENTRY_TYPE) continue;
		if (isCursorRuntimeEntryData(entry.data)) {
			sessionCursorRuntime = entry.data.runtime;
			sessionCursorCloudAcknowledged ||= entry.data.cloudAcknowledged === true;
		}
	}
}

export function restoreCursorCliState(pi: Pick<ExtensionAPI, "getFlag">): void {
	cliAutoReview = pi.getFlag("cursor-auto-review") === true;
	cliSandbox = pi.getFlag("cursor-sandbox") === true;
	cliLocalForce = !cliLocalForceConsumed && pi.getFlag("cursor-local-force") === true;
	cliLocalResume = pi.getFlag("cursor-local-resume") === true;
	cliNoLocalResume = pi.getFlag("cursor-no-local-resume") === true;
	cliCursorRuntime = stringFlagValue(pi.getFlag("cursor-runtime"));
	cliCursorCloudRepo = stringFlagValue(pi.getFlag("cursor-cloud-repo"));
	cliCursorCloudBranch = stringFlagValue(pi.getFlag("cursor-cloud-branch"));
	cliCursorCloudContext = stringFlagValue(pi.getFlag("cursor-cloud-context"));
	cliCursorCloudDirectPush = pi.getFlag("cursor-cloud-direct-push") === true;
	cliCursorCloudAutoCreatePR = pi.getFlag("cursor-cloud-auto-create-pr") === true;
	cliCursorCloudSkipReviewerRequest = pi.getFlag("cursor-cloud-skip-reviewer-request") === true;
	cliCursorCloudAllowLocalState = pi.getFlag("cursor-cloud-allow-local-state") === true;
	cliCursorCloudEnv = stringFlagValue(pi.getFlag("cursor-cloud-env"));
	cliCursorCloudEnvFromFiles = pi.getFlag("cursor-cloud-env-from-files") === true;
	cliCursorCloudEnvType = stringFlagValue(pi.getFlag("cursor-cloud-env-type"));
	cliCursorCloudEnvName = stringFlagValue(pi.getFlag("cursor-cloud-env-name"));
	cliCursorCloudAck = pi.getFlag("cursor-cloud-ack") === true;
}

function persistCursorRuntimePreference(
	pi: Pick<ExtensionAPI, "appendEntry">,
	runtime: CursorRuntime,
	cloudAcknowledged = false,
): void {
	const acknowledged = sessionCursorCloudAcknowledged || cloudAcknowledged;
	pi.appendEntry<CursorRuntimeEntryData>(CURSOR_RUNTIME_ENTRY_TYPE, {
		runtime,
		...(acknowledged ? { cloudAcknowledged: true } : {}),
	});
	sessionCursorRuntime = runtime;
	sessionCursorCloudAcknowledged = acknowledged;
}

function registerCursorRuntimeFlags(pi: Pick<ExtensionAPI, "registerFlag">): void {
	pi.registerFlag("cursor-runtime", {
		description: `Select Cursor runtime for this run: local or cloud (or set ${CURSOR_RUNTIME_ENV})`,
		type: "string",
		default: "",
	});
	pi.registerFlag("cursor-cloud-repo", {
		description: `Set Cursor cloud repository URL for this run (or set ${CURSOR_CLOUD_REPO_ENV})`,
		type: "string",
		default: "",
	});
	pi.registerFlag("cursor-cloud-branch", {
		description: `Set Cursor cloud branch/ref for this run (or set ${CURSOR_CLOUD_BRANCH_ENV})`,
		type: "string",
		default: "",
	});
	pi.registerFlag("cursor-cloud-context", {
		description: `Set Cursor cloud context handoff: never, fresh, or bootstrap (or set ${CURSOR_CLOUD_CONTEXT_ENV})`,
		type: "string",
		default: "",
	});
	pi.registerFlag("cursor-cloud-direct-push", {
		description: `Allow Cursor cloud direct push for this run (or set ${CURSOR_CLOUD_DIRECT_PUSH_ENV}=1)`,
		type: "boolean",
		default: false,
	});
	pi.registerFlag("cursor-cloud-auto-create-pr", {
		description: `Ask Cursor cloud to create a pull request for this run (or set ${CURSOR_CLOUD_AUTO_CREATE_PR_ENV}=1)`,
		type: "boolean",
		default: false,
	});
	pi.registerFlag("cursor-cloud-skip-reviewer-request", {
		description: `Ask Cursor cloud not to request you as a reviewer for this run (or set ${CURSOR_CLOUD_SKIP_REVIEWER_REQUEST_ENV}=1)`,
		type: "boolean",
		default: false,
	});
	pi.registerFlag("cursor-cloud-allow-local-state", {
		description: `Allow Cursor cloud to proceed with local-only state for this run (or set ${CURSOR_CLOUD_ALLOW_LOCAL_STATE_ENV}=1)`,
		type: "boolean",
		default: false,
	});
	pi.registerFlag("cursor-cloud-env", {
		description: `Reserved Cursor cloud env var names; env forwarding is not implemented yet (or set ${CURSOR_CLOUD_ENV_ENV})`,
		type: "string",
		default: "",
	});
	pi.registerFlag("cursor-cloud-env-from-files", {
		description: `Reserved Cursor cloud env-file forwarding flag; not implemented yet (or set ${CURSOR_CLOUD_ENV_FROM_FILES_ENV}=1)`,
		type: "boolean",
		default: false,
	});
	pi.registerFlag("cursor-cloud-env-type", {
		description: `Select Cursor-managed cloud environment type: cloud, pool, or machine (or set ${CURSOR_CLOUD_ENV_TYPE_ENV})`,
		type: "string",
		default: "",
	});
	pi.registerFlag("cursor-cloud-env-name", {
		description: `Select Cursor-managed cloud environment name (or set ${CURSOR_CLOUD_ENV_NAME_ENV})`,
		type: "string",
		default: "",
	});
	pi.registerFlag("cursor-cloud-ack", {
		description: `Acknowledge first-use Cursor cloud runtime risks for this run (or set ${CURSOR_CLOUD_ACK_ENV}=1)`,
		type: "boolean",
		default: false,
	});
	pi.registerFlag("cursor-auto-review", {
		description: `Enable Cursor SDK local Auto-review for this run (or set ${CURSOR_AUTO_REVIEW_ENV}=1)`,
		type: "boolean",
		default: false,
	});
	pi.registerFlag("cursor-sandbox", {
		description: `Enable Cursor SDK local sandboxing for this run (or set ${CURSOR_SANDBOX_ENV}=1)`,
		type: "boolean",
		default: false,
	});
	pi.registerFlag("cursor-local-force", {
		description: `Force-expire a stuck local Cursor SDK run before sending this run (or set ${CURSOR_LOCAL_FORCE_ENV}=1)`,
		type: "boolean",
		default: false,
	});
	pi.registerFlag("cursor-local-resume", {
		description: `Resume recorded local Cursor SDK agents for matching pi session branches (default; or set ${CURSOR_LOCAL_RESUME_ENV}=1)`,
		type: "boolean",
		default: false,
	});
	pi.registerFlag("cursor-no-local-resume", {
		description: `Disable local Cursor SDK agent resume for this run (or set ${CURSOR_LOCAL_RESUME_ENV}=0)`,
		type: "boolean",
		default: false,
	});
}

async function confirmCloudAcknowledgement(
	ctx: Pick<ExtensionContext, "hasUI" | "ui">,
	alreadyAcknowledged: boolean,
): Promise<boolean> {
	if (alreadyAcknowledged) return true;
	if (!ctx.hasUI) {
		ctx.ui.notify(
			`Cursor cloud runtime requires first-use acknowledgement. Pass --cursor-cloud-ack or set ${CURSOR_CLOUD_ACK_ENV}=1, then retry.`,
			"error",
		);
		return false;
	}
	const confirmed = await ctx.ui.confirm("Enable Cursor Cloud runtime?", CURSOR_CLOUD_ACK_DISCLOSURE);
	if (!confirmed) ctx.ui.notify("Cursor cloud runtime change cancelled; no settings were written.", "info");
	return confirmed;
}

function registerCursorRuntimeCommand(
	pi: Pick<ExtensionAPI, "appendEntry" | "registerCommand">,
	refreshStatus: CursorStatusRefresh,
): void {
	pi.registerCommand("cursor-runtime", {
		description: "Set Cursor runtime for this session: local or cloud",
		handler: async (args, ctx) => {
			const usage = "Usage: /cursor-runtime local|cloud [--save-user|--save-project]";
			const tokens = args.trim().split(/\s+/).filter(Boolean);
			const raw = tokens[0];
			const saveUser = tokens.includes("--save-user");
			const saveProject = tokens.includes("--save-project");
			const extra = tokens.slice(1).filter((token) => token !== "--save-user" && token !== "--save-project");
			const currentResolution = resolveCursorStatusRuntime(ctx);
			if (!raw) {
				ctx.ui.notify(
					currentResolution.kind === "invalid"
						? `${currentResolution.message} ${usage}`
						: `Cursor runtime is ${formatResolvedCursorRuntime(currentResolution.runtime)}. ${usage}`,
					currentResolution.kind === "invalid" ? "error" : "info",
				);
				return;
			}
			if ((raw !== "local" && raw !== "cloud") || extra.length > 0 || (saveUser && saveProject)) {
				ctx.ui.notify(`Invalid Cursor runtime arguments. ${usage}`, "error");
				return;
			}
			if (currentResolution.kind === "invalid") {
				ctx.ui.notify(`${currentResolution.message} Fix the explicit override before changing the session runtime.`, "error");
				return;
			}
			if (saveProject && (getCursorSessionCwd() !== ctx.cwd || !getCursorSessionProjectTrusted())) {
				ctx.ui.notify(
					"Cannot save Cursor project config without explicit project-trust provenance. Ensure .pi/settings.json or another Pi project resource exists, trust the project, then restart pi; or restart with --approve. Project-local package installs must use --approve on every run that reads or writes .pi/cursor-sdk.json.",
					"error",
				);
				return;
			}
			const cloudAcknowledged = raw === "cloud" && await confirmCloudAcknowledgement(
				ctx,
				resolveEffectiveCursorConfigForContext(ctx).cloud.acknowledged.value,
			);
			if (raw === "cloud" && !cloudAcknowledged) return;
			if (saveUser || saveProject) {
				try {
					if (saveUser) {
						updateCursorSdkConfig(
							getCursorSdkUserConfigPath(),
							(current) => mergeCursorSdkConfigForUpdate(current, {
								runtime: raw,
								...(cloudAcknowledged ? { cloud: { acknowledged: true } } : {}),
							}),
							{ newFileMode: 0o600 },
						);
					} else {
						updateCursorSdkConfig(
							getCursorSdkProjectConfigPath(ctx.cwd),
							(current) => mergeCursorSdkConfigForUpdate(current, { runtime: raw }),
						);
					}
				} catch (error) {
					const effectiveResolution = resolveCursorStatusRuntime(ctx);
					refreshStatus(ctx);
					const effective = effectiveResolution.kind === "valid"
						? ` Effective runtime remains ${formatResolvedCursorRuntime(effectiveResolution.runtime)}.`
						: ` ${effectiveResolution.message}`;
					ctx.ui.notify(
						`Failed to save Cursor runtime preference to ${saveUser ? "user" : "project"} config: ${error instanceof Error ? error.message : String(error)}.${effective}`,
						"error",
					);
					return;
				}
			}
			try {
				persistCursorRuntimePreference(pi, raw, cloudAcknowledged);
			} catch (error) {
				const effectiveResolution = resolveCursorStatusRuntime(ctx);
				refreshStatus(ctx);
				const effective = effectiveResolution.kind === "valid"
					? ` Effective runtime is ${formatResolvedCursorRuntime(effectiveResolution.runtime)}.`
					: ` ${effectiveResolution.message}`;
				const persisted = saveUser
					? "User config was saved, but persisting the session runtime entry failed."
					: saveProject
						? "Project config was saved, but persisting the session runtime entry failed."
						: "Persisting the session runtime entry failed.";
				ctx.ui.notify(
					`${persisted} ${error instanceof Error ? error.message : String(error)}.${effective}`,
					"error",
				);
				return;
			}
			const effectiveResolution = resolveCursorStatusRuntime(ctx);
			refreshStatus(ctx);
			const saved = saveUser
				? " Saved to user config."
				: saveProject
					? " Saved to project config; cloud acknowledgement remains session/user-scoped."
					: "";
			const effective = effectiveResolution.kind === "valid"
				? ` Effective runtime is ${formatResolvedCursorRuntime(effectiveResolution.runtime)}.`
				: ` ${effectiveResolution.message}`;
			ctx.ui.notify(
				raw === "cloud"
					? `Cursor runtime request saved for this session and cloud risk acknowledged.${effective}${saved}`
					: `Cursor runtime request saved for this session.${effective}${saved}`,
				"info",
			);
		},
	});
}

export function registerCursorCloudRuntimeControls(
	pi: CursorRuntimeStateExtensionApi,
	options: { refreshStatus: CursorStatusRefresh },
): void {
	registerCursorCloudLifecycleLedger(pi);
	registerCursorRuntimeFlags(pi);
	registerCursorRuntimeCommand(pi, options.refreshStatus);
	pi.registerCommand("cursor-cloud", {
		description: "List, archive, or delete recorded Cursor cloud agents for this session branch",
		handler: async (args, ctx) => {
			await runCursorCloudLifecycleCommand(pi, args, ctx);
		},
	});
}

export function resetCursorRuntimeStateForTests(): void {
	cliAutoReview = false;
	cliSandbox = false;
	cliLocalForce = false;
	cliLocalForceConsumed = false;
	cliLocalResume = false;
	cliNoLocalResume = false;
	envLocalForceConsumed = false;
	cliCursorRuntime = undefined;
	cliCursorCloudRepo = undefined;
	cliCursorCloudBranch = undefined;
	cliCursorCloudContext = undefined;
	cliCursorCloudDirectPush = false;
	cliCursorCloudAutoCreatePR = false;
	cliCursorCloudSkipReviewerRequest = false;
	cliCursorCloudAllowLocalState = false;
	cliCursorCloudEnv = undefined;
	cliCursorCloudEnvFromFiles = false;
	cliCursorCloudEnvType = undefined;
	cliCursorCloudEnvName = undefined;
	cliCursorCloudAck = false;
	sessionCursorRuntime = undefined;
	sessionCursorCloudAcknowledged = false;
}
