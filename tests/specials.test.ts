import { describe, expect, it } from 'vitest'
import { appearanceSkin, HEAD_STYLES } from '../src/game/appearance'
import { defaultSave, parseSave, purchaseSkin } from '../src/engine/save'
import { CONFIG } from '../src/game/config'
import { ENVIRONMENTS, environmentFor } from '../src/game/environmentDefs'
import { ArenaEnvironment } from '../src/game/environments'
import { headGeometry } from '../src/game/headShapes'
import { radiusForLength } from '../src/game/rules'
import { Sim, type Worm } from '../src/game/sim'
import { isDominant, SPECIALS, surpriseInterval, trapDuration, TRAP_IDS, type SurpriseId, type TrapId } from '../src/game/specials'

function line(w: Worm, length = 28, x = 0, z = 0): void {
  w.xs = Array.from({ length }, (_, i) => x - i * 0.62)
  w.zs = Array(length).fill(z)
  w.kinds = Array(length).fill(null)
  w.mass = length
  w.radius = radiusForLength(length)
  w.angle = w.targetAngle = 0
  w.spawnGrace = w.envGrace = 0
  w.wantBoost = false
}
function arena(bots = 0): Sim {
  const sim = new Sim({ mode: 'ffa', seed: 12, playerName: 'Test', playerSkin: 'nebula', bots })
  sim.asteroids = []; sim.gates = []; sim.wells = []
  sim.orbs = []; sim.pickups = []; sim.celestials = []; sim.shards = []; sim.traps = []
  sim.events = []
  line(sim.player)
  return sim
}
function step(sim: Sim, dt = 0, turn = 0): void {
  sim.orbs = []; sim.pickups = []; sim.celestials = []; sim.shards = []
  sim.step(dt, { targetAngle: turn ? null : sim.player.angle, turn, boost: false })
}
function surprise(sim: Sim, kind: SurpriseId): void {
  const w = sim.player
  sim.surprises = [{ id: 9000, kind, ownerId: w.id, x: w.xs[0], z: w.zs[0], alive: true, expiresAt: sim.time + 5 }]
  step(sim)
}
function trap(sim: Sim, kind: TrapId, worm = sim.player): void {
  sim.traps = [{ id: 9001, kind, x: worm.xs[0], z: worm.zs[0], alive: true, expiresAt: sim.time + 36 }]
  step(sim)
}

