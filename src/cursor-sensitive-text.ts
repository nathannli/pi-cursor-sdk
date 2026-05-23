import type { CursorPiToolDisplay } from "./cursor-transcript-utils.js";

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function scrubSensitiveText(text: string, apiKey?: string): string {
	let scrubbed = text;
	const trimmedKey = apiKey?.trim();
	if (trimmedKey) {
		scrubbed = scrubbed.replace(new RegExp(escapeRegExp(trimmedKey), "g"), "[redacted]");
	}
	return scrubbed
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
		.replace(/((?:^|[\s,{])cookie["']?\s*[:=]\s*["']?)[^\n]+/gi, "$1[redacted]")
		.replace(
			/((?:authorization|api[_-]?key|apiKey|token|session(?:[_-]?id)?)["']?\s*[:=]\s*["']?)[^"'\s,;}]+/gi,
			"$1[redacted]",
		);
}

function scrubDisplayValue(value: unknown, apiKey?: string): unknown {
	if (typeof value === "string") return scrubSensitiveText(value, apiKey);
	if (Array.isArray(value)) return value.map((entry) => scrubDisplayValue(entry, apiKey));
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, scrubDisplayValue(entry, apiKey)]));
	}
	return value;
}

export function scrubPiToolDisplay(display: CursorPiToolDisplay, apiKey?: string): CursorPiToolDisplay {
	return {
		...display,
		args: scrubDisplayValue(display.args, apiKey) as Record<string, unknown>,
		result: scrubDisplayValue(display.result, apiKey) as CursorPiToolDisplay["result"],
	};
}
