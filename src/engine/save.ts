/**
 * Versioned local save. Everything the player keeps between sessions lives in one JSON record so
 * it is easy to migrate. Corrupt or foreign data falls back to defaults instead of crashing.
 */
import { SKINS } from '../game/content'
import { validColor, validHead, type HeadStyle, type WormColor } from '../game/appearance'
import { emptyRecords, LOCAL_BOARD_SIZE, type LifeEntry, type Records } from '../game/rules'
import { campaignStage, defaultCampaignProgress, type CampaignProgressData } from '../game/campaign'
import { emptyUpgradeLevels, LASER_PRICE, nextUpgradePrice, sanitizeUpgradeLevels, upgradeLevel, type UpgradeLevels } from '../game/upgrades'
import type { UpgradeId } from '../game/content'

export type Locale = 'en' | 'ar'
export const LOCALES: Locale[] = ['en', 'ar']
export type Quality = 'low' | 'medium' | 'high'
/** Threat Language detail: full = badges, reticle, edge arrows; minimal = ground marks and colours only. */
export type ThreatDetail = 'full' | 'minimal'
export const HINT_IDS = ['rival', 'asteroid', 'gate', 'well', 'rim', 'edible', 'bite'] as const

export type SaveData = {
  version: 2
  /** '' = never chosen; the game follows the browser language until the player picks one. */
  locale: Locale | ''
  musicVolume: number
  sfxVolume: number
  muted: boolean
  quality: Quality
  reducedMotion: boolean
  /** Mouse sensitivity is irrelevant for heading steering; kept for keyboard turn speed. */
  keyTurn: number
  tutorialDone: boolean
  playerName: string
  stardust: number
  /** Premium progression is separate from cosmetics, but spends the same safe local wallet. */
  upgrades: UpgradeLevels
  /** One-time destructive laser unlock; it is intentionally not part of upgrade levels. */
  laserUnlocked: boolean
  ownedSkins: string[]
  skin: string
  /** Additive v1 migration: missing/invalid choices preserve the original appearance. */
  color: WormColor
  headStyle: HeadStyle
  records: Records
  lives: LifeEntry[]
  /** Global leaderboard participation is strictly opt-in. */
  globalOptIn: boolean
  threatMode: ThreatDetail
  /** First-encounter hazard hints already shown. */
  seenHints: string[]
}

export const SAVE_KEY = 'spaceworm.save'
/** Separate key keeps the established SaveData schema and competitive history untouched. */
export const CAMPAIGN_SAVE_KEY = 'spaceworm.campaign'

export function defaultSave(): SaveData {
  return {
    version: 2,
    locale: '',
    musicVolume: 0.6,
    sfxVolume: 0.8,
    muted: false,
    quality: 'high',
    reducedMotion: false,
    keyTurn: 1,
    tutorialDone: false,
    playerName: 'Stargazer',
    stardust: 0,
    upgrades: emptyUpgradeLevels(),
    laserUnlocked: false,
    ownedSkins: ['nebula'],
    skin: 'nebula',
    color: 'skin',
    headStyle: 'round',
    records: emptyRecords(),
    lives: [],
    globalOptIn: false,
    threatMode: 'full',
    seenHints: [],
  }
}

const clamp01 = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback)
const nonNegInt = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

export function sanitizeName(name: unknown, fallback = 'Stargazer'): string {
  if (typeof name !== 'string') return fallback
  const clean = name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16)
  return clean || fallback
}

/** Parse untrusted stored JSON into a valid SaveData (pure; unit tested). */
export function parseSave(raw: string | null): SaveData {
  const base = defaultSave()
  if (!raw) return base
  let data: Record<string, unknown>
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return base
    data = parsed as Record<string, unknown>
  } catch {
    return base
  }
  // v1 saves predate the Upgrade Lab; missing upgrade data safely migrates to level zero.
  if (data.version !== 1 && data.version !== 2) return base
  const skinIds = new Set(SKINS.map(s => s.id))
  const owned = Array.isArray(data.ownedSkins) ? data.ownedSkins.filter((s): s is string => typeof s === 'string' && skinIds.has(s)) : []
  if (!owned.includes('nebula')) owned.unshift('nebula')
  const rec = (data.records && typeof data.records === 'object' ? data.records : {}) as Record<string, unknown>
  const records = emptyRecords()
  for (const key of Object.keys(records) as (keyof typeof records)[]) records[key] = nonNegInt(rec[key])
  const lives = (Array.isArray(data.lives) ? data.lives : [])
    .filter((e): e is LifeEntry => !!e && typeof e === 'object' && Number.isFinite((e as LifeEntry).length))
    .map(e => ({
      name: sanitizeName(e.name), length: nonNegInt(e.length), kills: nonNegInt(e.kills), seconds: nonNegInt(e.seconds),
      mode: e.mode === 'team' ? 'team' as const : 'ffa' as const, at: nonNegInt(e.at),
    }))
    .sort((a, b) => b.length - a.length || b.kills - a.kills || a.at - b.at)
    .slice(0, LOCAL_BOARD_SIZE)
  const skin = typeof data.skin === 'string' && owned.includes(data.skin) ? data.skin : 'nebula'
  return {
    version: 2,
    locale: data.locale === 'en' || data.locale === 'ar' ? data.locale : '',
    musicVolume: clamp01(data.musicVolume, base.musicVolume),
    sfxVolume: clamp01(data.sfxVolume, base.sfxVolume),
    muted: data.muted === true,
    quality: data.quality === 'low' || data.quality === 'medium' || data.quality === 'high' ? data.quality : base.quality,
    reducedMotion: data.reducedMotion === true,
    keyTurn: typeof data.keyTurn === 'number' && data.keyTurn >= 0.5 && data.keyTurn <= 1.8 ? data.keyTurn : 1,
    tutorialDone: data.tutorialDone === true,
    playerName: sanitizeName(data.playerName),
    stardust: nonNegInt(data.stardust),
    upgrades: sanitizeUpgradeLevels(data.upgrades),
    laserUnlocked: data.laserUnlocked === true,
    ownedSkins: owned,
    skin,
    color: validColor(data.color),
    headStyle: validHead(data.headStyle),
    records,
    lives,
    globalOptIn: data.globalOptIn === true,
    threatMode: data.threatMode === 'minimal' ? 'minimal' : 'full',
    seenHints: Array.isArray(data.seenHints)
      ? [...new Set(data.seenHints.filter((h): h is string => typeof h === 'string' && (HINT_IDS as readonly string[]).includes(h)))]
      : [],
  }
}

