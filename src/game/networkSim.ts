import { Sim, type Worm } from './sim'
import { shrinkScale } from './upgrades'
import type { OnlineEvent, OnlineSnapshot } from '../net/multiplayer'

/** Existing View/Minimap consume Sim's shape. This adapter contains no simulation or bots. */
export class NetworkSim extends Sim {
  latest: OnlineSnapshot | null = null
  private previous: OnlineSnapshot | null = null
  private receivedAt = 0
  private interpolationMs = 100
  private readonly template: Worm
  private display = new Map<string, Worm>()
  private eventId = 0
  private scores: [number, number] = [0, 0]
  playerScore = 0
  respawnIn = 0

  constructor(readonly localPlayerId: string) {
    super({ mode: 'team', seed: 0, playerName: '', playerSkin: 'nebula', networkOnly: true })
    this.template = this.player
    this.template.xs = [0]; this.template.zs = [0]; this.template.kinds = [null]
    this.worms = []
  }

  // Even an accidental call to Game's local path cannot run collisions, bots, eating or respawn.
  override step(): void {}
  override teamScores(): [number, number] { return [...this.scores] }

  applyNetworkSnapshot(snapshot: OnlineSnapshot, now = performance.now()): OnlineEvent[] {
    if (this.latest && snapshot.seq <= this.latest.seq) return []
    const gap = now - this.receivedAt
    this.previous = gap > 500 ? null : this.latest
    this.interpolationMs = Math.max(50, Math.min(150, gap || 100))
    this.latest = snapshot; this.receivedAt = now
    this.stage = snapshot.arena.stage
    this.radius = this.baseRadius = snapshot.arena.radius
    this.time = this.environmentTime = snapshot.tick / 20
    this.matchLeft = snapshot.timeLeft; this.matchOver = snapshot.phase === 'ended'
    this.scores = [snapshot.scores.blue, snapshot.scores.red]
    this.orbs = snapshot.food.map(f => ({ x: f.x, z: f.z, value: f.value, color: f.color, r: 0.65, alive: true, phase: f.id % 20, nova: false }))
    const numericId = (id: string) => { const p = snapshot.players.find(p => p.id === id); return p ? 1 + p.slot + (p.team === 'red' ? 3 : 0) : -1 }
    this.bombs = (snapshot.bombs || []).map(b => ({ id: b.id, ownerId: numericId(b.ownerId), x: b.x, z: b.z, level: b.level, alive: true, expiresAt: this.time + b.left }))
    this.worms = snapshot.players.map(p => {
      let w = this.display.get(p.id)
      if (!w) {
        w = { ...this.template, id: 1 + p.slot + (p.team === 'red' ? 3 : 0), xs: [], zs: [], kinds: [],
          stacks: { ...this.template.stacks }, traps: { freeze: 0, slow: 0, reverse: 0 }, brain: null }
        this.display.set(p.id, w)
      }
      Object.assign(w, {
        name: p.name, skin: p.skin, color: p.color, headStyle: p.headStyle, isPlayer: p.id === this.localPlayerId,
        team: p.team === 'blue' ? 0 : 1, alive: p.alive, mass: p.length, radius: 0.95,
        boosting: p.boosting, wantBoost: p.boosting, speed: p.connected ? p.boosting ? 22 : 12 : 0,
        kills: p.kills, peak: Math.max(w.peak, p.length), spawnGrace: p.spawnGrace,
        ghostLeft: p.abilities?.ghostLeft ?? 0, ghostCooldownLeft: p.abilities?.ghostCooldown ?? 0,
        electricLeft: p.abilities?.electricLeft ?? 0, electricLevel: p.abilities?.electricLeft ? p.abilities.levels.electric : 0,
        electricCooldownLeft: (p.abilities?.electricCooldown ?? 0) + (p.abilities?.electricLeft ?? 0), bombCooldownLeft: p.abilities?.bombCooldown ?? 0,
        shrinkLeft: p.abilities?.shrinkLeft ?? 0, shrinkReduction: p.abilities?.shrinkLeft ? p.abilities.levels.shrink * 10 : 0,
        shrinkCooldownLeft: (p.abilities?.shrinkCooldown ?? 0) + (p.abilities?.shrinkLeft ?? 0),
      })
      if (w.shrinkLeft > 0) w.radius *= shrinkScale(p.abilities!.levels.shrink)
      w.kinds = Array(p.length).fill(null)
      return w
    })
    const ids = new Set(snapshot.players.map(p => p.id))
    for (const id of this.display.keys()) if (!ids.has(id)) this.display.delete(id)
    const own = snapshot.players.find(p => p.id === this.localPlayerId)
    this.player = this.display.get(this.localPlayerId) || this.worms.find(w => w.alive) || this.worms[0] || this.template
    Object.assign(this.playerUpgrades, own?.abilities?.levels ?? { ghost: 0, electric: 0, bomb: 0, shrink: 0 })
    this.laserUnlocked = own?.abilities?.laserUnlocked ?? false; this.laserUsed = own?.abilities?.laserUsed ?? false
    this.playerScore = own?.score || 0; this.respawnIn = own?.respawnIn || 0
    this.interpolate(now)
    const fresh = snapshot.events.filter(e => e.id > this.eventId)
    this.eventId = Math.max(this.eventId, ...snapshot.events.map(e => e.id))
    // Resume never replays effects from the distant past, but all authoritative state is restored.
    return fresh.filter(e => e.tick >= snapshot.tick - 8)
  }

  interpolate(now = performance.now()): void {
    if (!this.latest) return
    const alpha = Math.max(0, Math.min(1, (now - this.receivedAt) / this.interpolationMs))
    for (const p of this.latest.players) {
      const w = this.display.get(p.id)!
      const old = this.previous?.players.find(o => o.id === p.id)
      const blend = old && old.generation === p.generation && old.alive === p.alive && p.alive &&
        Math.hypot(old.xs[0] - p.xs[0], old.zs[0] - p.zs[0]) < 15
      w.xs = p.xs.map((x, i) => blend ? (old.xs[i] ?? x) + (x - (old.xs[i] ?? x)) * alpha : x)
      w.zs = p.zs.map((z, i) => blend ? (old.zs[i] ?? z) + (z - (old.zs[i] ?? z)) * alpha : z)
      const difference = old ? Math.atan2(Math.sin(p.angle - old.angle), Math.cos(p.angle - old.angle)) : 0
      w.angle = blend ? old.angle + difference * alpha : p.angle
    }
  }
}
