import {
	CURSOR_KNOWN_NORMALIZED_TOOL_NAMES,
	type CursorNormalizedToolName,
} from "./cursor-tool-presentation-registry.js";

/** Structured replay detail variants with dedicated render paths. */
export type CursorReplayStructuredToolName = "edit" | "write" | "generateImage";

export type CursorReplayToolDetailsVariant =
	| CursorReplayStructuredToolName
	| "titledActivity"
	| "genericFallback";

/**
 * Sentinel cursor tool name for activity cards whose SDK name is not a known registry entry.
 * Real display identity lives in `title` and replay args.
 */
export const CURSOR_REPLAY_UNREGISTERED_ACTIVITY_TOOL_NAME = "unregisteredActivity" as const;

/** Cursor tool names allowed on titled-activity cards (excludes structured tool names). */
export type CursorReplayActivityCursorToolName =
	| Exclude<CursorNormalizedToolName, CursorReplayStructuredToolName>
	| typeof CURSOR_REPLAY_UNREGISTERED_ACTIVITY_TOOL_NAME;

declare const cursorReplayUnknownCursorToolNameBrand: unique symbol;

/** Opaque unknown/future Cursor tool names on generic-fallback replay cards. */
export type CursorReplayUnknownCursorToolName = string & {
	readonly [cursorReplayUnknownCursorToolNameBrand]: unique symbol;
};

export interface CursorReplayEditDetails {
	variant: "edit";
	cursorToolName: "edit";
	path?: string;
	linesAdded?: number;
	linesRemoved?: number;
	diffString?: string;
	diff?: string;
	firstChangedLine?: number;
	title?: string;
	summary?: string;
	expandedText?: string;
}

export interface CursorReplayWriteDetails {
	variant: "write";
	cursorToolName: "write";
	path?: string;
	linesCreated?: number;
	fileSize?: number;
	fileContentAfterWrite?: string;
	expandedText?: string;
	title?: string;
	summary?: string;
}

export interface CursorReplayGenerateImageDetails {
	variant: "generateImage";
	cursorToolName: "generateImage";
	imagePath?: string;
	imageDisplayPath?: string;
	imageMimeType?: string;
	summary?: string;
	expandedText?: string;
	/** Legacy parsed title retained on older payloads; display always uses `Cursor generateImage`. */
	title?: string;
	collapseDetailsByDefault?: boolean;
}

/** Neutral Cursor activity cards and unknown-tool fallbacks with a display title. */
export interface CursorReplayTitledActivityDetails {
	variant: "titledActivity";
	cursorToolName: CursorReplayActivityCursorToolName;
	title: string;
	summary?: string;
	expandedText?: string;
	collapseDetailsByDefault?: boolean;
	path?: string;
	fileSize?: number;
}

/** Parsed replay details without a display title (legacy or malformed payloads). */
export interface CursorReplayGenericFallbackDetails {
	variant: "genericFallback";
	cursorToolName: CursorReplayUnknownCursorToolName;
	summary?: string;
	expandedText?: string;
}

export type CursorReplayToolDetails =
	| CursorReplayEditDetails
	| CursorReplayWriteDetails
	| CursorReplayGenerateImageDetails
	| CursorReplayTitledActivityDetails
	| CursorReplayGenericFallbackDetails;

export type CursorReplayActivityDetailFields = Pick<
	CursorReplayTitledActivityDetails,
	"summary" | "expandedText" | "collapseDetailsByDefault" | "path" | "fileSize"
> &
	Pick<CursorReplayGenerateImageDetails, "imagePath" | "imageDisplayPath" | "imageMimeType">;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function readOptionalNumber(record: Record<string, unknown>, key: string): number | undefined {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readOptionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
	const value = record[key];
	return typeof value === "boolean" ? value : undefined;
}

function readCursorToolName(record: Record<string, unknown>): string | undefined {
	const value = record.cursorToolName;
	return typeof value === "string" && value.trim() ? value : undefined;
}

