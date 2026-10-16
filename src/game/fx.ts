/**
 * Effect recipes. Gameplay code asks for *what happened* ("bite", "swallow", "supernova") and this
 * module decides how it looks: layered atlas particles, expanding shockwave rings and flash
 * sprites. Everything is pooled and scaled down under reduced motion.
 */
import * as THREE from 'three'
import type { CelestialId, PickupId } from './content'
import { CELESTIALS, PICKUP_COLORS } from './content'
import { TILE, type Particles } from './particles'
import { glowTexture, shockwaveMaterial } from './visuals'

type Ring = { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; t: number; dur: number; max: number; active: boolean }
type Flash = { sprite: THREE.Sprite; t: number; dur: number; size: number; active: boolean }

const planeGeo = new THREE.PlaneGeometry(2, 2)
const SPARKS = [TILE.spark, TILE.sparkB, TILE.sparkC] as const
const STARS = [TILE.star, TILE.starB, TILE.starC] as const
const MAGIC = [TILE.magic, TILE.magicB] as const
const SMOKE = [TILE.smoke, TILE.smokeB] as const

export class Fx {
  readonly group = new THREE.Group()
  reduced = false
  private rings: Ring[] = []
  private flashes: Flash[] = []
  private c = new THREE.Color()

  constructor(private readonly p: Particles) {
    for (let i = 0; i < 14; i++) {
      const mat = shockwaveMaterial(0xffffff)
      const mesh = new THREE.Mesh(planeGeo, mat)
      mesh.rotation.x = -Math.PI / 2
      mesh.visible = false
      mesh.renderOrder = 4
      this.group.add(mesh)
      this.rings.push({ mesh, mat, t: 0, dur: 1, max: 1, active: false })
    }
    for (let i = 0; i < 8; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
      sprite.visible = false
      sprite.renderOrder = 6
      this.group.add(sprite)
      this.flashes.push({ sprite, t: 0, dur: 0.3, size: 1, active: false })
    }
  }