describe('monarch surprise rules', () => {
  it('requires crown, high current length/score or four kills, with bounded frequency', () => {
    expect(isDominant(20, false, 0)).toBe(false)
    expect(isDominant(20, true, 0)).toBe(true)
    expect(isDominant(90, false, 0)).toBe(true)
    expect(isDominant(20, false, 4)).toBe(true)
    expect(surpriseInterval(400, true, 8)).toBeLessThan(surpriseInterval(90, false, 0))
    expect(surpriseInterval(100000, true, 100)).toBeGreaterThanOrEqual(30)
  })
  it('expires a drop at exactly five seconds, before eating can occur', () => {
    const sim = arena()
    sim.player.traps.freeze = 20
    sim.surprises = [{ id: 888, kind: 'legendary', ownerId: sim.player.id, x: 0, z: 0, alive: true, expiresAt: 5 }]
    step(sim, 5)
    expect(sim.permanentExpansion).toBe(0)
    expect(sim.surprises).toHaveLength(0)
    expect(sim.events.some(e => e.type === 'surpriseExpire')).toBe(true)
    expect(sim.events.some(e => e.type === 'surprise')).toBe(false)
  })
  it('allows a drop to be eaten just before expiry', () => {
    const sim = arena()
    sim.time = 4.99
    sim.surprises = [{ id: 888, kind: 'legendary', ownerId: -1, x: 0, z: 0, alive: true, expiresAt: 5 }]
    step(sim)
    expect(sim.permanentExpansion).toBe(SPECIALS.legendaryExpansion)
  })
  it('keeps legendary and stage growth after a temporary zone ends and warns once', () => {
    const sim = arena()
    surprise(sim, 'zone')
    expect(sim.radius).toBe(CONFIG.arena.radius + SPECIALS.zoneExpansion)
    surprise(sim, 'legendary')
    line(sim.player, 80)
    step(sim)
    expect(sim.stage).toBe(3)
    const expected = CONFIG.arena.radius + 60 + SPECIALS.legendaryExpansion
    expect(sim.radius).toBe(expected + SPECIALS.zoneExpansion)
    sim.player.traps.freeze = 100
    step(sim, SPECIALS.zoneDuration - 5)
    expect(sim.events.filter(e => e.type === 'zoneWarning')).toHaveLength(1)
    step(sim, 5)
    expect(sim.radius).toBe(expected)
    expect(sim.zoneLeft).toBe(0)
    expect(sim.events.filter(e => e.type === 'zoneWarning')).toHaveLength(1)
    expect(sim.events.some(e => e.type === 'zoneEnd')).toBe(true)
  })
  it('rescues a head left in the returning annulus instead of causing an unavoidable rim death', () => {
    const sim = arena()
    surprise(sim, 'zone')
    sim.player.xs[0] = CONFIG.arena.radius + 12
    sim.player.traps.freeze = 100
    step(sim, SPECIALS.zoneDuration)
    expect(sim.player.alive).toBe(true)
    expect(Math.hypot(sim.player.xs[0], sim.player.zs[0])).toBeLessThan(sim.radius)
  })
  it('shrinks physical radius only and restores it without removing the crown or length', () => {
    const sim = arena()
    line(sim.player, 45)
    step(sim)
    const size = sim.player.radius
    const length = sim.player.xs.length
    expect(sim.crownId).toBe(sim.player.id)
    surprise(sim, 'shrink')
    expect(sim.player.radius).toBeCloseTo(size * SPECIALS.shrinkScale)
    expect(sim.player.xs.length).toBe(length)
    expect(sim.crownId).toBe(sim.player.id)
    sim.player.traps.freeze = 100
    step(sim, SPECIALS.shrinkDuration)
    expect(sim.player.radius).toBeCloseTo(size)
    expect(sim.crownId).toBe(sim.player.id)
    expect(sim.events.some(e => e.type === 'shrinkEnd')).toBe(true)
  })
  it('spawns at most one rare drop and does not respawn it each frame', () => {
    const sim = arena()
    line(sim.player, 100)
    sim.player.traps.freeze = 100
    step(sim, SPECIALS.firstSurprise + 0.1)
    expect(sim.surprises).toHaveLength(1)
    expect(sim.surprises[0].expiresAt - sim.time).toBe(5)
    step(sim, 1)
    expect(sim.events.filter(e => e.type === 'surpriseSpawn')).toHaveLength(1)
    step(sim, 5)
    expect(sim.surprises).toHaveLength(0)
    expect(sim.events.filter(e => e.type === 'surpriseSpawn')).toHaveLength(1)
  })
  it('does not spawn rare drops for a fresh, non-dominant worm', () => {
    const sim = arena()
    line(sim.player, 20)
    sim.player.traps.freeze = 100
    step(sim, 50)
    expect(sim.surprises).toHaveLength(0)
  })
})

