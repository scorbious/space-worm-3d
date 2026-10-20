import type { SaveData } from '../engine/save'
export type CosmeticKind = 'head' | 'color' | 'entry' | 'victory' | 'badge' | 'background'
export type Cosmetic = { id: string; kind: CosmeticKind; value: string; price: number; color: string; achievement?: 'kills' | 'wins' | 'crown' | 'daily'; target?: number }
export const COSMETICS: Cosmetic[] = [
  { id: 'head-crystal', kind: 'head', value: 'crystal', price: 3000, color: '#9fdcff' },
  { id: 'head-robot', kind: 'head', value: 'robot', price: 6500, color: '#7ff6ff' },
  { id: 'head-comet', kind: 'head', value: 'comet', price: 12000, color: '#ffa658' },
  { id: 'head-dragon', kind: 'head', value: 'dragon', price: 32000, color: '#b8ff68' },
  { id: 'head-manta', kind: 'head', value: 'manta', price: 0, color: '#b9a8ff', achievement: 'kills', target: 30 },
  { id: 'color-gold', kind: 'color', value: 'gold', price: 4500, color: '#ffd54f' },
  { id: 'color-ice', kind: 'color', value: 'ice', price: 9000, color: '#e4f6ff' },
  { id: 'color-dark', kind: 'color', value: 'dark', price: 18000, color: '#685a9e' },
  { id: 'entry-comet', kind: 'entry', value: 'comet', price: 16000, color: '#ff8a5c' },
  { id: 'entry-prism', kind: 'entry', value: 'prism', price: 45000, color: '#7ff6ff' },
  { id: 'victory-supernova', kind: 'victory', value: 'supernova', price: 28000, color: '#ffd54f' },
  { id: 'victory-aurora', kind: 'victory', value: 'aurora', price: 0, color: '#55ffb0', achievement: 'wins', target: 10 },
  { id: 'badge-royal', kind: 'badge', value: 'royal', price: 55000, color: '#ffd54f' },
  { id: 'badge-king', kind: 'badge', value: 'king', price: 0, color: '#ffa658', achievement: 'crown', target: 1 },
  { id: 'badge-daily', kind: 'badge', value: 'daily', price: 0, color: '#7ff6ff', achievement: 'daily', target: 1 },
  { id: 'background-eclipse', kind: 'background', value: 'eclipse', price: 75000, color: '#b9a8ff' },
  { id: 'background-aurora', kind: 'background', value: 'aurora', price: 140000, color: '#55ffb0' },
]
export type CosmeticEquipment = Record<'entry' | 'victory' | 'badge' | 'background', string>
export const emptyCosmeticEquipment = (): CosmeticEquipment => ({ entry: '', victory: '', badge: '', background: '' })
export function ownsAppearance(data: SaveData, kind: 'head' | 'color', value: string): boolean {
  const item = COSMETICS.find(c => c.kind === kind && c.value === value)
  return !item || data.ownedCosmetics.includes(item.id)
}
export function achievementProgress(data: SaveData, item: Cosmetic): number {
  switch (item.achievement) {
    case 'kills': return data.records.totalKills
    case 'wins': return data.records.teamWins
    case 'crown': return data.achievements.crowns
    case 'daily': return data.achievements.dailySets
    default: return 0
  }
}
export function unlockAchievements(data: SaveData): SaveData {
  const unlocked = COSMETICS.filter(c => c.achievement && achievementProgress(data, c) >= (c.target ?? 1)).map(c => c.id)
  return { ...data, ownedCosmetics: [...new Set([...data.ownedCosmetics, ...unlocked])] }
}
export function purchaseCosmetic(data: SaveData, id: string): SaveData | null {
  const item = COSMETICS.find(c => c.id === id)
  if (!item || item.achievement || data.ownedCosmetics.includes(id) || !Number.isSafeInteger(data.stardust) || data.stardust < item.price) return null
  return { ...data, stardust: data.stardust - item.price, ownedCosmetics: [...data.ownedCosmetics, id] }
}
export function equipCosmetic(data: SaveData, id: string): SaveData | null {
  const item = COSMETICS.find(c => c.id === id)
  if (!item || !data.ownedCosmetics.includes(id)) return null
  if (item.kind === 'head') return { ...data, headStyle: item.value as SaveData['headStyle'] }
  if (item.kind === 'color') return { ...data, color: item.value as SaveData['color'] }
  return { ...data, cosmetics: { ...data.cosmetics, [item.kind]: item.id } }
}
