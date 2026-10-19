/**
 * Premium local abilities and Upgrade Lab math. This module is deterministic and has no DOM/network
 * dependencies so prices, caps and combat numbers stay easy to test.
 */
import { UPGRADE_IDS, type UpgradeId } from './content'

export type UpgradeLevels = Record<UpgradeId, number>
/** Eight purchases make the shrink progression reach the advertised 10…80% range. */
export const MAX_UPGRADE_LEVEL = 8

export type UpgradeDefinition = {
  id: UpgradeId
  maxLevel: number
  /** Price of level one. Later levels multiply this by the escalation factor. */
  basePrice: number
  /** Description keys are deliberately shared by the English and Arabic dictionaries. */
  color: number
}

export const UPGRADE_DEFS: Record<UpgradeId, UpgradeDefinition> = {
  ghost: { id: 'ghost', maxLevel: MAX_UPGRADE_LEVEL, basePrice: 2500, color: 0xb9a8ff },
  electric: { id: 'electric', maxLevel: MAX_UPGRADE_LEVEL, basePrice: 1900, color: 0x63e7ff },
  shrink: { id: 'shrink', maxLevel: MAX_UPGRADE_LEVEL, basePrice: 1400, color: 0xf59aff },
  bomb: { id: 'bomb', maxLevel: MAX_UPGRADE_LEVEL, basePrice: 2200, color: 0xff805e },
}

/** Prices are intentionally steep: upgrades are a long-term Stardust sink, not a free buff. */
export const UPGRADE_PRICE_ESCALATION = 2.35

export const emptyUpgradeLevels = (): UpgradeLevels => ({ ghost: 0, electric: 0, shrink: 0, bomb: 0 })

export function upgradeLevel(levels: Partial<UpgradeLevels> | null | undefined, id: UpgradeId): number {
  const raw = levels?.[id]
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.min(MAX_UPGRADE_LEVEL, Math.max(0, Math.floor(raw))) : 0
}

export function sanitizeUpgradeLevels(raw: unknown): UpgradeLevels {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return Object.fromEntries(UPGRADE_IDS.map(id => [id, upgradeLevel(value as Partial<UpgradeLevels>, id)])) as UpgradeLevels
}

/** `nextLevel` is one-based. A zero price is never returned for a real purchase. */
export function upgradePrice(id: UpgradeId, nextLevel: number): number {
  const def = UPGRADE_DEFS[id]
  const level = Math.min(def.maxLevel, Math.max(1, Math.floor(nextLevel)))
  return Math.round(def.basePrice * Math.pow(UPGRADE_PRICE_ESCALATION, level - 1))
}

export function nextUpgradePrice(id: UpgradeId, currentLevel: number): number | null {
  const level = upgradeLevel({ [id]: currentLevel }, id)
  return level >= UPGRADE_DEFS[id].maxLevel ? null : upgradePrice(id, level + 1)
}

export function ghostDuration(level: number): number {
  return level <= 0 ? 0 : 4 + Math.min(MAX_UPGRADE_LEVEL, level) * 0.9
}

export function electricDuration(level: number): number {
  return level <= 0 ? 0 : 4 + Math.min(MAX_UPGRADE_LEVEL, level) * 0.85
}

/** Length removed from an attacker on an electric collision. */
export function electricDamage(level: number): number {
  return level <= 0 ? 0 : 3 + Math.min(MAX_UPGRADE_LEVEL, level) * 1.75
}

/** Percentage of the worm's current length removed by an upgraded shrink surprise. */
export function shrinkReductionPercent(level: number): number {
  return level <= 0 ? 0 : Math.min(80, Math.floor(level) * 10)
}

export function shrinkDuration(level: number): number {
  return level <= 0 ? 12 : 12 + Math.min(MAX_UPGRADE_LEVEL, level) * 2
}

export function shrinkScale(level: number): number {
  return level <= 0 ? 0.58 : Math.max(0.34, 0.58 - Math.min(MAX_UPGRADE_LEVEL, level) * 0.03)
}

export function bombLifetime(level: number): number {
  return level <= 0 ? 0 : 6 + Math.min(MAX_UPGRADE_LEVEL, level) * 1.5
}

export function bombDamage(level: number): number {
  return level <= 0 ? 0 : 4 + Math.min(MAX_UPGRADE_LEVEL, level) * 2.5
}

export function bombLimit(level: number): number {
  return level <= 0 ? 0 : 1 + Math.floor((Math.min(MAX_UPGRADE_LEVEL, level) - 1) / 2)
}

export function hasUpgrade(levels: Partial<UpgradeLevels> | null | undefined, id: UpgradeId): boolean {
  return upgradeLevel(levels, id) > 0
}
