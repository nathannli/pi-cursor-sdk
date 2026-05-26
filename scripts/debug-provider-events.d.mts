export interface CursorDebugProviderEventsArgs {
	cwd: string;
	model: string;
	prompt?: string;
	promptFile?: string;
	out?: string;
	settingSources?: string[] | undefined;
	sessionDir?: string;
	apiKey?: string;
}

export declare function parseDebugProviderEventsArgs(
	argv: string[],
	env?: NodeJS.ProcessEnv,
): CursorDebugProviderEventsArgs;

export interface CursorPiSessionSnapshotState {
	copied: boolean;
	sessionFile?: string;
	reason?: string;
	recoveredAfterChildExit?: boolean;
}

export interface CursorDebugCaptureSummary {
	artifactDir: string;
	sessionFile?: string;
	counts: Record<string, number>;
	piSessionSnapshot: CursorPiSessionSnapshotState;
}

export declare function backfillPiSessionSnapshot(
	captureSummary: CursorDebugCaptureSummary,
	artifactDir: string,
	sessionDir: string,
): CursorDebugCaptureSummary;

export declare function runDebugProviderEvents(args: CursorDebugProviderEventsArgs): Promise<CursorDebugCaptureSummary>;
