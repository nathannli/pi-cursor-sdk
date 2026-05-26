#!/usr/bin/env node
/**
 * Maintainer probe: measure Cursor SDK cold-start timing with/without ambient MCP settings
 * and with the pi-cursor-sdk MCP connect timeout override installed.
 */
import { performance } from "node:perf_hooks";
import {
	installCursorMcpToolTimeoutOverride,
	restoreCursorMcpToolTimeoutOverride,
} from "../src/cursor-mcp-timeout-override.ts";
import { scrubSensitiveText } from "./lib/cursor-probe-utils.mjs";
import { installCursorSdkOutputFilter, suppressCursorSdkOutput } from "./lib/cursor-sdk-output-filter.mjs";

function printHelp() {
	console.log(`Measure Cursor SDK first-send MCP cold-start timing.

Usage:
  CURSOR_API_KEY=... npm run debug:mcp-coldstart
  node scripts/probe-mcp-coldstart.mjs [options]

Options:
  --api-key <key>   Cursor API key. Prefer CURSOR_API_KEY to avoid shell history.
  -h, --help        Show this help without importing or calling the Cursor SDK.

Stdout:
  Emits one JSON object per scenario. Human status lines go to stderr.

Scenarios:
  with-all-settings                   Cursor settingSources=["all"]
  with-all-settings+connect-override  Same, with pi-cursor-sdk timeout override installed
  no-setting-sources                  No explicit settingSources

Safety:
  - --help never performs live Cursor calls.
  - SDK startup noise is suppressed.
  - Error messages are scrubbed for API keys, bearer tokens, cookies, and bridge endpoints.`);
}

function fail(message, apiKey) {
	console.error(`probe-mcp-coldstart: ${scrubSensitiveText(message, apiKey)}`);
	process.exit(1);
}

function parseArgs(argv, env = process.env) {
	const args = {
		apiKey: env.CURSOR_API_KEY?.trim() || undefined,
		help: false,
	};
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "-h" || arg === "--help") {
			args.help = true;
			continue;
		}
		if (arg === "--api-key") {
			const value = argv[++index];
			if (!value || value.startsWith("--")) fail("--api-key requires a value", args.apiKey);
			args.apiKey = value.trim();
			continue;
		}
		if (arg.startsWith("--api-key=")) {
			args.apiKey = arg.slice("--api-key=".length).trim();
			continue;
		}
		fail(`unknown argument: ${arg}`, args.apiKey);
	}
	return args;
}

async function probe(Agent, apiKey, label, { settingSources, installConnectOverride = false } = {}) {
	let agent;
	try {
		if (installConnectOverride) {
			const state = installCursorMcpToolTimeoutOverride();
			console.error(
				`probe-mcp-coldstart: installed connect override (${state.connectTimeoutMs}ms initialize/listTools, ${state.timeoutMs}ms callTool)`,
			);
		}

		const marks = [];
		const t0 = performance.now();
		const mark = (name) => marks.push({ name, ms: Math.round(performance.now() - t0) });

		mark("start");
		agent = await suppressCursorSdkOutput(() =>
			Agent.create({
				apiKey,
				model: { id: "composer-2.5" },
				local: settingSources
					? { cwd: process.cwd(), settingSources }
					: { cwd: process.cwd() },
			}),
		);
		mark("agent.create");

		let firstDeltaMs;
		const run = await suppressCursorSdkOutput(() =>
			agent.send("Reply with exactly: pong", {
				onDelta: ({ update }) => {
					if (firstDeltaMs === undefined && update.type === "text-delta") {
						firstDeltaMs = Math.round(performance.now() - t0);
						mark("first-delta");
					}
				},
			}),
		);
		mark("agent.send-returned");

		const result = await suppressCursorSdkOutput(() => run.wait());
		mark("run.wait");

		await suppressCursorSdkOutput(() => agent[Symbol.asyncDispose]());
		agent = undefined;
		mark("dispose");

		const sendReturnedMs = marks.find((entry) => entry.name === "agent.send-returned")?.ms;
		const mcpBlockingMs =
			firstDeltaMs !== undefined && sendReturnedMs !== undefined ? firstDeltaMs - sendReturnedMs : undefined;

		return {
			label,
			settingSources: settingSources ?? null,
			installConnectOverride,
			marks,
			firstDeltaMs,
			mcpBlockingMs,
			status: result.status,
			text: typeof result.result === "string" ? result.result.slice(0, 120) : null,
		};
	} finally {
		try {
			if (agent) {
				await suppressCursorSdkOutput(() => agent[Symbol.asyncDispose]()).catch(() => undefined);
			}
		} finally {
			restoreCursorMcpToolTimeoutOverride();
		}
	}
}

async function main(argv = process.argv.slice(2), env = process.env) {
	const args = parseArgs(argv, env);
	if (args.help) {
		printHelp();
		return;
	}
	if (!args.apiKey) {
		fail("CURSOR_API_KEY is required. Set CURSOR_API_KEY or pass --api-key.");
	}

	const restoreOutputFilter = installCursorSdkOutputFilter();
	try {
		const { Agent } = await suppressCursorSdkOutput(() => import("@cursor/sdk"));
		for (const scenario of [
			{ label: "with-all-settings", settingSources: ["all"] },
			{ label: "with-all-settings+connect-override", settingSources: ["all"], installConnectOverride: true },
			{ label: "no-setting-sources", settingSources: undefined },
		]) {
			try {
				console.log(JSON.stringify(await probe(Agent, args.apiKey, scenario.label, scenario)));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.log(
					JSON.stringify({
						label: scenario.label,
						error: scrubSensitiveText(message, args.apiKey),
					}),
				);
			}
		}
	} finally {
		restoreCursorMcpToolTimeoutOverride();
		restoreOutputFilter();
	}
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
	main().catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		fail(message, process.env.CURSOR_API_KEY);
	});
}
