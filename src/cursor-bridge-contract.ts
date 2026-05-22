export const CURSOR_PI_BRIDGE_MCP_TOOL_PREFIX = "pi__";

const CURSOR_PI_BRIDGE_CONTRACT_LINES = [
	"Pi bridge contract:",
	`${CURSOR_PI_BRIDGE_MCP_TOOL_PREFIX}* names are live Cursor MCP bridge tool names only when exposed in the current run.`,
	`Call the ${CURSOR_PI_BRIDGE_MCP_TOOL_PREFIX}* MCP tool name, not the real pi tool name shown in pi history or transcripts.`,
	"Bridged calls execute through normal pi tool flow, so pi shows the real pi tool name and returns a normal pi tool result.",
	"Replay IDs, replay labels, and transcript tool names are display-only/context-only, not callable tools.",
	"Cursor-native host tools, settings, plugins, and configured MCP servers are separate from the pi bridge.",
] as const;

export function getCursorPiBridgeContractText(): string {
	return CURSOR_PI_BRIDGE_CONTRACT_LINES.join("\n");
}

export function buildCursorPiBridgeMcpToolDescription(options: {
	piToolName: string;
	mcpToolName: string;
	piToolDescription: string;
}): string {
	return [
		options.piToolDescription,
		"",
		getCursorPiBridgeContractText(),
		`This run exposes real pi tool ${options.piToolName} as Cursor MCP tool ${options.mcpToolName}.`,
	].join("\n");
}
