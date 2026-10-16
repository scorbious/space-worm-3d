import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/game/config'
import { CELESTIALS } from '../src/game/content'
import { canBite, radiusForLength } from '../src/game/rules'
import { Sim, type Worm } from '../src/game/sim'
import { analyzeThreats, visibleThreatKinds, type ThreatWorld } from '../src/game/threats'

/** Lay a worm out as a straight line whose head is at (x, z) facing `ang`. */
function layout(w: Worm, x: number, z: number, ang: number, len: number): void {
  const sp = 0.8
  w.mass = len + 0.5
  w.xs = Array.from({ length: len }, (_, i) => x - Math.cos(ang) * i * sp)
  w.zs = Array.from({ length: len }, (_, i) => z - Math.sin(ang) * i * sp)
  w.kinds = Array.from({ length: len }, () => null)
  w.radius = radiusForLength(len)
  w.angle = w.targetAngle = ang
  w.spawnGrace = 0
  w.envGrace = 0
  w.shield = 0
  w.alive = true
}

/** An empty arena with the player and one rival, far from any hazard. */
function duel(playerLen: number, rivalLen: number) {
  const sim = new Sim({ mode: 'ffa', seed: 21, playerName: 'Test', playerSkin: 'nebula', bots: 1 })
  sim.asteroids = []
  sim.gates = []
  sim.wells = []
  sim.orbs = []
  sim.celestials = []
  const p = sim.player
  const r = sim.worms.find(w => w !== p)!
  // Rival lies along +x (head at x=10); the player heads straight down onto its segment 10.
  layout(r, 10, 0, 0, rivalLen)
  const target = 10
  layout(p, r.xs[target], r.zs[target] - 0.3, Math.PI / 2, playerLen)
  sim.events = []
  return { sim, p, r, target }
}

const stepHold = (sim: Sim, p: Worm) => sim.step(1 / 60, { targetAngle: p.angle, turn: 0, boost: false })

describe('bite rule', () => {
  it('needs a clear length lead', () => {
    expect(canBite(60, 20)).toBe(true)
    expect(canBite(23, 20)).toBe(true) // 1.15x and +3
    expect(canBite(22, 20)).toBe(false) // under 1.15x
    expect(canBite(9, 6)).toBe(true)
    expect(canBite(8, 6)).toBe(false) // 1.33x but only +2
    expect(canBite(20, 20)).toBe(false)
  })

  it('a longer head cuts a shorter body at the point of impact; the tail becomes food', () => {
    const { sim, p, r, target } = duel(60, 30)
    stepHold(sim, p)
    const bite = sim.events.find(e => e.type === 'bite')
    expect(bite).toBeTruthy()
    expect(p.alive).toBe(true)
    expect(r.alive).toBe(true)
    // Cut close to where the head landed; the front part keeps going.
    expect(r.xs.length).toBeGreaterThanOrEqual(target - 2)
    expect(r.xs.length).toBeLessThanOrEqual(target + 2)
    expect(r.xs.length).toBe(r.zs.length)
    expect(r.kinds.length).toBe(r.xs.length)
    expect(Math.floor(r.mass)).toBe(r.xs.length)
    if (bite?.type === 'bite') expect(bite.lost + r.xs.length).toBe(30)
    // Severed segments spill most of their mass as food.
    const spilled = sim.orbs.reduce((a, o) => a + o.value, 0)
    expect(spilled).toBeGreaterThan((30 - r.xs.length) * CONFIG.bite.spill * 0.8)
    expect(p.bites).toBe(1)
  })

  it('stays deadly for the attacker when lengths are close', () => {
    const { sim, p, r } = duel(32, 30)
    stepHold(sim, p)
    expect(sim.events.some(e => e.type === 'bite')).toBe(false)
    expect(p.alive).toBe(false)
    expect(r.alive).toBe(true)
    expect(r.xs.length).toBeGreaterThanOrEqual(30)
  })

  it('always leaves the victim at least its minimum length', () => {
    const { sim, p, r } = duel(60, 30)
    layout(p, r.xs[2], r.zs[2] - 0.3, Math.PI / 2, 60)
    stepHold(sim, p)
    expect(r.alive).toBe(true)
    expect(r.xs.length).toBe(CONFIG.bite.minKeep)
  })

  it('releases severed celestial segments back into space and removes their power', () => {
    const { sim, p, r } = duel(80, 30)
    r.kinds[20] = 'moon'
    const power = CELESTIALS.moon.power
    r.stacks[power] = 1
    stepHold(sim, p)
    expect(r.kinds.includes('moon')).toBe(false)
    expect(r.stacks[power]).toBe(0)
    expect(sim.celestials.some(c => c.kind === 'moon' && c.alive)).toBe(true)
  })

  it('lets the attacker pass through the stump right after a bite', () => {
    const { sim, p, r } = duel(60, 30)
    for (let i = 0; i < 20; i++) stepHold(sim, p)
    expect(p.alive).toBe(true)
    expect(sim.events.filter(e => e.type === 'bite').length).toBe(1)
    expect(r.alive).toBe(true)
  })
})

describe('bite-aware threat language', () => {
  type W = ThreatWorld['worms'][number]
  const worm = (over: Partial<W> & { id: number }): W => ({
    alive: true, isPlayer: false, team: -1, xs: [0], zs: [0], angle: 0, targetAngle: 0, radius: 1, speed: 12, spawnGrace: 0, ...over,
  })
  const line = (x0: number, z0: number, n: number, dx = -1, dz = 0) => ({
    xs: Array.from({ length: n }, (_, i) => x0 + dx * i * 0.8),
    zs: Array.from({ length: n }, (_, i) => z0 + dz * i * 0.8),
  })
  it('does not treat a prey body across our path as lethal, but does for an equal rival', () => {
    const player = worm({ id: 1, isPlayer: true, ...line(0, 0, 60) })
    // Rival body lying across the path 6 units ahead.
    const across = (id: number, n: number) => worm({ id, ...line(6, 8, n, 0, -1) })
    const prey = across(2, 20)
    const peer = across(3, 58)
    const base = { time: 0, radius: 200, mode: 'ffa' as const, asteroids: [], gates: [], wells: [], player }
    const r1 = analyzeThreats({ ...base, worms: [player, prey] })
    expect(r1.rivals.get(2)?.prey).toBe(true)
    expect(r1.rivals.get(2)?.level).toBe(0)
    expect(r1.focus).toBeNull()
    const r2 = analyzeThreats({ ...base, worms: [player, peer] })
    expect(r2.rivals.get(3)?.prey).toBe(false)
    expect(r2.rivals.get(3)?.level).toBe(2)
  })
  it('offers the edible and bite hints only when they apply', () => {
    const small = worm({ id: 1, isPlayer: true, ...line(0, 0, 8) })
    const big = worm({ id: 1, isPlayer: true, ...line(0, 0, 400) })
    const rival = worm({ id: 2, ...line(10, 5, 20) })
    const celestials = [{ x: 8, z: 0, kind: 'star' as const, alive: true }]
    const base = { time: 0, radius: 500, mode: 'ffa' as const, asteroids: [], gates: [], wells: [], celestials }
    const s = visibleThreatKinds({ ...base, worms: [small, rival], player: small }, 0, 0, 40)
    expect(s.has('edible')).toBe(CELESTIALS.star.minLength <= 8)
    expect(s.has('bite')).toBe(false)
    const b = visibleThreatKinds({ ...base, worms: [big, rival], player: big }, 0, 0, 40)
    expect(b.has('edible')).toBe(true)
    expect(b.has('bite')).toBe(true)
  })
})