function parseCursorReplayEditDetails(record: Record<string, unknown>): CursorReplayEditDetails {
	return {
		variant: "edit",
		cursorToolName: "edit",
		path: readOptionalString(record, "path"),
		linesAdded: readOptionalNumber(record, "linesAdded"),
		linesRemoved: readOptionalNumber(record, "linesRemoved"),
		diffString: readOptionalString(record, "diffString"),
		diff: readOptionalString(record, "diff"),
		firstChangedLine: readOptionalNumber(record, "firstChangedLine"),
		title: readOptionalString(record, "title"),
		summary: readOptionalString(record, "summary"),
		expandedText: readOptionalString(record, "expandedText"),
	};
}

function parseCursorReplayWriteDetails(record: Record<string, unknown>): CursorReplayWriteDetails {
	return {
		variant: "write",
		cursorToolName: "write",
		path: readOptionalString(record, "path"),
		linesCreated: readOptionalNumber(record, "linesCreated"),
		fileSize: readOptionalNumber(record, "fileSize"),
		fileContentAfterWrite: readOptionalString(record, "fileContentAfterWrite"),
		expandedText: readOptionalString(record, "expandedText"),
		title: readOptionalString(record, "title"),
		summary: readOptionalString(record, "summary"),
	};
}

function parseCursorReplayGenerateImageDetails(record: Record<string, unknown>): CursorReplayGenerateImageDetails {
	const title = readOptionalString(record, "title");
	const collapseDetailsByDefault = readOptionalBoolean(record, "collapseDetailsByDefault");
	return {
		variant: "generateImage",
		cursorToolName: "generateImage",
		imagePath: readOptionalString(record, "imagePath"),
		imageDisplayPath: readOptionalString(record, "imageDisplayPath"),
		imageMimeType: readOptionalString(record, "imageMimeType"),
		summary: readOptionalString(record, "summary"),
		expandedText: readOptionalString(record, "expandedText"),
		...(title !== undefined ? { title } : {}),
		...(collapseDetailsByDefault !== undefined ? { collapseDetailsByDefault } : {}),
	};
}

function parseCursorReplayTitledActivityDetails(
	record: Record<string, unknown>,
	cursorToolName: CursorReplayActivityCursorToolName,
	title: string,
): CursorReplayTitledActivityDetails {
	return {
		variant: "titledActivity",
		cursorToolName,
		title,
		summary: readOptionalString(record, "summary"),
		expandedText: readOptionalString(record, "expandedText"),
		collapseDetailsByDefault: readOptionalBoolean(record, "collapseDetailsByDefault"),
		path: readOptionalString(record, "path"),
		fileSize: readOptionalNumber(record, "fileSize"),
	};
}

function brandCursorReplayUnknownCursorToolName(cursorToolName: string): CursorReplayUnknownCursorToolName {
	return cursorToolName as CursorReplayUnknownCursorToolName;
}

function parseCursorReplayGenericFallbackDetails(
	record: Record<string, unknown>,
	cursorToolName: string,
): CursorReplayGenericFallbackDetails {
	return {
		variant: "genericFallback",
		cursorToolName: brandCursorReplayUnknownCursorToolName(cursorToolName),
		summary: readOptionalString(record, "summary"),
		expandedText: readOptionalString(record, "expandedText"),
	};
}

const STRUCTURED_CURSOR_REPLAY_TOOL_NAMES = new Set<CursorReplayStructuredToolName>(["edit", "write", "generateImage"]);

function isCursorReplayActivityCursorToolName(name: string): name is CursorReplayActivityCursorToolName {
	if (name === CURSOR_REPLAY_UNREGISTERED_ACTIVITY_TOOL_NAME) return true;
	if (STRUCTURED_CURSOR_REPLAY_TOOL_NAMES.has(name as CursorReplayStructuredToolName)) return false;
	return (CURSOR_KNOWN_NORMALIZED_TOOL_NAMES as readonly string[]).includes(name);
}

function resolveParseActivityCursorToolName(cursorToolName: string): CursorReplayActivityCursorToolName {
	return isCursorReplayActivityCursorToolName(cursorToolName)
		? cursorToolName
		: CURSOR_REPLAY_UNREGISTERED_ACTIVITY_TOOL_NAME;
}

