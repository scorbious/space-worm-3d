/** Shared balance math. Match owns entitlements; no input packet may choose a level. */
export const ABILITY_IDS = ['ghost', 'electric', 'bomb', 'shrink', 'laser']
export const ONLINE_LEVELS = Object.freeze({ ghost: 1, electric: 1, bomb: 1, shrink: 1 })
const level = n => Number.isFinite(n) ? Math.max(0, Math.min(10, Math.floor(n))) : 0
export const ghostDuration = n => level(n) ? 5 + (level(n) - 1) * 0.9 : 0
export const ghostCooldown = n => level(n) ? 15 + (ghostDuration(n) - 5) * 3 : 0
export const electricDuration = n => level(n) ? 4 + level(n) * 0.4 : 0
export const electricDamage = n => level(n) ? Math.floor(4 + level(n) * 0.8) : 0
export const electricCooldown = n => level(n) ? 22 + level(n) * 0.8 : 0
export const bombLifetime = n => level(n) ? 5 + (level(n) - 1) * 0.7 : 0
export const bombDamage = n => level(n) ? Math.floor(5 + level(n) * 1.3) : 0
export const bombLimit = n => level(n) ? Math.min(3, 1 + Math.floor((level(n) - 1) / 4)) : 0
export const bombCooldown = n => level(n) ? 3.5 + (level(n) - 1) * 0.15 : 0
export const shrinkDuration = n => level(n) ? 12 + level(n) : 12
export const shrinkCooldown = n => level(n) ? 24 + level(n) : 0
export const shrinkScale = n => level(n) ? Math.max(0.42, 0.58 - level(n) * 0.016) : 0.58
export const shrinkReductionPercent = n => level(n) * 10
export const LASER_RANGE = 72
export const LASER_CONE = 0.52
