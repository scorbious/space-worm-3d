/**
 * Headless arena simulation. No three.js or DOM: the view reads this state every frame and the
 * game orchestrator feeds player intent in. Everything advances only in fixed `step(dt)` calls.
 */
import { CONFIG } from './config'
import {
  BOT_NAMES, CELESTIALS, CELESTIAL_IDS, PICKUP_IDS, SKINS,
  type CelestialId, type PickupId,
} from './content'
import {
  addPower, canBite, canConsume, emptyStacks, gateState, lengthFromMass, powerEffects, radiusForLength,
  selfSafeSegments, spacingForRadius, turnRateFor, wellSpeedFactor, type Mode, type PowerStacks,
} from './rules'

// ─── Random ────────────────────────────────────────────────────────────────
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ─── Entities ──────────────────────────────────────────────────────────────
export type Brain = {
  think: number
  goalX: number
  goalZ: number
  wanderX: number
  wanderZ: number
  wanderTimer: number
  aggression: number
  skill: number
  boostHold: number
  hunting: number
}

export type Worm = {
  id: number
  name: string
  isPlayer: boolean
  team: number
  skin: string
  alive: boolean
  xs: number[]
  zs: number[]
  kinds: (CelestialId | null)[]
  angle: number
  targetAngle: number
  turnAxis: number
  mass: number
  radius: number
  boosting: boolean
  wantBoost: boolean
  dropTimer: number
  stacks: PowerStacks
  magnet: number
  shield: number
  freeBoost: number
  /** Seconds of immunity after a shield absorbed a hazard. */
  envGrace: number
  /** Spawn protection: collisions involving this worm are ignored. */
  spawnGrace: number
  speed: number
  slowed: boolean
  peak: number
  kills: number
  celestials: number
  shards: number
  born: number
  /** Bites landed this life, and the worm we may pass through right after a bite. */
  bites: number
  biteImmuneId: number
  biteImmuneUntil: number
  respawnAt: number
  brain: Brain | null
  /** Visual-only: seconds since last pickup, for head pulse. */
  gulp: number
  /** Feast combo: consecutive bites without a gap longer than CONFIG.feast.comboWindow. */
  combo: number
  comboTimer: number
  bestCombo: number
}
/** Combo milestones and the bonus stardust each one pays (player only). */
export const COMBO_MILESTONES: readonly (readonly [number, number])[] = [[10, 1], [25, 2], [50, 4], [100, 8], [200, 12]]

export type Orb = { x: number; z: number; value: number; r: number; color: number; alive: boolean; phase: number; nova: boolean }
export type Shard = { x: number; z: number; alive: boolean; phase: number }
export type Pickup = { id: number; kind: PickupId; x: number; z: number; alive: boolean; phase: number }
export type Celestial = { id: number; kind: CelestialId; x: number; z: number; vx: number; vz: number; spin: number; alive: boolean; bump: number }
export type Asteroid = { x: number; z: number; r: number; seed: number }
export type Gate = { ax: number; az: number; bx: number; bz: number; period: number; on: number; offset: number }
export type Well = { x: number; z: number; r: number }

export type DeathCause = 'worm' | 'self' | 'rim' | 'asteroid' | 'gate' | 'head'

export type SimEvent =
  | { type: 'eat'; worm: Worm; value: number; x: number; z: number; color: number; nova: boolean; combo: number }
  | { type: 'combo'; worm: Worm; combo: number; bonus: number }
  | { type: 'crown'; worm: Worm | null }
  | { type: 'crownTaken'; killer: Worm; victim: Worm; bounty: number }
  | { type: 'shard'; worm: Worm; x: number; z: number }
  | { type: 'pickup'; worm: Worm; kind: PickupId; x: number; z: number }
  | { type: 'celestial'; worm: Worm; kind: CelestialId; powerAdded: boolean; x: number; z: number }
  | { type: 'tooSmall'; worm: Worm; kind: CelestialId }
  | { type: 'shieldBreak'; worm: Worm; x: number; z: number; cause: DeathCause }
  | { type: 'death'; worm: Worm; killer: Worm | null; cause: DeathCause; x: number; z: number }
  /** `biter` cut `victim` in two; `lost` segments (from `xs`/`zs`, tail side) turned into food. */
  | { type: 'bite'; biter: Worm; victim: Worm; lost: number; x: number; z: number; xs: number[]; zs: number[] }
  | { type: 'spawn'; worm: Worm }
  | { type: 'stage'; stage: number; radius: number }
  | { type: 'matchEnd'; scores: [number, number] }

export type PlayerControl = { targetAngle: number | null; turn: number; boost: boolean }

const ORB_COLORS = [0x5ef3ff, 0xff5fc8, 0xffd24f, 0x7dffb0, 0xa98bff, 0xff8a5c]

// ─── Spatial hash for body segments ───────────────────────────────────────
class SegmentGrid {
  private cells = new Map<number, number[]>()
  private used: number[][] = []
  constructor(readonly size: number) {}
  private key(cx: number, cz: number): number {
    return (cx + 2048) * 4096 + (cz + 2048)
  }
  clear(): void {
    for (const arr of this.used) arr.length = 0
    this.used.length = 0
  }
  insert(x: number, z: number, worm: number, seg: number): void {
    const k = this.key(Math.floor(x / this.size), Math.floor(z / this.size))
    let arr = this.cells.get(k)
    if (!arr) {
      arr = []
      this.cells.set(k, arr)
    }
    if (arr.length === 0) this.used.push(arr)
    arr.push(worm, seg)
  }
  /** Calls fn(worm, seg) for entries in cells overlapping the query circle. */
  query(x: number, z: number, r: number, fn: (worm: number, seg: number) => boolean | void): void {
    const x0 = Math.floor((x - r) / this.size)
    const x1 = Math.floor((x + r) / this.size)
    const z0 = Math.floor((z - r) / this.size)
    const z1 = Math.floor((z + r) / this.size)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this.cells.get(this.key(cx, cz))
        if (!arr) continue
        for (let i = 0; i < arr.length; i += 2) if (fn(arr[i], arr[i + 1]) === true) return
      }
    }
  }
}

function segDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const len2 = dx * dx + dz * dz
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t))
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

export type SimOptions = { mode: Mode; seed?: number; playerName: string; playerSkin: string; bots?: number }

