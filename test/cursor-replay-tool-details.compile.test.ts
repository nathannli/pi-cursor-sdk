import {
	assembleCursorReplayActivityResultDetails,
	assembleCursorReplayTitledActivityDetails,
	type CursorReplayActivityCursorToolName,
	type CursorReplayEditDetails,
	type CursorReplayGenerateImageDetails,
	type CursorReplayGenericFallbackDetails,
	type CursorReplayTitledActivityDetails,
	type CursorReplayWriteDetails,
} from "../src/cursor-replay-tool-details.js";

type Expect<T extends true> = T;
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type NotExtends<A, B> = A extends B ? false : true;

type _variantEdit = Expect<Equal<CursorReplayEditDetails["variant"], "edit">>;
type _variantWrite = Expect<Equal<CursorReplayWriteDetails["variant"], "write">>;
type _variantGenerateImage = Expect<Equal<CursorReplayGenerateImageDetails["variant"], "generateImage">>;
type _variantTitledActivity = Expect<Equal<CursorReplayTitledActivityDetails["variant"], "titledActivity">>;
type _variantGenericFallback = Expect<Equal<CursorReplayGenericFallbackDetails["variant"], "genericFallback">>;
type _editNotActivity = Expect<NotExtends<"edit", CursorReplayActivityCursorToolName>>;
type _writeNotActivity = Expect<NotExtends<"write", CursorReplayActivityCursorToolName>>;
type _generateImageNotActivity = Expect<NotExtends<"generateImage", CursorReplayActivityCursorToolName>>;
type _mcpIsActivity = Expect<Equal<"mcp" extends CursorReplayActivityCursorToolName ? true : false, true>>;

// Compile-time regression: structured tool names must not satisfy titled-activity details.
const _rejectEditOnTitledActivity: CursorReplayTitledActivityDetails = {
	variant: "titledActivity",
	// @ts-expect-error edit uses the dedicated edit variant
	cursorToolName: "edit",
	title: "Cursor edit",
};

const _rejectWriteOnTitledActivity: CursorReplayTitledActivityDetails = {
	variant: "titledActivity",
	// @ts-expect-error write uses the dedicated write variant
	cursorToolName: "write",
	title: "Cursor write",
};

const _rejectGenerateImageOnTitledActivity: CursorReplayTitledActivityDetails = {
	variant: "titledActivity",
	// @ts-expect-error generateImage uses the dedicated generateImage variant
	cursorToolName: "generateImage",
	title: "Cursor image generation",
};

const _rejectEditOnGenericFallback: CursorReplayGenericFallbackDetails = {
	variant: "genericFallback",
	// @ts-expect-error structured edit names use the dedicated edit variant
	cursorToolName: "edit",
};

const _rejectWriteOnGenericFallback: CursorReplayGenericFallbackDetails = {
	variant: "genericFallback",
	// @ts-expect-error structured write names use the dedicated write variant
	cursorToolName: "write",
};

const _rejectGenerateImageOnGenericFallback: CursorReplayGenericFallbackDetails = {
	variant: "genericFallback",
	// @ts-expect-error structured generateImage names use the dedicated generateImage variant
	cursorToolName: "generateImage",
};

const _rejectEditOnActivityAssembly = assembleCursorReplayActivityResultDetails(
	// @ts-expect-error edit must use buildCursorReplayEditDetails
	"edit",
	"Cursor edit",
	{},
	"",
	false,
	undefined,
);

const _rejectWriteOnActivityAssembly = assembleCursorReplayActivityResultDetails(
	// @ts-expect-error write must use buildCursorReplayWriteDetails
	"write",
	"Cursor write",
	{},
	"",
	false,
	undefined,
);

const _rejectEditOnTitledActivityAssembly = assembleCursorReplayTitledActivityDetails(
	// @ts-expect-error edit uses the dedicated edit variant
	"edit",
	"Cursor edit",
	{},
	"",
	false,
	undefined,
);

const _rejectWriteOnTitledActivityAssembly = assembleCursorReplayTitledActivityDetails(
	// @ts-expect-error write uses the dedicated write variant
	"write",
	"Cursor write",
	{},
	"",
	false,
	undefined,
);

void _rejectEditOnTitledActivity;
void _rejectWriteOnTitledActivity;
void _rejectGenerateImageOnTitledActivity;
void _rejectEditOnGenericFallback;
void _rejectWriteOnGenericFallback;
void _rejectGenerateImageOnGenericFallback;
void _rejectEditOnActivityAssembly;
void _rejectWriteOnActivityAssembly;
void _rejectEditOnTitledActivityAssembly;
void _rejectWriteOnTitledActivityAssembly;
