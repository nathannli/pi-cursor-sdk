import { describe, expect, it } from "vitest";
import type { HarnessEventMap } from "./pi-harness.js";

describe("pi-harness event map types", () => {
	it("keeps compile-time negative fixtures for invalid harness payloads", () => {
		expect(true).toBe(true);
	});
});

// Negative compile tests: invalid harness payloads must not type-check.
// @ts-expect-error session_start requires type and reason
const _invalidSessionStart: HarnessEventMap["session_start"] = {};

// @ts-expect-error model_select requires a concrete model
const _invalidModelSelect: HarnessEventMap["model_select"] = {
	type: "model_select",
	model: undefined,
	previousModel: undefined,
	source: "set",
};

export {};