export class Sim {
  readonly mode: Mode
  radius = CONFIG.arena.radius
  stage = 1
  time = 0
  worms: Worm[] = []
  orbs: Orb[] = []
  shards: Shard[] = []
  pickups: Pickup[] = []
  celestials: Celestial[] = []
  asteroids: Asteroid[] = []
  gates: Gate[] = []
  wells: Well[] = []
  events: SimEvent[] = []
  player!: Worm
  /** Team match: seconds remaining (Infinity in free-for-all). */
  matchLeft = Infinity
  matchOver = false
  private nextId = 1
  private grid = new SegmentGrid(6)
  private random: () => number
  private spawnTimers = { pickup: 0, celestial: 0 }
  private tooSmallCooldown = 0
  private readonly stageThresholds = [0, 30, 70, 130, 220] as const

  constructor(opts: SimOptions) {
    this.mode = opts.mode
    this.random = rng(opts.seed ?? (Math.random() * 2 ** 31) | 0)
    this.buildHazards()
    this.player = this.createWorm(opts.playerName, true, opts.mode === 'team' ? 0 : -1, opts.playerSkin)
    if (opts.mode === 'team') {
      this.matchLeft = CONFIG.team.seconds
      for (let i = 0; i < 5; i++) this.createWorm(this.botName(), false, 0, this.randomSkin())
      for (let i = 0; i < 6; i++) this.createWorm(this.botName(), false, 1, this.randomSkin())
    } else {
      const bots = opts.bots ?? CONFIG.arena.bots
      for (let i = 0; i < bots; i++) this.createWorm(this.botName(), false, -1, this.randomSkin())
    }
    for (const w of this.worms) this.spawnWorm(w)
    for (let i = 0; i < CONFIG.arena.food; i++) this.spawnOrb()
    for (let i = 0; i < CONFIG.arena.stardust; i++) this.spawnShard()
    for (let i = 0; i < CONFIG.arena.pickups; i++) this.spawnPickup()
    for (let i = 0; i < CONFIG.arena.celestials; i++) this.spawnCelestial()
  }

  // ─── setup ──────────────────────────────────────────────────────────────
  private botName(): string {
    const used = new Set(this.worms.map(w => w.name))
    const free = BOT_NAMES.filter(n => !used.has(n))
    return free.length ? free[Math.floor(this.random() * free.length)] : `Worm ${this.worms.length}`
  }

  private randomSkin(): string {
    return SKINS[Math.floor(this.random() * SKINS.length)].id
  }

  private randomPoint(maxFrac = 0.95, minFrac = 0): { x: number; z: number } {
    const r = this.radius * Math.sqrt(minFrac * minFrac + this.random() * (maxFrac * maxFrac - minFrac * minFrac))
    const a = this.random() * Math.PI * 2
    return { x: Math.cos(a) * r, z: Math.sin(a) * r }
  }

  private blocked(x: number, z: number, margin: number): boolean {
    if (Math.hypot(x, z) > this.radius - margin) return true
    for (const a of this.asteroids) if (Math.hypot(x - a.x, z - a.z) < a.r + margin) return true
    return false
  }

  private buildHazards(): void {
    const R = this.radius
    const clearOf = (x: number, z: number, m: number) =>
      !this.asteroids.some(a => Math.hypot(a.x - x, a.z - z) < a.r + m) &&
      !this.wells.some(w => Math.hypot(w.x - x, w.z - z) < w.r + m) &&
      !this.gates.some(g => segDistance(x, z, g.ax, g.az, g.bx, g.bz) < m)
    for (let tries = 0; this.wells.length < CONFIG.arena.wells && tries < 400; tries++) {
      const p = this.randomPoint(0.78, 0.3)
      const r = 14 + this.random() * 5
      if (clearOf(p.x, p.z, r + 12)) this.wells.push({ x: p.x, z: p.z, r })
    }
    for (let tries = 0; this.gates.length < CONFIG.arena.gates && tries < 400; tries++) {
      const p = this.randomPoint(0.86, 0.22)
      const half = 7 + this.random() * 5
      // Orient gates roughly tangentially so they cut across common paths.
      const a = Math.atan2(p.z, p.x) + Math.PI / 2 + (this.random() - 0.5) * 0.9
      const g: Gate = {
        ax: p.x - Math.cos(a) * half, az: p.z - Math.sin(a) * half,
        bx: p.x + Math.cos(a) * half, bz: p.z + Math.sin(a) * half,
        period: 8 + this.random() * 3, on: 3.2 + this.random() * 0.8, offset: this.random() * 10,
      }
      if (clearOf(g.ax, g.az, 10) && clearOf(g.bx, g.bz, 10) && clearOf(p.x, p.z, 10)) this.gates.push(g)
    }
    for (let tries = 0; this.asteroids.length < CONFIG.arena.asteroids && tries < 800; tries++) {
      const p = this.randomPoint(0.92, 0.14)
      const r = 2.4 + this.random() * 3.4
      if (clearOf(p.x, p.z, r + 7) && Math.hypot(p.x, p.z) < R - r - 6) this.asteroids.push({ x: p.x, z: p.z, r, seed: this.random() * 1000 })
    }
  }

  private createWorm(name: string, isPlayer: boolean, team: number, skin: string): Worm {
    const w: Worm = {
      id: this.nextId++, name, isPlayer, team, skin, alive: false, xs: [], zs: [], kinds: [],
      angle: 0, targetAngle: 0, turnAxis: 0, mass: CONFIG.worm.startLength, radius: radiusForLength(CONFIG.worm.startLength),
      boosting: false, wantBoost: false, dropTimer: 0, stacks: emptyStacks(), magnet: 0, shield: 0, freeBoost: 0,
      envGrace: 0, spawnGrace: 0, speed: 0, slowed: false, peak: 0, kills: 0, celestials: 0, shards: 0, born: 0, bites: 0, biteImmuneId: -1, biteImmuneUntil: 0,
      respawnAt: 0, gulp: 0, combo: 0, comboTimer: 0, bestCombo: 0,
      brain: isPlayer ? null : {
        think: 0, goalX: 0, goalZ: 0, wanderX: 0, wanderZ: 0, wanderTimer: 0,
        aggression: 0.2 + this.random() * 0.7, skill: 0.55 + this.random() * 0.45, boostHold: 0, hunting: 0,
      },
    }
    this.worms.push(w)
    return w
  }

