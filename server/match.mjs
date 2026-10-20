import { ABILITY_IDS, ONLINE_LEVELS, ghostDuration, ghostCooldown, electricDuration, electricDamage, electricCooldown, bombLifetime, bombDamage, bombLimit, bombCooldown, shrinkDuration, shrinkCooldown, shrinkScale, LASER_RANGE, LASER_CONE } from './abilities.mjs'
export const PROTOCOL = 'spaceworm-3v3-v2'
export const TICK_HZ = 20
export const SNAPSHOT_HZ = 10
export const DT = 1 / TICK_HZ
export const START_LENGTH = 20
export const MAX_LENGTH = 240
export const MIN_BOOST_LENGTH = 12
const RADIUS = 0.95
const SPACING = 1.3
const COLORS = [0x5ef3ff, 0xff5fc8, 0xffd24f, 0x7dffb0, 0xa98bff, 0xff8a5c]
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a))
const round = n => Math.round(n * 1000) / 1000

export function seededRandom(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function validateInput(packet) {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return false
  if (Object.keys(packet).some(key => !['type', 'protocol', 'targetAngle', 'boost', 'seq', 'abilities'].includes(key))) return false
  return packet.type === 'input' && packet.protocol === PROTOCOL &&
    typeof packet.targetAngle === 'number' && Number.isFinite(packet.targetAngle) && Math.abs(packet.targetAngle) <= Math.PI * 2 &&
    typeof packet.boost === 'boolean' && (packet.abilities === undefined || (Array.isArray(packet.abilities) && packet.abilities.length <= 5 && new Set(packet.abilities).size === packet.abilities.length && packet.abilities.every(a => ABILITY_IDS.includes(a)))) && Number.isSafeInteger(packet.seq) && packet.seq >= 0 && packet.seq <= 0x7fffffff
}

function segmentDistance(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
  return Math.hypot(x - ax - t * dx, z - az - t * dz)
}

/** Pure fixed-tick state: only steering intent crosses the trust boundary. No browser Sim or bots. */
export class Match {
  constructor(seats, { seed = 1, seconds = 240, foodCount = 420 } = {}) {
    this.random = seededRandom(seed)
    this.tick = 0
    this.seq = 0
    this.duration = Math.max(1, Math.min(600, seconds))
    this.phase = 'running'
    this.timeLeft = this.duration
    this.stage = 1
    this.arenaRadius = 128
    this.scores = { blue: 0, red: 0 }
    this.players = new Map()
    this.food = []
    this.foodCount = Math.max(0, Math.min(800, foodCount))
    this.nextFoodId = 1
    this.nextEventId = 1
    this.events = []
    this.bombs = []
    this.nextBombId = 1
    for (const seat of seats) {
      const worm = {
        id: seat.id, team: seat.team, slot: seat.slot, name: seat.name, skin: seat.skin,
        color: seat.color || 'skin', headStyle: seat.headStyle || 'round',
        connected: Boolean(seat.socket), alive: false, xs: [], zs: [], angle: 0,
        length: START_LENGTH, boosting: false, score: 0, kills: 0,
        inputSeq: -1, targetAngle: 0, boost: false, lastInputTick: -100,
        inputWindow: 0, inputCount: 0, respawnTick: 0, invulnerableUntil: 0, boostCost: 0, generation: 0,
        levels: { ...ONLINE_LEVELS }, laserUnlocked: true, laserUsed: false,
        ghostUntil: 0, ghostReady: 0, electricUntil: 0, electricReady: 0,
        shrinkUntil: 0, shrinkReady: 0, bombReady: 0, electricHitUntil: 0, pendingAbilities: [],
      }
      this.players.set(worm.id, worm)
      this.spawn(worm)
    }
    this.replenishFood()
  }

  /** P2P migration only: caller validates the public snapshot before restoring it.
   * Steering intent/rate windows reset; scores, bodies, timers and sequence IDs survive.
   * Public snapshots omit RNG/boost-cost internals, so future food is deterministically reseeded.
   */
  static fromSnapshot(snapshot) {
    const match = new Match([], { seed: snapshot.tick + 1, seconds: snapshot.timeLeft + snapshot.tick * DT, foodCount: 0 })
    Object.assign(match, {
      tick: snapshot.tick, seq: snapshot.seq, phase: snapshot.phase,
      duration: snapshot.timeLeft + snapshot.tick * DT, timeLeft: snapshot.timeLeft,
      stage: snapshot.arena.stage, arenaRadius: snapshot.arena.radius, scores: { ...snapshot.scores },
      food: snapshot.food.map(f => ({ ...f })), foodCount: snapshot.food.length,
      events: snapshot.events.map(e => ({ ...e })),
      nextFoodId: Math.max(0, ...snapshot.food.map(f => f.id)) + 1,
      nextEventId: Math.max(0, ...snapshot.events.map(e => e.id)) + 1,
      bombs: (snapshot.bombs || []).map(b => ({ ...b, expiresTick: snapshot.tick + Math.round(b.left / DT) })),
      nextBombId: Math.max(0, ...(snapshot.bombs || []).map(b => b.id)) + 1,
    })
    for (const p of snapshot.players) match.players.set(p.id, {
      ...p, xs: [...p.xs], zs: [...p.zs], targetAngle: p.angle, boost: false, boosting: false,
      lastInputTick: -100, inputWindow: 0, inputCount: 0, boostCost: 0,
      respawnTick: snapshot.tick + Math.round(p.respawnIn / DT),
      invulnerableUntil: snapshot.tick + Math.round(p.spawnGrace / DT),
      levels: { ...ONLINE_LEVELS }, laserUnlocked: true, laserUsed: p.abilities?.laserUsed || false, pendingAbilities: [],
      ghostUntil: snapshot.tick + Math.round((p.abilities?.ghostLeft || 0) / DT),
      ghostReady: snapshot.tick + Math.round(((p.abilities?.ghostLeft || 0) + (p.abilities?.ghostCooldown || 0)) / DT),
      electricUntil: snapshot.tick + Math.round((p.abilities?.electricLeft || 0) / DT),
      electricReady: snapshot.tick + Math.round(((p.abilities?.electricLeft || 0) + (p.abilities?.electricCooldown || 0)) / DT),
      shrinkUntil: snapshot.tick + Math.round((p.abilities?.shrinkLeft || 0) / DT),
      shrinkReady: snapshot.tick + Math.round(((p.abilities?.shrinkLeft || 0) + (p.abilities?.shrinkCooldown || 0)) / DT),
      bombReady: snapshot.tick + Math.round((p.abilities?.bombCooldown || 0) / DT),
      electricHitUntil: snapshot.tick + Math.round((p.abilities?.hitGrace || 0) / DT),
    })
    return match
  }

  event(type, data = {}) {
    this.events.push({ id: this.nextEventId++, tick: this.tick, type, ...data })
    // Repeated in snapshots so one dropped frame does not lose FX; clients deduplicate by id.
    if (this.events.length > 128) this.events.splice(0, this.events.length - 128)
  }

  point() {
    const r = Math.sqrt(this.random()) * (this.arenaRadius - 5), a = this.random() * Math.PI * 2
    return { x: Math.cos(a) * r, z: Math.sin(a) * r }
  }

  addFood(x, z, value = 1) {
    if (this.food.length >= 800 || Math.hypot(x, z) > this.arenaRadius - 2) return
    this.food.push({ id: this.nextFoodId++, x: round(x), z: round(z), value, color: COLORS[Math.floor(this.random() * COLORS.length)] })
  }

  replenishFood() {
    while (this.food.length < this.foodCount) { const p = this.point(); this.addFood(p.x, p.z) }
  }

  spawn(w) {
    // Opposite team halves, choose the safest of seeded candidates. Protection prevents spawn kills.
    let best = { x: w.team === 'blue' ? -65 : 65, z: (w.slot - 1) * 30 }, safety = -1
    for (let i = 0; i < 24; i++) {
      const p = { x: (w.team === 'blue' ? -1 : 1) * (35 + this.random() * 38), z: (this.random() - 0.5) * 110 }
      let distance = Infinity
      for (const other of this.players.values()) if (other !== w && other.alive && other.connected) {
        for (let j = 0; j < other.xs.length; j++) distance = Math.min(distance, Math.hypot(p.x - other.xs[j], p.z - other.zs[j]))
      }
      if (distance > safety) { best = p; safety = distance }
    }
    w.alive = true
    w.length = START_LENGTH
    w.angle = w.team === 'blue' ? 0 : Math.PI
    w.targetAngle = w.angle
    w.xs = Array.from({ length: w.length }, (_, i) => best.x - Math.cos(w.angle) * i * SPACING)
    w.zs = Array.from({ length: w.length }, (_, i) => best.z - Math.sin(w.angle) * i * SPACING)
    w.boost = false
    w.boosting = false
    w.boostCost = 0
    w.invulnerableUntil = this.tick + 40
    w.pendingAbilities = []
    w.ghostUntil = w.electricUntil = w.shrinkUntil = 0
    w.generation++
    this.event('spawn', { playerId: w.id, x: round(best.x), z: round(best.z) })
  }

  input(id, packet, now = Date.now()) {
    const w = this.players.get(id)
    if (!w || !w.connected || this.phase !== 'running' || !validateInput(packet) || packet.seq <= w.inputSeq) return false
    if (now - w.inputWindow >= 1000) { w.inputWindow = now; w.inputCount = 0 }
    if (++w.inputCount > 40) return false
    w.inputSeq = packet.seq
    w.targetAngle = wrap(packet.targetAngle)
    w.boost = packet.boost
    w.lastInputTick = this.tick
    w.pendingAbilities = [...new Set([...w.pendingAbilities, ...(packet.abilities || [])])].slice(0, 5)
    return true
  }

  radius(w) { return RADIUS * (w.shrinkUntil > this.tick ? shrinkScale(w.levels.shrink) : 1) }

  trim(w, amount) {
    const before = w.length
    w.length = Math.max(4, w.length - Math.ceil(amount))
    w.xs.length = w.zs.length = w.length
    return before - w.length
  }

  /** Normalized tournament loadout: local wallets cannot be authenticated by this protocol.
   * Every seat gets identical host-owned level-one abilities and one laser per MATCH.
   * No profile/input can change entitlement, damage, target, position or timers.
   */
  activate(w, kind) {
    if (!w.alive || !w.connected || this.phase !== 'running') return false
    const n = w.levels[kind]
    if (kind !== 'laser' && (!n || n > 10)) return false
    const ticks = seconds => Math.ceil(seconds / DT)
    if (kind === 'ghost') {
      if (this.tick < w.ghostReady || this.tick < w.electricUntil) return false
      w.ghostUntil = this.tick + ticks(ghostDuration(n))
      w.ghostReady = w.ghostUntil + ticks(ghostCooldown(n))
    } else if (kind === 'electric') {
      if (this.tick < w.electricReady || this.tick < w.ghostUntil) return false
      w.electricUntil = this.tick + ticks(electricDuration(n))
      w.electricReady = w.electricUntil + ticks(electricCooldown(n))
    } else if (kind === 'shrink') {
      if (this.tick < w.shrinkReady) return false
      w.shrinkUntil = this.tick + ticks(shrinkDuration(n))
      w.shrinkReady = w.shrinkUntil + ticks(shrinkCooldown(n))
    } else if (kind === 'bomb') {
      if (this.tick < w.bombReady || this.bombs.filter(b => b.ownerId === w.id).length >= bombLimit(n)) return false
      let x = w.xs[0] + Math.cos(w.angle) * 4.6, z = w.zs[0] + Math.sin(w.angle) * 4.6
      const k = Math.min(1, (this.arenaRadius - 3) / (Math.hypot(x, z) || 1))
      x *= k; z *= k
      this.bombs.push({ id: this.nextBombId++, ownerId: w.id, x: round(x), z: round(z), level: n, expiresTick: this.tick + ticks(bombLifetime(n)) })
      w.bombReady = this.tick + ticks(bombCooldown(n))
    } else if (kind === 'laser') {
      if (!w.laserUnlocked || w.laserUsed) return false
      const target = [...this.players.values()].filter(o => o !== w && o.alive && o.connected && o.team !== w.team && o.ghostUntil <= this.tick && o.invulnerableUntil <= this.tick)
        .map(o => ({ o, d: Math.hypot(o.xs[0] - w.xs[0], o.zs[0] - w.zs[0]), a: Math.abs(wrap(Math.atan2(o.zs[0] - w.zs[0], o.xs[0] - w.xs[0]) - w.angle)) }))
        .filter(o => o.d > 0.01 && o.d <= LASER_RANGE && o.a <= LASER_CONE).sort((a, b) => a.d + a.a * 18 - b.d - b.a * 18)[0]?.o
      if (!target) return false
      w.laserUsed = true
      this.event('laserFire', { playerId: w.id, targetId: target.id, x: round(w.xs[0]), z: round(w.zs[0]), tx: round(target.xs[0]), tz: round(target.zs[0]) })
      this.kill(target, w, 'laser')
      return true
    } else return false
    this.event('ability', { playerId: w.id, kind, x: round(w.xs[0]), z: round(w.zs[0]) })
    return true
  }

  updateBombs() {
    this.bombs = this.bombs.filter(b => {
      if (b.expiresTick <= this.tick) { this.event('bombExpire', { bombId: b.id, x: b.x, z: b.z }); return false }
      const owner = this.players.get(b.ownerId)
      const target = [...this.players.values()].find(w => w.alive && w.connected && w.id !== b.ownerId && w.team !== owner?.team && w.ghostUntil <= this.tick && w.invulnerableUntil <= this.tick &&
        w.xs.some((x, i) => Math.hypot(x - b.x, w.zs[i] - b.z) < this.radius(w) + 2.6))
      if (!target) return true
      const damage = this.trim(target, bombDamage(b.level))
      this.event('bombDetonate', { bombId: b.id, playerId: b.ownerId, targetId: target.id, damage, x: b.x, z: b.z })
      return false
    })
  }

  setConnected(id, connected) {
    const w = this.players.get(id)
    if (w && w.connected !== connected) { w.connected = connected; w.boost = false; w.boosting = false; w.lastInputTick = -100 }
  }

  removePlayer(id) { this.players.delete(id); this.bombs = this.bombs.filter(b => b.ownerId !== id) }

  kill(w, killer, cause) {
    if (!w.alive) return
    w.alive = false
    w.boosting = false
    w.boost = false
    w.respawnTick = this.tick + 60
    if (killer && killer !== w) {
      killer.kills++
      killer.score += 50
      this.scores[killer.team] += 50
    }
    for (let i = 0; i < w.xs.length; i += 3) this.addFood(w.xs[i], w.zs[i], 2)
    this.event('death', { playerId: w.id, killerId: killer?.id || null, cause, x: round(w.xs[0]), z: round(w.zs[0]) })
  }

  step() {
    if (this.phase !== 'running') return
    this.tick++
    this.timeLeft = Math.max(0, this.duration - this.tick * DT)
    const stage = Math.min(5, 1 + Math.floor(this.tick * DT / 60))
    if (stage !== this.stage) {
      this.stage = stage
      this.arenaRadius = 128 + (stage - 1) * 8
      this.event('stage', { stage, radius: this.arenaRadius })
    }
    const oldHeads = new Map()
    // Intent executes on a fixed tick, not at client-supplied timestamps.
    for (const w of this.players.values()) {
      const commands = w.pendingAbilities; w.pendingAbilities = []
      for (const kind of commands) this.activate(w, kind)
    }
    for (const w of this.players.values()) {
      if (!w.connected) continue // Grace freezes the worm; disconnected bodies are non-colliding.
      if (!w.alive) { if (this.tick >= w.respawnTick) this.spawn(w); continue }
      oldHeads.set(w.id, [w.xs[0], w.zs[0]])
      const delta = wrap(w.targetAngle - w.angle)
      const maxTurn = 2.8 * DT
      w.angle = wrap(w.angle + Math.max(-maxTurn, Math.min(maxTurn, delta)))
      w.boosting = w.boost && this.tick - w.lastInputTick <= 10 && w.length > MIN_BOOST_LENGTH
      if (w.boosting) {
        w.boostCost += DT
        if (w.boostCost >= 0.5) { w.boostCost -= 0.5; this.addFood(w.xs.at(-1), w.zs.at(-1)); w.length-- }
      }
      const speed = w.boosting ? 22 : 12
      w.xs[0] += Math.cos(w.angle) * speed * DT
      w.zs[0] += Math.sin(w.angle) * speed * DT
      while (w.xs.length < w.length) { w.xs.push(w.xs.at(-1)); w.zs.push(w.zs.at(-1)) }
      w.xs.length = w.zs.length = w.length
      for (let j = 1; j < w.length; j++) {
        const dx = w.xs[j] - w.xs[j - 1], dz = w.zs[j] - w.zs[j - 1], d = Math.hypot(dx, dz)
        if (d > SPACING) { w.xs[j] = w.xs[j - 1] + dx / d * SPACING; w.zs[j] = w.zs[j - 1] + dz / d * SPACING }
      }
    }
    this.updateBombs()
    const crowned = [...this.players.values()].filter(w => w.alive && w.connected && w.length >= 30).sort((a, b) => b.length - a.length || a.id.localeCompare(b.id))[0]?.id
    // Collect deaths against the same tick before applying any: no iteration-order head advantage.
    const deaths = new Map()
    const alive = [...this.players.values()].filter(w => w.alive && w.connected)
    for (const w of alive) {
      if (Math.hypot(w.xs[0], w.zs[0]) > this.arenaRadius - this.radius(w)) { deaths.set(w.id, [null, 'rim']); continue }
      if (w.invulnerableUntil > this.tick || w.ghostUntil > this.tick) continue
      const old = oldHeads.get(w.id) || [w.xs[0], w.zs[0]]
      for (const other of alive) {
        if (other.ghostUntil > this.tick || other.invulnerableUntil > this.tick || (other !== w && other.team === w.team)) continue
        const electricContact = other !== w && other.electricUntil > this.tick && crowned !== w.id && other.xs.some((x, i) =>
          segmentDistance(x, other.zs[i], old[0], old[1], w.xs[0], w.zs[0]) < this.radius(w) + this.radius(other))
        if (electricContact) {
          if (w.electricHitUntil <= this.tick) {
            w.electricHitUntil = this.tick + 13
            const damage = this.trim(w, electricDamage(other.levels.electric))
            this.event('electricHit', { playerId: other.id, targetId: w.id, damage, x: round(w.xs[0]), z: round(w.zs[0]) })
          }
          continue
        }
        if (other !== w && w.electricUntil > this.tick && crowned !== other.id) continue
        if (other !== w && segmentDistance(other.xs[0], other.zs[0], old[0], old[1], w.xs[0], w.zs[0]) < this.radius(w) + this.radius(other)) {
          deaths.set(w.id, [other, 'head']); deaths.set(other.id, [w, 'head']); break
        }
        for (let j = other === w ? 7 : 2; j < other.xs.length; j++) {
          if (segmentDistance(w.xs[0], w.zs[0], other.xs[j - 1], other.zs[j - 1], other.xs[j], other.zs[j]) < RADIUS * 1.65 ||
              segmentDistance(other.xs[j], other.zs[j], old[0], old[1], w.xs[0], w.zs[0]) < (this.radius(w) + this.radius(other)) * 0.825) {
            deaths.set(w.id, [other === w ? null : other, other === w ? 'self' : 'worm']); break
          }
        }
        if (deaths.has(w.id)) break
      }
    }
    for (const [id, [killer, cause]] of deaths) this.kill(this.players.get(id), killer, cause)
    for (const w of alive) if (w.alive) {
      const old = oldHeads.get(w.id) || [w.xs[0], w.zs[0]]
      this.food = this.food.filter(f => {
        if (segmentDistance(f.x, f.z, old[0], old[1], w.xs[0], w.zs[0]) > this.radius(w) + 0.65) return true
        w.score += f.value; this.scores[w.team] += f.value
        w.length = Math.min(MAX_LENGTH, w.length + f.value)
        while (w.xs.length < w.length) { w.xs.push(w.xs.at(-1)); w.zs.push(w.zs.at(-1)) }
        this.event('eat', { playerId: w.id, foodId: f.id, value: f.value, color: f.color, x: f.x, z: f.z })
        return false
      })
    }
    this.replenishFood()
    if (!this.timeLeft) { this.phase = 'ended'; this.event('end', { winner: this.winner() }) }
  }

  winner() { return this.scores.blue === this.scores.red ? 'draw' : this.scores.blue > this.scores.red ? 'blue' : 'red' }

  abilityState(w) {
    const left = tick => round(Math.max(0, (tick - this.tick) * DT))
    return { levels: { ...w.levels }, laserUnlocked: w.laserUnlocked, laserUsed: w.laserUsed,
      ghostLeft: left(w.ghostUntil), ghostCooldown: left(w.ghostReady) - left(w.ghostUntil),
      electricLeft: left(w.electricUntil), electricCooldown: left(w.electricReady) - left(w.electricUntil),
      shrinkLeft: left(w.shrinkUntil), shrinkCooldown: left(w.shrinkReady) - left(w.shrinkUntil),
      bombCooldown: left(w.bombReady), hitGrace: left(w.electricHitUntil) }
  }

  snapshot(type = 'match') {
    return {
      type, protocol: PROTOCOL, tick: this.tick, seq: ++this.seq, phase: this.phase, timeLeft: round(this.timeLeft),
      arena: { stage: this.stage, radius: this.arenaRadius }, scores: { ...this.scores },
      ...(type === 'matchEnd' ? { winner: this.winner() } : {}),
      players: [...this.players.values()].map(w => ({
        id: w.id, team: w.team, slot: w.slot, name: w.name, skin: w.skin, color: w.color, headStyle: w.headStyle,
        connected: w.connected, alive: w.alive, xs: w.xs.map(round), zs: w.zs.map(round), angle: round(w.angle),
        length: w.length, boosting: w.boosting, score: w.score, kills: w.kills, inputSeq: w.inputSeq,
        generation: w.generation, respawnIn: w.alive ? 0 : round(Math.max(0, (w.respawnTick - this.tick) * DT)),
        abilities: this.abilityState(w),
        spawnGrace: round(Math.max(0, (w.invulnerableUntil - this.tick) * DT)),
      })), bombs: this.bombs.map(b => ({ id: b.id, ownerId: b.ownerId, x: b.x, z: b.z, level: b.level, left: round(Math.max(0, (b.expiresTick - this.tick) * DT)) })), food: this.food.map(f => ({ ...f })), events: this.events.map(e => ({ ...e })),
    }
  }
}
