/**
 * Threat analysis ("Threat Language"). Pure: no three.js, DOM or randomness, so it is unit tested.
 *
 * Every frame the player's head is projected `LOOK_AHEAD` seconds along its current heading (turning
 * toward its steering target at the real turn rate). Each hazard and rival is scored:
 *   0 clear · 1 near (brighten markers) · 2 imminent (pulse, "!", reticle, warning tick)
 * Gates are judged by the phase they will be in when the head arrives, not the phase right now.
 */
import type { CelestialId } from './content'
import { canBite, canConsume, gateState, turnRateFor, type Mode } from './rules'

export const LOOK_AHEAD = 1.1
const STEPS = 11
/** Distance within which a hazard is "near" even if the path misses it. */
const NEAR = 7
/** Rival bodies within this range of the head get the red underglow. */
export const RIVAL_GLOW_RANGE = 40

export type ThreatLevel = 0 | 1 | 2
export type ThreatKind = 'asteroid' | 'gate' | 'well' | 'rim' | 'rival'
export type HintId = 'asteroid' | 'gate' | 'well' | 'rim' | 'rival' | 'edible' | 'bite'

type P = { x: number; z: number; r: number }
type G = { ax: number; az: number; bx: number; bz: number; period: number; on: number; offset: number }
type W = {
  id: number; alive: boolean; isPlayer: boolean; team: number; xs: number[]; zs: number[]
  angle: number; targetAngle: number; radius: number; speed: number; spawnGrace: number
}
export type ThreatWorld = {
  time: number; radius: number; mode: Mode
  asteroids: readonly P[]; gates: readonly G[]; wells: readonly P[]
  worms: readonly W[]; player: W
  /** Free-floating celestials (for the "you can swallow this" hint). */
  celestials?: readonly { x: number; z: number; kind: CelestialId; alive: boolean }[]
}
/** `bigger`: wins head-on clashes. `prey`: short enough for us to bite through (its body is not a wall). */
export type RivalThreat = { id: number; level: ThreatLevel; bigger: boolean; prey: boolean; ally: boolean; glow: boolean }
export type Focus = { kind: ThreatKind; x: number; z: number; t: number }
/** A threat worth pointing at when it is off-screen (the UI decides visibility with the camera). */
export type ArrowTarget = { kind: 'gate' | 'rival'; x: number; z: number; urgency: number; key: string }
export type ThreatReport = {
  asteroids: ThreatLevel[]; gates: ThreatLevel[]; wells: ThreatLevel[]; rim: ThreatLevel
  rivals: Map<number, RivalThreat>
  /** Earliest imminent danger on the path (drives the reticle and the warning tick). */
  focus: Focus | null
  arrows: ArrowTarget[]
  path: { x: number; z: number }[]
}

export function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az
  const len2 = dx * dx + dz * dz || 1
  const k = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2))
  return Math.hypot(px - (ax + dx * k), pz - (az + dz * k))
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const raise = (arr: ThreatLevel[], i: number, lvl: ThreatLevel) => { if (lvl > arr[i]) arr[i] = lvl }

/** Predicted head positions for t = dt..LOOK_AHEAD. */
export function projectPath(w: W, look = LOOK_AHEAD, steps = STEPS): { x: number; z: number; t: number }[] {
  const out: { x: number; z: number; t: number }[] = []
  const dt = look / steps
  const speed = Math.max(6, w.speed)
  const turn = turnRateFor(w.radius)
  let a = w.angle, x = w.xs[0], z = w.zs[0]
  for (let i = 1; i <= steps; i++) {
    const diff = wrap(w.targetAngle - a)
    a += Math.max(-turn * dt, Math.min(turn * dt, diff))
    x += Math.cos(a) * speed * dt
    z += Math.sin(a) * speed * dt
    out.push({ x, z, t: i * dt })
  }
  return out
}

