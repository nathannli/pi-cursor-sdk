import { accessSync, constants } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
	ensureCursorRipgrepPath,
	resolveBundledCursorRipgrepPath,
} from "../src/cursor-ripgrep-path.js";

const originalRipgrepPath = process.env.CURSOR_RIPGREP_PATH;

afterEach(() => {
	if (originalRipgrepPath === undefined) delete process.env.CURSOR_RIPGREP_PATH;
	else process.env.CURSOR_RIPGREP_PATH = originalRipgrepPath;
});

describe("Cursor ripgrep path", () => {
	it("resolves the executable from the installed Cursor SDK platform package", () => {
		const ripgrepPath = resolveBundledCursorRipgrepPath();

		if (!ripgrepPath) throw new Error("Expected the installed Cursor SDK platform package to include ripgrep");
		expect(ripgrepPath.replaceAll("\\", "/")).toContain(`@cursor/sdk-${process.platform}-${process.arch}`);
		expect(() => accessSync(ripgrepPath, constants.X_OK)).not.toThrow();
	});

	it("configures an empty path without overriding an existing value", () => {
		process.env.CURSOR_RIPGREP_PATH = "";
		const bundledPath = ensureCursorRipgrepPath();
		expect(process.env.CURSOR_RIPGREP_PATH).toBe(bundledPath);

		process.env.CURSOR_RIPGREP_PATH = "/custom/rg";
		expect(ensureCursorRipgrepPath()).toBe("/custom/rg");
		expect(process.env.CURSOR_RIPGREP_PATH).toBe("/custom/rg");
	});
});
