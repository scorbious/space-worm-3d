import { describe, expect, it } from 'vitest'
import { Sim, type Worm } from '../src/game/sim'
import { CONFIG } from '../src/game/config'
import { CAMPAIGN_STAGES } from '../src/game/campaign'
const round = { duration: 180 as const, win: 'score' as const, map: 'sprint' as const, teamSize: 2 as const }
function clean(sim: Sim): void {
  sim.asteroids = []; sim.gates = []; sim.wells = []; sim.traps = []; sim.surprises = []
  sim.orbs = []; sim.shards = []; sim.pickups = []; sim.celestials = []
}
function place(w: Worm, z: number): void {
  w.xs = w.xs.map((_, i) => -i * 1.5); w.zs = w.zs.map(() => z)
  w.angle = w.targetAngle = 0; w.spawnGrace = 100; w.wantBoost = false
  if (w.brain) { w.brain.think = 100; w.brain.boostHold = 0 }
}
describe('competitive beginner fairness', () => {
  it.each([1, 2, 42, 99, 1234])('uses equal beginner length/mass/radius for every enemy at seed %s', seed => {
    for (const mode of ['ffa', 'team'] as const) {
      const sim = new Sim({ mode, round, seed, bots: 8, playerName: 'P', playerSkin: 'nebula' })
      expect(sim.worms.length).toBeGreaterThan(1)
      for (const w of sim.worms) {
        expect(w.xs.length).toBe(sim.player.xs.length)
        expect(w.mass).toBe(CONFIG.worm.startLength)
        expect(w.radius).toBe(sim.player.radius)
        expect(w.speed).toBe(sim.player.speed)
      }
    }
  })
  it('respawns both teams at the same beginner size, never a random bonus length', () => {
    const sim = new Sim({ mode: 'team', round: { ...round, teamSize: 6 }, seed: 18, playerName: 'P', playerSkin: 'nebula' })
    for (const w of sim.worms) {
      w.mass = 200
      sim.spawnWorm(w)
      expect(w.xs.length).toBe(CONFIG.worm.startLength)
      expect(w.mass).toBe(sim.player.mass)
    }
  })
  it('grows enemies gradually through the exact same food rule and speed as the player', () => {
    const sim = new Sim({ mode: 'ffa', round, bots: 1, seed: 12, playerName: 'P', playerSkin: 'nebula' })
    clean(sim)
    const bot = sim.worms.find(w => !w.isPlayer)!
    place(sim.player, -30); place(bot, 30)
    const initial = bot.xs.length
    for (let i = 0; i < 4; i++) {
      clean(sim)
      sim.orbs = [sim.player, bot].map(w => ({ x: w.xs[0] + 1, z: w.zs[0], value: 2, color: 0xffffff, r: .65, alive: true, phase: 0, nova: false }))
      sim.step(.05, { targetAngle: 0, turn: 0, boost: false })
      expect(bot.mass).toBe(sim.player.mass)
      expect(bot.xs.length).toBe(sim.player.xs.length)
      expect(bot.speed).toBe(sim.player.speed)
    }
    expect(bot.xs.length).toBeGreaterThan(initial)
  })
  it('does not secretly grant enemies time-based mass bonuses without pickups', () => {
    const sim = new Sim({ mode: 'ffa', round, bots: 1, seed: 12, playerName: 'P', playerSkin: 'nebula' })
    clean(sim)
    const bot = sim.worms.find(w => !w.isPlayer)!
    place(sim.player, -30); place(bot, 30)
    for (let i = 0; i < 30; i++) { clean(sim); sim.step(.05, { targetAngle: 0, turn: 0, boost: false }) }
    expect(bot.mass).toBe(CONFIG.worm.startLength)
    expect(bot.xs.length).toBe(sim.player.xs.length)
  })
  it('starts ordinary non-round bots at the same beginner length as the player', () => {
    const sim = new Sim({ mode: 'ffa', bots: 5, seed: 91, playerName: 'P', playerSkin: 'nebula' })
    for (const w of sim.worms) {
      expect(w.xs.length).toBe(sim.player.xs.length)
      expect(w.mass).toBe(sim.player.mass)
      expect(w.radius).toBe(sim.player.radius)
      expect(w.speed).toBe(sim.player.speed)
    }
  })
  it('retains separately authored campaign difficulty rather than forcing beginner campaign stages', () => {
    const stage = CAMPAIGN_STAGES[5]
    const sim = new Sim({ mode: 'ffa', campaign: stage, seed: 4, playerName: 'P', playerSkin: 'nebula' })
    expect(sim.player.mass).toBe(stage.startLength)
    expect(sim.worms.some(w => w.brain && w.brain.skill === stage.botSkill)).toBe(true)
  })
})