  private safeSpawnPoint(team: number): { x: number; z: number } {
    let best = { x: 0, z: 0 }
    let bestScore = -Infinity
    for (let i = 0; i < 40; i++) {
      const p = this.randomPoint(0.78, 0.1)
      if (this.mode === 'team' && team >= 0 && i < 30) {
        // Teams start on opposite halves so the first clash happens mid-arena.
        const side = team === 0 ? -1 : 1
        if (Math.sign(p.x) !== side) p.x = -p.x
      }
      if (this.blocked(p.x, p.z, 10)) continue
      let nearest = 60
      for (const w of this.worms) {
        if (!w.alive) continue
        for (let s = 0; s < w.xs.length; s += 3) nearest = Math.min(nearest, Math.hypot(w.xs[s] - p.x, w.zs[s] - p.z))
      }
      for (const g of this.gates) nearest = Math.min(nearest, segDistance(p.x, p.z, g.ax, g.az, g.bx, g.bz) + 2)
      if (nearest > bestScore) {
        bestScore = nearest
        best = p
      }
    }
    return best
  }

  spawnWorm(w: Worm): void {
    const p = this.safeSpawnPoint(w.team)
    const toCenter = Math.atan2(-p.z, -p.x) + (this.random() - 0.5) * 1.2
    const start = CONFIG.worm.startLength + (w.isPlayer ? 0 : Math.floor(this.random() * 26))
    w.alive = true
    w.mass = start
    w.radius = radiusForLength(start)
    w.angle = toCenter
    w.targetAngle = toCenter
    w.turnAxis = 0
    w.xs = []
    w.zs = []
    w.kinds = []
    const spacing = spacingForRadius(w.radius)
    for (let i = 0; i < lengthFromMass(start); i++) {
      w.xs.push(p.x - Math.cos(toCenter) * spacing * i)
      w.zs.push(p.z - Math.sin(toCenter) * spacing * i)
      w.kinds.push(null)
    }
    w.stacks = emptyStacks()
    w.magnet = 0
    w.shield = 0
    w.freeBoost = 0
    w.envGrace = 0
    w.spawnGrace = 2.2
    w.boosting = false
    w.wantBoost = false
    w.peak = w.xs.length
    w.kills = 0
    w.bites = 0
    w.biteImmuneId = -1
    w.celestials = 0
    w.shards = 0
    w.born = this.time
    if (!w.isPlayer && this.mode === 'ffa') w.skin = this.randomSkin()
    if (w.brain) {
      w.brain.think = this.random() * 0.2
      w.brain.wanderTimer = 0
      w.brain.hunting = 0
    }
    this.events.push({ type: 'spawn', worm: w })
  }

  private spawnOrb(x?: number, z?: number, value?: number, color?: number): void {
    let px = x
    let pz = z
    if (px === undefined || pz === undefined) {
      for (let tries = 0; tries < 8; tries++) {
        const p = this.randomPoint(0.97)
        px = p.x
        pz = p.z
        if (!this.blocked(p.x, p.z, 1.5)) break
      }
    }
    const F = CONFIG.feast
    const nova = value === undefined && this.random() < F.novaChance && this.orbs.reduce((n, o) => n + (o.alive && o.nova ? 1 : 0), 0) < F.novaMax
    const v = nova ? F.novaValue : value ?? (this.random() < 0.12 ? 2 : 1)
    const orb: Orb = {
      x: px!, z: pz!, value: v, r: nova ? 1.15 : 0.3 + Math.min(1.1, Math.sqrt(v) * 0.24),
      color: nova ? 0xffffff : color ?? ORB_COLORS[Math.floor(this.random() * ORB_COLORS.length)], alive: true, phase: this.random() * 6.28, nova,
    }
    const slot = this.orbs.findIndex(o => !o.alive)
    if (slot >= 0 && this.orbs.length > 1400) this.orbs[slot] = orb
    else this.orbs.push(orb)
  }

  private spawnShard(): void {
    for (let tries = 0; tries < 10; tries++) {
      const p = this.randomPoint(0.94)
      if (this.blocked(p.x, p.z, 3)) continue
      this.shards.push({ x: p.x, z: p.z, alive: true, phase: this.random() * 6.28 })
      return
    }
  }

  private spawnPickup(): void {
    for (let tries = 0; tries < 10; tries++) {
      const p = this.randomPoint(0.9)
      if (this.blocked(p.x, p.z, 4)) continue
      const kind = PICKUP_IDS[Math.floor(this.random() * PICKUP_IDS.length)]
      this.pickups.push({ id: this.nextId++, kind, x: p.x, z: p.z, alive: true, phase: this.random() * 6.28 })
      return
    }
  }

  private spawnCelestial(kind?: CelestialId, x?: number, z?: number, vx = 0, vz = 0): void {
    let k = kind
    if (!k) {
      const total = CELESTIAL_IDS.reduce((n, id) => n + CELESTIALS[id].weight, 0)
      let roll = this.random() * total
      k = CELESTIAL_IDS.find(id => (roll -= CELESTIALS[id].weight) < 0) ?? 'moon'
    }
    let px = x
    let pz = z
    if (px === undefined || pz === undefined) {
      for (let tries = 0; tries < 12; tries++) {
        const p = this.randomPoint(0.88)
        px = p.x
        pz = p.z
        if (!this.blocked(p.x, p.z, CELESTIALS[k].radius + 4)) break
      }
    }
    const a = this.random() * Math.PI * 2
    const drift = 0.6 + this.random() * 0.9
    this.celestials.push({
      id: this.nextId++, kind: k, x: px!, z: pz!,
      vx: vx || Math.cos(a) * drift, vz: vz || Math.sin(a) * drift, spin: this.random() * 6.28, alive: true, bump: 0,
    })
  }

  // ─── queries ────────────────────────────────────────────────────────────
  /** Id of the worm wearing the Bounty Crown (longest alive worm above the minimum), or -1. */
  crownId = -1
  private updateCrown(): void {
    let best: Worm | null = null
    for (const w of this.worms) if (w.alive && w.xs.length >= CONFIG.feast.crownMinLength && (!best || w.xs.length > best.xs.length)) best = w
    const cur = this.worms.find(w => w.id === this.crownId && w.alive)
    // Hysteresis: a challenger must be 5% longer to take the crown without a kill.
    if (cur && best && best !== cur && best.xs.length < cur.xs.length * 1.05) return
    if (cur && !best) return
    const id = best ? best.id : -1
    if (id !== this.crownId) {
      this.crownId = id
      this.events.push({ type: 'crown', worm: best })
    }
  }

