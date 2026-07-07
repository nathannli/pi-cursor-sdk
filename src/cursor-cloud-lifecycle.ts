import type { ExtensionAPI, ExtensionCommandContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { resolveCursorRuntimeApiKey } from "./cursor-api-key.js";
import {
	MAX_CLOUD_REPORT_BRANCHES,
	type CursorCloudRunReport,
} from "./cursor-cloud-reporting.js";
import { asRecord, getString } from "./cursor-record-utils.js";
import { scrubSensitiveText } from "./cursor-sensitive-text.js";
import { loadCursorSdk } from "./cursor-sdk-runtime.js";

export const CLOUD_LIFECYCLE_ENTRY_TYPE = "cursor-cloud-lifecycle";

const MAX_LEDGER_AGENT_ID_LENGTH = 256;
const MAX_LEDGER_RUN_ID_LENGTH = 256;
const MAX_LEDGER_TIMESTAMP_LENGTH = 64;
const MAX_LEDGER_BRANCH_LENGTH = 160;
const MAX_LEDGER_PR_URL_LENGTH = 240;
const MAX_LIST_RECORDS = 25;

type CloudLifecycleAction = "record" | "archive" | "delete";

interface CursorCloudLifecycleBranchEntry {
	branch?: string;
	prUrl?: string;
}

export interface CursorCloudLifecycleEntryData {
	action: CloudLifecycleAction;
	runtime: "cloud";
	agentId: string;
	runId?: string;
	timestamp: string;
	branches?: CursorCloudLifecycleBranchEntry[];
}

export interface CursorCloudLifecycleAgentRecord {
	agentId: string;
	runId?: string;
	timestamp: string;
	archived: boolean;
	deleted: boolean;
	branches: CursorCloudLifecycleBranchEntry[];
}

type CloudLifecycleApi = Pick<ExtensionAPI, "appendEntry">;
type CloudLifecycleCommandContext = Pick<ExtensionCommandContext, "sessionManager" | "ui">;
type CloudLifecycleSdkOperations = {
	archive(agentId: string, options?: { apiKey?: string }): Promise<void>;
	delete(agentId: string, options?: { apiKey?: string }): Promise<void>;
};

let cloudLifecycleApi: CloudLifecycleApi | undefined;
let sdkOperationsForTests: CloudLifecycleSdkOperations | undefined;

function isCloudLifecycleAction(value: unknown): value is CloudLifecycleAction {
	return value === "record" || value === "archive" || value === "delete";
}

function truncateLedgerString(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function requiredBoundedString(record: Record<string, unknown>, key: string, maxLength: number): string | undefined {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return undefined;
	return value;
}

function optionalString(record: Record<string, unknown>, key: string, maxLength: number): string | undefined | false {
	const value = record[key];
	if (value === undefined) return undefined;
	return typeof value === "string" ? truncateLedgerString(value, maxLength) : false;
}

function parseBranch(value: unknown): CursorCloudLifecycleBranchEntry | undefined {
	const record = asRecord(value);
	if (!record) return undefined;
	const branch = optionalString(record, "branch", MAX_LEDGER_BRANCH_LENGTH);
	const prUrl = optionalString(record, "prUrl", MAX_LEDGER_PR_URL_LENGTH);
	if (branch === false || prUrl === false || (!branch && !prUrl)) return undefined;
	return {
		...(branch ? { branch } : {}),
		...(prUrl ? { prUrl } : {}),
	};
}

function parseArray<T>(value: unknown, parseItem: (item: unknown) => T | undefined): T[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) return undefined;
	const parsed = value.map(parseItem).filter((item): item is T => item !== undefined);
	return parsed.length > 0 ? parsed : undefined;
}

function parseCloudLifecycleEntryData(value: unknown): CursorCloudLifecycleEntryData | undefined {
	const record = asRecord(value);
	if (!record || !isCloudLifecycleAction(record.action) || record.runtime !== "cloud") return undefined;
	const agentId = requiredBoundedString(record, "agentId", MAX_LEDGER_AGENT_ID_LENGTH);
	const timestamp = requiredBoundedString(record, "timestamp", MAX_LEDGER_TIMESTAMP_LENGTH);
	if (!agentId || !timestamp) return undefined;
	const runId = optionalString(record, "runId", MAX_LEDGER_RUN_ID_LENGTH);
	if (runId === false) return undefined;
	const branches = parseArray(record.branches, parseBranch)?.slice(0, MAX_CLOUD_REPORT_BRANCHES);
	return {
		action: record.action,
		runtime: "cloud",
		agentId,
		timestamp,
		...(runId ? { runId } : {}),
		...(branches ? { branches } : {}),
	};
}

function buildBranchEntries(report: CursorCloudRunReport): CursorCloudLifecycleBranchEntry[] | undefined {
	const branches = report.branches
		.slice(0, MAX_CLOUD_REPORT_BRANCHES)
		.map((branch) => ({
			...(branch.branch ? { branch: truncateLedgerString(branch.branch, MAX_LEDGER_BRANCH_LENGTH) } : {}),
			...(branch.prUrl ? { prUrl: truncateLedgerString(branch.prUrl, MAX_LEDGER_PR_URL_LENGTH) } : {}),
		}))
		.filter((branch) => branch.branch || branch.prUrl);
	return branches.length > 0 ? branches : undefined;
}

function buildBaseEntry(agentId: string, action: CloudLifecycleAction): CursorCloudLifecycleEntryData | undefined {
	if (!agentId || agentId.length > MAX_LEDGER_AGENT_ID_LENGTH) return undefined;
	return {
		action,
		runtime: "cloud",
		agentId,
		timestamp: new Date().toISOString(),
	};
}

function appendCloudLifecycleEntry(pi: CloudLifecycleApi, data: CursorCloudLifecycleEntryData | undefined): void {
	if (!data) return;
	pi.appendEntry<CursorCloudLifecycleEntryData>(CLOUD_LIFECYCLE_ENTRY_TYPE, data);
}

export function registerCursorCloudLifecycleLedger(pi: CloudLifecycleApi): void {
	cloudLifecycleApi = pi;
}

export function recordCursorCloudLifecycleRun(report: CursorCloudRunReport): boolean {
	if (!cloudLifecycleApi) return false;
	const baseEntry = buildBaseEntry(report.agentId, "record");
	if (!baseEntry) return false;
	const branches = buildBranchEntries(report);
	appendCloudLifecycleEntry(cloudLifecycleApi, {
		...baseEntry,
		runId: truncateLedgerString(report.runId, MAX_LEDGER_RUN_ID_LENGTH),
		...(branches ? { branches } : {}),
	});
	return true;
}

export function readCursorCloudLifecycleAgents(entries: readonly SessionEntry[]): CursorCloudLifecycleAgentRecord[] {
	const agents = new Map<string, CursorCloudLifecycleAgentRecord>();
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== CLOUD_LIFECYCLE_ENTRY_TYPE) continue;
		const data = parseCloudLifecycleEntryData(entry.data);
		if (!data) continue;
		const existing = agents.get(data.agentId);
		if (data.action === "record") {
			agents.set(data.agentId, {
				agentId: data.agentId,
				runId: data.runId,
				timestamp: data.timestamp,
				archived: existing?.archived ?? false,
				deleted: existing?.deleted ?? false,
				branches: data.branches ?? [],
			});
			continue;
		}
		if (!existing) continue;
		agents.set(data.agentId, {
			...existing,
			timestamp: data.timestamp,
			archived: data.action === "archive" ? true : existing.archived,
			deleted: data.action === "delete" ? true : existing.deleted,
		});
	}
	return [...agents.values()].filter((agent) => !agent.deleted);
}

