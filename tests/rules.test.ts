import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/game/config'
import {
  addPower, applyLife, canConsume, emptyRecords, emptyStacks, formatClock, gateState, insertLife, lengthFromMass,
  lifeEligibleForBoard, powerEffects, radiusForLength, stardustForLife, teamWinner, wellSpeedFactor, type LifeEntry,
} from '../src/game/rules'
import { Sim } from '../src/game/sim'

describe('growth rules', () => {
  it('maps mass to whole segments with a floor', () => {
    expect(lengthFromMass(14.9)).toBe(14)
    expect(lengthFromMass(0)).toBe(4)
  })
  it('grows radius monotonically and stays bounded', () => {
    let prev = 0
    for (const len of [14, 30, 80, 200, 600, 5000]) {
      const r = radiusForLength(len)
      expect(r).toBeGreaterThanOrEqual(prev)
      prev = r
    }
    expect(prev).toBeLessThan(2.2)
  })
})

describe('celestial powers', () => {
  it('requires enough length to swallow bigger bodies', () => {
    expect(canConsume(14, 'moon')).toBe(true)
    expect(canConsume(14, 'planet')).toBe(false)
    expect(canConsume(40, 'planet')).toBe(true)
  })
  it('stacks powers up to their cap and turns them into effects', () => {
    const s = emptyStacks()
    expect(addPower(s, 'moon')).toBe(true)
    expect(addPower(s, 'moon')).toBe(true)
    expect(addPower(s, 'moon')).toBe(true)
    expect(addPower(s, 'moon')).toBe(false)
    expect(s.tide).toBe(3)
    addPower(s, 'comet')
    addPower(s, 'planet')
    const fx = powerEffects(s)
    expect(fx.pickup).toBeCloseTo(1.75)
    expect(fx.boostCost).toBeCloseTo(0.8)
    expect(fx.wellSlow).toBeCloseTo(0.6)
    expect(fx.speed).toBe(1)
  })
})

describe('hazards', () => {
  it('cycles gates off → warn → on', () => {
    expect(gateState(0, 10, 3, 0).phase).toBe('off')
    expect(gateState(6.2, 10, 3, 0).phase).toBe('warn')
    expect(gateState(7.5, 10, 3, 0).phase).toBe('on')
    expect(gateState(7.5, 10, 3, 0).remaining).toBeCloseTo(2.5)
    expect(gateState(-1, 10, 3, 0).phase).toBe('on')
  })
  it('slows movement inside wells, less with the planet power', () => {
    expect(wellSpeedFactor(20, 15, 1)).toBe(1)
    const base = wellSpeedFactor(2, 15, 1)
    const resisted = wellSpeedFactor(2, 15, 0.6)
    expect(base).toBeLessThan(0.6)
    expect(resisted).toBeGreaterThan(base)
  })
})

describe('progression', () => {
  it('awards stardust from a life', () => {
    expect(stardustForLife({ mode: 'ffa', peakLength: 60, kills: 2, celestials: 1, shards: 3, seconds: 90 })).toBe(10 + 16 + 4 + 3)
  })
  it('keeps a bounded, ordered local board', () => {
    let board: LifeEntry[] = []
    for (let i = 0; i < 14; i++) board = insertLife(board, { name: 'p', length: i * 10, kills: 0, seconds: 1, mode: 'ffa', at: i }).board
    expect(board).toHaveLength(10)
    expect(board[0].length).toBe(130)
    const { rank } = insertLife(board, { name: 'x', length: 5, kills: 0, seconds: 1, mode: 'ffa', at: 99 })
    expect(rank).toBe(-1)
  })
  it('tracks personal bests', () => {
    const first = applyLife(emptyRecords(), { mode: 'ffa', peakLength: 40, kills: 1, celestials: 0, shards: 0, seconds: 30 }, 12)
    expect(first.records.bestLength).toBe(40)
    expect(first.newBests).toContain('bestLength')
    const second = applyLife(first.records, { mode: 'ffa', peakLength: 20, kills: 3, celestials: 0, shards: 0, seconds: 10 }, 5)
    expect(second.records.bestLength).toBe(40)
    expect(second.records.mostKills).toBe(3)
    expect(second.records.lives).toBe(2)
    expect(second.records.totalStardust).toBe(17)
  })
  it('decides team winners and formats clocks', () => {
    expect(teamWinner([10, 5])).toBe(0)
    expect(teamWinner([1, 5])).toBe(1)
    expect(teamWinner([5, 5])).toBe(-1)
    expect(formatClock(125.2)).toBe('2:06')
  })
  it('limits online submissions to the board window', () => {
    expect(lifeEligibleForBoard(40, 60_000)).toBe(true)
    expect(lifeEligibleForBoard(40, 1_000)).toBe(false)
    expect(lifeEligibleForBoard(40, 2_000_000)).toBe(false)
  })
})

