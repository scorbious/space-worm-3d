/**
 * Lightweight 2D particle layer drawn over the DOM UI (pointer-events: none). Used for button
 * bursts, stardust flying into the wallet counter and celebration rings. Driven from `Ui.frame`,
 * idle when empty, and thinned out under reduced motion.
 */
type Part = {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  size: number
  color: string
  kind: 'dot' | 'star' | 'img' | 'ring'
  /** Homing flight: quadratic bezier from (x0,y0) via (cx,cy) to target centre. */
  fly?: { x0: number; y0: number; cx: number; cy: number; target: HTMLElement; done?: () => void }
  spin: number
  rot: number
}

export class Sparks {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private parts: Part[] = []
  private dpr = 1
  reduced = false
  image: HTMLImageElement | null = null

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'ui-sparks'
    this.canvas.setAttribute('aria-hidden', 'true')
    parent.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  private resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.canvas.width = Math.round(window.innerWidth * this.dpr)
    this.canvas.height = Math.round(window.innerHeight * this.dpr)
  }

  private add(p: Omit<Part, 'age' | 'spin' | 'rot'> & Partial<Pick<Part, 'spin' | 'rot'>>): void {
    if (this.parts.length > 420) this.parts.shift()
    this.parts.push({ age: 0, spin: 0, rot: Math.random() * 6.28, ...p })
  }

  /** Radial burst of dots and stars at a screen point. */
  burst(x: number, y: number, color: string, count = 14, speed = 240): void {
    const n = this.reduced ? Math.ceil(count / 4) : count
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const s = speed * (0.35 + Math.random() * 0.75)
      this.add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: 0.45 + Math.random() * 0.4, size: 2 + Math.random() * 3.5, color, kind: Math.random() < 0.35 ? 'star' : 'dot', spin: (Math.random() - 0.5) * 10 })
    }
  }

  ring(x: number, y: number, color: string, size = 60): void {
    this.add({ x, y, vx: 0, vy: 0, life: this.reduced ? 0.3 : 0.55, size, color, kind: 'ring' })
  }

  /** Burst around the edges of an element (e.g. a card or banner). */
  burstAround(el: Element, color: string, count = 24): void {
    const r = el.getBoundingClientRect()
    const n = this.reduced ? Math.ceil(count / 4) : count
    for (let i = 0; i < n; i++) {
      const t = i / n
      const edge = t * 2 * (r.width + r.height)
      let x: number
      let y: number
      if (edge < r.width) [x, y] = [r.left + edge, r.top]
      else if (edge < r.width + r.height) [x, y] = [r.right, r.top + edge - r.width]
      else if (edge < 2 * r.width + r.height) [x, y] = [r.right - (edge - r.width - r.height), r.bottom]
      else [x, y] = [r.left, r.bottom - (edge - 2 * r.width - r.height)]
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const a = Math.atan2(y - cy, x - cx)
      const s = 80 + Math.random() * 160
      this.add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.4, size: 2 + Math.random() * 3, color, kind: Math.random() < 0.4 ? 'star' : 'dot', spin: 6 })
    }
  }

  /** Icons fly from a point into a target element; `done` fires once, when the first arrives. */
  flyTo(x: number, y: number, target: HTMLElement, count = 6, done?: () => void, color = '#ffd54f'): void {
    const n = this.reduced ? 1 : count
    let fired = false
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const spread = 40 + Math.random() * 60
      const x0 = x + Math.cos(a) * 12
      const y0 = y + Math.sin(a) * 12
      this.add({
        x: x0, y: y0, vx: 0, vy: 0, life: (this.reduced ? 0.35 : 0.55) + i * 0.05 + Math.random() * 0.12, size: 18 + Math.random() * 6, color, kind: this.image ? 'img' : 'star', spin: 4,
        fly: {
          x0, y0, cx: x0 + Math.cos(a) * spread, cy: y0 + Math.sin(a) * spread - 60, target,
          done: () => {
            if (fired) return
            fired = true
            done?.()
          },
        },
      })
    }
  }

  get busy(): boolean {
    return this.parts.length > 0
  }

  update(dt: number): void {
    const ctx = this.ctx
    if (!this.parts.length) {
      if (this.canvas.dataset.dirty) {
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
        delete this.canvas.dataset.dirty
      }
      return
    }
    this.canvas.dataset.dirty = '1'
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.globalCompositeOperation = 'lighter'
    const keep: Part[] = []
    for (const p of this.parts) {
      p.age += dt
      const k = p.age / p.life
      if (k >= 1) {
        p.fly?.done?.()
        continue
      }
      keep.push(p)
      p.rot += p.spin * dt
      if (p.fly) {
        const r = p.fly.target.getBoundingClientRect()
        const tx = r.left + r.width / 2
        const ty = r.top + r.height / 2
        const e = k * k * (3 - 2 * k)
        const u = 1 - e
        p.x = u * u * p.fly.x0 + 2 * u * e * p.fly.cx + e * e * tx
        p.y = u * u * p.fly.y0 + 2 * u * e * p.fly.cy + e * e * ty
      } else {
        const drag = Math.exp(-3.2 * dt)
        p.vx *= drag
        p.vy = p.vy * drag + 260 * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
      }
      const alpha = p.fly ? Math.min(1, (1 - k) * 4) : (1 - k) * (1 - k * 0.4)
      ctx.globalAlpha = Math.max(0, alpha)
      if (p.kind === 'ring') {
        ctx.strokeStyle = p.color
        ctx.lineWidth = 3 * (1 - k) + 0.5
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * (0.3 + k * 0.9), 0, Math.PI * 2)
        ctx.stroke()
      } else if (p.kind === 'img' && this.image) {
        const s = p.size * (p.fly ? 1 - k * 0.35 : 1)
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.drawImage(this.image, -s / 2, -s / 2, s, s)
        ctx.restore()
      } else if (p.kind === 'star') {
        const s = p.size * 1.6
        ctx.fillStyle = p.color
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.beginPath()
        for (let i = 0; i < 8; i++) {
          const rr = i % 2 ? s * 0.28 : s
          const a = (i / 8) * Math.PI * 2
          ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
        }
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      } else {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2)
        g.addColorStop(0, '#ffffff')
        g.addColorStop(0.35, p.color)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    this.parts = keep
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }
}
