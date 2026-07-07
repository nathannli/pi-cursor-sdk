import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CURSOR_API_KEY_CONFIG_VALUE,
	getCliCursorApiKeyFromArgv,
	resolveCursorApiKey,
	resolveCursorRuntimeApiKey,
} from "../src/cursor-api-key.js";

function writeStoredCursorApiKey(apiKey: string): void {
	writeFileSync(
		join(process.env.PI_CODING_AGENT_DIR!, "auth.json"),
		JSON.stringify({ cursor: { type: "api_key", key: apiKey } }, null, 2),
	);
}

describe("cursor-api-key helpers", () => {
	const originalEnv = process.env;
	const originalArgv = process.argv;
	let tmpAgentDir: string;

	beforeEach(() => {
		process.env = { ...originalEnv };
		delete process.env.CURSOR_API_KEY;
		tmpAgentDir = mkdtempSync(join(tmpdir(), "pi-cursor-api-key-"));
		process.env.PI_CODING_AGENT_DIR = tmpAgentDir;
		process.argv = ["node", "vitest"];
	});

	afterEach(() => {
		rmSync(tmpAgentDir, { recursive: true, force: true });
		process.env = originalEnv;
		process.argv = originalArgv;
	});

	it("parses --api-key forms", () => {
		expect(getCliCursorApiKeyFromArgv(["node", "pi", "--api-key", "cli-key-123"])).toBe("cli-key-123");
		expect(getCliCursorApiKeyFromArgv(["node", "pi", "--api-key=cli-key-123"])).toBe("cli-key-123");
		expect(getCliCursorApiKeyFromArgv(["node", "pi", "--api-key", "--list-models"])).toBeUndefined();
	});

	it.each(["CURSOR_API_KEY", "$CURSOR_API_KEY", "${CURSOR_API_KEY}", CURSOR_API_KEY_CONFIG_VALUE])(
		"resolves placeholder %s through env only",
		(placeholder) => {
			expect(resolveCursorApiKey(placeholder)).toBeUndefined();
			process.env.CURSOR_API_KEY = "env-key-123";
			expect(resolveCursorApiKey(placeholder)).toBe("env-key-123");
		},
	);

	it("prefers CLI, then stored auth, then env for runtime keys", async () => {
		writeStoredCursorApiKey("stored-key-123");
		process.env.CURSOR_API_KEY = "env-key-123";
		expect(await resolveCursorRuntimeApiKey()).toBe("stored-key-123");

		process.argv = ["node", "pi", "--api-key", "cli-key-123"];
		expect(await resolveCursorRuntimeApiKey()).toBe("cli-key-123");
	});

	it("resolves stored placeholders through env", async () => {
		writeStoredCursorApiKey(CURSOR_API_KEY_CONFIG_VALUE);
		process.env.CURSOR_API_KEY = "env-key-123";

		expect(await resolveCursorRuntimeApiKey()).toBe("env-key-123");
	});
});
