export function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function getField(value: unknown, field: string): unknown {
	return asRecord(value)?.[field];
}

export function hasUsableText(value: string | undefined): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

export function getFirstStringByKeys(
	record: Record<string, unknown> | undefined,
	keys: readonly string[],
	options?: { nonEmpty?: boolean },
): string | undefined {
	if (!record) return undefined;
	for (const key of keys) {
		const value = record[key];
		if (typeof value !== "string") continue;
		if (options?.nonEmpty && !value) continue;
		return value;
	}
	return undefined;
}
