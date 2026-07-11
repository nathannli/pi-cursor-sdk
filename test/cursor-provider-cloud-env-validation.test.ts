import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerCursorRuntimeControls } from "../src/cursor-state.js";
import { streamCursor } from "../src/cursor-provider.js";
import {
	collectEvents,
	createPiHarness,
	getErrorEvent,
	makeContext,
	makeModel,
	mockCreatedAgent,
	mockedCreate,
	mockedResume,
	resetCursorProviderTestState,
} from "./helpers/cursor-provider-harness.js";

describe("streamCursor cloud env request validation", () => {
	beforeEach(resetCursorProviderTestState);

	it("rejects an all-invalid PI_CURSOR_CLOUD_ENV request before SDK calls", async () => {
		process.env.PI_CURSOR_CLOUD_ENV = "bad-name,CURSOR_SECRET,9INVALID";
		const send = vi.fn();
		mockCreatedAgent({ send });

		const events = await collectEvents(streamCursor(makeModel("gpt-5.5@1m"), makeContext(), { apiKey: "test-key" }));

		expect(getErrorEvent(events).error.errorMessage).toContain(
			"Invalid PI_CURSOR_CLOUD_ENV: no valid environment variable names were requested.",
		);
		expect(mockedCreate).not.toHaveBeenCalled();
		expect(mockedResume).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});

	it("rejects credential-bearing cloud repo URLs before Agent.create without echoing credentials", async () => {
		process.env.PI_CURSOR_RUNTIME = "cloud";
		process.env.PI_CURSOR_CLOUD_ACK = "1";
		process.env.PI_CURSOR_CLOUD_ALLOW_LOCAL_STATE = "1";
		process.env.PI_CURSOR_CLOUD_REPO = "https://repo-user:repo-secret@example.com/org/repo.git";

		const events = await collectEvents(streamCursor(makeModel("gpt-5.5@1m"), makeContext(), { apiKey: "test-key" }));
		const message = getErrorEvent(events).error.errorMessage;

		expect(message).toContain("HTTPS repository URL without embedded credentials");
		expect(message).not.toContain("repo-user");
		expect(message).not.toContain("repo-secret");
		expect(mockedCreate).not.toHaveBeenCalled();
	});

	it("keeps valid names from a mixed request for the existing forwarding preflight", async () => {
		process.env.PI_CURSOR_RUNTIME = "cloud";
		process.env.PI_CURSOR_CLOUD_ACK = "1";
		process.env.PI_CURSOR_CLOUD_ALLOW_LOCAL_STATE = "1";
		process.env.PI_CURSOR_CLOUD_ENV = "bad-name,NODE_ENV,CURSOR_SECRET";

		const events = await collectEvents(streamCursor(makeModel("gpt-5.5@1m"), makeContext(), { apiKey: "test-key" }));

		const message = getErrorEvent(events).error.errorMessage;
		expect(message).toContain("Cursor cloud env forwarding is not implemented");
		expect(message).not.toContain("no valid environment variable names");
		expect(mockedCreate).not.toHaveBeenCalled();
	});

	it("rejects an all-invalid --cursor-cloud-env request before SDK calls", async () => {
		const pi = createPiHarness({ flagValues: { "cursor-cloud-env": "bad-name,CURSOR_SECRET,9INVALID" } });
		registerCursorRuntimeControls(pi);
		await pi.runSessionStart({ model: makeModel("gpt-5.5@1m") });
		const send = vi.fn();
		mockCreatedAgent({ send });

		const events = await collectEvents(streamCursor(makeModel("gpt-5.5@1m"), makeContext(), { apiKey: "test-key" }));

		expect(getErrorEvent(events).error.errorMessage).toContain(
			"Invalid --cursor-cloud-env: no valid environment variable names were requested.",
		);
		expect(mockedCreate).not.toHaveBeenCalled();
		expect(mockedResume).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});
});