  length(w: Worm): number {
    return w.xs.length
  }

  teamScores(): [number, number] {
    const s: [number, number] = [0, 0]
    for (const w of this.worms) if (w.alive && w.team >= 0) s[w.team] += w.xs.length
    return s
  }

  /** Alive worms sorted by length, longest first. */
  ranking(): Worm[] {
    return this.worms.filter(w => w.alive).sort((a, b) => b.xs.length - a.xs.length)
  }

  gateAt(g: Gate) {
    return gateState(this.time, g.period, g.on, g.offset)
  }

  // ─── step ───────────────────────────────────────────────────────────────
  step(dt: number, control: PlayerControl | null): void {
    this.time += dt
    if (this.tooSmallCooldown > 0) this.tooSmallCooldown -= dt
    if (this.mode === 'team' && !this.matchOver) {
      this.matchLeft -= dt
      if (this.matchLeft <= 0) {
        this.matchLeft = 0
        this.matchOver = true
        this.events.push({ type: 'matchEnd', scores: this.teamScores() })
      }
    }

    // Respawns (bots always; the player is respawned by the orchestrator).
    for (const w of this.worms) {
      if (!w.alive && !w.isPlayer && this.time >= w.respawnAt && !this.matchOver) this.spawnWorm(w)
    }

    for (const w of this.worms) {
      if (w.comboTimer > 0) {
        w.comboTimer -= dt
        if (w.comboTimer <= 0) w.combo = 0
      }
    }
    this.updateCrown()
    this.rebuildGrid()
    for (const w of this.worms) {
      if (!w.alive) continue
      if (w.isPlayer) {
        if (control) {
          w.targetAngle = control.targetAngle ?? w.targetAngle
          w.turnAxis = control.targetAngle === null ? control.turn : 0
          w.wantBoost = control.boost
        }
      } else this.think(w, dt)
      this.moveWorm(w, dt)
    }
    this.rebuildGrid()
    this.collide()
    this.eat(dt)
    this.driftCelestials(dt)
    this.maintain(dt)
    this.updateStage()
  }

  /**
   * Growth is also progression: every stage makes the arena larger, sharpens bot
   * aggression and refreshes the expanded space with new food and power targets.
   */
  private updateStage(): void {
    const next = this.stageThresholds.reduce((current, threshold, index) =>
      this.player.xs.length >= threshold ? index + 1 : current, 1)
    if (next <= this.stage) return
    this.stage = next
    this.radius = CONFIG.arena.radius + (this.stage - 1) * 30
    for (const w of this.worms) if (w.brain) {
      w.brain.aggression = Math.min(1, w.brain.aggression + 0.14)
      w.brain.skill = Math.min(0.98, w.brain.skill + 0.04)
    }
    for (let i = 0; i < 8 + this.stage * 3; i++) this.spawnOrb()
    for (let i = 0; i < Math.max(1, this.stage - 2); i++) this.spawnCelestial()
    this.events.push({ type: 'stage', stage: this.stage, radius: this.radius })
  }

  nextStageLength(): number | null {
    return this.stage < this.stageThresholds.length ? this.stageThresholds[this.stage] : null
  }

  private rebuildGrid(): void {
    this.grid.clear()
    for (let wi = 0; wi < this.worms.length; wi++) {
      const w = this.worms[wi]
      if (!w.alive) continue
      for (let s = 0; s < w.xs.length; s++) this.grid.insert(w.xs[s], w.zs[s], wi, s)
    }
  }

  private moveWorm(w: Worm, dt: number): void {
    const fx = powerEffects(w.stacks)
    w.magnet = Math.max(0, w.magnet - dt)
    w.shield = Math.max(0, w.shield - dt)
    w.freeBoost = Math.max(0, w.freeBoost - dt)
    w.envGrace = Math.max(0, w.envGrace - dt)
    w.spawnGrace = Math.max(0, w.spawnGrace - dt)
    w.gulp += dt

    const len = w.xs.length
    const canBoost = w.freeBoost > 0 || len > CONFIG.worm.minBoostLength
    w.boosting = w.wantBoost && canBoost

    // Turning
    const rate = turnRateFor(w.radius) * (w.boosting ? 0.85 : 1)
    if (w.turnAxis !== 0) {
      w.angle = wrapAngle(w.angle + Math.max(-1, Math.min(1, w.turnAxis)) * rate * 1.05 * dt)
      w.targetAngle = w.angle
    } else {
      const diff = wrapAngle(w.targetAngle - w.angle)
      const maxTurn = rate * dt
      w.angle = wrapAngle(w.angle + Math.max(-maxTurn, Math.min(maxTurn, diff)))
    }

    // Speed and gravity wells
    let speed = (w.boosting ? CONFIG.worm.boostSpeed * (w.freeBoost > 0 ? 1.08 : 1) : CONFIG.worm.baseSpeed) * fx.speed
    let hx = w.xs[0]
    let hz = w.zs[0]
    w.slowed = false
    let pullX = 0
    let pullZ = 0
    for (const well of this.wells) {
      const d = Math.hypot(hx - well.x, hz - well.z)
      if (d < well.r) {
        w.slowed = true
        speed *= wellSpeedFactor(d, well.r, fx.wellSlow)
        const pull = 3.2 * (1 - d / well.r) * fx.wellSlow
        if (d > 0.01) {
          pullX += ((well.x - hx) / d) * pull
          pullZ += ((well.z - hz) / d) * pull
        }
      }
    }
    w.speed = speed
    hx += (Math.cos(w.angle) * speed + pullX) * dt
    hz += (Math.sin(w.angle) * speed + pullZ) * dt
    w.xs[0] = hx
    w.zs[0] = hz

    // Boost cost: spent length leaks out of the tail as energy others can eat.
    if (w.boosting && w.freeBoost <= 0) {
      const cost = CONFIG.worm.boostCost * fx.boostCost * dt
      w.mass = Math.max(CONFIG.worm.minBoostLength, w.mass - cost)
      w.dropTimer += dt
      if (w.dropTimer >= 0.22) {
        w.dropTimer = 0
        const t = w.xs.length - 1
        this.spawnOrb(w.xs[t] + (this.random() - 0.5), w.zs[t] + (this.random() - 0.5), CONFIG.worm.boostCost * fx.boostCost * 0.22 * 0.6, this.skinColor(w))
      }
    }

    // Giants slowly shed length so nobody can hold the arena forever.
    if (len > 160) w.mass -= (len - 160) * 0.0022 * dt

    this.resize(w)

    // Body follows the head as a chain with fixed spacing.
    const spacing = spacingForRadius(w.radius)
    for (let i = 1; i < w.xs.length; i++) {
      const dx = w.xs[i - 1] - w.xs[i]
      const dz = w.zs[i - 1] - w.zs[i]
      const d = Math.hypot(dx, dz)
      if (d > spacing) {
        const k = (d - spacing) / d
        w.xs[i] += dx * k
        w.zs[i] += dz * k
      }
    }
    w.peak = Math.max(w.peak, w.xs.length)
  }

