import { skinById, type Skin } from './content'

export const HEAD_STYLES = ['round', 'crystal', 'robot', 'comet', 'dragon', 'cat', 'cyclops', 'manta'] as const
export type HeadStyle = typeof HEAD_STYLES[number]
export const WORM_COLORS = [
  { id: 'skin', value: null }, { id: 'cyan', value: 0x5ef3ff }, { id: 'pink', value: 0xff5fc8 },
  { id: 'gold', value: 0xffd54f }, { id: 'green', value: 0x55ffb0 }, { id: 'violet', value: 0xa98bff },
  { id: 'orange', value: 0xff8a5c }, { id: 'ice', value: 0xe4f6ff }, { id: 'dark', value: 0x393254 },
] as const
export type WormColor = typeof WORM_COLORS[number]['id']
export const validHead = (value: unknown): HeadStyle => HEAD_STYLES.includes(value as HeadStyle) ? value as HeadStyle : 'round'
export const validColor = (value: unknown): WormColor => WORM_COLORS.some(c => c.id === value) ? value as WormColor : 'skin'
const cache = new Map<string, Skin>()
/** Reuse cached palettes rather than allocating a new skin every render frame. */
export function appearanceSkin(skinId: string, color: WormColor = 'skin'): Skin {
  const base = skinById(skinId)
  const tint = WORM_COLORS.find(c => c.id === color)?.value
  if (tint == null) return base
  const key = `${base.id}:${color}`
  let skin = cache.get(key)
  if (!skin) {
    const shade = (factor: number) => [16, 8, 0].reduce((n, shift) => n | Math.min(255, Math.round(((tint >> shift) & 255) * factor)) << shift, 0)
    skin = { ...base, colors: [tint, shade(0.78), shade(1.16)], head: tint }
    cache.set(key, skin)
  }
  return skin
}
