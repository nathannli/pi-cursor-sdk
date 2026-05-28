export const CURSOR_API_KEY_ENV_VAR = "CURSOR_API_KEY";
export const CURSOR_API_KEY_CONFIG_VALUE = `$${CURSOR_API_KEY_ENV_VAR}`;

const CURSOR_API_KEY_PLACEHOLDERS = new Set([
	CURSOR_API_KEY_ENV_VAR,
	CURSOR_API_KEY_CONFIG_VALUE,
	`\${${CURSOR_API_KEY_ENV_VAR}}`,
]);

export function resolveCursorApiKey(apiKey?: string): string | undefined {
	const trimmed = apiKey?.trim();
	if (!trimmed) return undefined;
	if (CURSOR_API_KEY_PLACEHOLDERS.has(trimmed)) return process.env.CURSOR_API_KEY?.trim() || undefined;
	return trimmed;
}