export function parseCursorReplayToolDetails(value: unknown): CursorReplayToolDetails | undefined {
	if (!isRecord(value)) return undefined;
	const cursorToolName = readCursorToolName(value);
	if (cursorToolName === "edit") return parseCursorReplayEditDetails(value);
	if (cursorToolName === "write") return parseCursorReplayWriteDetails(value);
	if (cursorToolName === "generateImage") return parseCursorReplayGenerateImageDetails(value);
	const title = readOptionalString(value, "title")?.trim();
	if (title) {
		return parseCursorReplayTitledActivityDetails(
			value,
			resolveParseActivityCursorToolName(cursorToolName ?? CURSOR_REPLAY_UNREGISTERED_ACTIVITY_TOOL_NAME),
			title,
		);
	}
	return parseCursorReplayGenericFallbackDetails(value, cursorToolName ?? "tool");
}

/** @deprecated Prefer {@link parseCursorReplayToolDetails} for validated narrowing. */
export const asCursorReplayToolDetails = parseCursorReplayToolDetails;

export function buildCursorReplayEditDetails(
	fields: Omit<CursorReplayEditDetails, "variant" | "cursorToolName">,
): CursorReplayEditDetails {
	return { variant: "edit", cursorToolName: "edit", ...fields };
}

export function buildCursorReplayWriteDetails(
	fields: Omit<CursorReplayWriteDetails, "variant" | "cursorToolName">,
): CursorReplayWriteDetails {
	return { variant: "write", cursorToolName: "write", ...fields };
}

export function assembleCursorReplayTitledActivityDetails(
	cursorToolName: CursorReplayActivityCursorToolName,
	title: string,
	fields: CursorReplayActivityDetailFields,
	contentText: string,
	isError: boolean,
	activitySummary: string | undefined,
): CursorReplayTitledActivityDetails {
	const summary = isError ? fields.summary : (fields.summary ?? activitySummary);
	return {
		variant: "titledActivity",
		cursorToolName,
		title,
		summary,
		expandedText: fields.expandedText ?? contentText,
		...(fields.collapseDetailsByDefault !== undefined ? { collapseDetailsByDefault: fields.collapseDetailsByDefault } : {}),
		...(fields.path !== undefined ? { path: fields.path } : {}),
		...(fields.fileSize !== undefined ? { fileSize: fields.fileSize } : {}),
	};
}

export const CURSOR_REPLAY_GENERATE_IMAGE_RESULT_TITLE = "Cursor generateImage" as const;

export type CursorReplayActivityResultCursorToolName =
	| CursorReplayActivityCursorToolName
	| "generateImage";

export function assembleCursorReplayActivityResultDetails(
	cursorToolName: CursorReplayActivityResultCursorToolName,
	title: string,
	fields: CursorReplayActivityDetailFields,
	contentText: string,
	isError: boolean,
	activitySummary: string | undefined,
): CursorReplayTitledActivityDetails | CursorReplayGenerateImageDetails {
	if (cursorToolName === "generateImage") {
		const summary = isError ? fields.summary : (fields.summary ?? activitySummary);
		return {
			variant: "generateImage",
			cursorToolName: "generateImage",
			imagePath: fields.imagePath,
			imageDisplayPath: fields.imageDisplayPath,
			imageMimeType: fields.imageMimeType,
			summary,
			expandedText: fields.expandedText ?? contentText,
		};
	}
	return assembleCursorReplayTitledActivityDetails(
		cursorToolName,
		title,
		fields,
		contentText,
		isError,
		activitySummary,
	);
}

export function isCursorReplayEditDetails(details: CursorReplayToolDetails): details is CursorReplayEditDetails {
	return details.variant === "edit";
}

export function isCursorReplayWriteDetails(details: CursorReplayToolDetails): details is CursorReplayWriteDetails {
	return details.variant === "write";
}

export function isCursorReplayGenerateImageDetails(
	details: CursorReplayToolDetails,
): details is CursorReplayGenerateImageDetails {
	return details.variant === "generateImage";
}

export function isCursorReplayTitledActivityDetails(
	details: CursorReplayToolDetails,
): details is CursorReplayTitledActivityDetails {
	return details.variant === "titledActivity";
}

export function isCursorReplayGenericFallbackDetails(
	details: CursorReplayToolDetails,
): details is CursorReplayGenericFallbackDetails {
	return details.variant === "genericFallback";
}