  private skinColor(w: Worm): number {
    const skin = SKINS.find(s => s.id === w.skin) ?? SKINS[0]
    return skin.colors[0]
  }

  /** Match segment count to mass: grow at the tail, shrink by removing plain segments. */
  private resize(w: Worm): void {
    const target = lengthFromMass(w.mass)
    let guard = 0
    while (w.xs.length < target && guard++ < 64) {
      const t = w.xs.length - 1
      w.xs.push(w.xs[t])
      w.zs.push(w.zs[t])
      w.kinds.push(null)
    }
    while (w.xs.length > target && guard++ < 128) {
      let idx = -1
      for (let i = w.xs.length - 1; i >= 1; i--) if (w.kinds[i] === null) { idx = i; break }
      if (idx < 0) break
      w.xs.splice(idx, 1)
      w.zs.splice(idx, 1)
      w.kinds.splice(idx, 1)
    }
    w.radius = radiusForLength(w.xs.length)
  }

  // ─── collisions ─────────────────────────────────────────────────────────
  private collide(): void {
    const dead = new Map<Worm, { killer: Worm | null; cause: DeathCause }>()
    const bites: { biter: Worm; victim: Worm; seg: number }[] = []
    for (let wi = 0; wi < this.worms.length; wi++) {
      const w = this.worms[wi]
      if (!w.alive || dead.has(w)) continue
      const hx = w.xs[0]
      const hz = w.zs[0]
      // Environment
      let envCause: DeathCause | null = null
      let nx = 0
      let nz = 0
      const dc = Math.hypot(hx, hz)
      if (dc + w.radius > this.radius) {
        envCause = 'rim'
        nx = -hx / dc
        nz = -hz / dc
      }
      if (!envCause) {
        for (const a of this.asteroids) {
          const d = Math.hypot(hx - a.x, hz - a.z)
          if (d < a.r + w.radius * 0.8) {
            envCause = 'asteroid'
            nx = (hx - a.x) / (d || 1)
            nz = (hz - a.z) / (d || 1)
            break
          }
        }
      }
      if (!envCause) {
        for (const g of this.gates) {
          if (this.gateAt(g).phase !== 'on') continue
          if (segDistance(hx, hz, g.ax, g.az, g.bx, g.bz) < w.radius * 0.8 + 0.35) {
            envCause = 'gate'
            break
          }
        }
      }
      if (envCause && w.envGrace > 0 && (envCause === 'rim' || envCause === 'asteroid')) {
        // Grace after a shield hit: slide along solid obstacles instead of passing through.
        if (envCause === 'rim') {
          const k = (this.radius - w.radius - 0.2) / dc
          w.xs[0] = hx * k
          w.zs[0] = hz * k
          w.targetAngle = Math.atan2(nz, nx)
        } else {
          w.xs[0] = hx + nx * 0.6
          w.zs[0] = hz + nz * 0.6
        }
      } else if (envCause && w.envGrace <= 0) {
        if (w.shield > 0) {
          w.shield = 0
          w.envGrace = 1.2
          if (envCause === 'rim') {
            w.angle = Math.atan2(nz, nx) + (this.random() - 0.5) * 0.6
            w.xs[0] = hx + nx * 2
            w.zs[0] = hz + nz * 2
          } else if (envCause === 'asteroid') {
            const dx = Math.cos(w.angle)
            const dz = Math.sin(w.angle)
            const dot = dx * nx + dz * nz
            w.angle = Math.atan2(dz - 2 * dot * nz, dx - 2 * dot * nx)
            w.xs[0] = hx + nx * 1.5
            w.zs[0] = hz + nz * 1.5
          }
          w.targetAngle = w.angle
          this.events.push({ type: 'shieldBreak', worm: w, x: hx, z: hz, cause: envCause })
        } else if (envCause === 'rim' || w.spawnGrace <= 0 || envCause !== 'gate') {
          dead.set(w, { killer: null, cause: envCause })
          continue
        }
      }
      if (w.spawnGrace > 0) continue
      // Other worms and self
      const reach = w.radius + 2.6
      const selfSafe = selfSafeSegments(w.radius)
      let hit: { killer: Worm | null; cause: DeathCause } | null = null
      this.grid.query(hx, hz, reach, (oi, s) => {
        const o = this.worms[oi]
        if (!o.alive || o.spawnGrace > 0) return
        if (o === w) {
          if (s < selfSafe) return
        } else if (this.mode === 'team' && o.team === w.team) return
        else if (o.id === w.biteImmuneId && this.time < w.biteImmuneUntil) return
        const d = Math.hypot(o.xs[s] - hx, o.zs[s] - hz)
        if (d >= w.radius * 0.72 + o.radius * 0.82) return
        if (o === w) {
          hit = { killer: null, cause: 'self' }
          return true
        }
        if (s === 0) {
          // Head-on: the shorter worm loses, ties destroy both.
          const lw = w.xs.length
          const lo = o.xs.length
          if (lw <= lo) hit = { killer: o, cause: 'head' }
          if (lo <= lw && !dead.has(o)) dead.set(o, { killer: w, cause: 'head' })
          return hit !== null
        }
        if (canBite(w.xs.length, o.xs.length)) {
          // Bigger head meets smaller body: bite through it instead of dying.
          if (!bites.some(b => b.victim === o)) bites.push({ biter: w, victim: o, seg: s })
          w.biteImmuneId = o.id
          w.biteImmuneUntil = this.time + CONFIG.bite.immunity
          return true
        }
        hit = { killer: o, cause: 'worm' }
        return true
      })
      if (hit) dead.set(w, hit)
    }
    for (const [w, info] of dead) this.kill(w, info.killer, info.cause)
    for (const b of bites) if (b.biter.alive && b.victim.alive) this.sever(b.victim, b.seg, b.biter)
  }

