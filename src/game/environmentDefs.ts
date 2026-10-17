export const ENVIRONMENTS = ['forest', 'ocean', 'dunes', 'solar', 'aurora', 'crystal'] as const
export type EnvironmentId = typeof ENVIRONMENTS[number]
export const ENVIRONMENT_SECONDS = 180

/** Anchored to active round time, NOT time since the most recent stage. */
export function environmentEpoch(elapsedSeconds: number): number {
  const seconds = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0
  // Only a nanosecond of tolerance for floating-point accumulation at an exact fixed-step edge.
  return Math.floor((seconds + 1e-9) / ENVIRONMENT_SECONDS)
}

export function environmentFor(stage: number, roundOffset: number, elapsedSeconds = 0): EnvironmentId {
  const safeStage = Number.isFinite(stage) ? Math.max(1, Math.floor(stage)) : 1
  const offset = Number.isFinite(roundOffset) ? Math.floor(roundOffset) : 0
  const index = ((safeStage - 1 + offset + environmentEpoch(elapsedSeconds)) % ENVIRONMENTS.length + ENVIRONMENTS.length) % ENVIRONMENTS.length
  return ENVIRONMENTS[index]
}
