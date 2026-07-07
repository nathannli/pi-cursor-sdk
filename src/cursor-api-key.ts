export const CURSOR_API_KEY_ENV_VAR = "CURSOR_API_KEY";
const CURSOR_PROVIDER_ID = "cursor";

// Non-secret literal sentinel for pi's provider registry. Pi 0.77 treats `$ENV_VAR`
// values as unconfigured when the env var is absent, which hides fallback models
// before `/login`. Keep the provider available and resolve the real key in the
// Cursor provider turn path from pi auth, --api-key, or CURSOR_API_KEY.
export const CURSOR_API_KEY_CONFIG_VALUE = "pi-cursor-sdk-cursor-api-key-placeholder";

const CURSOR_API_KEY_PLACEHOLDERS = new Set([
	CURSOR_API_KEY_ENV_VAR,
	`$${CURSOR_API_KEY_ENV_VAR}`,
	`\${${CURSOR_API_KEY_ENV_VAR}}`,
	CURSOR_API_KEY_CONFIG_VALUE,
]);

export function resolveCursorApiKey(apiKey?: string): string | undefined {
	const trimmed = apiKey?.trim();
	if (!trimmed) return undefined;
	if (CURSOR_API_KEY_PLACEHOLDERS.has(trimmed)) return process.env.CURSOR_API_KEY?.trim() || undefined;
	return trimmed;
}

export function getCliCursorApiKeyFromArgv(argv: string[] = process.argv): string | undefined {
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--api-key") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) return undefined;
			const trimmed = value.trim();
			return trimmed || undefined;
		}
		const prefix = "--api-key=";
		if (arg.startsWith(prefix)) {
			const trimmed = arg.slice(prefix.length).trim();
			return trimmed || undefined;
		}
	}
	return undefined;
}

async function getStoredCursorApiKey(): Promise<string | undefined> {
	try {
		const { AuthStorage } = await import("@earendil-works/pi-coding-agent");
		return resolveCursorApiKey(await AuthStorage.create().getApiKey(CURSOR_PROVIDER_ID, { includeFallback: false }));
	} catch {
		return undefined;
	}
}

export async function resolveCursorRuntimeApiKey(): Promise<string | undefined> {
	return (
		resolveCursorApiKey(getCliCursorApiKeyFromArgv()) ??
		(await getStoredCursorApiKey()) ??
		resolveCursorApiKey(process.env.CURSOR_API_KEY)
	);
}