function validateRecordedCloudAgentId(agentId: string, records: readonly CursorCloudLifecycleAgentRecord[]): string | undefined {
	if (!agentId) return "Missing Cursor cloud agent ID.";
	if (!agentId.startsWith("bc-")) return "Cursor cloud agent IDs must start with bc-.";
	if (agentId.length > MAX_LEDGER_AGENT_ID_LENGTH) return "Cursor cloud agent ID is too long.";
	if (/[*?[\]{}]/.test(agentId)) return "Wildcards are not allowed; pass exactly one recorded Cursor cloud agent ID.";
	if (!records.some((record) => record.agentId === agentId)) return `Cursor cloud agent ${agentId} is not recorded in this session branch.`;
	return undefined;
}

function tokenizeArgs(args: string): string[] {
	return args.trim().split(/\s+/).filter(Boolean);
}

function formatCloudAgentRecord(record: CursorCloudLifecycleAgentRecord): string {
	const parts = [`- ${record.agentId}${record.archived ? " (archived)" : ""}`];
	if (record.runId) parts.push(`run ${record.runId}`);
	const branch = record.branches.find((candidate) => candidate.branch || candidate.prUrl);
	if (branch?.branch) parts.push(`branch ${branch.branch}`);
	if (branch?.prUrl) parts.push(`PR ${branch.prUrl}`);
	return parts.join(" · ");
}

