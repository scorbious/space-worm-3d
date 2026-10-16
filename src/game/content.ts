/**
 * Static game content: celestial bodies and the permanent powers they grant, temporary pickups
 * and cosmetic skins. Player-facing names live in i18n under `celestial.*`, `power.*`, `pickup.*`
 * and `skin.*` using these ids.
 */
export type CelestialId = 'moon' | 'comet' | 'planet' | 'star' | 'pulsar'
export type PowerId = 'tide' | 'tail' | 'core' | 'drive' | 'heart'
export type PickupId = 'magnet' | 'shield' | 'freeBoost'

export type CelestialDef = {
  id: CelestialId
  power: PowerId
  /** Minimum worm length needed to swallow it; smaller worms bounce off. */
  minLength: number
  /** Length gained when swallowed. */
  growth: number
  /** Radius of the free-floating body. */
  radius: number
  /** Relative spawn weight. */
  weight: number
  color: number
}

export const CELESTIALS: Record<CelestialId, CelestialDef> = {
  moon: { id: 'moon', power: 'tide', minLength: 0, growth: 6, radius: 2.1, weight: 6, color: 0xc9c4d8 },
  comet: { id: 'comet', power: 'tail', minLength: 22, growth: 10, radius: 2.3, weight: 4, color: 0x8fe8ff },
  planet: { id: 'planet', power: 'core', minLength: 40, growth: 16, radius: 3.2, weight: 3, color: 0xf0a868 },
  star: { id: 'star', power: 'drive', minLength: 70, growth: 24, radius: 3.4, weight: 2, color: 0xff6a3d },
  pulsar: { id: 'pulsar', power: 'heart', minLength: 110, growth: 34, radius: 2.8, weight: 1, color: 0xb9a8ff },
}
export const CELESTIAL_IDS = Object.keys(CELESTIALS) as CelestialId[]

export type PowerDef = { id: PowerId; celestial: CelestialId; maxStacks: number; icon: string }
export const POWERS: Record<PowerId, PowerDef> = {
  tide: { id: 'tide', celestial: 'moon', maxStacks: 3, icon: 'moon' },
  tail: { id: 'tail', celestial: 'comet', maxStacks: 3, icon: 'comet' },
  core: { id: 'core', celestial: 'planet', maxStacks: 3, icon: 'planet' },
  drive: { id: 'drive', celestial: 'star', maxStacks: 3, icon: 'star' },
  heart: { id: 'heart', celestial: 'pulsar', maxStacks: 3, icon: 'pulsar' },
}
export const POWER_IDS = Object.keys(POWERS) as PowerId[]

export const PICKUP_IDS: PickupId[] = ['magnet', 'shield', 'freeBoost']
export const PICKUP_COLORS: Record<PickupId, number> = { magnet: 0xff4fd8, shield: 0x4fb8ff, freeBoost: 0xffd84f }

export type Skin = {
  id: string
  price: number
  /** Body colors cycled along the segments. */
  colors: number[]
  /** Segments per color band. */
  band: number
  head: number
  eye: number
  glow: number
}

export const SKINS: Skin[] = [
  { id: 'nebula', price: 0, colors: [0x5ef3ff, 0x6b8cff, 0xa46bff], band: 4, head: 0x7ff6ff, eye: 0xffffff, glow: 0.35 },
  { id: 'aurora', price: 120, colors: [0x55ffb0, 0x2fd6c8, 0x8b6bff], band: 3, head: 0x7dffc4, eye: 0xffffff, glow: 0.35 },
  { id: 'solar', price: 200, colors: [0xffd24f, 0xff9a3d, 0xff5f3d], band: 3, head: 0xffe07a, eye: 0xffffff, glow: 0.4 },
  { id: 'koi', price: 260, colors: [0xfff4ea, 0xff6a3d, 0xfff4ea, 0xfff4ea], band: 2, head: 0xfff4ea, eye: 0x1b1030, glow: 0.18 },
  { id: 'void', price: 350, colors: [0x221a3a, 0x2e1f4d, 0xff3fd0], band: 3, head: 0x2a1f48, eye: 0xff3fd0, glow: 0.5 },
  { id: 'crystal', price: 450, colors: [0xe4f6ff, 0x9fdcff, 0xc9b8ff], band: 1, head: 0xf2fbff, eye: 0x3a6bff, glow: 0.3 },
  { id: 'galaxy', price: 600, colors: [0x3b1f8f, 0x7a3dff, 0xff5fc8, 0x49c2ff], band: 2, head: 0x9b6bff, eye: 0xffffff, glow: 0.45 },
  { id: 'gold', price: 900, colors: [0xffd54f, 0xffb300, 0xfff1b0], band: 2, head: 0xffe27a, eye: 0x3a2400, glow: 0.45 },
]
export const skinById = (id: string): Skin => SKINS.find(s => s.id === id) ?? SKINS[0]

/** Team palettes used for halos, minimap dots and the team score bar. */
export const TEAM_COLORS = [0x4fb8ff, 0xff8a3d] as const

export const BOT_NAMES = [
  'Nova', 'Quasar', 'Orbit', 'Vega', 'Lyra', 'Zenith', 'Comet', 'Nebby', 'Halo', 'Rigel', 'Sirius', 'Io',
  'Titan', 'Pulse', 'Astra', 'Cosmo', 'Ember', 'Kepler', 'Draco', 'Mira', 'Solstice', 'Umbra', 'Photon', 'Echo',
]
