import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	__testUtils as cursorSessionCwdTestUtils,
	getCursorSessionCwd,
	registerCursorSessionCwd,
} from "../src/cursor-session-cwd.js";

function createMockPi() {
	const handlers = new Map<string, Array<(event: unknown, ctx: { cwd: string }) => void>>();
	return {
		on: vi.fn((event: string, handler: (event: unknown, ctx: { cwd: string }) => void) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		}),
		emitSessionStart(cwd: string) {
			for (const handler of handlers.get("session_start") ?? []) {
				handler({ reason: "startup" }, { cwd });
			}
		},
	} satisfies Pick<ExtensionAPI, "on"> & { emitSessionStart(cwd: string): void };
}

describe("cursor-session-cwd", () => {
	afterEach(() => {
		cursorSessionCwdTestUtils.reset();
	});

	it("falls back to process.cwd() before session_start", () => {
		expect(getCursorSessionCwd()).toBe(process.cwd());
	});

	it("syncs cwd from session_start", () => {
		const sessionDir = mkdtempSync(join(tmpdir(), "pi-cursor-session-cwd-"));
		try {
			const pi = createMockPi();
			registerCursorSessionCwd(pi as unknown as ExtensionAPI);
			pi.emitSessionStart(sessionDir);

			expect(getCursorSessionCwd()).toBe(sessionDir);
		} finally {
			rmSync(sessionDir, { recursive: true, force: true });
		}
	});

	it("updates cwd on subsequent session_start events", () => {
		const firstDir = mkdtempSync(join(tmpdir(), "pi-cursor-session-cwd-a-"));
		const secondDir = mkdtempSync(join(tmpdir(), "pi-cursor-session-cwd-b-"));
		try {
			const pi = createMockPi();
			registerCursorSessionCwd(pi as unknown as ExtensionAPI);

			pi.emitSessionStart(firstDir);
			expect(getCursorSessionCwd()).toBe(firstDir);

			pi.emitSessionStart(secondDir);
			expect(getCursorSessionCwd()).toBe(secondDir);
		} finally {
			rmSync(firstDir, { recursive: true, force: true });
			rmSync(secondDir, { recursive: true, force: true });
		}
	});
});
