import { describe, expect, it } from 'vitest'
import { appearanceSkin, WORM_COLORS } from '../src/game/appearance'
import { growthMaterial, growthSkinPalette } from '../src/game/growthVisuals'
import { easeMouth, GULP_FACE_SECONDS, gulpFace, gulpFeedback, preyMouthTarget } from '../src/game/faceFeedback'
import { radiusForLength } from '../src/game/rules'
import { Sim, type SimEvent } from '../src/game/sim'

function arena(length = 100) {
  const sim = new Sim({ mode: 'ffa', seed: 2, bots: 1, playerName: 'Feast', playerSkin: 'nebula' })
  sim.orbs = []; sim.pickups = []; sim.shards = []; sim.celestials = []; sim.surprises = []; sim.traps = []
  const p = sim.player, rival = sim.worms.find(w => w !== p)!
  p.xs = Array(length).fill(0); p.zs = Array(length).fill(0); p.kinds = Array(length).fill(null)
  p.mass = length; p.radius = radiusForLength(length); p.angle = 0; p.spawnGrace = 0
  rival.xs = Array(20).fill(10); rival.zs = Array(20).fill(0); rival.kinds = Array(20).fill(null)
  rival.mass = 20; rival.radius = 1; rival.spawnGrace = 0
  sim.events = []
  return { sim, p, rival }
}

describe('bronze / gold / purple growth skin', () => {
  it.each(WORM_COLORS.map(c => c.id))('keeps %s unmodified at small sizes, then visibly changes each stage', color => {
    const base = appearanceSkin('nebula', color)
    const palettes = [20, 60, 130, 260].map(length => growthSkinPalette(base, growthMaterial(length, radiusForLength(length))))
    expect(palettes[0]).toEqual({ head: base.head, colors: base.colors })
    expect(new Set(palettes.map(p => p.head)).size).toBe(4)
    expect(new Set(palettes.map(p => JSON.stringify(p.colors))).size).toBe(4)
    expect(base).toBe(appearanceSkin('nebula', color))
  })
  it('uses the same 60/130/260 armor thresholds with increasingly bright metallic coats', () => {
    const materials = [20, 60, 130, 260].map(length => growthMaterial(length, radiusForLength(length)))
    expect(materials.map(m => m.phase)).toEqual(['base', 'bronze', 'gold', 'purple'])
    expect(materials.map(m => m.tier)).toEqual([0, 1, 2, 3])
    expect(materials.map(m => m.tint)).toEqual([0xb85a22, 0xb85a22, 0xffc62e, 0x8f3edd])
    expect(materials[3].metalness).toBeGreaterThan(materials[2].metalness)
    expect(materials[3].roughness).toBeLessThan(materials[1].roughness)
    expect(materials[3].glow).toBeGreaterThan(materials[1].glow)
  })
  it('smoothly tints before thresholds without palette jumps and respects shrink radius', () => {
    for (const length of [40, 60, 100, 130, 210, 260]) {
      const a = growthMaterial(length - 0.001, 2), b = growthMaterial(length + 0.001, 2)
      expect(Math.abs(a.blend - b.blend)).toBeLessThan(0.001)
      expect(Math.abs(a.metalness - b.metalness)).toBeLessThan(0.001)
      expect(a.tint).toBe(b.tint)
    }
    const small = growthMaterial(500, 0.9)
    expect(small.tier).toBe(0); expect(small.blend).toBe(0)
    expect(growthMaterial(NaN, NaN).metalness).toBe(0)
  })
})

