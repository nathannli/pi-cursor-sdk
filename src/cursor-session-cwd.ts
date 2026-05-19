import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const state = {
	sessionCwd: process.cwd(),
};

/**
 * Pi session cwd when known; falls back to process.cwd() before session_start.
 * Updated on session_start only until pi threads cwd into streamSimple—mid-session cwd
 * changes without a new session_start event are not reflected here.
 */
export function getCursorSessionCwd(): string {
	return state.sessionCwd;
}

function setCursorSessionCwd(cwd: string): void {
	state.sessionCwd = cwd;
}

function resetCursorSessionCwd(): void {
	state.sessionCwd = process.cwd();
}

export function registerCursorSessionCwd(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		setCursorSessionCwd(ctx.cwd);
	});
}

export const __testUtils = {
	set: setCursorSessionCwd,
	reset: resetCursorSessionCwd,
};