export function formatCursorCloudLifecycleList(entries: readonly SessionEntry[]): string {
	const records = readCursorCloudLifecycleAgents(entries);
	if (records.length === 0) return "No recorded Cursor cloud agents for this session branch.";
	const visibleRecords = records.slice(0, MAX_LIST_RECORDS);
	const lines = ["Recorded Cursor cloud agents for this session branch:", ...visibleRecords.map(formatCloudAgentRecord)];
	if (records.length > MAX_LIST_RECORDS) lines.push(`- +${records.length - MAX_LIST_RECORDS} more recorded agents`);
	return lines.join("\n");
}

async function getSdkOperations(): Promise<CloudLifecycleSdkOperations> {
	if (sdkOperationsForTests) return sdkOperationsForTests;
	const { Agent } = await loadCursorSdk();
	return {
		archive: (agentId, options) => Agent.archive(agentId, options),
		delete: (agentId, options) => Agent.delete(agentId, options),
	};
}

async function mutateRecordedCloudAgent(params: {
	pi: CloudLifecycleApi;
	ctx: CloudLifecycleCommandContext;
	agentId: string;
	action: "archive" | "delete";
}): Promise<void> {
	const records = readCursorCloudLifecycleAgents(params.ctx.sessionManager.getBranch());
	const validationError = validateRecordedCloudAgentId(params.agentId, records);
	if (validationError) {
		params.ctx.ui.notify(validationError, "error");
		return;
	}
	const apiKey = await resolveCursorRuntimeApiKey();
	try {
		const operations = await getSdkOperations();
		await operations[params.action](params.agentId, apiKey ? { apiKey } : undefined);
	} catch (error) {
		params.ctx.ui.notify(
			`Failed to ${params.action} Cursor cloud agent ${params.agentId}: ${scrubSensitiveText(getString(asRecord(error), "message") ?? String(error), apiKey)}`,
			"error",
		);
		return;
	}
	try {
		appendCloudLifecycleEntry(params.pi, buildBaseEntry(params.agentId, params.action));
	} catch (error) {
		params.ctx.ui.notify(
			`Cursor cloud agent ${params.agentId} ${params.action === "archive" ? "archived" : "deleted"}, but the ledger update failed: ${getString(asRecord(error), "message") ?? String(error)}`,
			"error",
		);
		return;
	}
	params.ctx.ui.notify(`Cursor cloud agent ${params.agentId} ${params.action === "archive" ? "archived" : "deleted"}.`, "info");
}

export async function runCursorCloudLifecycleCommand(pi: CloudLifecycleApi, args: string, ctx: CloudLifecycleCommandContext): Promise<void> {
	const usage = "Usage: /cursor-cloud list | archive <bc-agentId> | delete <bc-agentId> --yes";
	const tokens = tokenizeArgs(args);
	const [subcommand, agentId, ...rest] = tokens;
	if (!subcommand || subcommand === "list") {
		if (tokens.length > (subcommand ? 1 : 0)) {
			ctx.ui.notify(`Invalid Cursor cloud arguments. ${usage}`, "error");
			return;
		}
		ctx.ui.notify(formatCursorCloudLifecycleList(ctx.sessionManager.getBranch()), "info");
		return;
	}
	if (subcommand === "archive") {
		if (!agentId || rest.length > 0) {
			ctx.ui.notify(`Invalid Cursor cloud archive arguments. ${usage}`, "error");
			return;
		}
		await mutateRecordedCloudAgent({ pi, ctx, agentId, action: "archive" });
		return;
	}
	if (subcommand === "delete") {
		if (!agentId || rest.length !== 1 || rest[0] !== "--yes") {
			ctx.ui.notify(`Delete requires exactly one recorded bc- cloud agent ID and --yes. ${usage}`, "error");
			return;
		}
		await mutateRecordedCloudAgent({ pi, ctx, agentId, action: "delete" });
		return;
	}
	ctx.ui.notify(`Invalid Cursor cloud command. ${usage}`, "error");
}

export const __testUtils = {
	reset: () => {
		cloudLifecycleApi = undefined;
		sdkOperationsForTests = undefined;
	},
	setSdkOperations: (operations: CloudLifecycleSdkOperations | undefined) => {
		sdkOperationsForTests = operations;
	},
};
