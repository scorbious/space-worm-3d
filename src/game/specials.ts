/** Local arena surprises and edible traps. No rendering or persistence dependencies. */
export const SURPRISE_IDS = ['zone', 'legendary', 'shrink'] as const
export type SurpriseId = typeof SURPRISE_IDS[number]
export const TRAP_IDS = ['freeze', 'slow', 'reverse', 'half', 'teleport'] as const
export type TrapId = typeof TRAP_IDS[number]
export type TimedTrapId = Extract<TrapId, 'freeze' | 'slow' | 'reverse'>
export const SPECIALS = {
  surpriseLifetime: 5,
  surpriseChainWindow: 90,
  surpriseChainBonus: 3,
  surpriseDurationCap: 42,
  firstSurprise: 18,
  zoneDuration: 18,
  zoneExpansion: 28,
  legendaryExpansion: 14,
  maxLegendaryExpansion: 84,
  shrinkDuration: 12,
  shrinkScale: 0.58,
  returnWarning: 5,
  trapCount: 5,
  trapLifetime: 36,
  trapRespawn: 7,
  recovery: 2,
} as const
export const TRAP_DURATIONS: Record<TrapId, number> = { freeze: 1.6, slow: 4, reverse: 3.5, half: 0, teleport: 0 }
export const SPECIAL_COLORS: Record<SurpriseId | TrapId, number> = {
  zone: 0x63ffe0, legendary: 0xffd54f, shrink: 0xf59aff,
  freeze: 0x8fe8ff, slow: 0xffa04f, reverse: 0xc792ff, half: 0xff4d6d, teleport: 0x698bff,
}
/** The crown, high current length/score, or a strong kill streak unlocks rare drops. */
export function isDominant(length: number, crowned: boolean, kills: number): boolean {
  return crowned || length >= 90 || kills >= 4
}
/** Stronger dominance shortens the delay, but never below 30 seconds (one drop at a time). */
export function surpriseInterval(length: number, crowned: boolean, kills: number): number {
  return Math.max(30, 80 - Math.min(32, length * 0.1) - (crowned ? 10 : 0) - Math.min(8, kills * 2))
}
/** Planet/core stacks resist trap duration, at most 45%; instant traps still apply fully. */
export function trapDuration(kind: TrapId, coreStacks: number): number {
  return TRAP_DURATIONS[kind] * (1 - Math.min(3, Math.max(0, coreStacks)) * 0.15)
}
