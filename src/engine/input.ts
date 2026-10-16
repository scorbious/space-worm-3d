/**
 * Unified steering input. Every source resolves to one of:
 *  - an absolute heading target (mouse cursor, touch stick, gamepad stick), or
 *  - a relative turn axis (keyboard A/D or arrows),
 * plus a held boost flag. Gameplay reads `steer` and `boost`; it never checks raw events.
 */
export type Action = 'boost' | 'pause' | 'confirm'
export type InputMethod = 'mouse' | 'keyboard' | 'gamepad' | 'touch'

export type Steer =
  | { kind: 'none' }
  | { kind: 'screen'; x: number; y: number }
  | { kind: 'direction'; x: number; y: number }
  | { kind: 'turn'; axis: number }

const KEYS = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  boost: ['Space', 'KeyW', 'ArrowUp', 'ShiftLeft', 'ShiftRight'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'NumpadEnter'],
}

export class Input {
  method: InputMethod = 'mouse'
  steer: Steer = { kind: 'none' }
  boost = false
  /** Keyboard turn speed multiplier from settings. */
  keyTurn = 1
  private keys = new Set<string>()
  private pressed_ = new Set<Action>()
  private mouse = { x: 0, y: 0, known: false, down: false }
  private touchDir: { x: number; y: number } | null = null
  private touchBoost = false
  private padBoostPrev = false
  private padPausePrev = false
  private lastKeyTurn = 0

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', e => {
      // Only text entry swallows game keys; sliders, checkboxes and selects keep Escape working.
      const target = e.target as HTMLElement | null
      const typing = target?.matches?.('input:not([type]), input[type="text"], textarea')
      if (typing) {
        if (e.code === 'Escape') target!.blur()
        return
      }
      if (!e.repeat) {
        if (KEYS.pause.includes(e.code)) this.pressed_.add('pause')
        if (KEYS.confirm.includes(e.code)) this.pressed_.add('confirm')
      }
      this.keys.add(e.code)
      if ([...KEYS.left, ...KEYS.right].includes(e.code)) {
        this.method = 'keyboard'
        this.lastKeyTurn = performance.now()
      }
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault()
    })
    window.addEventListener('keyup', e => this.keys.delete(e.code))
    window.addEventListener('blur', () => {
      this.keys.clear()
      this.mouse.down = false
      this.touchBoost = false
    })
    canvas.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return
      this.mouse.x = e.clientX
      this.mouse.y = e.clientY
      this.mouse.known = true
      // Small jitters while using keys should not steal steering back to the mouse.
      if (this.method !== 'keyboard' || performance.now() - this.lastKeyTurn > 600) this.method = 'mouse'
    })
    canvas.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse') return
      if (e.button === 0 || e.button === 2) this.mouse.down = true
    })
    window.addEventListener('pointerup', e => {
      if (e.pointerType === 'mouse') this.mouse.down = false
    })
    canvas.addEventListener('contextmenu', e => e.preventDefault())
  }

  /** Touch controls feed these from the dual-touch layer. */
  setTouchSteer(dir: { x: number; y: number } | null): void {
    this.method = 'touch'
    this.touchDir = dir
  }

  setTouchBoost(down: boolean): void {
    this.method = 'touch'
    this.touchBoost = down
  }

  /** Sample all sources. Call once per rendered frame before gameplay reads input. */
  update(): void {
    const k = (codes: string[]) => codes.some(code => this.keys.has(code))
    const axis = (k(KEYS.right) ? 1 : 0) - (k(KEYS.left) ? 1 : 0)
    let boost = k(KEYS.boost) || this.mouse.down || this.touchBoost
    let steer: Steer = { kind: 'none' }

    if (this.method === 'touch') {
      if (this.touchDir) steer = { kind: 'direction', x: this.touchDir.x, y: this.touchDir.y }
    } else if (axis !== 0) {
      steer = { kind: 'turn', axis: axis * this.keyTurn }
    } else if (this.method === 'mouse' && this.mouse.known) {
      steer = { kind: 'screen', x: this.mouse.x, y: this.mouse.y }
    }

    const pad = navigator.getGamepads?.().find(p => p && p.connected)
    if (pad) {
      const dead = (v: number) => (Math.abs(v) < 0.22 ? 0 : v)
      const lx = dead(pad.axes[0] ?? 0)
      const ly = dead(pad.axes[1] ?? 0)
      const padBoost = !!(pad.buttons[0]?.pressed || pad.buttons[7]?.pressed || pad.buttons[5]?.pressed)
      if (lx !== 0 || ly !== 0 || padBoost) this.method = 'gamepad'
      if (this.method === 'gamepad') {
        if (lx !== 0 || ly !== 0) steer = { kind: 'direction', x: lx, y: -ly }
        boost ||= padBoost
      }
      const padPause = !!pad.buttons[9]?.pressed
      if (padPause && !this.padPausePrev) this.pressed_.add('pause')
      if (padBoost && !this.padBoostPrev) this.pressed_.add('confirm')
      this.padPausePrev = padPause
      this.padBoostPrev = padBoost
    }
    this.steer = steer
    this.boost = boost
  }

  pressed(action: Action): boolean {
    return this.pressed_.has(action)
  }

  /** Read and clear a press. */
  consume(action: Action): boolean {
    return this.pressed_.delete(action)
  }

  clearBoost(): void {
    this.mouse.down = false
    this.touchBoost = false
  }

  endFrame(): void {
    this.pressed_.clear()
  }

  get element(): HTMLCanvasElement {
    return this.canvas
  }
}
