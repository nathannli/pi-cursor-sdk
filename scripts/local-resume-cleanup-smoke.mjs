export async function runCleanupSmoke(h) {
	const {
		assertExactStringArray,
		assertNotResumedFrom,
		assertTurnMetadata,
		cleanupArtifactRoot,
		createRunContext,
		fail,
		getEntries,
		latestResumeEntry,
		parseTimeout,
		promptAndRead,
		resumeEntries,
		rpcData,
		startRpc,
		waitForCleanupEntryCount,
		writeTreeCommandExtension,
	} = h;
	const timeoutMs = parseTimeout();
	const { artifactRoot, sessionDir, sessionId, seenMetadata } = createRunContext("pi-cursor-local-resume-cleanup-smoke-");
	const token = `LOCAL_CLEANUP_${Date.now()}`;
	const extensionPath = writeTreeCommandExtension(artifactRoot);
	let oldAgentId;
	let newAgentId;
	let oldResumeEntryId;
	console.error(`[local-resume-smoke] artifacts: ${artifactRoot}`);
	try {
		let rpc = startRpc({ artifactDir: artifactRoot, sessionDir, sessionId });
		try {
			const baseline = await promptAndRead({
				rpc,
				artifactDir: artifactRoot,
				message: `Remember exact cleanup token ${token}. Reply exactly CLEANUP_BASELINE_OK.`,
				timeoutMs,
				seenMetadata,
			});
			assertTurnMetadata("cleanup baseline", baseline, { resumedAgent: false });
			oldAgentId = baseline.metadata.run.agentId;
			oldResumeEntryId = resumeEntries(await getEntries(rpc)).at(-1)?.id;
			if (!oldResumeEntryId) fail("cleanup baseline did not persist a resume entry");
		} finally {
			await rpc.stop();
		}

		rpc = startRpc({ artifactDir: artifactRoot, sessionDir, sessionId, bridge: true, exposeBuiltinTools: true });
		try {
			const changedSurface = await promptAndRead({
				rpc,
				artifactDir: artifactRoot,
				message: "From this conversation memory only, what exact LOCAL_CLEANUP token did I ask you to remember before the tool-surface change? Reply exactly TOKEN=<token> if known, otherwise NO_TOKEN. Do not inspect environment variables or files.",
				timeoutMs,
				seenMetadata,
			});
			assertNotResumedFrom("cleanup changed tool surface", changedSurface, oldAgentId);
			newAgentId = changedSurface.metadata.run.agentId;
			const changedHandle = latestResumeEntry(await getEntries(rpc));
			if (!changedHandle?.cleanupCandidateAgentIds?.includes(oldAgentId)) fail("changed tool surface did not record old agent cleanup candidate", JSON.stringify({ oldAgentId, changedHandle }, null, 2));

			await rpcData(rpc, "prompt", { message: "/cursor-local-resume-cleanup --dry-run" }, timeoutMs);
			let latestCleanup = (await waitForCleanupEntryCount(rpc, 1, timeoutMs)).at(-1)?.data;
			if (latestCleanup?.action !== "dry-run" || latestCleanup.deletedAgentIds?.length || latestCleanup.failedAgentIds?.length) {
				fail("cleanup dry-run did not record a pure dry-run", JSON.stringify(latestCleanup, null, 2));
			}
			assertExactStringArray("cleanup dry-run candidates", latestCleanup.candidateAgentIds, [oldAgentId]);

			await rpcData(rpc, "prompt", { message: "/cursor-local-resume-cleanup --yes" }, timeoutMs);
			latestCleanup = (await waitForCleanupEntryCount(rpc, 2, timeoutMs)).at(-1)?.data;
			if (latestCleanup?.action !== "delete" || latestCleanup.failedAgentIds?.length) {
				fail("cleanup delete did not record a clean delete", JSON.stringify(latestCleanup, null, 2));
			}
			assertExactStringArray("cleanup delete candidates", latestCleanup.candidateAgentIds, [oldAgentId]);
			assertExactStringArray("cleanup deleted agents", latestCleanup.deletedAgentIds, [oldAgentId]);
		} finally {
			await rpc.stop();
		}

		rpc = startRpc({ artifactDir: artifactRoot, sessionDir, sessionId, bridge: true, exposeBuiltinTools: true });
		try {
			const restart = await promptAndRead({
				rpc,
				artifactDir: artifactRoot,
				message: "From this conversation memory only, what exact LOCAL_CLEANUP token did I ask you to remember before cleanup? Reply exactly TOKEN=<token> if known, otherwise NO_TOKEN. Do not inspect environment variables or files.",
				timeoutMs,
				seenMetadata,
			});
			assertTurnMetadata("cleanup preserved current agent", restart, { resumedAgent: true });
			if (restart.metadata.run.agentId !== newAgentId) fail("cleanup deleted or failed to resume the current recorded agent", JSON.stringify({ expected: newAgentId, actual: restart.metadata.run.agentId }, null, 2));
		} finally {
			await rpc.stop();
		}

		rpc = startRpc({ artifactDir: artifactRoot, sessionDir, sessionId, extraExtensions: [extensionPath] });
		try {
			const oldBranch = await promptAndRead({
				rpc,
				artifactDir: artifactRoot,
				message: `/local_resume_tree_go ${oldResumeEntryId} From this conversation memory only, what exact LOCAL_CLEANUP token did I ask you to remember before old-agent cleanup? Reply exactly TOKEN=<token> if known, otherwise NO_TOKEN. Do not inspect environment variables or files.`,
				timeoutMs,
				seenMetadata,
			});
			assertNotResumedFrom("cleanup deleted old agent", oldBranch, oldAgentId);
			if (!oldBranch.text.includes(`TOKEN=${token}`)) fail("cleanup old-branch fallback did not bootstrap token", JSON.stringify({ expected: `TOKEN=${token}`, actual: oldBranch.text }, null, 2));
		} finally {
			await rpc.stop();
		}

		console.log("local-resume-cleanup-smoke-ok");
		console.error(`[local-resume-smoke] cleanup deleted recorded old ${oldAgentId} and preserved current ${newAgentId}`);
	} finally {
		cleanupArtifactRoot(artifactRoot);
	}
}

