import { describe, expect, it } from 'vitest'
import { advanceDaily, claimDaily, dailyDay, dailyMissions, emptyDaily, sanitizeDaily } from '../src/game/daily'
import { claimDailyReward, defaultSave, parseSave, SAVE_KEY, SaveStore } from '../src/engine/save'
const now = Date.parse('2026-10-19T12:00:00Z')
const day = dailyDay(now)
describe('local daily missions', () => {
  it('deterministically defines five bounded goals for the UTC calendar day', () => {
    expect(dailyMissions(day)).toEqual(dailyMissions(dailyDay(now + 1000)))
    expect(dailyMissions(day)).toHaveLength(5)
    expect(new Set(dailyMissions(day).map(m => m.id)).size).toBe(5)
    expect(dailyMissions(day).every(m => m.target > 0 && m.reward > 0)).toBe(true)
    expect(dailyMissions(day)).not.toEqual(dailyMissions('2026-10-20'))
    expect(dailyDay(Date.parse('2026-10-19T23:59:59Z') + 1000)).toBe('2026-10-20')
  })
  it('caps progress, ignores negative/nonfinite increments and preserves the input', () => {
    const original = emptyDaily(day)
    const next = advanceDaily(original, { coins: 10000, seconds: 1.5, kills: -3, abilities: NaN, royalty: Infinity }, now)
    expect(next.progress.coins).toBe(dailyMissions(day)[0].target)
    expect(next.progress.seconds).toBe(1.5)
    expect(next.progress.kills).toBe(0)
    expect(next.progress.abilities).toBe(0)
    expect(next.progress.royalty).toBe(0)
    expect(original.progress.coins).toBe(0)
  })
  it('resets progress and claims on day changes, including an attempted stale claim', () => {
    const completed = advanceDaily(emptyDaily(day), { coins: 999 }, now)
    const claimed = claimDaily(completed, 'coins', now)!
    const tomorrow = Date.parse('2026-10-20T00:00:00Z')
    expect(sanitizeDaily(claimed.daily, tomorrow)).toEqual(emptyDaily('2026-10-20'))
    expect(claimDaily(claimed.daily, 'coins', tomorrow)).toBeNull()
    expect(advanceDaily(claimed.daily, { kills: 1 }, tomorrow).progress.coins).toBe(0)
  })
  it('rejects premature/repeated claims and pays the exact mission reward once', () => {
    let data = { ...defaultSave(), daily: emptyDaily(day), stardust: 30 }
    expect(claimDailyReward(data, 'kills', now)).toBeNull()
    data.daily = advanceDaily(data.daily, { kills: 999 }, now)
    const result = claimDailyReward(data, 'kills', now)!
    expect(result.stardust).toBe(30 + dailyMissions(day).find(m => m.id === 'kills')!.reward)
    expect(claimDailyReward(result, 'kills', now)).toBeNull()
    expect(data.stardust).toBe(30)
  })
  it('awards a full-set achievement badge once and never sells or reclaims it', () => {
    let data = { ...defaultSave(), daily: advanceDaily(emptyDaily(day), { coins: 999, seconds: 999, kills: 99, abilities: 99, royalty: 99 }, now) }
    for (const m of dailyMissions(day)) data = claimDailyReward(data, m.id, now)!
    expect(data.daily.badgeClaimed).toBe(true)
    expect(data.achievements.dailySets).toBe(1)
    expect(data.ownedCosmetics).toContain('badge-daily')
    const wallet = data.stardust
    for (const m of dailyMissions(day)) expect(claimDailyReward(data, m.id, now)).toBeNull()
    expect(data.stardust).toBe(wallet)
  })
  it('sanitizes unknown/duplicate claims and broken local mission data', () => {
    for (const raw of [null, [], {}, { day: 'bad' }, { day, progress: { seconds: Infinity }, claimed: ['seconds', 'fake'], badgeClaimed: true }]) {
      expect(sanitizeDaily(raw, now)).toEqual(emptyDaily(day))
    }
    const valid = advanceDaily(emptyDaily(day), { coins: 999 }, now)
    expect(sanitizeDaily({ ...valid, claimed: ['coins', 'coins', 'fake'] }, now).claimed).toEqual(['coins'])
  })
  it('persists an atomic wallet/claim record and blocks a repeated claim after reload', () => {
    // Use the actual current day because parseSave intentionally discards other days.
    const current = Date.now(), today = dailyDay(current)
    const memory = new Map<string, string>()
    const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, v) } }
    const store = new SaveStore(storage)
    store.update({ daily: advanceDaily(emptyDaily(today), { coins: 999 }, current) })
    store.replace(claimDailyReward(store.data, 'coins', current)!)
    const reloaded = new SaveStore(storage)
    expect(reloaded.data.stardust).toBe(store.data.stardust)
    expect(claimDailyReward(reloaded.data, 'coins', current)).toBeNull()
    expect(parseSave(memory.get(SAVE_KEY)!).daily.claimed).toContain('coins')
  })
})
