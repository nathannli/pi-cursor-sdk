// Platform smoke configuration for pi-cursor-sdk.
// Reusable across pi extensions: change package name, model IDs, scenarios, and card matrix only.

export default {
	packageName: "pi-cursor-sdk",
	cursorModel: "cursor/composer-2-5",
	artifactRoot: ".artifacts/platform-smoke",
	requiredTargets: ["macos", "ubuntu", "windows-native"],
	requiredSuites: [
		"platform-build",
		"cursor-native-visual-matrix",
		"cursor-bridge-visual-matrix",
		"cursor-abort-cleanup",
	],
	requiredCrabbox: {
		source: "https://github.com/openclaw/crabbox",
		commit: "190257b0f6097552205092ab2b579f6aa0232491",
	},
	ubuntuContainerImage: "cimg/node:24.16",
	nodeValidationMajor: 24,
};
