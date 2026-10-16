import { describe, expect, it } from 'vitest'
import { analyzeThreats, projectPath, visibleThreatKinds, type ThreatWorld } from '../src/game/threats'

type W = ThreatWorld['worms'][number]
const worm = (over: Partial<W> & { id: number }): W => ({
  alive: true, isPlayer: false, team: -1, xs: [0], zs: [0], angle: 0, targetAngle: 0,
  radius: 1, speed: 12, spawnGrace: 0, ...over,
})
const line = (x0: number, z0: number, n: number, dx = -1, dz = 0) => ({
  xs: Array.from({ length: n }, (_, i) => x0 + dx * i * 0.8),
  zs: Array.from({ length: n }, (_, i) => z0 + dz * i * 0.8),
})
const world = (over: Partial<ThreatWorld> = {}): ThreatWorld => {
  const player = worm({ id: 1, isPlayer: true, ...line(0, 0, 30) })
  return { time: 0, radius: 200, mode: 'ffa', asteroids: [], gates: [], wells: [], worms: [player], player, ...over }
}

describe('threat look-ahead', () => {
  it('projects the head forward along its heading', () => {
    const p = projectPath(worm({ id: 1 }))
    expect(p.length).toBe(11)
    expect(p[p.length - 1].x).toBeGreaterThan(12)
    expect(Math.abs(p[p.length - 1].z)).toBeLessThan(0.01)
  })

  it('flags an asteroid straight ahead as imminent and sets the focus', () => {
    const r = analyzeThreats(world({ asteroids: [{ x: 9, z: 0, r: 2.5 }, { x: -60, z: 40, r: 3 }] }))
    expect(r.asteroids).toEqual([2, 0])
    expect(r.focus?.kind).toBe('asteroid')
  })

  it('judges gates by the phase at arrival time', () => {
    // period 10, on 3 → off until 5.8, warn 5.8–7, on 7–10. Gate crosses the path ~6 units ahead (~0.5 s).
    const gate = { ax: 6, az: -10, bx: 6, bz: 10, period: 10, on: 3, offset: 0 }
    expect(analyzeThreats(world({ time: 1, gates: [gate] })).gates[0]).toBe(0)
    expect(analyzeThreats(world({ time: 6.7, gates: [gate] })).gates[0]).toBe(2) // warn now, lit on arrival
    expect(analyzeThreats(world({ time: 8, gates: [gate] })).gates[0]).toBe(2)
    const lit = analyzeThreats(world({ time: 8, gates: [gate] }))
    expect(lit.focus?.kind).toBe('gate')
    expect(lit.arrows.some(a => a.kind === 'gate')).toBe(true)
  })

  it('treats gravity wells as hindrances, never imminent', () => {
    const r = analyzeThreats(world({ wells: [{ x: 10, z: 0, r: 8 }] }))
    expect(r.wells[0]).toBe(1)
    expect(r.focus).toBeNull()
  })

  it('warns before the arena rim', () => {
    const player = worm({ id: 1, isPlayer: true, ...line(190, 0, 20) })
    const r = analyzeThreats(world({ radius: 200, worms: [player], player }))
    expect(r.rim).toBe(2)
    expect(r.focus?.kind).toBe('rim')
  })

  it('flags a rival body across the path, but never a teammate', () => {
    // Rival body runs vertically across x = 7.
    const rival = worm({ id: 2, ...line(7, -10, 30, 0, 1), angle: Math.PI / 2, targetAngle: Math.PI / 2 })
    const base = world()
    const ffa = analyzeThreats({ ...base, worms: [base.player, rival] })
    expect(ffa.rivals.get(2)?.level).toBe(2)
    expect(ffa.rivals.get(2)?.glow).toBe(true)
    expect(ffa.focus?.kind).toBe('rival')
    const P = { ...base.player, team: 0 }
    const team = analyzeThreats({ ...base, mode: 'team', player: P, worms: [P, { ...rival, team: 0 }] })
    expect(team.rivals.get(2)?.ally).toBe(true)
    expect(team.rivals.get(2)?.level).toBe(0)
    expect(team.focus).toBeNull()
  })

  it('marks longer rivals as bigger and points arrows at them when they close in', () => {
    const big = worm({ id: 3, ...line(-40, 0, 80, -1, 0), angle: 0, targetAngle: 0 })
    const small = worm({ id: 4, ...line(0, 40, 5, 0, 1), angle: -Math.PI / 2 })
    const base = world()
    const r = analyzeThreats({ ...base, worms: [base.player, big, small] })
    expect(r.rivals.get(3)?.bigger).toBe(true)
    expect(r.rivals.get(4)?.bigger).toBe(false)
    expect(r.arrows.some(a => a.key === 'w3')).toBe(true)
    expect(r.arrows.some(a => a.key === 'w4')).toBe(false)
  })

  it('returns a clear report for a dead player', () => {
    const base = world({ asteroids: [{ x: 5, z: 0, r: 2 }] })
    const r = analyzeThreats({ ...base, player: { ...base.player, alive: false } })
    expect(r.asteroids).toEqual([0])
    expect(r.focus).toBeNull()
  })

  it('reports visible threat kinds for first-encounter hints', () => {
    const w = world({ asteroids: [{ x: 10, z: 5, r: 2 }], wells: [{ x: 400, z: 0, r: 10 }] })
    const k = visibleThreatKinds(w, 0, 0, 40)
    expect(k.has('asteroid')).toBe(true)
    expect(k.has('well')).toBe(false)
  })
})
