export const DAILY_METRICS = ['coins', 'seconds', 'kills', 'abilities', 'royalty'] as const
export type DailyMetric = typeof DAILY_METRICS[number]
export type DailyData = { day: string; progress: Record<DailyMetric, number>; claimed: DailyMetric[]; badgeClaimed: boolean }
export type DailyMission = { id: DailyMetric; target: number; reward: number }
/** UTC is explicit: the same calendar day always has the same goals. No remote service. */
export function dailyDay(now = Date.now()): string { return new Date(now).toISOString().slice(0, 10) }
export function dailyMissions(day = dailyDay()): DailyMission[] {
  const seed = [...day].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0)
  return [
    { id: 'coins', target: 12 + seed % 9, reward: 300 },
    { id: 'seconds', target: 90 + seed % 4 * 30, reward: 350 },
    { id: 'kills', target: 1 + seed % 3, reward: 450 },
    { id: 'abilities', target: 1 + seed % 2, reward: 500 },
    { id: 'royalty', target: 1, reward: 700 },
  ]
}
export function emptyDaily(day = dailyDay()): DailyData {
  return { day, progress: { coins: 0, seconds: 0, kills: 0, abilities: 0, royalty: 0 }, claimed: [], badgeClaimed: false }
}
export function sanitizeDaily(raw: unknown, now = Date.now()): DailyData {
  const day = dailyDay(now), base = emptyDaily(day)
  if (!raw || typeof raw !== 'object' || (raw as DailyData).day !== day) return base
  const value = raw as Partial<DailyData>
  for (const mission of dailyMissions(day)) {
    const n = value.progress?.[mission.id]
    base.progress[mission.id] = typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(mission.target, n)) : 0
  }
  base.claimed = DAILY_METRICS.filter(id => Array.isArray(value.claimed) && value.claimed.includes(id) && base.progress[id] >= dailyMissions(day).find(m => m.id === id)!.target)
  base.badgeClaimed = value.badgeClaimed === true && base.claimed.length === DAILY_METRICS.length
  return base
}
export function advanceDaily(raw: DailyData, delta: Partial<Record<DailyMetric, number>>, now = Date.now()): DailyData {
  const next = sanitizeDaily(raw, now)
  for (const mission of dailyMissions(next.day)) {
    const n = delta[mission.id]
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) next.progress[mission.id] = Math.min(mission.target, next.progress[mission.id] + n)
  }
  return next
}
export function claimDaily(raw: DailyData, id: DailyMetric, now = Date.now()): { daily: DailyData; reward: number; badge: boolean } | null {
  const daily = sanitizeDaily(raw, now), mission = dailyMissions(daily.day).find(m => m.id === id)
  if (!mission || daily.claimed.includes(id) || daily.progress[id] < mission.target) return null
  daily.claimed.push(id)
  const badge = daily.claimed.length === DAILY_METRICS.length && !daily.badgeClaimed
  if (badge) daily.badgeClaimed = true
  return { daily, reward: mission.reward, badge }
}