export function emptyReport(world: Pick<ThreatWorld, 'asteroids' | 'gates' | 'wells'>): ThreatReport {
  return {
    asteroids: world.asteroids.map(() => 0 as ThreatLevel), gates: world.gates.map(() => 0 as ThreatLevel),
    wells: world.wells.map(() => 0 as ThreatLevel), rim: 0, rivals: new Map(), focus: null, arrows: [], path: [],
  }
}

export function analyzeThreats(world: ThreatWorld): ThreatReport {
  const rep = emptyReport(world)
  const P = world.player
  if (!P || !P.alive || P.xs.length === 0) return rep
  const hx = P.xs[0], hz = P.zs[0], pr = P.radius
  const path = projectPath(P)
  rep.path = path.map(p => ({ x: p.x, z: p.z }))
  const hit = (kind: ThreatKind, x: number, z: number, t: number) => {
    if (!rep.focus || t < rep.focus.t) rep.focus = { kind, x, z, t }
  }

  world.asteroids.forEach((a, i) => {
    if (Math.hypot(hx - a.x, hz - a.z) < a.r + pr + NEAR) raise(rep.asteroids, i, 1)
    for (const p of path) {
      const d = Math.hypot(p.x - a.x, p.z - a.z)
      if (d < a.r + pr * 0.8 + 0.6) { raise(rep.asteroids, i, 2); hit('asteroid', a.x, a.z, p.t); break }
      if (d < a.r + pr + 3) raise(rep.asteroids, i, 1)
    }
  })

  world.gates.forEach((g, i) => {
    const now = gateState(world.time, g.period, g.on, g.offset)
    const dNow = segDist(hx, hz, g.ax, g.az, g.bx, g.bz)
    if (now.phase !== 'off' && dNow < NEAR + 3) raise(rep.gates, i, 1)
    for (const p of path) {
      const d = segDist(p.x, p.z, g.ax, g.az, g.bx, g.bz)
      if (d >= pr * 0.8 + 0.35 + 0.8) continue
      const then = gateState(world.time + p.t, g.period, g.on, g.offset)
      if (then.phase === 'on') {
        raise(rep.gates, i, 2)
        // Aim the reticle at the closest point of the beam to the crossing.
        const dx = g.bx - g.ax, dz = g.bz - g.az
        const k = Math.max(0, Math.min(1, ((p.x - g.ax) * dx + (p.z - g.az) * dz) / (dx * dx + dz * dz || 1)))
        hit('gate', g.ax + dx * k, g.az + dz * k, p.t)
        break
      }
      if (then.phase === 'warn') raise(rep.gates, i, 1)
    }
    const mx = (g.ax + g.bx) / 2, mz = (g.az + g.bz) / 2
    const dm = Math.hypot(mx - hx, mz - hz)
    if (now.phase !== 'off' && dm < 60) {
      rep.arrows.push({ kind: 'gate', x: mx, z: mz, urgency: rep.gates[i] === 2 ? 1 : now.phase === 'on' ? 0.6 : 0.45, key: `g${i}` })
    }
  })

  world.wells.forEach((w, i) => {
    if (Math.hypot(hx - w.x, hz - w.z) < w.r + 4) { raise(rep.wells, i, 1); return }
    if (path.some(p => Math.hypot(p.x - w.x, p.z - w.z) < w.r)) raise(rep.wells, i, 1)
  })

  const rimNow = world.radius - Math.hypot(hx, hz)
  if (rimNow < 14) rep.rim = 1
  for (const p of path) {
    if (Math.hypot(p.x, p.z) > world.radius - pr - 0.4) { rep.rim = 2; const d = Math.hypot(p.x, p.z) || 1; hit('rim', (p.x / d) * world.radius, (p.z / d) * world.radius, p.t); break }
  }

  const myLen = P.xs.length
  for (const o of world.worms) {
    if (o === P || !o.alive || o.xs.length === 0) continue
    const ally = world.mode === 'team' && o.team === P.team
    const bigger = o.xs.length >= myLen
    const prey = !ally && canBite(myLen, o.xs.length)
    const info: RivalThreat = { id: o.id, level: 0, bigger, prey, ally, glow: false }
    rep.rivals.set(o.id, info)
    // Prey cannot hurt us: we bite through its body and win head-on.
    if (ally || prey || o.spawnGrace > 0) continue
    const reach = pr * 0.72 + o.radius * 0.82 + 0.7
    const n = o.xs.length
    // Cheap reject: skip worms whose head is far beyond body length + look-ahead range.
    const headD = Math.hypot(o.xs[0] - hx, o.zs[0] - hz)
    const bodySpan = n * o.radius * 1.2 + 40
    if (headD > bodySpan) continue
    let nearest = Infinity
    let imminentT = Infinity, ix = 0, iz = 0
    for (let s = 0; s < n; s++) {
      const sx = o.xs[s], sz = o.zs[s]
      const dh = Math.hypot(sx - hx, sz - hz)
      if (dh < nearest) nearest = dh
      if (dh > 30) continue
      // A head-on clash only kills us if the rival is at least as long.
      if (s === 0 && !bigger) continue
      for (const p of path) {
        if (p.t >= imminentT) break
        if (Math.hypot(sx - p.x, sz - p.z) < reach) { imminentT = p.t; ix = sx; iz = sz; break }
      }
    }
    info.glow = nearest < RIVAL_GLOW_RANGE
    if (imminentT < Infinity) { info.level = 2; hit('rival', ix, iz, imminentT) }
    else if (nearest < NEAR + 4) info.level = 1
    // Bigger rivals closing on us are worth an off-screen arrow.
    if (bigger && headD < 55) {
      const toMe = Math.atan2(hz - o.zs[0], hx - o.xs[0])
      const closing = Math.cos(wrap(toMe - o.angle)) > 0.4
      if (closing) rep.arrows.push({ kind: 'rival', x: o.xs[0], z: o.zs[0], urgency: info.level === 2 ? 1 : Math.max(0.35, 1 - headD / 55), key: `w${o.id}` })
    }
  }
  rep.arrows.sort((a, b) => b.urgency - a.urgency)
  rep.arrows.length = Math.min(rep.arrows.length, 4)
  return rep
}

