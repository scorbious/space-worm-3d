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
  if (Object.keys(packet).some(key => !['type', 'protocol', 'targetAngle', 'boost', 'seq'].includes(key))) return false
  return packet.type === 'input' && packet.protocol === PROTOCOL &&
    typeof packet.targetAngle === 'number' && Number.isFinite(packet.targetAngle) && Math.abs(packet.targetAngle) <= Math.PI * 2 &&
    typeof packet.boost === 'boolean' && Number.isSafeInteger(packet.seq) && packet.seq >= 0 && packet.seq <= 0x7fffffff
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
    for (const seat of seats) {
      const worm = {
        id: seat.id, team: seat.team, slot: seat.slot, name: seat.name, skin: seat.skin,
        color: seat.color || 'skin', headStyle: seat.headStyle || 'round',
        connected: Boolean(seat.socket), alive: false, xs: [], zs: [], angle: 0,
        length: START_LENGTH, boosting: false, score: 0, kills: 0,
        inputSeq: -1, targetAngle: 0, boost: false, lastInputTick: -100,
        inputWindow: 0, inputCount: 0, respawnTick: 0, invulnerableUntil: 0, boostCost: 0, generation: 0,
      }
      this.players.set(worm.id, worm)
      this.spawn(worm)
    }
    this.replenishFood()
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
    return true
  }

  setConnected(id, connected) {
    const w = this.players.get(id)
    if (w) { w.connected = connected; w.boost = false; w.boosting = false; w.lastInputTick = -100 }
  }

  removePlayer(id) { this.players.delete(id) }

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
    // Collect deaths against the same tick before applying any: no iteration-order head advantage.
    const deaths = new Map()
    const alive = [...this.players.values()].filter(w => w.alive && w.connected)
    for (const w of alive) {
      if (Math.hypot(w.xs[0], w.zs[0]) > this.arenaRadius - RADIUS) { deaths.set(w.id, [null, 'rim']); continue }
      if (w.invulnerableUntil > this.tick) continue
      const old = oldHeads.get(w.id) || [w.xs[0], w.zs[0]]
      for (const other of alive) {
        if (other.invulnerableUntil > this.tick || (other !== w && other.team === w.team)) continue
        if (other !== w && segmentDistance(other.xs[0], other.zs[0], old[0], old[1], w.xs[0], w.zs[0]) < RADIUS * 2) {
          deaths.set(w.id, [other, 'head']); deaths.set(other.id, [w, 'head']); break
        }
        for (let j = other === w ? 7 : 2; j < other.xs.length; j++) {
          if (segmentDistance(w.xs[0], w.zs[0], other.xs[j - 1], other.zs[j - 1], other.xs[j], other.zs[j]) < RADIUS * 1.65 ||
              segmentDistance(other.xs[j], other.zs[j], old[0], old[1], w.xs[0], w.zs[0]) < RADIUS * 1.65) {
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
        if (segmentDistance(f.x, f.z, old[0], old[1], w.xs[0], w.zs[0]) > RADIUS + 0.65) return true
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
        spawnGrace: round(Math.max(0, (w.invulnerableUntil - this.tick) * DT)),
      })), food: this.food.map(f => ({ ...f })), events: this.events.map(e => ({ ...e })),
    }
  }
}
