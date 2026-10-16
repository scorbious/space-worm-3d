/**
 * Pure gameplay rules. No three.js, DOM or randomness here so everything is unit tested.
 */
import { CONFIG } from './config'
import { CELESTIALS, POWERS, POWER_IDS, type CelestialId, type PowerId } from './content'

export type Mode = 'ffa' | 'team'

export type PowerStacks = Record<PowerId, number>
export const emptyStacks = (): PowerStacks => ({ tide: 0, tail: 0, core: 0, drive: 0, heart: 0 })

/** Segment count for a given mass. Mass is the continuous quantity; length is what players see. */
export function lengthFromMass(mass: number): number {
  return Math.max(4, Math.floor(mass))
}

/**
 * Bite rule: a clearly longer worm's head cuts through a shorter rival's body instead of dying.
 * Near-ties stay lethal both ways so the rule never feels random.
 */
export function canBite(biterLength: number, victimLength: number): boolean {
  return biterLength >= victimLength * CONFIG.bite.ratio && biterLength - victimLength >= CONFIG.bite.minLead
}

/** Body radius grows quickly at first, then levels off so giant worms stay readable. */
export function radiusForLength(length: number): number {
  return 0.9 + 1.25 * (1 - Math.exp(-Math.max(0, length - CONFIG.worm.startLength) / 170))
}

export function spacingForRadius(radius: number): number {
  return radius * CONFIG.worm.spacing
}

/** Turn rate slows down as the worm thickens, widening its tightest circle. */
export function turnRateFor(radius: number): number {
  return CONFIG.worm.turnRate / (0.72 + radius * 0.31)
}

/** Head segments that can never collide with the worm itself (neck region). */
export function selfSafeSegments(radius: number): number {
  return Math.ceil((radius * 4.2) / spacingForRadius(radius)) + 4
}

export type PowerEffects = {
  /** Multiplier for the pickup radius. */
  pickup: number
  /** Multiplier for the length spent while boosting. */
  boostCost: number
  /** Fraction of gravity well slowdown that still applies. */
  wellSlow: number
  /** Multiplier for movement speed. */
  speed: number
  /** Multiplier for growth from energy. */
  growth: number
}

export function powerEffects(stacks: PowerStacks): PowerEffects {
  const n = (id: PowerId) => Math.min(POWERS[id].maxStacks, Math.max(0, stacks[id] | 0))
  return {
    pickup: 1 + 0.25 * n('tide'),
    boostCost: Math.pow(0.8, n('tail')),
    wellSlow: Math.pow(0.6, n('core')),
    speed: 1 + 0.07 * n('drive'),
    growth: 1 + 0.2 * n('heart'),
  }
}

/** Grant the power a swallowed celestial carries. Returns false when already at max stacks. */
export function addPower(stacks: PowerStacks, celestial: CelestialId): boolean {
  const power = CELESTIALS[celestial].power
  if (stacks[power] >= POWERS[power].maxStacks) return false
  stacks[power] += 1
  return true
}

export function canConsume(length: number, celestial: CelestialId): boolean {
  return length >= CELESTIALS[celestial].minLength
}

/** Gravity wells slow movement near their center; the planet's power resists it. */
export function wellSpeedFactor(distance: number, wellRadius: number, wellSlow: number): number {
  if (distance >= wellRadius) return 1
  const depth = 1 - distance / wellRadius
  return 1 - Math.min(0.62, 0.25 + depth * 0.5) * wellSlow
}

export type GateState = { phase: 'off' | 'warn' | 'on'; remaining: number }

/** Energy gates cycle off → warn → on. `offset` staggers gates so the arena keeps changing. */
export function gateState(time: number, period: number, onSeconds: number, offset: number, warnSeconds = 1.2): GateState {
  const t = (((time + offset) % period) + period) % period
  const offEnd = period - onSeconds
  if (t >= offEnd) return { phase: 'on', remaining: period - t }
  if (t >= offEnd - warnSeconds) return { phase: 'warn', remaining: offEnd - t }
  return { phase: 'off', remaining: offEnd - warnSeconds - t }
}

export type LifeSummary = {
  mode: Mode
  peakLength: number
  kills: number
  celestials: number
  shards: number
  seconds: number
}

/** Stardust awarded at the end of a life on top of collected shards. */
export function stardustForLife(life: LifeSummary): number {
  return Math.floor(life.peakLength / 6) + life.kills * 8 + life.celestials * 4 + life.shards
}

export type LifeEntry = { name: string; length: number; kills: number; seconds: number; mode: Mode; at: number }
export const LOCAL_BOARD_SIZE = 10

/** Bounded, deterministic local board: longest peak, then more kills, then earlier. */
export function insertLife(board: LifeEntry[], entry: LifeEntry): { board: LifeEntry[]; rank: number } {
  const next = [...board, entry].sort((a, b) => b.length - a.length || b.kills - a.kills || a.at - b.at).slice(0, LOCAL_BOARD_SIZE)
  return { board: next, rank: next.indexOf(entry) }
}

export type Records = {
  bestLength: number
  mostKills: number
  mostCelestials: number
  longestLife: number
  lives: number
  totalKills: number
  totalStardust: number
  teamWins: number
  teamMatches: number
}
export const emptyRecords = (): Records => ({
  bestLength: 0, mostKills: 0, mostCelestials: 0, longestLife: 0, lives: 0, totalKills: 0, totalStardust: 0, teamWins: 0, teamMatches: 0,
})

/** Fold one finished life into the records; returns which personal bests were beaten. */
export function applyLife(records: Records, life: LifeSummary, stardust: number): { records: Records; newBests: (keyof Records)[] } {
  const next = { ...records }
  const newBests: (keyof Records)[] = []
  const best = (key: 'bestLength' | 'mostKills' | 'mostCelestials' | 'longestLife', value: number) => {
    if (value > next[key]) {
      if (next[key] > 0 || key === 'bestLength') newBests.push(key)
      next[key] = value
    }
  }
  best('bestLength', life.peakLength)
  best('mostKills', life.kills)
  best('mostCelestials', life.celestials)
  best('longestLife', Math.floor(life.seconds))
  next.lives += 1
  next.totalKills += life.kills
  next.totalStardust += stardust
  return { records: next, newBests }
}

export function teamWinner(scores: readonly [number, number]): 0 | 1 | -1 {
  if (scores[0] === scores[1]) return -1
  return scores[0] > scores[1] ? 0 : 1
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Online submissions are only valid inside the board's duration window. */
export function lifeEligibleForBoard(peakLength: number, durationMs: number): boolean {
  return peakLength >= 1 && peakLength <= 100000 && durationMs >= 3000 && durationMs <= 1800000
}

export const ALL_POWERS = POWER_IDS
