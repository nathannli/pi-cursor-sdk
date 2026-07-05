import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

export const CURSOR_SDK_CONFIG_FILE = "cursor-sdk.json";

export const CURSOR_RUNTIME_ENV = "PI_CURSOR_RUNTIME";
export const CURSOR_TOOL_TRANSPORT_ENV = "PI_CURSOR_TOOL_TRANSPORT";
export const CURSOR_CLOUD_CONTEXT_ENV = "PI_CURSOR_CLOUD_CONTEXT";
export const CURSOR_CLOUD_DIRECT_PUSH_ENV = "PI_CURSOR_CLOUD_DIRECT_PUSH";
export const CURSOR_AUTO_REVIEW_ENV = "PI_CURSOR_AUTO_REVIEW";
export const CURSOR_SANDBOX_ENV = "PI_CURSOR_SANDBOX";

export type CursorConfigSource = "cli" | "environment" | "project" | "user" | "session" | "model-alias" | "builtin";
export type CursorConfigTrustLevel = "one-shot" | "environment" | "trusted-project" | "user" | "session" | "model-catalog" | "builtin";
export type CursorRuntime = "local" | "cloud";
export type CursorToolTransport = "mcp" | "customTools";
export type CursorCloudContextHandoff = "never" | "fresh" | "bootstrap";

export interface CursorSdkConfig {
	fastDefaults?: Record<string, boolean>;
	runtime?: CursorRuntime;
	toolTransport?: CursorToolTransport;
	cloud?: {
		contextHandoff?: CursorCloudContextHandoff;
		directPush?: boolean;
	};
	local?: {
		autoReview?: boolean;
		sandbox?: boolean;
		sandboxOptions?: {
			enabled?: boolean;
		};
	};
}

export interface CursorSafetyCap<T> {
	source: CursorConfigSource;
	trustLevel: CursorConfigTrustLevel;
	value: T;
	cappedSource: CursorConfigSource;
	cappedValue: T;
	reason: "safer-source";
}

export interface CursorResolvedSetting<T> {
	value: T;
	source: CursorConfigSource;
	trustLevel: CursorConfigTrustLevel;
	cappedBy?: CursorSafetyCap<T>;
}

export interface CursorResolvedSdkConfig {
	runtime: CursorResolvedSetting<CursorRuntime>;
	toolTransport: CursorResolvedSetting<CursorToolTransport>;
	cloud: {
		contextHandoff: CursorResolvedSetting<CursorCloudContextHandoff>;
		directPush: CursorResolvedSetting<boolean>;
	};
	local: {
		autoReview: CursorResolvedSetting<boolean>;
		sandboxEnabled: CursorResolvedSetting<boolean>;
	};
}

export interface ResolveCursorSdkConfigOptions {
	cli?: CursorSdkConfig;
	env?: Record<string, string | undefined>;
	project?: CursorSdkConfig;
	user?: CursorSdkConfig;
	builtIn?: CursorSdkConfig;
}

export interface LoadCursorSdkConfigOptions {
	cwd?: string;
	projectTrusted?: boolean;
	agentDir?: string;
}

const TRUST_LEVELS: Record<CursorConfigSource, CursorConfigTrustLevel> = {
	cli: "one-shot",
	environment: "environment",
	project: "trusted-project",
	user: "user",
	session: "session",
	"model-alias": "model-catalog",
	builtin: "builtin",
};

const BUILT_IN_CURSOR_CONFIG: Required<Pick<CursorSdkConfig, "runtime" | "toolTransport">> & {
	cloud: Required<NonNullable<CursorSdkConfig["cloud"]>>;
} = {
	runtime: "local",
	toolTransport: "mcp",
	cloud: {
		contextHandoff: "never",
		directPush: false,
	},
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function isCursorRuntime(value: unknown): value is CursorRuntime {
	return value === "local" || value === "cloud";
}

function isCursorToolTransport(value: unknown): value is CursorToolTransport {
	return value === "mcp" || value === "customTools";
}

function isCursorCloudContextHandoff(value: unknown): value is CursorCloudContextHandoff {
	return value === "never" || value === "fresh" || value === "bootstrap";
}

function parseEnvBoolean(value: string | undefined): boolean | undefined {
	if (value === undefined) return undefined;
	const normalized = value.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "off"].includes(normalized)) return false;
	return undefined;
}

