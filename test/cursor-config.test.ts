import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CURSOR_AUTO_REVIEW_ENV,
	CURSOR_CLOUD_CONTEXT_ENV,
	CURSOR_CLOUD_DIRECT_PUSH_ENV,
	CURSOR_RUNTIME_ENV,
	CURSOR_SANDBOX_ENV,
	cursorFastDefaultsFromConfig,
	getCursorSdkProjectConfigPath,
	getCursorSdkUserConfigPath,
	loadCursorSdkConfig,
	loadCursorSdkUserConfig,
	resolveCursorFastDefault,
	resolveCursorSdkConfig,
	saveCursorSdkUserConfig,
	withCursorFastDefaults,
} from "../src/cursor-config.js";

describe("Cursor SDK config resolver", () => {
	let root: string;
	let agentDir: string;
	let cwd: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "pi-cursor-config-"));
		agentDir = join(root, "agent");
		cwd = join(root, "repo");
		mkdirSync(cwd, { recursive: true });
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("resolves ordinary settings by CLI, env, trusted project, user, built-in order", () => {
		const user = { runtime: "cloud" as const };
		const project = { runtime: "local" as const };

		expect(resolveCursorSdkConfig({ user }).runtime).toMatchObject({ value: "cloud", source: "user", trustLevel: "user" });
		expect(resolveCursorSdkConfig({ user, project }).runtime).toMatchObject({
			value: "local",
			source: "project",
			trustLevel: "trusted-project",
		});
		expect(resolveCursorSdkConfig({ env: { [CURSOR_RUNTIME_ENV]: "cloud" }, user, project }).runtime).toMatchObject({
			value: "cloud",
			source: "environment",
		});
		expect(
			resolveCursorSdkConfig({ cli: { runtime: "local" }, env: { [CURSOR_RUNTIME_ENV]: "cloud" }, user, project }).runtime,
		).toMatchObject({ value: "local", source: "cli", trustLevel: "one-shot" });
		expect(resolveCursorSdkConfig().runtime).toMatchObject({ value: "local", source: "builtin" });
	});

	it("keeps legacy fastDefaults shape compatible and writes user config as 0600", () => {
		const path = getCursorSdkUserConfigPath(agentDir);
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(path, JSON.stringify({ fastDefaults: { "composer-2": false, bad: "true" } }));

		const config = loadCursorSdkUserConfig(path);
		expect(cursorFastDefaultsFromConfig(config)).toEqual(new Map([["composer-2", false]]));

		const savedPath = join(agentDir, "saved-cursor-sdk.json");
		saveCursorSdkUserConfig(withCursorFastDefaults(config, new Map([["composer-2", true]])), savedPath);
		expect(JSON.parse(readFileSync(savedPath, "utf-8"))).toEqual({ fastDefaults: { "composer-2": true } });
		if (process.platform !== "win32") expect(statSync(savedPath).mode & 0o777).toBe(0o600);
	});

	it("preserves current fast precedence through the resolver", () => {
		expect(resolveCursorFastDefault({ cliForceFast: true, aliasOverride: false, sessionValue: false, userValue: false, modelDefault: false })).toMatchObject({
			value: true,
			source: "cli",
		});
		expect(resolveCursorFastDefault({ aliasOverride: false, sessionValue: true, userValue: true, modelDefault: true })).toMatchObject({
			value: false,
			source: "model-alias",
		});
		expect(resolveCursorFastDefault({ sessionValue: false, userValue: true, modelDefault: true })).toMatchObject({
			value: false,
			source: "session",
		});
		expect(resolveCursorFastDefault({ userValue: false, modelDefault: true })).toMatchObject({ value: false, source: "user" });
		expect(resolveCursorFastDefault({ modelDefault: true })).toMatchObject({ value: true, source: "builtin" });
	});

	it("trust-gates project config loading through the caller's project trust state", () => {
		const projectPath = getCursorSdkProjectConfigPath(cwd);
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(projectPath, JSON.stringify({ runtime: "cloud" }));

		expect(loadCursorSdkConfig({ cwd, agentDir, projectTrusted: false })).toEqual({ user: {} });
		expect(loadCursorSdkConfig({ cwd, agentDir, projectTrusted: true })).toEqual({ user: {}, project: { runtime: "cloud" } });
	});

	it("keeps explicit env safety allows above project defaults", () => {
		const resolved = resolveCursorSdkConfig({
			env: { [CURSOR_CLOUD_DIRECT_PUSH_ENV]: "true" },
			project: { cloud: { directPush: false } },
		}).cloud.directPush;

		expect(resolved).toMatchObject({ value: true, source: "environment", trustLevel: "environment" });
		expect(resolved).not.toHaveProperty("cappedBy");
	});

	it("applies user safety caps over explicit env allows", () => {
		const resolved = resolveCursorSdkConfig({
			env: { [CURSOR_CLOUD_DIRECT_PUSH_ENV]: "true" },
			user: { cloud: { directPush: false } },
		}).cloud.directPush;

		expect(resolved).toMatchObject({ value: false, source: "user", trustLevel: "user" });
		expect(resolved.cappedBy).toMatchObject({ source: "user", cappedSource: "environment", cappedValue: true });
	});

	it("applies user safety caps over project defaults", () => {
		const context = resolveCursorSdkConfig({
			project: { cloud: { contextHandoff: "bootstrap" } },
			user: { cloud: { contextHandoff: "never" } },
		}).cloud.contextHandoff;
		const directPush = resolveCursorSdkConfig({
			project: { cloud: { directPush: true } },
			user: { cloud: { directPush: false } },
		}).cloud.directPush;

		expect(context).toMatchObject({ value: "never", source: "user" });
		expect(context.cappedBy).toMatchObject({ source: "user", cappedSource: "project", cappedValue: "bootstrap" });
		expect(directPush).toMatchObject({ value: false, source: "user" });
		expect(directPush.cappedBy).toMatchObject({ source: "user", cappedSource: "project", cappedValue: true });
	});

	it("lets explicit one-shot CLI safety allows override user denials", () => {
		const resolved = resolveCursorSdkConfig({
			cli: { cloud: { contextHandoff: "bootstrap", directPush: true } },
			env: { [CURSOR_CLOUD_CONTEXT_ENV]: "fresh" },
			user: { cloud: { contextHandoff: "never", directPush: false } },
		}).cloud;

		expect(resolved.contextHandoff).toMatchObject({ value: "bootstrap", source: "cli" });
		expect(resolved.contextHandoff).not.toHaveProperty("cappedBy");
		expect(resolved.directPush).toMatchObject({ value: true, source: "cli" });
		expect(resolved.directPush).not.toHaveProperty("cappedBy");
	});

	it("resolves local safety controls by CLI, env, project, user, built-in order", () => {
		const user = { local: { autoReview: true, sandboxOptions: { enabled: true } } };
		const project = { local: { autoReview: false, sandbox: false } };

		expect(resolveCursorSdkConfig().local.autoReview).toMatchObject({ value: false, source: "builtin" });
		expect(resolveCursorSdkConfig({ user }).local.sandboxEnabled).toMatchObject({ value: true, source: "user" });
		expect(resolveCursorSdkConfig({ user, project }).local.autoReview).toMatchObject({ value: false, source: "project" });
		expect(
			resolveCursorSdkConfig({ env: { [CURSOR_AUTO_REVIEW_ENV]: "1", [CURSOR_SANDBOX_ENV]: "true" }, user, project }).local,
		).toMatchObject({
			autoReview: expect.objectContaining({ value: true, source: "environment" }),
			sandboxEnabled: expect.objectContaining({ value: true, source: "environment" }),
		});
		expect(
			resolveCursorSdkConfig({
				cli: { local: { autoReview: false, sandboxOptions: { enabled: false } } },
				env: { [CURSOR_AUTO_REVIEW_ENV]: "1", [CURSOR_SANDBOX_ENV]: "1" },
				user,
				project,
			}).local,
		).toMatchObject({
			autoReview: expect.objectContaining({ value: false, source: "cli" }),
			sandboxEnabled: expect.objectContaining({ value: false, source: "cli" }),
		});
	});
});
