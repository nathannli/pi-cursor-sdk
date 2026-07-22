import { accessSync, constants } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const RIPGREP_ENV = "CURSOR_RIPGREP_PATH";

export function resolveBundledCursorRipgrepPath(): string | undefined {
	try {
		const platformPackage = `@cursor/sdk-${process.platform}-${process.arch}`;
		const packageDirectory = dirname(require.resolve(`${platformPackage}/package.json`));
		const ripgrepPath = join(packageDirectory, "bin", process.platform === "win32" ? "rg.exe" : "rg");
		accessSync(ripgrepPath, constants.X_OK);
		return ripgrepPath;
	} catch {
		return undefined;
	}
}

export function ensureCursorRipgrepPath(): string | undefined {
	const configuredPath = process.env[RIPGREP_ENV];
	if (configuredPath) return configuredPath;

	const bundledPath = resolveBundledCursorRipgrepPath();
	if (bundledPath) process.env[RIPGREP_ENV] = bundledPath;
	return bundledPath;
}
