import { CELESTIALS } from './content'
import { canBite, canConsume } from './rules'
import type { Sim, SimEvent, Worm } from './sim'
import { segDist } from './threats'

/** Cosmetic feedback only: a kill/sever is not itself a swallow. Rich spilled food is. */
export function gulpFeedback(event: SimEvent): { worm: Worm; strength: number; big: boolean } | null {
  if (event.type === 'celestial') return { worm: event.worm, strength: Math.min(1.5, CELESTIALS[event.kind].growth / 16), big: true }
  if (event.type !== 'eat') return null
  const source = event.sourceLength ?? 0
  const big = event.nova || event.value >= 3 || source >= 60 || source > event.worm.xs.length
  return { worm: event.worm, strength: big ? 1 : 0.45, big }
}

/** A forward-facing appetite, fading with distance; shared by player and AI heads. */
export function preyMouthTarget(w: Worm, world: Pick<Sim, 'worms' | 'celestials' | 'mode'>): number {
  if (!w.alive || !w.xs.length) return 0
  const hx = w.xs[0], hz = w.zs[0]
  const reach = 9 + w.radius * 3
  const fx = Math.cos(w.angle), fz = Math.sin(w.angle)
  let open = 0
  const consider = (x: number, z: number, radius: number) => {
    const dx = x - hx, dz = z - hz
    const d = Math.hypot(dx, dz)
    const gap = Math.max(0, d - radius - w.radius)
    if (gap >= reach || (d > radius + w.radius && (dx * fx + dz * fz) / d < 0.15)) return
    const proximity = 1 - gap / reach
    open = Math.max(open, proximity * proximity * (3 - 2 * proximity))
  }
  for (const rival of world.worms) {
    if (rival === w || !rival.alive || rival.spawnGrace > 0 || !canBite(w.xs.length, rival.xs.length)) continue
    if (world.mode === 'team' && rival.team === w.team) continue
    // Reject remote bodies cheaply, then examine every edge (not just the prey's head).
    if (Math.hypot(rival.xs[0] - hx, rival.zs[0] - hz) > rival.xs.length * rival.radius * 1.3 + reach) continue
    for (let i = 0; i < rival.xs.length; i++) {
      if (i === 0) { consider(rival.xs[i], rival.zs[i], rival.radius); continue }
      if (segDist(hx, hz, rival.xs[i - 1], rival.zs[i - 1], rival.xs[i], rival.zs[i]) > reach + rival.radius + w.radius) continue
      const ax = rival.xs[i - 1], az = rival.zs[i - 1]
      const dx = rival.xs[i] - ax, dz = rival.zs[i] - az
      const k = Math.max(0, Math.min(1, ((hx - ax) * dx + (hz - az) * dz) / (dx * dx + dz * dz || 1)))
      consider(ax + dx * k, az + dz * k, rival.radius)
    }
  }
  for (const c of world.celestials) if (c.alive && canConsume(w.xs.length, c.kind)) consider(c.x, c.z, CELESTIALS[c.kind].radius)
  return open
}

export const GULP_FACE_SECONDS = 0.46
export function gulpFace(elapsed: number, strength = 1): { open: number; tongue: number; pulse: number } {
  if (elapsed < 0 || elapsed >= GULP_FACE_SECONDS) return { open: 0, tongue: 0, pulse: 0 }
  const fade = Math.min(1, (GULP_FACE_SECONDS - elapsed) / 0.14)
  return { open: fade, tongue: fade * Math.min(1, strength), pulse: Math.sin(elapsed / GULP_FACE_SECONDS * Math.PI) * Math.min(1, strength) }
}

/** Exponential easing is stable at 30/60/144Hz and closes once prey leaves. */
export function easeMouth(current: number, target: number, dt: number): number {
  return current + (Math.max(0, Math.min(1, target)) - current) * (1 - Math.exp(-Math.max(0, dt) * (target > current ? 12 : 7)))
}