/**
 * Which threat types are currently visible around the camera focus (first-encounter hints).
 * Rim counts once the player is within 30 units of it.
 */
export function visibleThreatKinds(world: ThreatWorld, fx: number, fz: number, viewRadius: number): Set<HintId> {
  const out = new Set<HintId>()
  const inView = (x: number, z: number, pad = 0) => Math.abs(x - fx) < viewRadius * 0.8 + pad && Math.abs(z - fz) < viewRadius * 0.55 + pad
  if (world.asteroids.some(a => inView(a.x, a.z, a.r))) out.add('asteroid')
  if (world.gates.some(g => inView((g.ax + g.bx) / 2, (g.az + g.bz) / 2))) out.add('gate')
  if (world.wells.some(w => inView(w.x, w.z, w.r * 0.5))) out.add('well')
  if (world.radius - Math.hypot(fx, fz) < 30) out.add('rim')
  const P = world.player
  if (P?.alive && world.worms.some(o => o !== P && o.alive && !(world.mode === 'team' && o.team === P.team) && o.xs.length > 0 && inView(o.xs[0], o.zs[0]))) out.add('rival')
  if (P?.alive) {
    const myLen = P.xs.length
    if (world.celestials?.some(c => c.alive && canConsume(myLen, c.kind) && inView(c.x, c.z))) out.add('edible')
    if (world.worms.some(o => o !== P && o.alive && o.spawnGrace <= 0 && !(world.mode === 'team' && o.team === P.team) && o.xs.length > 0 && canBite(myLen, o.xs.length) && inView(o.xs[0], o.zs[0]))) out.add('bite')
  }
  return out
}