  ring(x: number, z: number, color: number, radius: number, dur = 0.7, width = 0.12, y = -0.9): void {
    const r = this.rings.find(v => !v.active) ?? this.rings.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b))
    r.active = true
    r.t = 0
    r.dur = this.reduced ? dur * 1.3 : dur
    r.max = radius
    r.mat.uniforms.uColor.value.setHex(color)
    r.mat.uniforms.uWidth.value = width
    r.mat.uniforms.uT.value = 0
    r.mesh.position.set(x, y, z)
    r.mesh.scale.setScalar(radius)
    r.mesh.visible = true
  }

  flash(x: number, y: number, z: number, color: number, size: number, dur = 0.35): void {
    if (this.reduced) size *= 0.6
    const f = this.flashes.find(v => !v.active) ?? this.flashes[0]
    f.active = true
    f.t = 0
    f.dur = dur
    f.size = size
    ;(f.sprite.material as THREE.SpriteMaterial).color.setHex(color)
    f.sprite.position.set(x, y, z)
    f.sprite.visible = true
  }

  update(dt: number): void {
    for (const r of this.rings) {
      if (!r.active) continue
      r.t += dt
      const k = r.t / r.dur
      if (k >= 1) {
        r.active = false
        r.mesh.visible = false
        continue
      }
      r.mat.uniforms.uT.value = 1 - Math.pow(1 - k, 2.2)
    }
    for (const f of this.flashes) {
      if (!f.active) continue
      f.t += dt
      const k = f.t / f.dur
      if (k >= 1) {
        f.active = false
        f.sprite.visible = false
        continue
      }
      f.sprite.scale.setScalar(f.size * (0.6 + k * 0.8))
      ;(f.sprite.material as THREE.SpriteMaterial).opacity = 0.55 * (1 - k) * (1 - k)
    }
  }

  clear(): void {
    for (const r of this.rings) {
      r.active = false
      r.mesh.visible = false
    }
    for (const f of this.flashes) {
      f.active = false
      f.sprite.visible = false
    }
  }

  // ─── recipes ──────────────────────────────────────────────────────────────
  /** A mote eaten. Bigger combos throw more sparkle. */
  bite(x: number, z: number, color: number, combo: number, mine: boolean): void {
    const extra = Math.min(6, Math.floor(combo / 8))
    this.p.emit({ x, z, y: 0.2, color: this.c.setHex(color), count: (mine ? 3 : 1) + extra, speed: [2, 5], size: [0.6, 1.1], life: [0.25, 0.45], tile: SPARKS, grow: 0.2, drag: 5 })
    if (mine && combo >= 10) this.p.emit({ x, z, y: 0.6, color: 0xffffff, count: 1 + (extra >> 1), speed: [1, 3], size: [0.8, 1.4], life: [0.35, 0.6], tile: STARS, up: 2, spin: 4 })
  }

  nova(x: number, z: number): void {
    this.flash(x, 0.5, z, 0xffffff, 5, 0.3)
    this.ring(x, z, 0xbfe8ff, 6, 0.55, 0.16)
    for (const hue of [0xff6ad5, 0x6ad5ff, 0xfff06a, 0x7dffb0]) {
      this.p.emit({ x, z, y: 0.5, color: hue, count: 7, speed: [5, 11], size: [0.8, 1.6], life: [0.5, 0.9], tile: STARS, up: 3, spin: 5, drag: 3 })
    }
  }

  shard(x: number, z: number): void {
    this.p.emit({ x, z, y: 0.6, color: 0xffd54f, count: 12, speed: [3, 8], size: [0.7, 1.3], life: [0.45, 0.8], tile: STARS, up: 4, spin: 4 })
    this.ring(x, z, 0xffd54f, 3.5, 0.45, 0.2)
  }

  pickup(x: number, z: number, kind: PickupId): void {
    const col = PICKUP_COLORS[kind]
    this.flash(x, 1, z, col, 9, 0.4)
    this.ring(x, z, col, 7, 0.6, 0.14)
    this.p.emit({ x, z, y: 1, color: col, count: 22, speed: [6, 13], size: [0.8, 1.6], life: [0.5, 0.9], tile: MAGIC, up: 3, spin: 3 })
    this.p.emit({ x, z, y: 1, color: 0xffffff, count: 8, speed: [4, 8], size: [0.6, 1], life: [0.4, 0.6], tile: SPARKS })
  }

  /** A celestial body swallowed whole: lensing flash, double shockwave, spiral of debris. */
  swallow(x: number, z: number, kind: CelestialId, radius: number): void {
    const col = CELESTIALS[kind].color
    this.flash(x, 0.6, z, col, 14 + radius * 2, 0.5)
    this.flash(x, 0.6, z, 0xffffff, 4.5, 0.22)
    this.ring(x, z, col, 10 + radius * 2, 0.8, 0.1)
    this.ring(x, z, 0xffffff, 5 + radius, 0.5, 0.2)
    this.p.emit({ x, z, y: 0.5, color: col, count: 46, speed: [8, 18], size: [1, 2.2], life: [0.7, 1.2], tile: [...SPARKS, ...STARS], up: 2, spin: 4, drag: 2.5 })
    this.p.emit({ x, z, y: 0.5, color: 0xffffff, count: 14, speed: [4, 9], size: [0.8, 1.3], life: [0.5, 0.8], tile: TILE.flare, spin: 1 })
    this.p.emitSoft({ x, z, y: 0.3, color: this.c.setHex(col).multiplyScalar(0.6), count: 8, speed: [2, 5], size: [4, 7], life: [0.9, 1.4], tile: SMOKE, grow: 2.2, alpha: 0.45, drag: 2 })
  }

  tooSmall(x: number, z: number): void {
    this.p.emit({ x, z, y: 0.5, color: 0xff4d6d, count: 8, speed: [3, 6], size: [0.6, 1], life: [0.3, 0.5], tile: SPARKS })
    this.ring(x, z, 0xff4d6d, 4, 0.35, 0.2)
  }

  shieldBreak(x: number, z: number): void {
    this.flash(x, 0.8, z, 0x7fd0ff, 12, 0.4)
    this.ring(x, z, 0x5cc8ff, 11, 0.6, 0.12)
    this.p.emit({ x, z, y: 0.8, color: 0x8fd8ff, count: 36, speed: [8, 18], size: [0.9, 1.8], life: [0.5, 0.9], tile: [TILE.magic, TILE.spark, TILE.flare], up: 3, spin: 6, gravity: 6 })
  }

  shieldUp(x: number, z: number): void {
    this.ring(x, z, 0x5cc8ff, 5, 0.5, 0.2)
  }

  /** Death: body bursts into its colours; long worms go supernova. */
  death(xs: number[], zs: number[], colors: number[], radius: number, big: boolean): void {
    const len = xs.length
    const step = Math.max(1, Math.floor(len / 40))
    for (let i = 0; i < len; i += step) {
      this.p.emit({ x: xs[i], z: zs[i], y: 0.3, color: colors[(i / step) % colors.length | 0], count: 3, speed: [3, 8], size: [radius * 0.8, radius * 1.6], life: [0.5, 1], tile: SPARKS, up: 2 })
    }
    const hx = xs[0]
    const hz = zs[0]
    this.p.emitSoft({ x: hx, z: hz, y: 0.2, color: 0x2a2040, count: 6, speed: [1, 3], size: [4, 6], life: [1, 1.6], tile: SMOKE, grow: 2, alpha: 0.5 })
    if (!big) {
      this.flash(hx, 0.6, hz, colors[0], 10, 0.4)
      this.ring(hx, hz, colors[0], 9, 0.6)
      return
    }
    this.supernova(hx, hz, colors)
  }

  supernova(x: number, z: number, colors: number[]): void {
    this.flash(x, 1, z, 0xffffff, 26, 0.5)
    this.flash(x, 1, z, colors[0], 42, 1.0)
    this.ring(x, z, 0xffffff, 26, 0.9, 0.08)
    this.ring(x, z, colors[0], 40, 1.4, 0.06)
    this.ring(x, z, colors[colors.length - 1], 18, 1.1, 0.16)
    for (const c of colors) this.p.emit({ x, z, y: 1, color: c, count: 40, speed: [12, 30], size: [1.2, 2.6], life: [0.9, 1.6], tile: [...STARS, ...SPARKS], up: 4, spin: 5, drag: 1.6 })
    this.p.emit({ x, z, y: 1, color: 0xffffff, count: 24, speed: [6, 14], size: [1.4, 2.4], life: [0.6, 1], tile: TILE.flare })
    this.p.emitSoft({ x, z, y: 0.2, color: this.c.setHex(colors[0]).multiplyScalar(0.5), count: 14, speed: [4, 10], size: [6, 10], life: [1.4, 2.2], tile: SMOKE, grow: 2.4, alpha: 0.4 })
  }

  /** Bite: a gold snap at the cut, and the severed tail bursting into its colours as food. */
  sever(x: number, z: number, xs: number[], zs: number[], colors: number[], radius: number, mine: boolean): void {
    const step = Math.max(1, Math.floor(xs.length / 24))
    for (let i = 0; i < xs.length; i += step) {
      this.p.emit({ x: xs[i], z: zs[i], y: 0.3, color: colors[(i / step) % colors.length | 0], count: 2, speed: [2, 6], size: [radius * 0.7, radius * 1.3], life: [0.4, 0.8], tile: SPARKS, up: 2 })
    }
    this.flash(x, 0.6, z, 0xffc53d, mine ? 9 : 6, 0.3)
    this.ring(x, z, 0xffc53d, mine ? 7 : 5, 0.45, 0.16)
    this.p.emit({ x, z, y: 0.8, color: 0xffe7a0, count: mine ? 18 : 10, speed: [6, 14], size: [0.7, 1.3], life: [0.3, 0.6], tile: SPARKS, spin: 4 })
  }

  kill(x: number, z: number): void {
    this.p.emit({ x, z, y: 1.2, color: 0xffe07a, count: 16, speed: [4, 10], size: [1, 1.8], life: [0.6, 1], tile: STARS, up: 6, gravity: 4 })
  }

  crown(x: number, z: number): void {
    this.flash(x, 3, z, 0xffd54f, 12, 0.5)
    this.ring(x, z, 0xffd54f, 12, 0.8, 0.1)
    this.p.emit({ x, z, y: 3, color: 0xffd54f, count: 30, speed: [6, 14], size: [1, 1.8], life: [0.7, 1.1], tile: STARS, up: 5, spin: 4 })
  }

  gateZap(x: number, z: number): void {
    this.p.emit({ x, z, y: 0.4, color: 0x9ff4ff, count: 2, speed: [3, 8], size: [0.5, 1.1], life: [0.15, 0.3], tile: SPARKS, up: 3 })
  }

  /** Boost afterimage from the tail; golden when the boost is free. */
  boostTrail(x: number, z: number, heading: number, color: number, radius: number, free: boolean): void {
    this.p.emit({ x, z, y: 0, color: free ? 0xffd84f : color, count: 1, speed: [1, 3], size: [radius * 1.6, radius * 2.4], life: [0.3, 0.5], tile: TILE.glow, dir: heading + Math.PI, cone: 0.5, alpha: 0.55, grow: 0.3 })
    if (Math.random() < 0.6) this.p.emit({ x, z, y: 0.3, color: free ? 0xfff1b0 : 0xffffff, count: 1, speed: [4, 8], size: [0.5, 0.9], life: [0.25, 0.4], tile: SPARKS, dir: heading + Math.PI, cone: 0.7 })
  }

  /** Motes streaming toward a magnetised head. */
  magnetStream(x: number, z: number, range: number): void {
    const a = Math.random() * Math.PI * 2
    const r = range * (0.8 + Math.random() * 0.2)
    const life = 0.45
    this.p.emit({ x: x + Math.cos(a) * r, z: z + Math.sin(a) * r, y: 0.2, color: 0xff4fd8, count: 1, speed: r / life * 0.9, size: [0.5, 0.9], life, tile: TILE.glow, dir: a + Math.PI, cone: 0.05, drag: 0 })
  }

  wellSwirl(x: number, z: number, r: number): void {
    const a = Math.random() * Math.PI * 2
    const d = r * (0.6 + Math.random() * 0.4)
    this.p.emit({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, y: -0.6, color: 0x8a5cff, count: 1, speed: [3, 5], size: [0.5, 1], life: [0.8, 1.2], tile: TILE.glow, dir: a + Math.PI * 0.62, cone: 0.1, drag: 0.4, alpha: 0.7 })
  }
}
