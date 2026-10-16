import { CELESTIALS, PICKUP_COLORS, TEAM_COLORS } from '../game/content'
import type { Game } from '../game/game'
import { canBite, canConsume } from '../game/rules'

const hex = (n: number, a = 1) => `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`

/** Circular 2D minimap drawn at ~20 Hz. */
export class Minimap {
  private ctx: CanvasRenderingContext2D
  private acc = 0

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!
  }

  draw(game: Game, dt: number): void {
    this.acc += dt
    if (this.acc < 0.05) return
    this.acc = 0
    const css = this.canvas.clientWidth
    if (!css) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const px = Math.round(css * dpr)
    if (this.canvas.width !== px) {
      this.canvas.width = px
      this.canvas.height = px
    }
    const ctx = this.ctx
    const sim = game.sim
    const R = sim.radius
    const half = px / 2
    const k = (half - 3 * dpr) / R
    const X = (x: number) => half + x * k
    const Z = (z: number) => half + z * k
    ctx.clearRect(0, 0, px, px)
    ctx.save()
    ctx.beginPath()
    ctx.arc(half, half, half - 1, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(8,6,26,0.78)'
    ctx.fill()
    ctx.clip()

    for (const w of sim.wells) {
      ctx.beginPath()
      ctx.arc(X(w.x), Z(w.z), w.r * k, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(160,102,255,0.16)'
      ctx.fill()
      // Dashed violet boundary: "slows you", not lethal.
      ctx.setLineDash([2.5 * dpr, 2 * dpr])
      ctx.strokeStyle = 'rgba(176,122,255,0.95)'
      ctx.lineWidth = 1.2 * dpr
      ctx.stroke()
      ctx.setLineDash([])
    }
    // Asteroids are lethal: hazard red.
    ctx.fillStyle = 'rgba(255,59,78,0.9)'
    for (const a of sim.asteroids) {
      ctx.beginPath()
      ctx.arc(X(a.x), Z(a.z), Math.max(1.5 * dpr, a.r * k), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.lineCap = 'round'
    for (const g of sim.gates) {
      const s = sim.gateAt(g)
      const blink = s.phase === 'warn' && Math.floor(performance.now() / 160) % 2 === 0
      ctx.strokeStyle = s.phase === 'on' ? 'rgba(255,59,92,1)' : s.phase === 'warn' ? `rgba(255,176,32,${blink ? 0.45 : 1})` : 'rgba(111,127,166,0.5)'
      ctx.lineWidth = (s.phase === 'on' ? 2.4 : 1.6) * dpr
      ctx.beginPath()
      ctx.moveTo(X(g.ax), Z(g.az))
      ctx.lineTo(X(g.bx), Z(g.bz))
      ctx.stroke()
    }
    const P = sim.player
    const plen = P.alive ? P.xs.length : 0
    for (const c of sim.celestials) {
      const def = CELESTIALS[c.kind]
      ctx.beginPath()
      ctx.arc(X(c.x), Z(c.z), 2.2 * dpr, 0, Math.PI * 2)
      ctx.fillStyle = hex(def.color)
      ctx.fill()
      if (P.alive && canConsume(plen, c.kind)) {
        // Gold = "you can eat it" (same colour as the in-world ring and the hint card).
        const pulse = game.reducedMotion ? 1 : 0.7 + 0.3 * Math.sin(performance.now() / 260)
        ctx.beginPath()
        ctx.arc(X(c.x), Z(c.z), 3.8 * dpr, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(255,197,61,${pulse.toFixed(2)})`
        ctx.lineWidth = 1.6 * dpr
        ctx.stroke()
      }
    }
    for (const p of sim.pickups) {
      ctx.fillStyle = hex(PICKUP_COLORS[p.kind])
      ctx.fillRect(X(p.x) - 1.6 * dpr, Z(p.z) - 1.6 * dpr, 3.2 * dpr, 3.2 * dpr)
    }
    // Rival worms: heads sized by length; the longest also show their bodies.
    const team = sim.mode === 'team'
    for (const w of sim.worms) {
      if (!w.alive || w === P) continue
      const col = team ? TEAM_COLORS[w.team] : 0xff6b8a
      if (w.xs.length > 70) {
        ctx.strokeStyle = hex(col, 0.35)
        ctx.lineWidth = Math.max(1, w.radius * k * 1.6)
        ctx.beginPath()
        for (let i = 0; i < w.xs.length; i += 4) i === 0 ? ctx.moveTo(X(w.xs[i]), Z(w.zs[i])) : ctx.lineTo(X(w.xs[i]), Z(w.zs[i]))
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.arc(X(w.xs[0]), Z(w.zs[0]), (1.6 + Math.min(2.4, w.xs.length / 80)) * dpr, 0, Math.PI * 2)
      ctx.fillStyle = hex(col, 0.95)
      ctx.fill()
      // Rivals longer than you win head-on clashes: red ring.
      const ally = team && w.team === P.team
      if (!ally && P.alive && w.xs.length >= P.xs.length) {
        ctx.strokeStyle = 'rgba(255,59,78,1)'
        ctx.lineWidth = 1.4 * dpr
        ctx.stroke()
      } else if (!ally && P.alive && canBite(P.xs.length, w.xs.length)) {
        // Short enough to bite through: gold ring.
        ctx.strokeStyle = 'rgba(255,197,61,1)'
        ctx.lineWidth = 1.4 * dpr
        ctx.stroke()
      }
    }
    if (P.alive) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'
      ctx.lineWidth = Math.max(1.5 * dpr, P.radius * k * 1.6)
      ctx.beginPath()
      for (let i = 0; i < P.xs.length; i += 2) i === 0 ? ctx.moveTo(X(P.xs[i]), Z(P.zs[i])) : ctx.lineTo(X(P.xs[i]), Z(P.zs[i]))
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(X(P.xs[0]), Z(P.zs[0]), 3.4 * dpr, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.strokeStyle = team ? hex(TEAM_COLORS[0]) : '#5ef3ff'
      ctx.lineWidth = 1.5 * dpr
      ctx.stroke()
    }
    const v = game.viewCenter()
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'
    ctx.lineWidth = 1 * dpr
    ctx.strokeRect(X(v.x - v.r), Z(v.z - v.r), v.r * 2 * k, v.r * 2 * k)
    ctx.restore()
    ctx.beginPath()
    ctx.arc(half, half, half - 1.5 * dpr, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,80,150,0.85)'
    ctx.lineWidth = 2 * dpr
    ctx.stroke()
  }
}