  /**
   * Cut `v` at segment `seg`: it keeps the front part and carries on; the severed tail turns into
   * food, and any celestial segments in it float free again (taking their power with them).
   */
  sever(v: Worm, seg: number, biter: Worm | null): number {
    const len = v.xs.length
    const keep = Math.max(CONFIG.bite.minKeep, seg)
    if (keep >= len) return 0
    const xs = v.xs.slice(keep)
    const zs = v.zs.slice(keep)
    const kinds = v.kinds.slice(keep)
    const lost = xs.length
    const plain = kinds.filter(k => !k).length
    const skin = SKINS.find(s => s.id === v.skin) ?? SKINS[0]
    // One mote per severed segment (capped) so the lost tail visibly turns into a trail of food.
    const count = Math.min(80, Math.max(3, lost))
    const each = (plain * CONFIG.bite.spill) / count
    if (each > 0) {
      for (let i = 0; i < count; i++) {
        const s = Math.min(lost - 1, Math.floor((i / count) * lost))
        const j = v.radius * 0.6
        this.spawnOrb(xs[s] + (this.random() - 0.5) * j, zs[s] + (this.random() - 0.5) * j, each, skin.colors[i % skin.colors.length])
      }
    }
    for (let i = 0; i < lost; i++) {
      const k = kinds[i]
      if (!k) continue
      const power = CELESTIALS[k].power
      v.stacks[power] = Math.max(0, v.stacks[power] - 1)
      const a = this.random() * Math.PI * 2
      const px = Math.max(-this.radius * 0.9, Math.min(this.radius * 0.9, xs[i]))
      const pz = Math.max(-this.radius * 0.9, Math.min(this.radius * 0.9, zs[i]))
      this.spawnCelestial(k, px, pz, Math.cos(a) * 3, Math.sin(a) * 3)
    }
    v.xs.length = keep
    v.zs.length = keep
    v.kinds.length = keep
    v.mass = keep + (v.mass % 1)
    v.radius = radiusForLength(keep)
    v.combo = 0
    v.comboTimer = 0
    if (biter) {
      biter.bites += 1
      if (biter.isPlayer) biter.shards += CONFIG.bite.shards
    }
    this.events.push({ type: 'bite', biter: biter ?? v, victim: v, lost, x: xs[0], z: zs[0], xs, zs })
    return lost
  }

  kill(w: Worm, killer: Worm | null, cause: DeathCause): void {
    if (!w.alive) return
    w.alive = false
    w.boosting = false
    w.respawnAt = this.time + 3 + this.random() * 3
    if (killer && killer !== w) killer.kills += 1
    w.combo = 0
    w.comboTimer = 0
    if (w.id === this.crownId) {
      if (killer && killer !== w && killer.alive) {
        const bounty = CONFIG.feast.crownBounty
        if (killer.isPlayer) killer.shards += bounty
        this.events.push({ type: 'crownTaken', killer, victim: w, bounty })
      }
      this.crownId = -1
    }
    // Scatter the body as rich energy and release swallowed celestials back into space.
    const len = w.xs.length
    const count = Math.min(110, Math.max(6, Math.ceil(len / 2)))
    const each = (w.mass * 0.7) / count
    const skin = SKINS.find(s => s.id === w.skin) ?? SKINS[0]
    for (let i = 0; i < count; i++) {
      const s = Math.min(len - 1, Math.floor((i / count) * len))
      const j = w.radius * 1.2
      this.spawnOrb(w.xs[s] + (this.random() - 0.5) * j, w.zs[s] + (this.random() - 0.5) * j, each, skin.colors[i % skin.colors.length])
    }
    for (let i = 0; i < len; i++) {
      const k = w.kinds[i]
      if (!k) continue
      const a = this.random() * Math.PI * 2
      const px = Math.max(-this.radius * 0.9, Math.min(this.radius * 0.9, w.xs[i]))
      const pz = Math.max(-this.radius * 0.9, Math.min(this.radius * 0.9, w.zs[i]))
      this.spawnCelestial(k, px, pz, Math.cos(a) * 3, Math.sin(a) * 3)
    }
    this.events.push({ type: 'death', worm: w, killer: killer && killer !== w ? killer : null, cause, x: w.xs[0], z: w.zs[0] })
  }