export function parseCursorSdkConfig(value: unknown): CursorSdkConfig | undefined {
	const record = asRecord(value);
	if (!record) return undefined;
	const config: CursorSdkConfig = {};

	if (isCursorRuntime(record.runtime)) config.runtime = record.runtime;
	if (isCursorToolTransport(record.toolTransport)) config.toolTransport = record.toolTransport;

	const fastDefaults = asRecord(record.fastDefaults);
	if (fastDefaults) {
		config.fastDefaults = Object.fromEntries(
			Object.entries(fastDefaults).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
		);
	}

	const cloud = asRecord(record.cloud);
	if (cloud) {
		const parsedCloud: NonNullable<CursorSdkConfig["cloud"]> = {};
		if (isCursorCloudContextHandoff(cloud.contextHandoff)) parsedCloud.contextHandoff = cloud.contextHandoff;
		if (typeof cloud.directPush === "boolean") parsedCloud.directPush = cloud.directPush;
		if (Object.keys(parsedCloud).length > 0) config.cloud = parsedCloud;
	}

	const local = asRecord(record.local);
	if (local) {
		const parsedLocal: NonNullable<CursorSdkConfig["local"]> = {};
		if (typeof local.autoReview === "boolean") parsedLocal.autoReview = local.autoReview;
		if (typeof local.sandbox === "boolean") parsedLocal.sandbox = local.sandbox;
		const sandboxOptions = asRecord(local.sandboxOptions);
		if (typeof sandboxOptions?.enabled === "boolean") parsedLocal.sandboxOptions = { enabled: sandboxOptions.enabled };
		if (Object.keys(parsedLocal).length > 0) config.local = parsedLocal;
	}

	return config;
}

export function getCursorSdkUserConfigPath(agentDir = getAgentDir()): string {
	return join(agentDir, CURSOR_SDK_CONFIG_FILE);
}

export function getCursorSdkProjectConfigPath(cwd: string, configDirName = CONFIG_DIR_NAME): string {
	return join(cwd, configDirName, CURSOR_SDK_CONFIG_FILE);
}

function readCursorSdkConfigFile(path: string): CursorSdkConfig {
	if (!existsSync(path)) return {};
	try {
		return parseCursorSdkConfig(JSON.parse(readFileSync(path, "utf-8"))) ?? {};
	} catch {
		return {};
	}
}

export function loadCursorSdkUserConfig(path = getCursorSdkUserConfigPath()): CursorSdkConfig {
	return readCursorSdkConfigFile(path);
}

export function loadCursorSdkProjectConfig(cwd: string, projectTrusted: boolean): CursorSdkConfig | undefined {
	if (!projectTrusted) return undefined;
	const path = getCursorSdkProjectConfigPath(cwd);
	return existsSync(path) ? readCursorSdkConfigFile(path) : undefined;
}

export function loadCursorSdkConfig(options: LoadCursorSdkConfigOptions = {}): { user: CursorSdkConfig; project?: CursorSdkConfig } {
	const user = loadCursorSdkUserConfig(getCursorSdkUserConfigPath(options.agentDir));
	const project = options.cwd ? loadCursorSdkProjectConfig(options.cwd, options.projectTrusted === true) : undefined;
	return project ? { user, project } : { user };
}

export function saveCursorSdkUserConfig(config: CursorSdkConfig, path = getCursorSdkUserConfigPath()): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export function cursorFastDefaultsFromConfig(config: CursorSdkConfig | undefined): Map<string, boolean> {
	return new Map(Object.entries(config?.fastDefaults ?? {}));
}

export function withCursorFastDefaults(config: CursorSdkConfig, fastDefaults: Map<string, boolean>): CursorSdkConfig {
	return {
		...config,
		fastDefaults: Object.fromEntries([...fastDefaults.entries()].sort(([a], [b]) => a.localeCompare(b))),
	};
}

function resolved<T>(source: CursorConfigSource, value: T, cappedBy?: CursorSafetyCap<T>): CursorResolvedSetting<T> {
	return { value, source, trustLevel: TRUST_LEVELS[source], ...(cappedBy ? { cappedBy } : {}) };
}

function valueFrom<T>(source: CursorConfigSource, value: T | undefined): CursorResolvedSetting<T> | undefined {
	return value === undefined ? undefined : resolved(source, value);
}

function resolveOrdinary<T>(layers: Array<CursorResolvedSetting<T> | undefined>): CursorResolvedSetting<T> {
	const match = layers.find((layer): layer is CursorResolvedSetting<T> => layer !== undefined);
	if (!match) throw new Error("Cursor config resolver missing built-in default");
	return match;
}

function resolveSafety<T>(
	baseLayers: Array<CursorResolvedSetting<T> | undefined>,
	capLayers: Array<CursorResolvedSetting<T> | undefined>,
	risk: (value: T) => number,
): CursorResolvedSetting<T> {
	const cli = baseLayers[0];
	if (cli) return cli;
	const base = resolveOrdinary(baseLayers.slice(1));
	const cap = capLayers
		.filter((layer): layer is CursorResolvedSetting<T> => layer !== undefined && risk(layer.value) < risk(base.value))
		.sort((a, b) => risk(a.value) - risk(b.value))[0];
	if (!cap) return base;
	return resolved(cap.source, cap.value, {
		source: cap.source,
		trustLevel: cap.trustLevel,
		value: cap.value,
		cappedSource: base.source,
		cappedValue: base.value,
		reason: "safer-source",
	});
}

