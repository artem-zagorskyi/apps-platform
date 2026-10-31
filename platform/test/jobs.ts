// Jobs sent by code under test while no queue runs (see test/setup.ts)
export const queuedJobs: { name: string; data: Record<string, unknown> }[] = [];