  // ─── eating ─────────────────────────────────────────────────────────────
  private eat(dt: number): void {
    for (const w of this.worms) {
      if (!w.alive) continue
      const fx = powerEffects(w.stacks)
      const hx = w.xs[0]
      const hz = w.zs[0]
      const reach = (w.radius + 1.3) * fx.pickup
      const magnet = w.magnet > 0 ? CONFIG.pickups.magnetRange * fx.pickup : 0
      const scan = Math.max(reach, magnet)
      for (const o of this.orbs) {
        if (!o.alive) continue
        const dx = o.x - hx
        const dz = o.z - hz
        if (Math.abs(dx) > scan || Math.abs(dz) > scan) continue
        const d = Math.hypot(dx, dz)
        if (d < reach) {
          o.alive = false
          w.mass += o.value * fx.growth
          w.gulp = 0
          w.combo += 1
          w.comboTimer = CONFIG.feast.comboWindow
          if (w.combo > w.bestCombo) w.bestCombo = w.combo
          this.events.push({ type: 'eat', worm: w, value: o.value, x: o.x, z: o.z, color: o.color, nova: o.nova, combo: w.combo })
          if (w.isPlayer) {
            const m = COMBO_MILESTONES.find(([at]) => at === w.combo)
            if (m) {
              w.shards += m[1]
              this.events.push({ type: 'combo', worm: w, combo: w.combo, bonus: m[1] })
            }
          }
        } else if (magnet > 0 && d < magnet) {
          const pull = Math.min(d, (18 + (magnet - d) * 2) * dt)
          o.x -= (dx / d) * pull
          o.z -= (dz / d) * pull
        } else if (d < reach * 2.2) {
          // Soft suction so food visibly flows into the mouth.
          const pull = Math.min(d, 6 * dt)
          o.x -= (dx / d) * pull
          o.z -= (dz / d) * pull
        }
      }
      if (w.isPlayer) {
        for (const s of this.shards) {
          if (!s.alive) continue
          const d = Math.hypot(s.x - hx, s.z - hz)
          if (d < reach + 0.4) {
            s.alive = false
            w.shards += 1
            this.events.push({ type: 'shard', worm: w, x: s.x, z: s.z })
          } else if (magnet > 0 && d < magnet) {
            const pull = Math.min(d, 16 * dt)
            s.x -= ((s.x - hx) / d) * pull
            s.z -= ((s.z - hz) / d) * pull
          }
        }
      }
      for (const p of this.pickups) {
        if (!p.alive) continue
        if (Math.hypot(p.x - hx, p.z - hz) < w.radius + 1.6) {
          p.alive = false
          if (p.kind === 'magnet') w.magnet = CONFIG.pickups.magnet
          if (p.kind === 'shield') w.shield = CONFIG.pickups.shield
          if (p.kind === 'freeBoost') w.freeBoost = CONFIG.pickups.freeBoost
          this.events.push({ type: 'pickup', worm: w, kind: p.kind, x: p.x, z: p.z })
        }
      }
      for (const c of this.celestials) {
        if (!c.alive) continue
        const def = CELESTIALS[c.kind]
        const d = Math.hypot(c.x - hx, c.z - hz)
        if (d > def.radius + w.radius) continue
        if (canConsume(w.xs.length, c.kind)) {
          c.alive = false
          const powerAdded = addPower(w.stacks, c.kind)
          w.mass += def.growth * fx.growth
          w.celestials += 1
          w.gulp = 0
          // The swallowed body itself becomes a segment right behind the head.
          const at = Math.min(2, w.xs.length - 1)
          w.xs.splice(at, 0, w.xs[at - 1] ?? w.xs[0])
          w.zs.splice(at, 0, w.zs[at - 1] ?? w.zs[0])
          w.kinds.splice(at, 0, c.kind)
          this.resize(w)
          this.events.push({ type: 'celestial', worm: w, kind: c.kind, powerAdded, x: c.x, z: c.z })
        } else if (c.bump <= 0) {
          // Too small: the body shoves the celestial away instead.
          const nx = (c.x - hx) / (d || 1)
          const nz = (c.z - hz) / (d || 1)
          c.vx = nx * 7
          c.vz = nz * 7
          c.bump = 0.4
          if (w.isPlayer && this.tooSmallCooldown <= 0) {
            this.tooSmallCooldown = 2
            this.events.push({ type: 'tooSmall', worm: w, kind: c.kind })
          }
        }
      }
    }
  }

  private driftCelestials(dt: number): void {
    for (const c of this.celestials) {
      if (!c.alive) continue
      const def = CELESTIALS[c.kind]
      c.bump = Math.max(0, c.bump - dt)
      c.spin += dt * (0.3 + 1 / def.radius)
      c.x += c.vx * dt
      c.z += c.vz * dt
      // Friction toward a gentle cruising drift.
      const sp = Math.hypot(c.vx, c.vz)
      if (sp > 1.4) {
        const k = Math.max(0.2, 1 - dt * 1.4)
        c.vx *= k
        c.vz *= k
      }
      const d = Math.hypot(c.x, c.z)
      if (d > this.radius - def.radius - 3) {
        const nx = c.x / d
        const nz = c.z / d
        const dot = c.vx * nx + c.vz * nz
        if (dot > 0) {
          c.vx -= 2 * dot * nx
          c.vz -= 2 * dot * nz
        }
        c.x = nx * (this.radius - def.radius - 3)
        c.z = nz * (this.radius - def.radius - 3)
      }
      for (const a of this.asteroids) {
        const da = Math.hypot(c.x - a.x, c.z - a.z)
        if (da < a.r + def.radius) {
          const nx = (c.x - a.x) / (da || 1)
          const nz = (c.z - a.z) / (da || 1)
          const dot = c.vx * nx + c.vz * nz
          if (dot < 0) {
            c.vx -= 2 * dot * nx
            c.vz -= 2 * dot * nz
          }
          c.x = a.x + nx * (a.r + def.radius)
          c.z = a.z + nz * (a.r + def.radius)
        }
      }
    }
  }

  private maintain(dt: number): void {
    let orbCount = 0
    for (const o of this.orbs) if (o.alive) orbCount++
    for (let i = 0; i < 8 && orbCount < CONFIG.arena.food; i++, orbCount++) this.spawnOrb()
    if (this.orbs.length > 1600) this.orbs = this.orbs.filter(o => o.alive)
    const shards = this.shards.filter(s => s.alive)
    if (shards.length !== this.shards.length) this.shards = shards
    if (this.shards.length < CONFIG.arena.stardust && this.random() < dt * 0.8) this.spawnShard()
    this.pickups = this.pickups.filter(p => p.alive)
    this.spawnTimers.pickup -= dt
    if (this.pickups.length < CONFIG.arena.pickups && this.spawnTimers.pickup <= 0) {
      this.spawnTimers.pickup = 2.5
      this.spawnPickup()
    }
    this.celestials = this.celestials.filter(c => c.alive)
    this.spawnTimers.celestial -= dt
    if (this.celestials.length < CONFIG.arena.celestials && this.spawnTimers.celestial <= 0) {
      this.spawnTimers.celestial = 3
      this.spawnCelestial()
    }
  }