/** Parse campaign progress independently so corrupt mission data never invalidates the main save. */
export function parseCampaignProgress(raw: string | null): CampaignProgressData {
  const base = defaultCampaignProgress()
  if (!raw) return base
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return base
    const unlockedStage = typeof parsed.unlockedStage === 'number' && Number.isFinite(parsed.unlockedStage)
      ? Math.min(6, Math.max(1, Math.floor(parsed.unlockedStage))) : 1
    const completedStages = Array.isArray(parsed.completedStages)
      ? [...new Set(parsed.completedStages.filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && !!campaignStage(id)).map(id => Math.floor(id)))].sort((a, b) => a - b)
      : []
    const bestScores: Record<string, number> = {}
    if (parsed.bestScores && typeof parsed.bestScores === 'object') {
      for (const [key, value] of Object.entries(parsed.bestScores as Record<string, unknown>)) {
        if (campaignStage(Number(key)) && typeof value === 'number' && Number.isFinite(value) && value >= 0) bestScores[key] = Math.floor(value)
      }
    }
    return {
      version: 1,
      unlockedStage: Math.max(unlockedStage, completedStages.length ? Math.min(6, Math.max(...completedStages) + 1) : 1),
      completedStages,
      bestScores,
      totalRewards: typeof parsed.totalRewards === 'number' && Number.isFinite(parsed.totalRewards) && parsed.totalRewards >= 0 ? Math.floor(parsed.totalRewards) : 0,
    }
  } catch {
    return base
  }
}

/** Buy a skin if affordable; pure so it can be tested. */
export function purchaseSkin(data: SaveData, skinId: string): SaveData | null {
  const skin = SKINS.find(s => s.id === skinId)
  if (!skin || data.ownedSkins.includes(skinId) || data.stardust < skin.price) return null
  return { ...data, stardust: data.stardust - skin.price, ownedSkins: [...data.ownedSkins, skinId], skin: skinId }
}

/** Buy the next premium level only when the wallet can afford it; pure for unit tests. */
export function purchaseUpgrade(data: SaveData, id: UpgradeId): SaveData | null {
  const current = upgradeLevel(data.upgrades, id)
  const price = nextUpgradePrice(id, current)
  if (price === null || data.stardust < price) return null
  return {
    ...data,
    stardust: data.stardust - price,
    upgrades: sanitizeUpgradeLevels({ ...data.upgrades, [id]: current + 1 }),
  }
}

/** Unlock the expensive one-shot laser once; unlike upgrades it has no levels. */
export function purchaseLaser(data: SaveData): SaveData | null {
  if (data.laserUnlocked || data.stardust < LASER_PRICE) return null
  return { ...data, stardust: data.stardust - LASER_PRICE, laserUnlocked: true }
}

export class SaveStore {
  data: SaveData
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage) {
    let raw: string | null = null
    try {
      raw = this.storage?.getItem(SAVE_KEY) ?? null
    } catch {
      raw = null
    }
    this.data = parseSave(raw)
  }

  update(patch: Partial<SaveData>): void {
    this.data = { ...this.data, ...patch }
    this.persist()
  }

  replace(data: SaveData): void {
    this.data = data
    this.persist()
  }

  private persist(): void {
    try {
      this.storage?.setItem(SAVE_KEY, JSON.stringify(this.data))
    } catch {
      // Private browsing or quota: the game keeps working with in-memory settings.
    }
  }
}


export class CampaignStore {
  data: CampaignProgressData
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage) {
    let raw: string | null = null
    try { raw = this.storage?.getItem(CAMPAIGN_SAVE_KEY) ?? null } catch { raw = null }
    this.data = parseCampaignProgress(raw)
  }

  replace(data: CampaignProgressData): void {
    this.data = data
    try { this.storage?.setItem(CAMPAIGN_SAVE_KEY, JSON.stringify(this.data)) } catch { /* in-memory progress remains usable */ }
  }
}
