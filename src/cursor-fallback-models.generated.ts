import type { ModelListItem } from "@cursor/sdk";

// Generated/maintained fallback Cursor catalog snapshot.
// Refresh with: npm run refresh:cursor-snapshots -- --write
// Do not add secrets; this file stores public model metadata only.
export const FALLBACK_MODEL_ITEMS = [
	{
		id: "composer-2",
		displayName: "Cursor Composer 2",
		parameters: [
			{
				id: "fast",
				displayName: "Fast",
				values: [{ value: "false" }, { value: "true" }],
			},
		],
		variants: [
			{
				params: [{ id: "fast", value: "true" }],
				displayName: "Cursor Composer 2",
				isDefault: true,
			},
		],
	},
	{
		id: "gpt-5.5",
		displayName: "GPT-5.5",
		parameters: [
			{
				id: "context",
				displayName: "Context",
				values: [{ value: "1m" }, { value: "272k" }],
			},
			{
				id: "reasoning",
				displayName: "Reasoning",
				values: [
					{ value: "none" },
					{ value: "low" },
					{ value: "medium" },
					{ value: "high" },
					{ value: "extra-high" },
				],
			},
			{
				id: "fast",
				displayName: "Fast",
				values: [{ value: "false" }, { value: "true" }],
			},
		],
		variants: [
			{
				params: [
					{ id: "context", value: "1m" },
					{ id: "reasoning", value: "medium" },
					{ id: "fast", value: "false" },
				],
				displayName: "GPT-5.5",
				isDefault: true,
			},
		],
	},
	{
		id: "claude-sonnet-4-6",
		displayName: "Sonnet 4.6",
		parameters: [
			{
				id: "thinking",
				displayName: "Thinking",
				values: [{ value: "false" }, { value: "true" }],
			},
			{
				id: "context",
				displayName: "Context",
				values: [{ value: "1m" }, { value: "200k" }],
			},
			{
				id: "effort",
				displayName: "Effort",
				values: [
					{ value: "low" },
					{ value: "medium" },
					{ value: "high" },
					{ value: "xhigh" },
					{ value: "max" },
				],
			},
			{
				id: "fast",
				displayName: "Fast",
				values: [{ value: "false" }, { value: "true" }],
			},
		],
		variants: [
			{
				params: [
					{ id: "thinking", value: "true" },
					{ id: "context", value: "1m" },
					{ id: "effort", value: "medium" },
					{ id: "fast", value: "false" },
				],
				displayName: "Sonnet 4.6",
				isDefault: true,
			},
		],
	},
	{
		id: "claude-opus-4-7",
		displayName: "Opus 4.7",
		parameters: [
			{
				id: "thinking",
				displayName: "Thinking",
				values: [{ value: "false" }, { value: "true" }],
			},
			{
				id: "context",
				displayName: "Context",
				values: [{ value: "1m" }, { value: "300k" }],
			},
			{
				id: "effort",
				displayName: "Effort",
				values: [
					{ value: "low" },
					{ value: "medium" },
					{ value: "high" },
					{ value: "xhigh" },
					{ value: "max" },
				],
			},
		],
		variants: [
			{
				params: [
					{ id: "thinking", value: "true" },
					{ id: "context", value: "1m" },
					{ id: "effort", value: "xhigh" },
				],
				displayName: "Opus 4.7",
				isDefault: true,
			},
		],
	},
] satisfies ModelListItem[];
