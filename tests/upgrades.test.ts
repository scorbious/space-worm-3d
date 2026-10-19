import { describe, expect, it } from 'vitest'
import { defaultSave, parseSave, purchaseLaser, purchaseUpgrade } from '../src/engine/save'
import {
  MAX_UPGRADE_LEVEL,
  UPGRADE_DEFS,
  bombDamage,
  bombLifetime,
  electricDamage,
  ghostCooldown,
  ghostDuration,
  LASER_PRICE,
  shrinkDuration,
  shrinkReductionPercent,
  shrinkScale,
  upgradePrice,
} from '../src/game/upgrades'

describe('premium upgrade economy', () => {
  it('uses steep prices and caps every ability at the authored maximum', () => {
    expect(upgradePrice('ghost', 1)).toBe(2500)
    expect(upgradePrice('ghost', 2)).toBeGreaterThan(upgradePrice('ghost', 1))
    expect(UPGRADE_DEFS.bomb.maxLevel).toBe(MAX_UPGRADE_LEVEL)
    expect(shrinkReductionPercent(1)).toBe(10)
    expect(shrinkReductionPercent(8)).toBe(80)
    expect(shrinkReductionPercent(99)).toBe(100)
  })

  it('allows only affordable next levels and preserves the wallet transactionally', () => {
    const poor = { ...defaultSave(), stardust: 2499 }
    expect(purchaseUpgrade(poor, 'ghost')).toBeNull()
    const bought = purchaseUpgrade({ ...defaultSave(), stardust: 2500 }, 'ghost')!
    expect(bought.upgrades.ghost).toBe(1)
    expect(bought.stardust).toBe(0)
    expect(purchaseUpgrade({ ...bought, stardust: 999999 }, 'ghost')!.upgrades.ghost).toBe(2)
  })

  it('migrates old saves and keeps ability math bounded', () => {
    const old = parseSave(JSON.stringify({ ...defaultSave(), version: 1, stardust: 8000 }))
    expect(old.version).toBe(2)
    expect(old.upgrades).toEqual({ ghost: 0, electric: 0, shrink: 0, bomb: 0 })
    expect(ghostDuration(8)).toBeGreaterThan(ghostDuration(1))
    expect(electricDamage(8)).toBeGreaterThan(electricDamage(1))
    expect(bombDamage(8)).toBeGreaterThan(bombDamage(1))
    expect(bombLifetime(8)).toBeGreaterThan(bombLifetime(1))
    expect(shrinkDuration(8)).toBeGreaterThan(shrinkDuration(1))
    expect(shrinkScale(8)).toBeLessThan(shrinkScale(1))
    expect(ghostCooldown(1)).toBe(15)
    expect(ghostCooldown(8)).toBeGreaterThan(ghostCooldown(1))
    expect(bombLifetime(1)).toBe(5)
    expect(bombLifetime(8)).toBeGreaterThan(5)
  })

  it('buys the independent laser once and never upgrades or double-charges it', () => {
    expect(purchaseLaser({ ...defaultSave(), stardust: LASER_PRICE - 1 })).toBeNull()
    const bought = purchaseLaser({ ...defaultSave(), stardust: LASER_PRICE })!
    expect(bought.laserUnlocked).toBe(true)
    expect(bought.stardust).toBe(0)
    expect(purchaseLaser({ ...bought, stardust: LASER_PRICE * 2 })).toBeNull()
  })
})
