import { describe, expect, it } from 'vitest'
import { COSMETICS, equipCosmetic, ownsAppearance, purchaseCosmetic, unlockAchievements } from '../src/game/cosmetics'
import { defaultSave, parseSave, purchaseLaser, purchaseUpgrade } from '../src/engine/save'
import { bombCooldown, bombDamage, bombLimit, electricCooldown, electricDamage, electricDuration, ghostCooldown, ghostDuration, LASER_PRICE, needsPurchaseConfirmation, upgradePrice, upgradeStats } from '../src/game/upgrades'
describe('long-term cosmetics economy', () => {
  it('offers all requested cosmetic categories with tiered expensive prices', () => {
    expect(new Set(COSMETICS.map(c => c.kind))).toEqual(new Set(['head', 'color', 'entry', 'victory', 'badge', 'background']))
    const paid = COSMETICS.filter(c => !c.achievement)
    expect(Math.min(...paid.map(c => c.price))).toBeGreaterThanOrEqual(3000)
    expect(Math.max(...paid.map(c => c.price))).toBeGreaterThanOrEqual(100000)
    expect(new Set(COSMETICS.map(c => c.id)).size).toBe(COSMETICS.length)
  })
  it('rejects unknown/unaffordable/owned/achievement-only purchases', () => {
    const data = { ...defaultSave(), stardust: 999999 }
    expect(purchaseCosmetic(data, 'missing')).toBeNull()
    expect(purchaseCosmetic(defaultSave(), 'head-dragon')).toBeNull()
    expect(purchaseCosmetic(data, 'badge-king')).toBeNull()
    const bought = purchaseCosmetic(data, 'head-dragon')!
    expect(bought.stardust).toBe(999999 - 32000)
    expect(purchaseCosmetic(bought, 'head-dragon')).toBeNull()
    expect(data.ownedCosmetics).toEqual([])
  })
  it('only equips owned cosmetics and leaves existing skin ownership intact', () => {
    const data = defaultSave()
    expect(equipCosmetic(data, 'color-gold')).toBeNull()
    const bought = purchaseCosmetic({ ...data, stardust: 4500 }, 'color-gold')!
    const equipped = equipCosmetic(bought, 'color-gold')!
    expect(equipped.color).toBe('gold')
    expect(equipped.skin).toBe(data.skin)
    expect(equipped.ownedSkins).toEqual(['nebula'])
    expect(ownsAppearance(data, 'color', 'gold')).toBe(false)
    expect(ownsAppearance(data, 'head', 'round')).toBe(true)
    expect(ownsAppearance(equipped, 'color', 'gold')).toBe(true)
  })
  it('unlocks earned heads, victories and badges once without charging money', () => {
    const data = { ...defaultSave(), records: { ...defaultSave().records, totalKills: 30, teamWins: 10 }, achievements: { crowns: 1, dailySets: 1 } }
    const next = unlockAchievements(data)
    for (const id of ['head-manta', 'victory-aurora', 'badge-king', 'badge-daily']) expect(next.ownedCosmetics).toContain(id)
    expect(next.stardust).toBe(data.stardust)
    expect(unlockAchievements(next).ownedCosmetics).toEqual(next.ownedCosmetics)
  })
  it('migrates equipped legacy appearances and drops invalid or unequipped reward fields', () => {
    const legacy = { ...defaultSave(), headStyle: 'dragon', color: 'gold' } as Record<string, unknown>
    delete legacy.ownedCosmetics
    const migrated = parseSave(JSON.stringify(legacy))
    expect(migrated.ownedCosmetics).toContain('head-dragon')
    expect(migrated.ownedCosmetics).toContain('color-gold')
    expect(migrated.headStyle).toBe('dragon')
    const corrupt = parseSave(JSON.stringify({ ...defaultSave(), ownedCosmetics: ['unknown', 'entry-prism', 'entry-prism'], cosmetics: { entry: 'entry-prism', victory: 'entry-prism', background: 'fake' } }))
    expect(corrupt.ownedCosmetics).toEqual(['entry-prism'])
    expect(corrupt.cosmetics).toEqual({ entry: 'entry-prism', victory: '', badge: '', background: '' })
  })
})
describe('bounded ability balance', () => {
  it('compares real durations, damage, cooldown and counts at each level', () => {
    for (let n = 1; n <= 10; n++) {
      expect(upgradeStats('bomb', n).damage).toBe(bombDamage(n))
      expect(upgradeStats('electric', n).damage).toBe(electricDamage(n))
      expect(bombLimit(n)).toBeLessThanOrEqual(3)
      expect(bombDamage(n)).toBeLessThanOrEqual(18)
      expect(electricDamage(n)).toBeLessThanOrEqual(12)
      expect(electricDuration(n)).toBeLessThan(electricCooldown(n))
      expect(ghostDuration(n)).toBeLessThan(ghostCooldown(n))
      expect(bombCooldown(n)).toBeGreaterThanOrEqual(3.5)
      if (n > 1) expect(upgradePrice('ghost', n)).toBeGreaterThan(upgradePrice('ghost', n - 1))
    }
    expect(upgradeStats('ghost', 0)).toEqual({ duration: 0, damage: 0, cooldown: 0, count: 0 })
  })
  it('requires confirmation for costly upgrades and keeps the laser costly/non-upgradable', () => {
    expect(needsPurchaseConfirmation(9999)).toBe(false)
    expect(needsPurchaseConfirmation(10000)).toBe(true)
    expect(needsPurchaseConfirmation(LASER_PRICE)).toBe(true)
    expect(LASER_PRICE).toBe(250000)
    expect(purchaseUpgrade({ ...defaultSave(), stardust: 999999 }, 'laser' as never)).toBeNull()
    const data = purchaseLaser({ ...defaultSave(), stardust: LASER_PRICE })!
    expect(purchaseLaser(data)).toBeNull()
  })
})