describe('appetite and brief gulp tongue', () => {
  it('opens gradually when edible prey approaches the forward head, then closes after retreat', () => {
    const { sim, p, rival } = arena()
    const near = preyMouthTarget(p, sim)
    rival.xs.fill(15)
    const farther = preyMouthTarget(p, sim)
    expect(near).toBeGreaterThan(farther); expect(farther).toBeGreaterThan(0)
    rival.xs.fill(100)
    expect(preyMouthTarget(p, sim)).toBe(0)
    const opened = easeMouth(0, near, 1 / 60)
    expect(opened).toBeGreaterThan(0); expect(opened).toBeLessThan(near)
    expect(easeMouth(opened, 0, 0.5)).toBeLessThan(opened / 10)
  })
  it('rejects larger/near-tie enemies, protected/dead rivals, teammates and prey behind the head', () => {
    const { sim, p, rival } = arena()
    rival.xs.fill(-8)
    expect(preyMouthTarget(p, sim)).toBe(0)
    rival.xs.fill(8); rival.spawnGrace = 1
    expect(preyMouthTarget(p, sim)).toBe(0)
    rival.spawnGrace = 0; rival.alive = false
    expect(preyMouthTarget(p, sim)).toBe(0)
    rival.alive = true; rival.xs = Array(100).fill(8); rival.zs = Array(100).fill(0)
    expect(preyMouthTarget(p, sim)).toBe(0)
    rival.xs = Array(20).fill(8); rival.zs = Array(20).fill(0); rival.team = p.team
    expect(preyMouthTarget(p, { ...sim, mode: 'team' })).toBe(0)
  })
  it('detects edible body edges even when a rival head is elsewhere, and works for AI worms', () => {
    const { sim, p, rival } = arena()
    rival.xs.fill(30); rival.zs.fill(20)
    rival.xs[10] = 5; rival.zs[10] = 0
    expect(preyMouthTarget(p, sim)).toBeGreaterThan(0.7)
    p.xs.fill(6); p.mass = 10; p.xs.length = 10; p.zs.length = 10
    rival.xs = Array(100).fill(0); rival.zs = Array(100).fill(0); rival.angle = 0
    expect(preyMouthTarget(rival, sim)).toBeGreaterThan(0)
  })
  it('opens only for celestials the worm can swallow, and restores closed idle without a flash', () => {
    const { sim, p, rival } = arena(20)
    rival.alive = false
    sim.celestials.push({ id: 1, kind: 'pulsar', x: 5, z: 0, vx: 0, vz: 0, spin: 0, alive: true, bump: 0 })
    expect(preyMouthTarget(p, sim)).toBe(0)
    sim.celestials[0].kind = 'moon'
    expect(preyMouthTarget(p, sim)).toBeGreaterThan(0.8)
    expect(gulpFace(Infinity)).toEqual({ open: 0, tongue: 0, pulse: 0 })
    expect(gulpFace(0).tongue).toBe(1)
    expect(gulpFace(0.1).pulse).toBeGreaterThan(0)
    expect(gulpFace(GULP_FACE_SECONDS - 0.02).tongue).toBeLessThan(0.2)
    expect(gulpFace(GULP_FACE_SECONDS).tongue).toBe(0)
  })
  it('is frame-rate-independent and does not suppress appetite or tongue for reduced motion', () => {
    let a = 0, b = 0
    for (let i = 0; i < 30; i++) a = easeMouth(a, 1, 1 / 30)
    for (let i = 0; i < 144; i++) b = easeMouth(b, 1, 1 / 144)
    expect(a).toBeCloseTo(b, 10)
    expect(gulpFace(0.05, 0.45).tongue).toBe(0.45)
  })
})

describe('large feast trigger, not a kill sound', () => {
  it('ordinary pellets show a tongue but only nova/rich food/large rival food or celestials request a voice', () => {
    const { p } = arena()
    const eat: SimEvent = { type: 'eat', worm: p, value: 1, x: 0, z: 0, color: 0xffffff, nova: false, combo: 1 }
    expect(gulpFeedback(eat)?.big).toBe(false)
    expect(gulpFeedback({ ...eat, value: 3 })?.big).toBe(true)
    expect(gulpFeedback({ ...eat, nova: true })?.big).toBe(true)
    expect(gulpFeedback({ ...eat, sourceLength: 60 })?.big).toBe(true)
    expect(gulpFeedback({ ...eat, sourceLength: 59 })?.big).toBe(false)
    expect(gulpFeedback({ type: 'celestial', worm: p, kind: 'planet', powerAdded: true, x: 0, z: 0 })?.big).toBe(true)
    expect(gulpFeedback({ type: 'death', worm: p, killer: null, cause: 'rim', x: 0, z: 0 })).toBe(null)
    expect(gulpFeedback({ type: 'pickup', worm: p, kind: 'shield', x: 0, z: 0 })).toBe(null)
  })
  it('also recognizes food from an enemy longer than a small player', () => {
    const { p } = arena(20)
    expect(gulpFeedback({ type: 'eat', worm: p, value: 1, x: 0, z: 0, color: 0xffffff, nova: false, combo: 1, sourceLength: 40 })?.big).toBe(true)
  })
  it('carries original rival length through spilled food and eat events, including recycled orb slots', () => {
    const { sim, p, rival } = arena()
    rival.xs = Array(80).fill(0); rival.zs = Array(80).fill(0); rival.kinds = Array(80).fill(null); rival.mass = 80
    sim.orbs = Array.from({ length: 1401 }, () => ({ x: 90, z: 90, value: 1, r: 1, color: 0xffffff, alive: false, phase: 0, nova: false }))
    sim.kill(rival, p, 'head')
    expect(sim.orbs.filter(o => o.alive).every(o => o.sourceLength === 80)).toBe(true)
    expect(sim.events.every(e => gulpFeedback(e) === null)).toBe(true)
    sim.events = []
    const eat = (sim as unknown as { eat(dt: number): void }).eat.bind(sim)
    eat(0)
    const events = sim.events.filter(e => e.type === 'eat')
    expect(events.length).toBeGreaterThan(0)
    expect(events.every(e => e.sourceLength === 80 && gulpFeedback(e)?.big)).toBe(true)
  })
})