describe('simulation', () => {
  it('runs a busy free-for-all arena without errors and keeps bots alive over time', () => {
    const sim = new Sim({ mode: 'ffa', seed: 7, playerName: 'Test', playerSkin: 'nebula' })
    let deaths = 0
    let eats = 0
    for (let i = 0; i < 60 * 90; i++) {
      sim.step(1 / 60, { targetAngle: Math.sin(i / 200) * 3, turn: 0, boost: i % 300 < 40 })
      for (const e of sim.events) {
        if (e.type === 'death') deaths++
        if (e.type === 'eat') eats++
      }
      sim.events.length = 0
      if (!sim.player.alive) sim.spawnWorm(sim.player)
    }
    expect(eats).toBeGreaterThan(200)
    expect(deaths).toBeGreaterThan(0)
    const alive = sim.worms.filter(w => w.alive).length
    expect(alive).toBeGreaterThan(CONFIG.arena.bots / 2)
    for (const w of sim.worms) {
      if (!w.alive) continue
      expect(w.xs.every(Number.isFinite)).toBe(true)
      expect(w.xs.length).toBe(w.kinds.length)
    }
  })

  it('adds swallowed celestials as body segments with a permanent power', () => {
    const sim = new Sim({ mode: 'ffa', seed: 3, playerName: 'Test', playerSkin: 'nebula', bots: 0 })
    const p = sim.player
    sim.celestials = [{ id: 999, kind: 'moon', x: p.xs[0] + Math.cos(p.angle) * 2, z: p.zs[0] + Math.sin(p.angle) * 2, vx: 0, vz: 0, spin: 0, alive: true, bump: 0 }]
    const before = p.xs.length
    sim.step(1 / 60, { targetAngle: p.angle, turn: 0, boost: false })
    expect(p.kinds).toContain('moon')
    expect(p.stacks.tide).toBe(1)
    expect(p.xs.length).toBeGreaterThan(before)
    expect(sim.events.some(e => e.type === 'celestial')).toBe(true)
  })

  it('lets a shield absorb one environmental hit', () => {
    const sim = new Sim({ mode: 'ffa', seed: 5, playerName: 'Test', playerSkin: 'nebula', bots: 0 })
    const p = sim.player
    p.spawnGrace = 0
    p.shield = 10
    const dir = Math.atan2(p.zs[0], p.xs[0])
    const edge = sim.radius - p.radius + 0.5
    p.xs[0] = Math.cos(dir) * edge
    p.zs[0] = Math.sin(dir) * edge
    p.angle = dir
    sim.step(1 / 60, { targetAngle: dir, turn: 0, boost: false })
    expect(p.alive).toBe(true)
    expect(p.shield).toBe(0)
    p.envGrace = 0
    p.xs[0] = Math.cos(dir) * edge
    p.zs[0] = Math.sin(dir) * edge
    sim.step(1 / 60, { targetAngle: dir, turn: 0, boost: false })
    expect(p.alive).toBe(false)
  })

  it('spends length while boosting and not with a free boost', () => {
    const sim = new Sim({ mode: 'ffa', seed: 9, playerName: 'Test', playerSkin: 'nebula', bots: 0 })
    const p = sim.player
    p.mass = 60
    const m0 = p.mass
    const step = () => { sim.orbs = []; sim.step(1 / 60, { targetAngle: p.angle, turn: 0, boost: true }) }
    for (let i = 0; i < 30; i++) step()
    expect(p.mass).toBeLessThan(m0)
    p.freeBoost = 5
    const m1 = p.mass
    for (let i = 0; i < 30; i++) step()
    expect(p.mass).toBeGreaterThanOrEqual(m1)
  })

  it('runs a team match to completion with passable teammates', () => {
    const sim = new Sim({ mode: 'team', seed: 11, playerName: 'Test', playerSkin: 'nebula' })
    expect(sim.worms.filter(w => w.team === 0)).toHaveLength(6)
    expect(sim.worms.filter(w => w.team === 1)).toHaveLength(6)
    sim.matchLeft = 2
    let ended = false
    for (let i = 0; i < 60 * 3; i++) {
      sim.step(1 / 60, null)
      if (sim.events.some(e => e.type === 'matchEnd')) ended = true
      sim.events.length = 0
    }
    expect(ended).toBe(true)
    expect(sim.matchOver).toBe(true)
  })
})
