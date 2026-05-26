import { getCursorReplayActivityTitle } from "./cursor-tool-names.js";
import { getToolArgs, getToolName, normalizeToolName } from "./cursor-transcript-utils.js";
import { resolveTranscriptToolName } from "./cursor-web-tool-activity.js";

interface CursorToolVisibilityConfig {
	incompleteTitle?: string;
	lifecycleTitle?: string;
	lifecycleEligible?: boolean;
	fastLocalDiscovery?: boolean;
}

export interface CursorToolVisibility {
	args: Record<string, unknown>;
	displayName: string;
	normalizedName: string;
	normalizedKey: string;
	activityTitle?: string;
	incompleteTitle?: string;
	lifecycleTitle?: string;
	lifecycleEligible: boolean;
	fastLocalDiscovery: boolean;
}

const CURSOR_TOOL_VISIBILITY_BY_NAME: Record<string, CursorToolVisibilityConfig> = {
	read: { incompleteTitle: "Cursor read", fastLocalDiscovery: true },
	grep: { incompleteTitle: "Cursor grep", fastLocalDiscovery: true },
	glob: { incompleteTitle: "Cursor find", fastLocalDiscovery: true },
	ls: { incompleteTitle: "Cursor ls", fastLocalDiscovery: true },
	shell: { incompleteTitle: "Cursor shell", lifecycleTitle: "Cursor shell", lifecycleEligible: true },
	task: { lifecycleEligible: true },
	mcp: { lifecycleEligible: true },
	generateimage: { lifecycleEligible: true },
	recordscreen: { lifecycleEligible: true },
	semsearch: { lifecycleEligible: true },
	websearch: { lifecycleEligible: true },
	webfetch: { lifecycleEligible: true },
	createplan: { lifecycleEligible: true },
	updatetodos: { lifecycleEligible: true },
};

export function classifyCursorToolVisibility(toolCall: unknown): CursorToolVisibility {
	const args = getToolArgs(toolCall);
	const displayName = resolveTranscriptToolName(getToolName(toolCall), args);
	const normalizedName = normalizeToolName(displayName);
	const normalizedKey = normalizedName.toLowerCase();
	const config = CURSOR_TOOL_VISIBILITY_BY_NAME[normalizedKey];
	const replayActivityTitle = getCursorReplayActivityTitle(normalizedName);
	return {
		args,
		displayName,
		normalizedName,
		normalizedKey,
		activityTitle: replayActivityTitle ?? config?.incompleteTitle ?? config?.lifecycleTitle,
		incompleteTitle: replayActivityTitle ?? config?.incompleteTitle,
		lifecycleTitle: replayActivityTitle ?? config?.lifecycleTitle,
		lifecycleEligible: config?.lifecycleEligible ?? false,
		fastLocalDiscovery: config?.fastLocalDiscovery ?? false,
	};
}

export function isFastLocalDiscoveryTool(toolCall: unknown): boolean {
	return classifyCursorToolVisibility(toolCall).fastLocalDiscovery;
}
