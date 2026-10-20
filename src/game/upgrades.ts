/**
 * Premium local abilities and Upgrade Lab math. This module is deterministic and has no DOM/network
 * dependencies so prices, caps and combat numbers stay easy to test.
 */
import { UPGRADE_IDS, type UpgradeId } from './content'
import * as balance from '../../server/abilities.mjs'

export type UpgradeLevels = Record<UpgradeId, number>
/** Ten purchases make the shrink progression reach the advertised 10…100% range. */
export const MAX_UPGRADE_LEVEL = 10

/** The destructive laser is a separate, one-shot campaign purchase. */
export const LASER_PRICE = 250000

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
  electric: { id: 'electric', maxLevel: MAX_UPGRADE_LEVEL, basePrice: 1900, color: 0xffe44f },
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

export { ghostDuration, ghostCooldown, electricDuration, electricDamage, electricCooldown, bombLifetime, bombDamage, bombLimit, bombCooldown, shrinkDuration, shrinkCooldown, shrinkScale, shrinkReductionPercent, LASER_RANGE, LASER_CONE } from '../../server/abilities.mjs'

export function hasUpgrade(levels: Partial<UpgradeLevels> | null | undefined, id: UpgradeId): boolean {
  return upgradeLevel(levels, id) > 0
}

export const needsPurchaseConfirmation = (price: number): boolean => price >= 10000
export function upgradeStats(id: UpgradeId, level: number): { duration: number; damage: number; cooldown: number; count: number } {
  const n = upgradeLevel({ [id]: level }, id)
  const tidy = (v: number) => Math.round(v * 10) / 10
  switch (id) {
    case 'ghost': return { duration: tidy(balance.ghostDuration(n)), damage: 0, cooldown: tidy(balance.ghostCooldown(n)), count: n ? 1 : 0 }
    case 'electric': return { duration: tidy(balance.electricDuration(n)), damage: tidy(balance.electricDamage(n)), cooldown: tidy(balance.electricCooldown(n)), count: n ? 1 : 0 }
    case 'bomb': return { duration: tidy(balance.bombLifetime(n)), damage: tidy(balance.bombDamage(n)), cooldown: tidy(balance.bombCooldown(n)), count: balance.bombLimit(n) }
    case 'shrink': return { duration: n ? balance.shrinkDuration(n) : 0, damage: 0, cooldown: balance.shrinkCooldown(n), count: n ? 1 : 0 }
  }
}