describe('edible trap rules', () => {
  it('applies bounded core resistance', () => {
    expect(trapDuration('freeze', 0)).toBe(1.6)
    expect(trapDuration('slow', 3)).toBeCloseTo(2.2)
    expect(trapDuration('reverse', 10)).toBeCloseTo(3.5 * 0.55)
    expect(trapDuration('half', 3)).toBe(0)
  })
  it('freezes movement and boosting, then restores movement with an expiry event', () => {
    const sim = arena()
    trap(sim, 'freeze')
    const x = sim.player.xs[0]
    expect(sim.player.traps.freeze).toBe(1.6)
    step(sim, 0.5)
    expect(sim.player.xs[0]).toBe(x)
    expect(sim.player.speed).toBe(0)
    expect(sim.player.boosting).toBe(false)
    step(sim, 1.11)
    expect(sim.player.traps.freeze).toBe(0)
    expect(sim.player.speed).toBeGreaterThan(0)
    expect(sim.events.some(e => e.type === 'trapEnd' && e.kind === 'freeze')).toBe(true)
  })
  it('slows the player and applies planet resistance to the duration', () => {
    const sim = arena()
    sim.player.stacks.core = 2
    trap(sim, 'slow')
    expect(sim.player.traps.slow).toBeCloseTo(2.8)
    step(sim, 0.05)
    expect(sim.player.speed).toBeCloseTo(CONFIG.worm.baseSpeed * 0.48)
    expect(sim.player.slowed).toBe(true)
  })
  it('reverses keyboard and pointer turning rather than flipping the whole chain', () => {
    const sim = arena()
    trap(sim, 'reverse')
    step(sim, 0.05, 1)
    expect(sim.player.angle).toBeLessThan(0)
    sim.player.angle = 0
    sim.player.targetAngle = 0.8
    sim.orbs = []; sim.pickups = []; sim.celestials = []
    sim.step(0.05, { targetAngle: 0.8, turn: 0, boost: false })
    expect(sim.player.angle).toBeLessThan(0)
  })
  it('halves actual length/score immediately, including celestial segments in the removed tail', () => {
    const sim = arena()
    line(sim.player, 28)
    sim.player.kinds[26] = 'moon'
    sim.player.stacks.tide = 1
    sim.player.peak = 70
    sim.player.shards = 6
    trap(sim, 'half')
    expect(sim.player.xs).toHaveLength(14)
    expect(sim.player.zs).toHaveLength(14)
    expect(sim.player.kinds).toHaveLength(14)
    expect(sim.player.mass).toBe(14)
    expect(sim.player.stacks.tide).toBe(0)
    expect(sim.player.peak).toBe(70)
    expect(sim.player.shards).toBe(6)
    expect(sim.player.alive).toBe(true)
  })
  it('never reduces a tiny worm below four segments', () => {
    const sim = arena()
    line(sim.player, 5)
    trap(sim, 'half')
    expect(sim.player.xs).toHaveLength(4)
    expect(sim.player.mass).toBe(4)
  })
  it('teleports the complete chain with landing protection and no loss of powers', () => {
    const sim = arena()
    const before = sim.player.xs.slice()
    sim.player.stacks.heart = 2
    trap(sim, 'teleport')
    expect(sim.player.xs[0]).not.toBe(before[0])
    expect(sim.player.xs).toHaveLength(before.length)
    expect(sim.player.xs[1] - sim.player.xs[0]).toBeCloseTo(before[1] - before[0])
    expect(sim.player.spawnGrace).toBeGreaterThan(0)
    expect(sim.player.envGrace).toBeGreaterThan(0)
    expect(sim.player.stacks.heart).toBe(2)
    expect(Math.hypot(sim.player.xs[0], sim.player.zs[0])).toBeLessThan(sim.radius - 5)
  })
  it('a shield blocks one trap, and recovery blocks trap chains', () => {
    const sim = arena()
    sim.player.shield = 10
    trap(sim, 'half')
    expect(sim.player.mass).toBe(28)
    expect(sim.player.shield).toBe(0)
    expect(sim.events.some(e => e.type === 'trap' && e.resisted)).toBe(true)
    trap(sim, 'freeze')
    expect(sim.player.traps.freeze).toBe(0)
    sim.player.trapGrace = 0
    trap(sim, 'freeze')
    const duration = sim.player.traps.freeze
    trap(sim, 'slow')
    expect(sim.player.traps.freeze).toBe(duration)
    expect(sim.player.traps.slow).toBe(0)
  })
  it.each(TRAP_IDS)('applies %s to AI through the same consumption rules', kind => {
    const sim = arena(1)
    const bot = sim.worms[1]
    line(bot, 28, 40, 20)
    if (bot.brain) bot.brain.think = 10
    trap(sim, kind, bot)
    expect(sim.events.some(e => e.type === 'trap' && e.worm === bot && e.kind === kind && !e.resisted)).toBe(true)
    if (kind === 'freeze' || kind === 'slow' || kind === 'reverse') expect(bot.traps[kind]).toBeGreaterThan(0)
    if (kind === 'half') expect(bot.xs).toHaveLength(14)
    if (kind === 'teleport') expect(bot.spawnGrace).toBeGreaterThan(0)
  })
  it('resets all temporary effects on respawn, but keeps cosmetics', () => {
    const sim = arena()
    sim.player.color = 'pink'; sim.player.headStyle = 'cat'
    sim.player.traps.freeze = 4; sim.player.shrinkLeft = 4; sim.player.trapGrace = 7
    sim.spawnWorm(sim.player)
    expect(sim.player.traps).toEqual({ freeze: 0, slow: 0, reverse: 0 })
    expect(sim.player.shrinkLeft).toBe(0)
    expect(sim.player.trapGrace).toBe(0)
    expect(sim.player.color).toBe('pink')
    expect(sim.player.headStyle).toBe('cat')
  })
  it('bounds arena trap count and silently expires stale traps', () => {
    const sim = arena()
    sim.traps = TRAP_IDS.map((kind, id) => ({ id, kind, x: 80 + id, z: 30, alive: true, expiresAt: 1 }))
    sim.player.traps.freeze = 100
    step(sim, 0.5)
    expect(sim.traps).toHaveLength(SPECIALS.trapCount)
    step(sim, 1)
    expect(sim.traps.length).toBeLessThanOrEqual(1)
    expect(sim.traps.every(t => t.expiresAt > sim.time)).toBe(true)
  })
})