  // ─── AI ─────────────────────────────────────────────────────────────────
  private think(w: Worm, dt: number): void {
    const b = w.brain!
    const stageAggression = Math.min(1.35, 1 + (this.stage - 1) * 0.18)
    const aggression = Math.min(1, b.aggression * stageAggression)
    b.think -= dt
    b.boostHold = Math.max(0, b.boostHold - dt)
    b.hunting = Math.max(0, b.hunting - dt)
    if (b.think > 0) return
    b.think = 0.1 + (1 - b.skill) * 0.12 + this.random() * 0.05
    const hx = w.xs[0]
    const hz = w.zs[0]
    const len = w.xs.length

    // 1. Choose a goal.
    let goalX = 0
    let goalZ = 0
    let goalScore = 0
    const consider = (x: number, z: number, score: number) => {
      if (score > goalScore) {
        goalScore = score
        goalX = x
        goalZ = z
      }
    }
    for (const p of this.pickups) {
      const d = Math.hypot(p.x - hx, p.z - hz)
      if (d < 40) consider(p.x, p.z, 55 / (d + 4))
    }
    for (const c of this.celestials) {
      if (!canConsume(len, c.kind)) continue
      const d = Math.hypot(c.x - hx, c.z - hz)
      if (d < 50) consider(c.x, c.z, (CELESTIALS[c.kind].growth * 4) / (d + 4))
    }
    let bestOrb: Orb | null = null
    let bestOrbScore = 0
    for (const o of this.orbs) {
      if (!o.alive) continue
      const dx = o.x - hx
      const dz = o.z - hz
      if (Math.abs(dx) > 30 || Math.abs(dz) > 30) continue
      const d = Math.hypot(dx, dz)
      // Favor food ahead of us: turning around costs time.
      const ahead = (dx * Math.cos(w.angle) + dz * Math.sin(w.angle)) / (d || 1)
      const s = (o.value * (1.4 + ahead)) / (d + 2)
      if (s > bestOrbScore) {
        bestOrbScore = s
        bestOrb = o
      }
    }
    if (bestOrb) consider(bestOrb.x, bestOrb.z, bestOrbScore * 2.2)
    // Hunting: cut off a nearby rival's path.
    if (len > 30 && this.random() < aggression * 0.5) {
      for (const o of this.worms) {
        if (o === w || !o.alive || o.spawnGrace > 0 || (this.mode === 'team' && o.team === w.team)) continue
        const d = Math.hypot(o.xs[0] - hx, o.zs[0] - hz)
        if (d < 34 && canBite(len, o.xs.length)) {
          // Aim at the middle of a smaller rival's body: biting there cuts off the most food.
          const mid = Math.min(o.xs.length - 1, Math.max(CONFIG.bite.minKeep, Math.floor(o.xs.length * 0.4)))
          b.hunting = 1.6
          consider(o.xs[mid], o.zs[mid], 2.6)
        } else if (d < 26 && o.xs.length < len * 1.3) {
          b.hunting = 1.6
          consider(o.xs[0] + Math.cos(o.angle) * (6 + o.speed * 0.5), o.zs[0] + Math.sin(o.angle) * (6 + o.speed * 0.5), 3)
        }
      }
    }
    b.wanderTimer -= b.think
    if (b.wanderTimer <= 0 || Math.hypot(b.wanderX - hx, b.wanderZ - hz) < 10) {
      const p = this.randomPoint(0.7)
      b.wanderX = p.x
      b.wanderZ = p.z
      b.wanderTimer = 4 + this.random() * 5
    }
    if (goalScore < 0.08) {
      goalX = b.wanderX
      goalZ = b.wanderZ
    }
    b.goalX = goalX
    b.goalZ = goalZ
    const desired = Math.atan2(goalZ - hz, goalX - hx)

    // 2. Pick the safest heading near the desired one.
    const offsets = [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6, 2.2, -2.2, Math.PI]
    let best = desired
    let bestCost = Infinity
    let dangerAhead = 0
    const base = wrapAngle(desired - w.angle) // relative to current heading
    for (const off of offsets) {
      const rel = Math.max(-Math.PI, Math.min(Math.PI, base + off))
      const a = w.angle + rel
      const danger = this.danger(w, a)
      if (off === 0) dangerAhead = danger
      const cost = danger * 10 + Math.abs(off) * 0.55 + Math.abs(rel) * 0.15
      if (cost < bestCost) {
        bestCost = cost
        best = a
      }
    }
    const straightDanger = this.danger(w, w.angle)
    if (straightDanger === 0 && dangerAhead > 0 && bestCost > 5) best = w.angle
    // Imperfect bots: small heading noise.
    w.targetAngle = best + (this.random() - 0.5) * (1 - b.skill) * 0.3

    // 3. Boost decisions.
    const safe = straightDanger === 0 && bestCost < 3
    let boost = false
    if (safe && len > CONFIG.worm.minBoostLength + 10) {
      if (b.hunting > 0 && this.random() < 0.7) boost = true
      else if (bestOrb && bestOrb.value >= 2 && this.random() < 0.3) boost = true
      else if (this.random() < 0.02 * aggression) b.boostHold = 0.8 + this.random()
    }
    if (w.freeBoost > 0 && safe) boost = true
    w.wantBoost = boost || (b.boostHold > 0 && safe)
  }

  /** Danger score of heading `a` for worm `w`, probing points ahead. */
  private danger(w: Worm, a: number): number {
    const hx = w.xs[0]
    const hz = w.zs[0]
    const r = w.radius
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const selfSafe = selfSafeSegments(r)
    let total = 0
    const probes = [r * 1.5 + 2, r * 1.5 + 5, r * 1.5 + 9, r * 1.5 + 14]
    for (let pi = 0; pi < probes.length; pi++) {
      const weight = 1 - pi * 0.18
      const px = hx + ca * probes[pi]
      const pz = hz + sa * probes[pi]
      let d = 0
      if (Math.hypot(px, pz) > this.radius - r - 2) d = 3
      if (!d) for (const ast of this.asteroids) if (Math.hypot(px - ast.x, pz - ast.z) < ast.r + r + 1.2) { d = 3; break }
      if (!d) {
        for (const g of this.gates) {
          const s = this.gateAt(g)
          if (s.phase === 'on' || (s.phase === 'warn' && s.remaining < 1)) {
            if (segDistance(px, pz, g.ax, g.az, g.bx, g.bz) < r + 1.5) { d = 3; break }
          }
        }
      }
      if (!d) {
        this.grid.query(px, pz, r + 2.8, (oi, s) => {
          const o = this.worms[oi]
          if (!o.alive) return
          if (o === w && s < selfSafe + 4) return
          if (o !== w && this.mode === 'team' && o.team === w.team) return
          if (o !== w && s > 0 && canBite(w.xs.length, o.xs.length)) return
          if (Math.hypot(o.xs[s] - px, o.zs[s] - pz) < r + o.radius + 0.6) {
            d = 2.5
            return true
          }
        })
      }
      if (!d) {
        for (const c of this.celestials) {
          if (canConsume(w.xs.length, c.kind)) continue
          if (Math.hypot(px - c.x, pz - c.z) < CELESTIALS[c.kind].radius + r) { d = 0.6; break }
        }
      }
      if (!d) for (const well of this.wells) if (Math.hypot(px - well.x, pz - well.z) < well.r * 0.7) { d = 0.25; break }
      total += d * weight
    }
    return total
  }
}
