/** Cosmetic only. Radius gates stop temporary shrink from wearing oversized heavy armor. */
export type ArmorTier = 0 | 1 | 2 | 3
export function armorTier(length: number, radius: number, progressionStage = 1): ArmorTier {
  const byLength = length >= 260 ? 3 : length >= 130 ? 2 : length >= 60 ? 1 : 0
  const byRadius = radius >= 1.75 ? 3 : radius >= 1.4 ? 2 : radius >= 1.08 ? 1 : 0
  // Campaign stages grant a visible evolution layer while ordinary runs keep the original gates.
  const stage = Number.isFinite(progressionStage) ? Math.max(1, Math.floor(progressionStage)) : 1
  const byStage = Math.min(3, Math.ceil((stage - 1) / 2))
  const baseTier = Math.min(byLength, byRadius)
  const campaignTier = stage > 1 ? Math.min(3, Math.max(baseTier, byRadius + byStage)) : baseTier
  return campaignTier as ArmorTier
}

export const ARMOR_PROFILES = [
  { scale: 1, solid: 0, band: 1, plateEvery: 0, tint: 0x9faeca, trim: 0xc3e4ff },
  { scale: 1.06, solid: 0.3, band: 0.85, plateEvery: 6, tint: 0xb85a22, trim: 0xffc18a },
  { scale: 1.13, solid: 0.65, band: 0.65, plateEvery: 4, tint: 0xffc62e, trim: 0xffeb94 },
  { scale: 1.21, solid: 0.95, band: 0.5, plateEvery: 3, tint: 0x8f3edd, trim: 0xe4b0ff },
] as const

const smooth = (value: number, lo: number, hi: number) => {
  const t = Number.isFinite(value) ? Math.max(0, Math.min(1, (value - lo) / (hi - lo))) : 0
  return t * t * (3 - 2 * t)
}
export function mixSkinColor(a: number, b: number, amount: number): number {
  return [16, 8, 0].reduce((hex, shift) => hex | Math.round(((a >> shift) & 255) * (1 - amount) + ((b >> shift) & 255) * amount) << shift, 0)
}

/** Fade INTO each threshold, gated by radius too; a temporary shrink smoothly loses its tint. */
export function growthMaterial(length: number, radius: number, progressionStage = 1) {
  const stage = Number.isFinite(progressionStage) ? Math.max(1, Math.floor(progressionStage)) : 1
  const bronze = Math.max(stage >= 2 ? 1 : 0, Math.min(smooth(length, 40, 60), smooth(radius, 0.98, 1.08)))
  const gold = Math.max(stage >= 4 ? 1 : 0, Math.min(smooth(length, 100, 130), smooth(radius, 1.28, 1.4)))
  const purple = Math.max(stage >= 6 ? 1 : 0, Math.min(smooth(length, 210, 260), smooth(radius, 1.62, 1.75)))
  const tint = mixSkinColor(mixSkinColor(0xb85a22, 0xffc62e, gold), 0x8f3edd, purple)
  const trim = mixSkinColor(mixSkinColor(0xffc18a, 0xffeb94, gold), 0xe4b0ff, purple)
  return {
    tier: armorTier(length, radius, progressionStage), phase: purple >= 1 ? 'purple' : gold >= 1 ? 'gold' : bronze > 0 ? 'bronze' : 'base',
    tint, trim, blend: bronze * (0.8 + gold * 0.08 + purple * 0.01),
    metalness: bronze * (0.45 + gold * 0.18 + purple * 0.22),
    roughness: 0.42 - bronze * 0.12 - gold * 0.08 - purple * 0.05,
    glow: 0.35 + bronze * 0.12 + gold * 0.12 + purple * 0.23,
  }
}

/** Alternating copper/gold/amethyst and pale metallic seams keep the selected skin underneath. */
export function growthSkinPalette(base: { head: number; colors: readonly number[] }, material: ReturnType<typeof growthMaterial>) {
  return {
    head: mixSkinColor(base.head, material.tint, material.blend),
    colors: base.colors.map((color, stripe) => mixSkinColor(color, stripe % 3 === 2 ? material.trim : material.tint, material.blend * (stripe % 3 === 1 ? 0.82 : 1))),
  }
}