describe('cosmetic migration and geometry', () => {
  it('migrates old v1 saves without losing purchases, records or currency', () => {
    const old = { ...defaultSave(), color: undefined, headStyle: undefined, stardust: 80, ownedSkins: ['nebula', 'solar'], skin: 'solar' }
    old.records.bestLength = 123
    const parsed = parseSave(JSON.stringify(old))
    expect(parsed.color).toBe('skin')
    expect(parsed.headStyle).toBe('round')
    expect(parsed.skin).toBe('solar')
    expect(parsed.stardust).toBe(80)
    expect(parsed.records.bestLength).toBe(123)
  })
  it('validates corrupt cosmetic choices and preserves valid independent choices', () => {
    expect(parseSave(JSON.stringify({ ...defaultSave(), color: '<script>', headStyle: {} })).color).toBe('skin')
    expect(parseSave(JSON.stringify({ ...defaultSave(), color: 'pink', headStyle: 'dragon' })).headStyle).toBe('dragon')
    const bought = purchaseSkin({ ...defaultSave(), stardust: 500, color: 'ice', headStyle: 'robot' }, 'solar')!
    expect(bought.color).toBe('ice')
    expect(bought.headStyle).toBe('robot')
  })
  it('changes actual head/body colors while default keeps the original skin', () => {
    const base = appearanceSkin('nebula')
    const pink = appearanceSkin('nebula', 'pink')
    expect(pink.colors[0]).toBe(0xff5fc8)
    expect(pink.head).toBe(0xff5fc8)
    expect(pink.colors).not.toEqual(base.colors)
    expect(appearanceSkin('nebula', 'pink')).toBe(pink)
  })
  it.each(HEAD_STYLES)('creates finite, cached procedural %s geometry', style => {
    const geometry = headGeometry(style)
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0)
    expect(Array.from(geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true)
    expect(geometry.boundingSphere?.radius).toBeGreaterThan(0)
    expect(headGeometry(style)).toBe(geometry)
  })
})

describe('decorative environment rotation', () => {
  it('visits all six environments, wraps stages and varies by round seed', () => {
    expect(new Set(ENVIRONMENTS.map((_, i) => environmentFor(i + 1, 0))).size).toBe(6)
    expect(environmentFor(7, 0)).toBe(environmentFor(1, 0))
    expect(environmentFor(1, 1)).not.toBe(environmentFor(1, 0))
    const sim = arena()
    const first = sim.environment
    line(sim.player, 80)
    step(sim)
    expect(sim.environment).not.toBe(first)
  })
  it('freezes decorative animation with reduced motion and limits low-quality instances', () => {
    const environment = new ArenaEnvironment()
    environment.quality = 'low'
    environment.update('forest', 10, 128, true)
    const meshes = environment.group.children.filter(child => 'instanceMatrix' in child)
    const before = meshes.map(mesh => Array.from((mesh as import('three').InstancedMesh).instanceMatrix.array))
    environment.update('forest', 50, 128, true)
    const after = meshes.map(mesh => Array.from((mesh as import('three').InstancedMesh).instanceMatrix.array))
    expect(after).toEqual(before)
    expect(meshes.every(mesh => (mesh as import('three').InstancedMesh).count <= 24)).toBe(true)
    environment.update('forest', 50, 128, false)
    const animated = meshes.map(mesh => Array.from((mesh as import('three').InstancedMesh).instanceMatrix.array))
    expect(animated).not.toEqual(before)
  })
})