export function cursorSdkConfigFromEnv(env: Record<string, string | undefined> = process.env): CursorSdkConfig {
	const config: CursorSdkConfig = {};
	const runtime = env[CURSOR_RUNTIME_ENV]?.trim();
	if (isCursorRuntime(runtime)) config.runtime = runtime;
	const toolTransport = env[CURSOR_TOOL_TRANSPORT_ENV]?.trim();
	if (isCursorToolTransport(toolTransport)) config.toolTransport = toolTransport;
	const contextHandoff = env[CURSOR_CLOUD_CONTEXT_ENV]?.trim();
	const directPush = parseEnvBoolean(env[CURSOR_CLOUD_DIRECT_PUSH_ENV]);
	if (isCursorCloudContextHandoff(contextHandoff) || directPush !== undefined) {
		config.cloud = {
			...(isCursorCloudContextHandoff(contextHandoff) ? { contextHandoff } : {}),
			...(directPush !== undefined ? { directPush } : {}),
		};
	}
	const autoReview = parseEnvBoolean(env[CURSOR_AUTO_REVIEW_ENV]);
	const sandbox = parseEnvBoolean(env[CURSOR_SANDBOX_ENV]);
	if (autoReview !== undefined || sandbox !== undefined) {
		config.local = {
			...(autoReview !== undefined ? { autoReview } : {}),
			...(sandbox !== undefined ? { sandboxOptions: { enabled: sandbox } } : {}),
		};
	}
	return config;
}

export function resolveCursorSdkConfig(options: ResolveCursorSdkConfigOptions = {}): CursorResolvedSdkConfig {
	const env = cursorSdkConfigFromEnv(options.env);
	const builtIn = {
		...BUILT_IN_CURSOR_CONFIG,
		...options.builtIn,
		cloud: { ...BUILT_IN_CURSOR_CONFIG.cloud, ...options.builtIn?.cloud },
	};
	const cli = options.cli;
	const project = options.project;
	const user = options.user;
	return {
		runtime: resolveOrdinary([
			valueFrom("cli", cli?.runtime),
			valueFrom("environment", env.runtime),
			valueFrom("project", project?.runtime),
			valueFrom("user", user?.runtime),
			valueFrom("builtin", builtIn.runtime),
		]),
		toolTransport: resolveOrdinary([
			valueFrom("cli", cli?.toolTransport),
			valueFrom("environment", env.toolTransport),
			valueFrom("project", project?.toolTransport),
			valueFrom("user", user?.toolTransport),
			valueFrom("builtin", builtIn.toolTransport),
		]),
		cloud: {
			contextHandoff: resolveSafety(
				[
					valueFrom("cli", cli?.cloud?.contextHandoff),
					valueFrom("environment", env.cloud?.contextHandoff),
					valueFrom("project", project?.cloud?.contextHandoff),
					valueFrom("user", user?.cloud?.contextHandoff),
					valueFrom("builtin", builtIn.cloud.contextHandoff),
				],
				[valueFrom("user", user?.cloud?.contextHandoff)],
				(value) => ({ never: 0, fresh: 1, bootstrap: 2 })[value],
			),
			directPush: resolveSafety(
				[
					valueFrom("cli", cli?.cloud?.directPush),
					valueFrom("environment", env.cloud?.directPush),
					valueFrom("project", project?.cloud?.directPush),
					valueFrom("user", user?.cloud?.directPush),
					valueFrom("builtin", builtIn.cloud.directPush),
				],
				[valueFrom("user", user?.cloud?.directPush)],
				(value) => (value ? 1 : 0),
			),
		},
		local: {
			autoReview: resolveOrdinary([
				valueFrom("cli", cli?.local?.autoReview),
				valueFrom("environment", env.local?.autoReview),
				valueFrom("project", project?.local?.autoReview),
				valueFrom("user", user?.local?.autoReview),
				valueFrom("builtin", false),
			]),
			sandboxEnabled: resolveOrdinary([
				valueFrom("cli", cli?.local?.sandboxOptions?.enabled ?? cli?.local?.sandbox),
				valueFrom("environment", env.local?.sandboxOptions?.enabled ?? env.local?.sandbox),
				valueFrom("project", project?.local?.sandboxOptions?.enabled ?? project?.local?.sandbox),
				valueFrom("user", user?.local?.sandboxOptions?.enabled ?? user?.local?.sandbox),
				valueFrom("builtin", false),
			]),
		},
	};
}

export function resolveCursorFastDefault(options: {
	cliForceFast?: boolean;
	cliForceNoFast?: boolean;
	aliasOverride?: boolean;
	sessionValue?: boolean;
	userValue?: boolean;
	modelDefault: boolean;
}): CursorResolvedSetting<boolean> {
	if (options.cliForceNoFast) return resolved("cli", false);
	if (options.cliForceFast) return resolved("cli", true);
	if (options.aliasOverride !== undefined) return resolved("model-alias", options.aliasOverride);
	if (options.sessionValue !== undefined) return resolved("session", options.sessionValue);
	if (options.userValue !== undefined) return resolved("user", options.userValue);
	return resolved("builtin", options.modelDefault);
}
