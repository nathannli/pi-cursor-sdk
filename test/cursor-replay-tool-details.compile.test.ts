import {
	assembleCursorReplayActivityResultDetails,
	assembleCursorReplayTitledActivityDetails,
	type CursorReplayGenericFallbackDetails,
	type CursorReplayTitledActivityDetails,
} from "../src/cursor-replay-tool-details.js";

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
void _rejectEditOnActivityAssembly;
void _rejectWriteOnActivityAssembly;
void _rejectEditOnTitledActivityAssembly;
void _rejectWriteOnTitledActivityAssembly;
