/** Cosmetic only. Radius gates stop temporary shrink from wearing oversized heavy armor. */
export type ArmorTier = 0 | 1 | 2 | 3
export function armorTier(length: number, radius: number): ArmorTier {
  const byLength = length >= 260 ? 3 : length >= 130 ? 2 : length >= 60 ? 1 : 0
  const byRadius = radius >= 1.75 ? 3 : radius >= 1.4 ? 2 : radius >= 1.08 ? 1 : 0
  return Math.min(byLength, byRadius) as ArmorTier
}

export const ARMOR_PROFILES = [
  { scale: 1, solid: 0, band: 1, plateEvery: 0, tint: 0x9faeca, trim: 0xc3e4ff },
  { scale: 1.06, solid: 0.3, band: 0.85, plateEvery: 6, tint: 0x657796, trim: 0xa0e6ff },
  { scale: 1.13, solid: 0.65, band: 0.65, plateEvery: 4, tint: 0x45516d, trim: 0x8ffff0 },
  { scale: 1.21, solid: 0.95, band: 0.5, plateEvery: 3, tint: 0x30374f, trim: 0xffdf91 },
] as const
