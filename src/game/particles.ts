import * as THREE from 'three'

/**
 * Pooled GPU point-sprite particles sampling the Kenney particle atlas (4x4 cells).
 * Tiles: 0 soft circle, 1 light, 2 flare, 3-5 sparks, 6-8 stars, 9-10 magic, 11-12 smoke,
 * 13 twirl, 14 trace, 15 flame. Until the atlas arrives a procedural soft dot is used.
 */
export const TILE = {
  glow: 0, light: 1, flare: 2, spark: 3, sparkB: 4, sparkC: 5, star: 6, starB: 7, starC: 8,
  magic: 9, magicB: 10, smoke: 11, smokeB: 12, twirl: 13, trace: 14, flame: 15,
} as const

export type Emit = {
  x: number
  y?: number
  z: number
  color: THREE.ColorRepresentation | THREE.Color
  count?: number
  /** Initial speed range [min,max]. */
  speed?: number | [number, number]
  size?: number | [number, number]
  life?: number | [number, number]
  tile?: number | readonly number[]
  /** Upward velocity added to each particle. */
  up?: number
  /** Direction (radians on the ground plane) and cone half-angle; omit for radial. */
  dir?: number
  cone?: number
  drag?: number
  gravity?: number
  /** Size multiplier at end of life (e.g. 2.5 for expanding smoke, 0 for shrinking sparks). */
  grow?: number
  spin?: number
  /** Initial positional jitter radius. */
  spread?: number
  alpha?: number
}

const rand = (v: number | [number, number]) => (typeof v === 'number' ? v : v[0] + Math.random() * (v[1] - v[0]))

class Pool {
  readonly points: THREE.Points
  readonly max: number
  private pos: Float32Array
  private col: Float32Array
  private sz: Float32Array
  private alpha: Float32Array
  private tile: Float32Array
  private rot: Float32Array
  private vel: Float32Array
  private life: Float32Array
  private age: Float32Array
  private base: Float32Array
  private grow: Float32Array
  private spin: Float32Array
  private drag: Float32Array
  private grav: Float32Array
  private a0: Float32Array
  private cursor = 0
  active = 0
  readonly material: THREE.ShaderMaterial

