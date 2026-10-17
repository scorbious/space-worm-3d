export const ENVIRONMENTS = ['forest', 'ocean', 'dunes', 'solar', 'aurora', 'crystal'] as const
export type EnvironmentId = typeof ENVIRONMENTS[number]
export function environmentFor(stage: number, roundOffset: number): EnvironmentId {
  const index = ((Math.max(1, Math.floor(stage)) - 1 + Math.floor(roundOffset)) % ENVIRONMENTS.length + ENVIRONMENTS.length) % ENVIRONMENTS.length
  return ENVIRONMENTS[index]
}
