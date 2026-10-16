import type { Input } from '../engine/input'

/**
 * Dual-touch controls: the left side of the screen is a floating steering stick that appears
 * where the thumb lands; the right side is a boost zone with a large visible button. Both
 * thumbs work independently (multi-touch). Hidden until the device reports a touch.
 */
export class TouchControls {
  private el: HTMLElement
  private base: HTMLElement
  private knob: HTMLElement
  private boostBtn: HTMLElement
  private steerId: number | null = null
  private boostIds = new Set<number>()
  private origin = { x: 0, y: 0 }
  private enabled = false

  constructor(root: HTMLElement, private readonly input: Input) {
    this.el = document.createElement('div')
    this.el.className = 'touch'
    this.el.innerHTML = `
      <div class="touch-zone touch-left"></div>
      <div class="touch-zone touch-right"></div>
      <div class="stick-base"><div class="stick-knob"></div></div>
      <div class="boost-btn" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 9-12h-6z" fill="currentColor"/></svg></div>`
    root.appendChild(this.el)
    this.base = this.el.querySelector('.stick-base')!
    this.knob = this.el.querySelector('.stick-knob')!
    this.boostBtn = this.el.querySelector('.boost-btn')!
    const left = this.el.querySelector<HTMLElement>('.touch-left')!
    const right = this.el.querySelector<HTMLElement>('.touch-right')!

    const markTouch = () => document.body.classList.add('has-touch')
    window.addEventListener('touchstart', markTouch, { passive: true })
    if (matchMedia('(pointer: coarse)').matches) markTouch()

    left.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' || this.steerId !== null) return
      e.preventDefault()
      left.setPointerCapture(e.pointerId)
      this.steerId = e.pointerId
      this.origin = { x: e.clientX, y: e.clientY }
      this.base.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
      this.knob.style.transform = 'translate(0px, 0px)'
      this.base.classList.add('is-on')
    })
    left.addEventListener('pointermove', e => {
      if (e.pointerId !== this.steerId) return
      const max = Math.min(70, window.innerWidth * 0.09 + 20)
      let dx = e.clientX - this.origin.x
      let dy = e.clientY - this.origin.y
      const d = Math.hypot(dx, dy)
      // Follow the thumb when it drifts beyond the ring, so steering never "runs out".
      if (d > max * 1.35) {
        const k = (d - max * 1.35) / d
        this.origin.x += dx * k
        this.origin.y += dy * k
        this.base.style.transform = `translate(${this.origin.x}px, ${this.origin.y}px)`
        dx = e.clientX - this.origin.x
        dy = e.clientY - this.origin.y
      }
      const len = Math.hypot(dx, dy)
      const clamp = Math.min(1, len / max)
      const kx = len > 0 ? (dx / len) * clamp * max : 0
      const ky = len > 0 ? (dy / len) * clamp * max : 0
      this.knob.style.transform = `translate(${kx}px, ${ky}px)`
      if (len > 6) this.input.setTouchSteer({ x: dx / len, y: -dy / len })
    })
    const endSteer = (e: PointerEvent) => {
      if (e.pointerId !== this.steerId) return
      this.steerId = null
      this.base.classList.remove('is-on')
      this.input.setTouchSteer(null)
    }
    left.addEventListener('pointerup', endSteer)
    left.addEventListener('pointercancel', endSteer)

    right.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') return
      e.preventDefault()
      right.setPointerCapture(e.pointerId)
      this.boostIds.add(e.pointerId)
      this.input.setTouchBoost(true)
      this.boostBtn.classList.add('is-on')
    })
    const endBoost = (e: PointerEvent) => {
      if (!this.boostIds.delete(e.pointerId)) return
      if (this.boostIds.size === 0) {
        this.input.setTouchBoost(false)
        this.boostBtn.classList.remove('is-on')
      }
    }
    right.addEventListener('pointerup', endBoost)
    right.addEventListener('pointercancel', endBoost)
  }

  /** Show zones only while a life is being played. */
  sync(active: boolean): void {
    if (active === this.enabled) return
    this.enabled = active
    this.el.classList.toggle('is-active', active)
    if (!active) {
      this.steerId = null
      this.boostIds.clear()
      this.base.classList.remove('is-on')
      this.boostBtn.classList.remove('is-on')
      this.input.setTouchBoost(false)
    }
  }
}
