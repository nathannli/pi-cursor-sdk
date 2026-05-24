/** Canonical single-line sanitization and truncation for Cursor replay/trace display. */
export function sanitizeCursorDisplayLine(value: string): string {
	return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

export function truncateCursorDisplayLine(value: string, maxLength = 240): string {
	const sanitized = sanitizeCursorDisplayLine(value);
	if (sanitized.length <= maxLength) return sanitized;
	return `${sanitized.slice(0, maxLength - 1)}…`;
}