  constructor(max: number, blending: THREE.Blending, map: THREE.Texture) {
    this.max = max
    this.pos = new Float32Array(max * 3)
    this.col = new Float32Array(max * 3)
    this.sz = new Float32Array(max)
    this.alpha = new Float32Array(max)
    this.tile = new Float32Array(max)
    this.rot = new Float32Array(max)
    this.vel = new Float32Array(max * 3)
    this.life = new Float32Array(max).fill(1)
    this.age = new Float32Array(max).fill(1e9)
    this.base = new Float32Array(max)
    this.grow = new Float32Array(max)
    this.spin = new Float32Array(max)
    this.drag = new Float32Array(max)
    this.grav = new Float32Array(max)
    this.a0 = new Float32Array(max)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('size', new THREE.BufferAttribute(this.sz, 1).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('tile', new THREE.BufferAttribute(this.tile, 1).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('rot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage))
    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map }, uScale: { value: window.innerHeight / 2 }, uAtlas: { value: 0 }, uGain: { value: blending === THREE.AdditiveBlending ? 0.72 : 1 } },
      vertexShader: `attribute float size; attribute float alpha; attribute float tile; attribute float rot; attribute vec3 color;
        uniform float uScale; varying vec3 vC; varying float vA; varying float vT; varying float vR;
        void main(){ vC = color; vA = alpha; vT = tile; vR = rot;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(size * uScale / -mv.z, 0.0, 256.0);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uMap; uniform float uAtlas; uniform float uGain; varying vec3 vC; varying float vA; varying float vT; varying float vR;
        void main(){
          vec2 p = gl_PointCoord - 0.5; float c = cos(vR), s = sin(vR);
          p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
          if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) discard;
          float m;
          if (uAtlas > 0.5) {
            vec2 cell = vec2(mod(vT, 4.0), floor(vT / 4.0));
            vec2 uv = vec2((cell.x + p.x) / 4.0, 1.0 - (cell.y + p.y) / 4.0);
            vec4 t = texture2D(uMap, uv); m = t.a * max(t.r, max(t.g, t.b));
          } else { float r = length(p - 0.5) * 2.0; m = pow(max(0.0, 1.0 - r), 2.0); }
          if (m * vA < 0.004) discard;
          gl_FragColor = vec4(vC * uGain, m * vA);
        }`,
      transparent: true, depthWrite: false, blending,
    })
    this.points = new THREE.Points(g, this.material)
    this.points.frustumCulled = false
    this.points.renderOrder = 5
  }

  spawn(e: Emit, c: THREE.Color, scale: number): void {
    const n = Math.max(1, Math.round((e.count ?? 8) * scale))
    const tiles = e.tile ?? TILE.glow
    for (let k = 0; k < n; k++) {
      const i = this.cursor
      this.cursor = (this.cursor + 1) % this.max
      const sp = rand(e.speed ?? 6)
      const a = e.dir !== undefined ? e.dir + (Math.random() * 2 - 1) * (e.cone ?? 0.4) : Math.random() * Math.PI * 2
      const el = (Math.random() - 0.3) * 0.6
      const j = e.spread ?? 0
      this.pos[i * 3] = e.x + (Math.random() - 0.5) * j * 2
      this.pos[i * 3 + 1] = (e.y ?? 0.4) + (Math.random() - 0.5) * j
      this.pos[i * 3 + 2] = e.z + (Math.random() - 0.5) * j * 2
      this.vel[i * 3] = Math.cos(a) * sp
      this.vel[i * 3 + 1] = el * sp * 0.5 + (e.up ?? 0) * (0.5 + Math.random())
      this.vel[i * 3 + 2] = Math.sin(a) * sp
      this.col[i * 3] = c.r
      this.col[i * 3 + 1] = c.g
      this.col[i * 3 + 2] = c.b
      this.base[i] = rand(e.size ?? 1)
      this.life[i] = Math.max(0.05, rand(e.life ?? 0.7))
      this.age[i] = 0
      this.grow[i] = e.grow ?? 0.2
      this.spin[i] = (Math.random() - 0.5) * 2 * (e.spin ?? 2)
      this.rot[i] = Math.random() * 6.283
      this.drag[i] = e.drag ?? 2.2
      this.grav[i] = e.gravity ?? 0
      this.a0[i] = e.alpha ?? 1
      this.tile[i] = typeof tiles === 'number' ? tiles : tiles[(Math.random() * tiles.length) | 0]
    }
  }

  update(dt: number): void {
    let live = 0
    for (let i = 0; i < this.max; i++) {
      const L = this.life[i]
      if (this.age[i] >= L) {
        if (this.sz[i] !== 0) {
          this.alpha[i] = 0
          this.sz[i] = 0
        }
        continue
      }
      const age = (this.age[i] += dt)
      live++
      const t = Math.min(1, age / L)
      const d = Math.exp(-this.drag[i] * dt)
      this.vel[i * 3] *= d
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt
      this.vel[i * 3 + 2] *= d
      this.pos[i * 3] += this.vel[i * 3] * dt
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt
      this.rot[i] += this.spin[i] * dt
      const fadeIn = Math.min(1, t * 8)
      this.alpha[i] = this.a0[i] * fadeIn * (1 - t) * (1 - t * 0.3)
      this.sz[i] = this.base[i] * (1 + (this.grow[i] - 1) * t)
    }
    this.active = live
    const g = this.points.geometry
    for (const k of ['position', 'color', 'size', 'alpha', 'tile', 'rot']) (g.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true
  }

  clear(): void {
    this.age.fill(1e9)
    this.alpha.fill(0)
    this.sz.fill(0)
  }
}

export class Particles {
  readonly group = new THREE.Group()
  /** Legacy handle kept for callers that add the particle layer to a scene. */
  readonly points: THREE.Group = this.group
  /** 1 = full density; reduced-motion lowers it. */
  scale = 1
  private add: Pool
  private norm: Pool
  private tmp = new THREE.Color()

  constructor(max = 3600) {
    const c = document.createElement('canvas')
    c.width = c.height = 4
    const map = new THREE.CanvasTexture(c)
    this.add = new Pool(max, THREE.AdditiveBlending, map)
    this.norm = new Pool(Math.floor(max / 4), THREE.NormalBlending, map)
    this.group.add(this.norm.points, this.add.points)
  }

  /** Swap in the real atlas once stage 1 has streamed in. */
  setAtlas(image: HTMLImageElement): void {
    const tex = new THREE.Texture(image)
    tex.colorSpace = THREE.NoColorSpace
    tex.generateMipmaps = true
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.needsUpdate = true
    for (const p of [this.add, this.norm]) {
      p.material.uniforms.uMap.value = tex
      p.material.uniforms.uAtlas.value = 1
    }
  }

  /** Additive (glowing) particles. */
  emit(e: Emit): void {
    const c = e.color instanceof THREE.Color ? e.color : this.tmp.set(e.color)
    this.add.spawn(e, c, this.scale)
  }
  /** Normal-blended particles (smoke, dust, debris). */
  emitSoft(e: Emit): void {
    const c = e.color instanceof THREE.Color ? e.color : this.tmp.set(e.color)
    this.norm.spawn(e, c, this.scale)
  }

  /** Fraction of the additive pool in use (0..1), used as a render-heat signal. */
  get load(): number {
    return this.add.active / this.add.max
  }

  update(dt: number): void {
    const s = window.innerHeight / 2
    this.add.material.uniforms.uScale.value = s
    this.norm.material.uniforms.uScale.value = s
    this.add.update(dt)
    this.norm.update(dt)
  }

  clear(): void {
    this.add.clear()
    this.norm.clear()
  }
}
