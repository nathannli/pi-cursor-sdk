export function buildCloudSmokeEnv(artifactDir: string, options?: { contextHandoff?: "fresh" | "bootstrap" | "never" }): NodeJS.ProcessEnv;
export function buildCloudSmokeWorkspace(artifactDir: string): string;
export function cloudAgentIdsFromLifecycleArtifacts(artifactDir: string): string[];
