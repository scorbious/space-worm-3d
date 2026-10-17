/**
 * Renders a `Sim` with three.js. Read-only: it never mutates simulation state. Large counts
 * (body segments, motes, stardust) use instanced meshes; everything else is pooled. Effect
 * recipes live in `Fx`; streamed textures upgrade materials in place as they arrive.
 */
import * as THREE from 'three'
import stageBeaconUrl from '../../assets/models/stage-beacon.glb?url'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { assets } from '../engine/assets'
import { CONFIG } from './config'
import { CELESTIALS, TEAM_COLORS, type CelestialId, type Skin } from './content'
import { Fx } from './fx'
import { appearanceSkin } from './appearance'
import { HEAD_FEATURES, headGeometry } from './headShapes'
import { bodyArmorGeometry, headArmorGeometry } from './headArmor'
import { ARMOR_PROFILES, armorTier } from './growthVisuals'
import { ArenaEnvironment } from './environments'
import { SPECIAL_COLORS } from './specials'
import { disposeSpecial, makeSpecial } from './specialVisuals'
import { THREAT_COLORS } from './glyphs'
import { Particles } from './particles'
import { canConsume } from './rules'
import type { Sim, Worm } from './sim'
import { ThreatMarks, type ThreatMode } from './threatMarks'
import type { RivalThreat, ThreatReport } from './threats'
import {
  animateCelestial, asteroidGeometry, crystalMaterial, glowQuadMaterial, glowTexture, iconSprite, jellyMaterial,
  labelTexture, makeCelestial, makeLabel, makePickup, metalMaterial, rockMaterial, shieldMaterial, type CelestialVisual,
} from './visuals'

type HeadView = {
  group: THREE.Group
  head: THREE.Mesh
  headMat: THREE.ShaderMaterial
  armor: THREE.Group
  armorLayers: THREE.Mesh[]
  armorMat: THREE.MeshStandardMaterial
  trimMat: THREE.MeshStandardMaterial
  eyes: THREE.Mesh[]
  pupils: THREE.Mesh[]
  mouth: THREE.Mesh
  halo: THREE.Mesh
  status: THREE.Mesh
  shield: THREE.Mesh
  shieldMat: THREE.ShaderMaterial
  magnet: THREE.Mesh
  boostGlow: THREE.Sprite
  label: THREE.Sprite
  labelKey: string
  crown: THREE.Sprite
  skin: string
  blinkAt: number
}
type FreeCelestialView = { visual: CelestialVisual; ring: THREE.Mesh; label: THREE.Sprite; edible: boolean | null }
type GateView = { mat: THREE.ShaderMaterial; tips: THREE.MeshBasicMaterial[]; ax: number; az: number; bx: number; bz: number }

const MAX_SEGMENTS = 9000
const MAX_ORBS = 1800
const MAX_SHARDS = 80
const MAX_BODY_ARMOR = Math.ceil(MAX_SEGMENTS / 3)
const tmpColor = new THREE.Color()
const armorColor = new THREE.Color()
const trimColor = new THREE.Color()
const GEM_TILT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0.4).normalize(), 0.75)
const tmpQuat = new THREE.Quaternion()
const tmpMat = new THREE.Matrix4()
const tmpPos = new THREE.Vector3()
const tmpScale = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)
const NOVA_HUES = [0xff7ad9, 0x7ad9ff, 0xfff27a, 0x8dffb8, 0xc6a0ff]

export class View {
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly environment = new ArenaEnvironment()
  /** Threat Language markers; `threats` is set by the game each frame before `update`. */
  readonly marks = new ThreatMarks()
  threats: ThreatReport | null = null
  threatMode: ThreatMode = 'full'
  readonly particles = new Particles()
  readonly fx = new Fx(this.particles)
  reducedMotion = false
  /** Worms drawn last frame; feeds the render-heat signal. */
  visibleWorms = 0
  private sim: Sim | null = null
  private hazards = new THREE.Group()
  private body: THREE.InstancedMesh
  private bodyArmor: THREE.InstancedMesh
  private orbs: THREE.InstancedMesh
  private orbGlow: THREE.InstancedMesh
  private shards: THREE.InstancedMesh
  private heads = new Map<number, HeadView>()
  private celSegPool = new Map<CelestialId, CelestialVisual[]>()
  private freeCel = new Map<number, FreeCelestialView>()
  private pickups = new Map<number, THREE.Group>()
  private specials = new Map<number, THREE.Group>()
  private gates: GateView[] = []
  private wellMats: THREE.ShaderMaterial[] = []
  private asteroidMeshes: THREE.Mesh[] = []
  private wallMat!: THREE.ShaderMaterial
  private floorMat!: THREE.ShaderMaterial
  private arenaFloor!: THREE.Mesh
  private arenaWall!: THREE.Mesh
  private arenaRim!: THREE.Mesh
  private stageBeacon: THREE.Group | null = null
  private magnetGeo = new THREE.RingGeometry(0.975, 1, 72)
  private bulges = new Map<number, number[]>()
  private time = 0
  private stage = 0

  constructor() {
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, window.innerWidth / window.innerHeight, 0.5, 3000)
    this.scene.background = new THREE.Color(0x04030c)
    this.scene.add(new THREE.HemisphereLight(0xa9bcff, 0x2a1440, 0.9))
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.1)
    sun.position.set(40, 90, 30)
    this.scene.add(sun)
    const rim = new THREE.DirectionalLight(0x8a6bff, 0.8)
    rim.position.set(-60, 30, -50)
    this.scene.add(rim)
    this.buildBackground()
    this.scene.add(this.hazards)
    this.scene.add(this.marks.group)
    this.scene.add(this.environment.group)

    this.body = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 18, 12), jellyMaterial(true), MAX_SEGMENTS)
    this.body.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.body.setColorAt(0, new THREE.Color(1, 1, 1))
    this.body.frustumCulled = false
    this.body.count = 0
    this.scene.add(this.body)

    this.bodyArmor = new THREE.InstancedMesh(bodyArmorGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.34, metalness: 0.65, side: THREE.DoubleSide }), MAX_BODY_ARMOR)
    this.bodyArmor.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.bodyArmor.setColorAt(0, new THREE.Color(1, 1, 1))
    this.bodyArmor.frustumCulled = false
    this.bodyArmor.count = 0
    this.scene.add(this.bodyArmor)

    this.orbs = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), crystalMaterial(), MAX_ORBS)
    this.orbs.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.orbs.setColorAt(0, new THREE.Color(1, 1, 1))
    this.orbs.frustumCulled = false
    this.orbs.count = 0
    this.scene.add(this.orbs)
    this.orbGlow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), glowQuadMaterial(), MAX_ORBS + MAX_SHARDS)
    this.orbGlow.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.orbGlow.setColorAt(0, new THREE.Color(1, 1, 1))
    this.orbGlow.frustumCulled = false
    this.orbGlow.count = 0
    this.orbGlow.renderOrder = 3
    this.scene.add(this.orbGlow)

    this.shards = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.75, 0), crystalMaterial(), MAX_SHARDS)
    this.shards.setColorAt(0, new THREE.Color(1, 1, 1))
    this.shards.frustumCulled = false
    this.shards.count = 0
    this.scene.add(this.shards)

    this.scene.add(this.particles.group, this.fx.group)
    this.loadStageBeacon()
    assets.when('fx/particles', v => {
      if (v instanceof HTMLImageElement) this.particles.setAtlas(v)
    })
  }

  private loadStageBeacon(): void {
    const loader = new GLTFLoader()
    loader.load(stageBeaconUrl, gltf => {
      this.stageBeacon = gltf.scene
      this.stageBeacon.scale.setScalar(4.2)
      this.stageBeacon.visible = false
      this.stageBeacon.traverse(object => {
        const mesh = object as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.castShadow = false
        mesh.receiveShadow = false
      })
      this.scene.add(this.stageBeacon)
    }, undefined, () => {
      // The beacon is optional; procedural stage visuals remain the fallback.
    })
  }

  // ─── static background ──────────────────────────────────────────────────
  private buildBackground(): void {
    const R = CONFIG.arena.radius
    // The environment owns the clean backdrop. Keep the arena's navigational hex lattice.
    this.floorMat = new THREE.ShaderMaterial({
      uniforms: { uR: { value: R }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uR; uniform float uTime; varying vec2 vP;
        float hex(vec2 p){ p = abs(p); return max(dot(p, normalize(vec2(1.0,1.732))), p.x); }
        void main(){
          vec2 p = vP / 9.0;
          vec2 a = mod(p, vec2(1.0,1.732)) - vec2(0.5,0.866);
          vec2 b = mod(p + vec2(0.5,0.866), vec2(1.0,1.732)) - vec2(0.5,0.866);
          vec2 g = dot(a,a) < dot(b,b) ? a : b;
          float edge = smoothstep(0.482, 0.5, hex(g));
          float d = length(vP) / uR;
          float pulse = 0.5 + 0.5 * sin(d * 18.0 - uTime * 0.8);
          vec3 base = mix(vec3(0.02,0.018,0.06), vec3(0.05,0.015,0.06), smoothstep(0.6,1.0,d));
          vec3 line = mix(vec3(0.2,0.24,0.55), vec3(0.6,0.16,0.42), smoothstep(0.75,1.0,d));
          float alpha = 0.4 + edge * 0.06 + smoothstep(0.85, 1.0, d) * 0.3;
          gl_FragColor = vec4(base + line * edge * (0.12 + 0.06 * pulse + 0.14 * d), alpha);
        }`,
      transparent: true, depthWrite: false,
    })
    this.arenaFloor = new THREE.Mesh(new THREE.CircleGeometry(R + 1, 160), this.floorMat)
    this.arenaFloor.rotation.x = -Math.PI / 2
    this.arenaFloor.position.y = -1.6
    this.arenaFloor.renderOrder = -1
    this.scene.add(this.arenaFloor)

    this.wallMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        void main(){ float stripe = 0.55 + 0.45 * sin(vUv.x * 900.0 + vUv.y * 6.0 - uTime * 3.0);
          float fade = pow(1.0 - vUv.y, 2.2);
          vec3 c = mix(vec3(1.0,0.2,0.55), vec3(1.0,0.55,0.3), vUv.y);
          gl_FragColor = vec4(c * 0.95, fade * (0.4 + 0.25 * stripe)); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    })
    this.arenaWall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 9, 200, 1, true), this.wallMat)
    this.arenaWall.position.y = 2.9
    this.scene.add(this.arenaWall)
    this.arenaRim = new THREE.Mesh(new THREE.RingGeometry(R - 0.6, R + 0.4, 200), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3f8a).multiplyScalar(1.05), side: THREE.DoubleSide }))
    this.arenaRim.rotation.x = -Math.PI / 2
    this.arenaRim.position.y = -1.5
    this.scene.add(this.arenaRim)
  }

  private applyStageVisuals(stage: number, radius: number): void {
    if (this.stage === stage && Math.abs(this.floorMat.uniforms.uR.value - radius) < 0.01) return
    this.stage = stage
    const backgrounds = [0x04030c, 0x061326, 0x180a36, 0x350b2b, 0x0b2c3b]
    const rims = [0xff3f8a, 0x45c7ff, 0xc26bff, 0xff4b9b, 0x63ffe0]
    this.scene.background = new THREE.Color(backgrounds[Math.min(backgrounds.length - 1, stage - 1)] ?? backgrounds[0])
    const scale = radius / CONFIG.arena.radius
    this.arenaFloor.scale.setScalar(scale)
    this.arenaWall.scale.set(scale, 1, scale)
    this.arenaRim.scale.setScalar(scale)
    this.floorMat.uniforms.uR.value = radius
    ;(this.arenaRim.material as THREE.MeshBasicMaterial).color.setHex(rims[Math.min(rims.length - 1, stage - 1)] ?? rims[0])
  }

  // ─── per-arena setup ────────────────────────────────────────────────────
  bind(sim: Sim): void {
    this.sim = sim
    this.environment.reset()
    this.applyStageVisuals(sim.stage, sim.radius)
    for (const child of [...this.hazards.children]) {
      this.hazards.remove(child)
      child.traverse(o => {
        const m = o as THREE.Mesh
        if (m.material && !Array.isArray(m.material) && (m.material as THREE.Material).userData.shared !== true) (m.material as THREE.Material).dispose()
      })
    }
    for (const h of this.heads.values()) this.disposeHead(h)
    this.heads.clear()
    for (const v of this.freeCel.values()) this.scene.remove(v.visual, v.ring, v.label)
    this.freeCel.clear()
    for (const p of this.pickups.values()) this.scene.remove(p)
    this.pickups.clear()
    for (const s of this.specials.values()) { this.scene.remove(s); disposeSpecial(s) }
    this.specials.clear()
    for (const pool of this.celSegPool.values()) for (const v of pool) v.visible = false
    this.particles.clear()
    this.fx.clear()
    this.bulges.clear()
    this.gates = []
    this.wellMats = []
    this.marks.bind(sim)
    this.threats = null
    this.asteroidMeshes = []

    const rock = rockMaterial()
    for (const a of sim.asteroids) {
      const m = new THREE.Mesh(asteroidGeometry(a.seed), rock)
      m.position.set(a.x, 0, a.z)
      m.scale.set(a.r * 1.1, a.r * 0.92, a.r * 1.1)
      m.rotation.set(a.seed, a.seed * 2, a.seed * 3)
      m.userData.spin = 0.1 + (a.seed % 1) * 0.25
      this.asteroidMeshes.push(m)
      this.hazards.add(m)
    }

    const metal = metalMaterial()
    for (const g of sim.gates) {
      const len = Math.hypot(g.bx - g.ax, g.bz - g.az)
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uState: { value: 0 }, uLen: { value: len } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform float uTime; uniform float uState; uniform float uLen; varying vec2 vUv;
          void main(){
            float y = abs(vUv.y - 0.5) * 2.0;
            float x = vUv.x * uLen;
            float n = sin(x * 3.1 + uTime * 23.0) * 0.5 + sin(x * 7.7 - uTime * 31.0) * 0.3 + sin(x * 1.3 + uTime * 9.0) * 0.2;
            float n2 = sin(x * 5.3 - uTime * 17.0) * 0.5 + sin(x * 11.0 + uTime * 27.0) * 0.5;
            float core = smoothstep(0.3 + n * 0.1, 0.0, abs(y - n * 0.2));
            float arc2 = smoothstep(0.12, 0.0, abs(y - n2 * 0.35)) * 0.6;
            float halo = pow(1.0 - y, 2.2);
            vec3 onC = vec3(1.0, 0.24, 0.36);
            vec3 warnC = vec3(1.0, 0.6, 0.2);
            vec3 offC = vec3(0.42, 0.48, 0.64);
            float dash = step(0.5, fract(x * 0.5 - uTime * 0.5));
            vec3 col; float a;
            if (uState > 1.5) { col = mix(onC * 1.25, vec3(1.0, 0.92, 0.95), pow(core, 3.0) * 0.8); a = core + arc2 * 0.8 + halo * 0.3; }
            else if (uState > 0.5) { float f = step(0.5, fract(uTime * 7.0)); col = warnC * 1.15; a = (core * 0.6 + halo * 0.25) * (0.35 + 0.65 * f); }
            else { col = offC; a = smoothstep(0.25, 0.0, y) * 0.26 * dash; }
            gl_FragColor = vec4(col, a);
          }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      })
      const beam = new THREE.Mesh(new THREE.PlaneGeometry(len, 2.6), mat)
      beam.rotation.x = -Math.PI / 2
      beam.rotation.z = -Math.atan2(g.bz - g.az, g.bx - g.ax)
      beam.position.set((g.ax + g.bx) / 2, 0.2, (g.az + g.bz) / 2)
      this.hazards.add(beam)
      const tips: THREE.MeshBasicMaterial[] = []
      for (const [x, z] of [[g.ax, g.az], [g.bx, g.bz]]) {
        const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.0, 3.6, 12), metal)
        pylon.position.set(x, 0, z)
        const base = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.5, 0.5, 16), metal)
        base.position.set(x, -1.5, z)
        const tipMat = new THREE.MeshBasicMaterial({ color: 0x7ab8ff })
        const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.75, 0), tipMat)
        tip.position.set(x, 2.4, z)
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.09, 8, 24), tipMat)
        band.rotation.x = Math.PI / 2
        band.position.set(x, 1.1, z)
        tips.push(tipMat)
        this.hazards.add(pylon, base, tip, band)
      }
      this.gates.push({ mat, tips, ax: g.ax, az: g.az, bx: g.bx, bz: g.bz })
    }

    for (const w of sim.wells) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: 'varying vec2 vP; void main(){ vP = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform float uTime; varying vec2 vP;
          void main(){ float r = length(vP); if (r > 1.0) discard;
            float a = atan(vP.y, vP.x);
            float spiral = sin(a * 3.0 + log(r + 0.02) * 9.0 + uTime * 1.6) * 0.5 + 0.5;
            float spiral2 = sin(a * 5.0 + log(r + 0.02) * 14.0 + uTime * 2.4) * 0.5 + 0.5;
            float edge = smoothstep(1.0, 0.92, r);
            float rimLine = smoothstep(0.9, 0.97, r) * edge;
            float disk = smoothstep(0.18, 0.3, r) * (1.0 - smoothstep(0.3, 0.55, r));
            vec3 c = mix(vec3(0.36, 0.16, 0.8), vec3(0.72, 0.5, 1.0), spiral * (1.0 - r));
            float alpha = (spiral * 0.16 * (1.0 - r * 0.6) + spiral2 * 0.06 + rimLine * 0.35 + disk * 0.22) * edge;
            float core = smoothstep(0.2, 0.0, r);
            vec3 hot = vec3(1.0, 0.75, 1.0) * disk * 0.6;
            gl_FragColor = vec4(mix(c * 0.9 + hot, vec3(0.0, 0.0, 0.02), core), alpha + core * 0.9);
          }`,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      })
      const disc = new THREE.Mesh(new THREE.PlaneGeometry(w.r * 2, w.r * 2), mat)
      disc.rotation.x = -Math.PI / 2
      disc.position.set(w.x, -1.3, w.z)
      this.hazards.add(disc)
      this.wellMats.push(mat)
    }
  }

  /** Start a swallow bulge travelling from head to tail. */
  bulge(wormId: number): void {
    const list = this.bulges.get(wormId) ?? []
    if (list.length < 4) list.push(this.time)
    this.bulges.set(wormId, list)
  }

  /** 0..1 estimate of how busy the frame is (particles and worms on screen). */
  get heat(): number {
    return Math.min(1, this.particles.load * 1.4 + Math.max(0, this.visibleWorms - 6) / 12)
  }

  // ─── per-frame sync ─────────────────────────────────────────────────────
  update(dt: number, focusX: number, focusZ: number, viewRadius: number): void {
    const sim = this.sim
    if (!sim) return
    this.time += dt
    this.applyStageVisuals(sim.stage, sim.radius)
    if (this.stageBeacon) {
      this.stageBeacon.visible = sim.stage >= 2
      this.stageBeacon.rotation.y += dt * (this.reducedMotion ? 0.08 : 0.42)
      const a = sim.stage * 1.7
      const r = sim.radius * 0.42
      this.stageBeacon.position.set(Math.cos(a) * r, 1.2, Math.sin(a) * r)
      this.stageBeacon.scale.setScalar(3.2 + sim.stage * 0.45)
    }
    const t = this.time
    const calm = this.reducedMotion
    const background = this.environment.update(sim.environment, t, sim.radius, calm)
    ;(this.scene.background as THREE.Color).copy(background)
    this.fx.reduced = calm
    this.wallMat.uniforms.uTime.value = calm ? 0 : t
    this.floorMat.uniforms.uTime.value = calm ? 0 : t
    for (const m of this.wellMats) m.uniforms.uTime.value = calm ? t * 0.15 : t
    for (const m of this.asteroidMeshes) m.rotation.y += dt * (m.userData.spin as number) * (calm ? 0.2 : 1)

    const cull = (x: number, z: number, pad: number) => Math.abs(x - focusX) > viewRadius + pad || Math.abs(z - focusZ) > viewRadius + pad
    sim.gates.forEach((g, i) => {
      const s = sim.gateAt(g)
      const view = this.gates[i]
      view.mat.uniforms.uTime.value = calm ? Math.floor(t * 2) / 2 : t
      view.mat.uniforms.uState.value = s.phase === 'on' ? 2 : s.phase === 'warn' ? 1 : 0
      const c = s.phase === 'on' ? 0xff3b5c : s.phase === 'warn' ? 0xffb020 : 0x5a6a88
      for (const tip of view.tips) tip.color.setHex(c).multiplyScalar(s.phase === 'off' ? 1 : 2)
      if (s.phase === 'on' && !calm && Math.random() < 0.5) {
        const k = Math.random()
        const x = view.ax + (view.bx - view.ax) * k
        const z = view.az + (view.bz - view.az) * k
        if (!cull(x, z, 2)) this.fx.gateZap(x, z)
      }
    })
    if (!calm) for (const w of sim.wells) if (!cull(w.x, w.z, w.r) && Math.random() < 0.35) this.fx.wellSwirl(w.x, w.z, w.r)
    if (this.threats) this.marks.update(sim, this.threats, this.camera, t, calm, this.threatMode, viewRadius)
    else this.marks.clear()

    const player = sim.player
    const playerLen = player.alive ? player.xs.length : -1

    // Motes (+ glow halos) and stardust
    let n = 0
    let g = 0
    for (const o of sim.orbs) {
      if (!o.alive || n >= MAX_ORBS || cull(o.x, o.z, 2)) continue
      const pulse = calm ? 1 : 1 + 0.16 * Math.sin(t * 4 + o.phase)
      const s = o.r * pulse * (o.nova ? 1 : 0.95)
      // Tilted spin so the top-down camera sees differently lit facets instead of a flat diamond.
      tmpQuat.setFromAxisAngle(UP, (calm ? 0 : t * (o.nova ? 2.2 : 1.1)) + o.phase).multiply(GEM_TILT)
      const bob = o.nova && !calm ? Math.sin(t * 3 + o.phase) * 0.3 : 0
      tmpMat.compose(tmpPos.set(o.x, -0.2 + bob + (o.nova ? 0.6 : 0), o.z), tmpQuat, tmpScale.set(s, s * 1.25, s))
      this.orbs.setMatrixAt(n, tmpMat)
      if (o.nova) tmpColor.setHex(NOVA_HUES[Math.floor(t * 3 + o.phase) % NOVA_HUES.length]).multiplyScalar(1.1)
      else tmpColor.setHex(o.color).multiplyScalar(0.95)
      this.orbs.setColorAt(n, tmpColor)
      const gs = s * (o.nova ? 5 : 2.8)
      tmpMat.makeScale(gs, gs, gs).setPosition(o.x, -0.2 + bob + (o.nova ? 0.6 : 0), o.z)
      this.orbGlow.setMatrixAt(g, tmpMat)
      this.orbGlow.setColorAt(g, tmpColor.multiplyScalar(o.nova ? 0.38 : 0.2))
      g++
      n++
    }
    this.orbs.count = n
    this.orbs.instanceMatrix.needsUpdate = true
    if (this.orbs.instanceColor) this.orbs.instanceColor.needsUpdate = true

    n = 0
    for (const s of sim.shards) {
      if (!s.alive || n >= MAX_SHARDS || cull(s.x, s.z, 2)) continue
      tmpQuat.setFromAxisAngle(UP, (calm ? 0 : t * 2) + s.phase)
      const bob = calm ? 0 : Math.sin(t * 3 + s.phase) * 0.3
      tmpMat.compose(tmpPos.set(s.x, 0.4 + bob, s.z), tmpQuat, tmpScale.set(1, 1.4, 1))
      this.shards.setMatrixAt(n, tmpMat)
      this.shards.setColorAt(n, tmpColor.setHex(0xffd54f).multiplyScalar(1.05))
      tmpMat.makeScale(4.2, 4.2, 4.2).setPosition(s.x, 0.4 + bob, s.z)
      this.orbGlow.setMatrixAt(g, tmpMat)
      this.orbGlow.setColorAt(g, tmpColor.setHex(0xffc94f).multiplyScalar(0.8))
      g++
      n++
    }
    this.shards.count = n
    this.shards.instanceMatrix.needsUpdate = true
    if (this.shards.instanceColor) this.shards.instanceColor.needsUpdate = true
    this.orbGlow.count = g
    this.orbGlow.instanceMatrix.needsUpdate = true
    if (this.orbGlow.instanceColor) this.orbGlow.instanceColor.needsUpdate = true

    // Pickups
    const seenPickups = new Set<number>()
    for (const p of sim.pickups) {
      if (!p.alive) continue
      seenPickups.add(p.id)
      let v = this.pickups.get(p.id)
      if (!v) {
        v = makePickup(p.kind)
        this.pickups.set(p.id, v)
        this.scene.add(v)
      }
      v.visible = !cull(p.x, p.z, 6)
      v.position.set(p.x, 1 + (calm ? 0 : Math.sin(t * 2.2 + p.phase) * 0.35), p.z)
      const icon = v.getObjectByName('icon') as THREE.Sprite
      icon.material.rotation = calm ? 0 : Math.sin(t * 1.7 + p.phase) * 0.2
      const ring = v.getObjectByName('ring')!
      ring.scale.setScalar(calm ? 1 : 1 + 0.12 * Math.sin(t * 3 + p.phase))
    }
    for (const [id, v] of this.pickups) {
      if (!seenPickups.has(id)) {
        this.scene.remove(v)
        this.pickups.delete(id)
      }
    }

    // Rare drops and traps are distinct from normal pickups: gold vs red ground outlines.
    const seenSpecials = new Set<number>()
    for (const s of [...sim.surprises, ...sim.traps]) {
      if (!s.alive || s.expiresAt <= sim.time) continue
      seenSpecials.add(s.id)
      let v = this.specials.get(s.id)
      const rare = 'ownerId' in s
      if (!v) {
        v = makeSpecial(s.kind, !rare)
        if (rare) {
          const timer = makeLabel('', '#fff1b8', 1.5)
          timer.name = 'timer'
          timer.position.y = 4
          v.add(timer)
        }
        this.specials.set(s.id, v)
        this.scene.add(v)
      }
      v.visible = !cull(s.x, s.z, 7)
      v.position.set(s.x, 0.3 + (calm ? 0 : Math.sin(t * 3 + s.id) * 0.25), s.z)
      v.getObjectByName('core')!.rotation.y = calm ? 0 : t * 1.3
      if (rare) {
        const secs = Math.ceil(s.expiresAt - sim.time)
        if (v.userData.seconds !== secs) {
          v.userData.seconds = secs
          const timer = v.getObjectByName('timer') as THREE.Sprite
          const mat = timer.material as THREE.SpriteMaterial
          mat.map = labelTexture(String(secs), secs <= 2 ? '#ff6b8a' : '#fff1b8')
          timer.scale.set(1.5 * (mat.map.userData.aspect as number), 1.5, 1)
          mat.needsUpdate = true
        }
      }
    }
    for (const [id, v] of this.specials) if (!seenSpecials.has(id)) {
      this.scene.remove(v)
      disposeSpecial(v)
      this.specials.delete(id)
    }

    // Free celestials
    const seenCel = new Set<number>()
    for (const c of sim.celestials) {
      if (!c.alive) continue
      seenCel.add(c.id)
      let v = this.freeCel.get(c.id)
      const def = CELESTIALS[c.kind]
      if (!v) {
        const visual = makeCelestial(c.kind)
        visual.scale.setScalar(def.radius)
        const ring = new THREE.Mesh(new THREE.RingGeometry(def.radius * 1.4, def.radius * 1.58, 56), new THREE.MeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }))
        ring.rotation.x = -Math.PI / 2
        const label = makeLabel(`${def.minLength}+`, '#ff6b8a', 1.7)
        v = { visual, ring, label, edible: null }
        this.freeCel.set(c.id, v)
        this.scene.add(visual, ring, label)
      }
      const visible = !cull(c.x, c.z, def.radius + 6)
      v.visual.visible = v.ring.visible = visible
      v.visual.position.set(c.x, 0.3, c.z)
      if (visible) animateCelestial(v.visual, t, calm ? 0 : c.spin, Math.atan2(c.vz, c.vx), calm)
      v.ring.position.set(c.x, -1.35, c.z)
      const edible = playerLen < 0 ? true : canConsume(playerLen, c.kind)
      if (edible !== v.edible) {
        v.edible = edible
        ;(v.ring.material as THREE.MeshBasicMaterial).color.set(edible ? THREAT_COLORS.edible : 0xff4d6d)
      }
      ;(v.ring.material as THREE.MeshBasicMaterial).opacity = calm ? 0.7 : 0.55 + 0.3 * Math.sin(t * 3 + c.id)
      v.label.visible = visible && !edible
      v.label.position.set(c.x, def.radius + 2.4, c.z)
    }
    for (const [id, v] of this.freeCel) {
      if (!seenCel.has(id)) {
        this.scene.remove(v.visual, v.ring, v.label)
        ;(v.ring.material as THREE.Material).dispose()
        ;(v.label.material as THREE.Material).dispose()
        this.freeCel.delete(id)
      }
    }

    // Worms
    const segUsed = new Map<CelestialId, number>()
    n = 0
    let plates = 0
    let visibleWorms = 0
    const seenHeads = new Set<number>()
    for (const w of sim.worms) {
      if (!w.alive) continue
      const skin = appearanceSkin(w.skin, w.color)
      const len = w.xs.length
      const tier = armorTier(len, w.radius)
      const growth = ARMOR_PROFILES[tier]
      const band = Math.max(1, Math.round(skin.band * growth.band))
      armorColor.setHex(growth.tint).lerp(tmpColor.setHex(skin.head), 0.28)
      trimColor.setHex(growth.trim).lerp(tmpColor.setHex(skin.colors[0]), 0.25)
      const flicker = w.spawnGrace > 0 && !calm && Math.floor(t * 12) % 2 === 0
      const dim = w.spawnGrace > 0 ? (calm ? 0.55 : flicker ? 0.3 : 0.75) : 1
      const bulges = this.bulges.get(w.id)
      const bulgeAt: number[] = []
      if (bulges) {
        for (let k = bulges.length - 1; k >= 0; k--) {
          const pos = (t - bulges[k]) * 30
          if (pos > len + 4) bulges.splice(k, 1)
          else bulgeAt.push(pos)
        }
      }
      const headVisible = !cull(w.xs[0], w.zs[0], 6)
      if (headVisible) visibleWorms++
      for (let i = len - 1; i >= 1; i--) {
        const x = w.xs[i]
        const z = w.zs[i]
        const kind = w.kinds[i]
        if (cull(x, z, 4)) continue
        if (kind) {
          const pool = this.celSegPool.get(kind) ?? []
          this.celSegPool.set(kind, pool)
          const used = segUsed.get(kind) ?? 0
          let v = pool[used]
          if (!v) {
            v = makeCelestial(kind)
            pool.push(v)
            this.scene.add(v)
          }
          segUsed.set(kind, used + 1)
          v.visible = true
          v.position.set(x, 0.15, z)
          v.scale.setScalar(w.radius * 1.3)
          const heading = Math.atan2(w.zs[i - 1] - z, w.xs[i - 1] - x)
          animateCelestial(v, t, calm ? 0 : t * 0.8 + i, heading, calm)
          continue
        }
        if (n >= MAX_SEGMENTS) continue
        const tailK = i > len - 10 ? 0.55 + 0.45 * ((len - i) / 10) : 1
        const wave = w.boosting && !calm ? 1 + 0.1 * Math.sin(t * 20 - i * 0.55) : calm ? 1 : 1 + 0.03 * Math.sin(t * 3 - i * 0.35)
        let bump = 1
        for (const b of bulgeAt) {
          const d = Math.abs(i - b)
          if (d < 3.5) bump = Math.max(bump, 1 + 0.38 * (1 - d / 3.5))
        }
        const s = w.radius * tailK * wave * bump
        tmpMat.makeScale(s, s * 0.92, s).setPosition(x, 0, z)
        this.body.setMatrixAt(n, tmpMat)
        tmpColor.setHex(skin.colors[Math.floor(i / band) % skin.colors.length])
        if (tier > 0 && i % band === 0) tmpColor.lerp(trimColor, 0.5)
        tmpColor.multiplyScalar((w.boosting ? 1.3 : 1) * dim * (bump > 1 ? 1.25 : 1))
        this.body.setColorAt(n, tmpColor)
        if (growth.plateEvery > 0 && i % growth.plateEvery === 0 && i < len - 6 && plates < MAX_BODY_ARMOR) {
          const heading = Math.atan2(w.zs[i - 1] - z, w.xs[i - 1] - x)
          tmpQuat.setFromAxisAngle(UP, -heading)
          tmpMat.compose(tmpPos.set(x, 0, z), tmpQuat, tmpScale.set(s * 1.1, s * 1.04, s * (0.91 + tier * 0.04)))
          this.bodyArmor.setMatrixAt(plates, tmpMat)
          this.bodyArmor.setColorAt(plates, tmpColor.copy(i % (growth.plateEvery * 4) === 0 ? trimColor : armorColor).multiplyScalar(dim))
          plates++
        }
        n++
      }
      seenHeads.add(w.id)
      this.updateHead(w, skin, sim.mode === 'team', t, calm, dim, headVisible, sim.crownId === w.id, this.threats?.rivals.get(w.id))
      if (w.boosting && !cull(w.xs[len - 1], w.zs[len - 1], 4) && Math.random() < (w.freeBoost > 0 ? 0.95 : 0.6)) {
        const tl = len - 1
        const heading = Math.atan2(w.zs[Math.max(0, tl - 1)] - w.zs[tl], w.xs[Math.max(0, tl - 1)] - w.xs[tl])
        this.fx.boostTrail(w.xs[tl], w.zs[tl], heading, skin.colors[0], w.radius, w.freeBoost > 0)
      }
      if (w.magnet > 0 && headVisible && !calm && Math.random() < 0.5) this.fx.magnetStream(w.xs[0], w.zs[0], CONFIG.pickups.magnetRange)
    }
    this.visibleWorms = visibleWorms
    this.body.count = n
    this.body.instanceMatrix.needsUpdate = true
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true
    this.bodyArmor.count = plates
    this.bodyArmor.instanceMatrix.needsUpdate = true
    if (this.bodyArmor.instanceColor) this.bodyArmor.instanceColor.needsUpdate = true
    for (const [kind, pool] of this.celSegPool) {
      const used = segUsed.get(kind) ?? 0
      for (let i = used; i < pool.length; i++) pool[i].visible = false
    }
    for (const [id, h] of this.heads) {
      if (!seenHeads.has(id)) h.group.visible = false
    }
    this.particles.update(dt)
    this.fx.update(dt)
  }

  private updateHead(w: Worm, skin: Skin, team: boolean, t: number, calm: boolean, dim: number, visible: boolean, crowned: boolean, threat?: RivalThreat): void {
    let h = this.heads.get(w.id)
    const appearanceKey = `${skin.id}:${w.color}:${w.headStyle}`
    if (!h || h.skin !== appearanceKey) {
      if (h) this.disposeHead(h)
      h = this.makeHead(w, skin, team)
      this.heads.set(w.id, h)
      this.scene.add(h.group)
    }
    h.group.visible = visible
    if (!visible) return
    const r = w.radius
    const tier = armorTier(w.xs.length, r)
    const growth = ARMOR_PROFILES[tier]
    const R = r * 1.18 * growth.scale
    const face = HEAD_FEATURES[w.headStyle]
    h.group.position.set(w.xs[0], 0.05, w.zs[0])
    h.group.rotation.y = -w.angle
    const chew = calm ? 0 : Math.max(0, 0.2 - w.gulp) * 5
    const gulp = 1 + chew * 0.16
    h.head.scale.set(R * gulp, R * 0.94 * gulp, R * gulp)
    h.headMat.uniforms.uColor.value.setHex(skin.head).multiplyScalar(w.boosting ? 1.25 : 1)
    h.headMat.uniforms.uOpacity.value = dim < 1 ? 0.55 + dim * 0.45 : 1
    h.headMat.uniforms.uSolid.value = Math.max(w.headStyle === 'robot' ? 0.7 : 0, growth.solid)
    h.armor.scale.set(R, R * 0.94, R)
    for (let i = 0; i < h.armorLayers.length; i++) h.armorLayers[i].visible = i < tier
    h.armorMat.color.setHex(growth.tint).lerp(tmpColor.setHex(skin.head), 0.28).multiplyScalar(dim)
    h.trimMat.color.setHex(growth.trim).lerp(tmpColor.setHex(skin.head), 0.25).multiplyScalar(dim)
    h.armorMat.metalness = 0.45 + tier * 0.15
    // Eyes: glance toward the turn, blink every few seconds.
    const glance = Math.max(-0.12, Math.min(0.12, Math.atan2(Math.sin(w.targetAngle - w.angle), Math.cos(w.targetAngle - w.angle)) * 0.2))
    if (t > h.blinkAt + 0.14) h.blinkAt = t + 2.2 + Math.random() * 3.5
    const blink = !calm && t > h.blinkAt ? 0.12 : 1
    for (let k = 0; k < h.eyes.length; k++) {
      const side = h.eyes.length === 1 ? 0 : k === 0 ? -1 : 1
      const eyeSize = face.size * R
      const eyeHeight = w.headStyle === 'robot' ? 0.65 : 1
      h.eyes[k].position.set(face.eye[0] * R, face.eye[1] * R, side * face.eye[2] * R)
      h.eyes[k].scale.set(eyeSize, eyeSize * blink * eyeHeight, eyeSize)
      h.pupils[k].position.set((face.eye[0] + face.size * 0.62) * R, (face.eye[1] + face.size * 0.34) * R, side * face.eye[2] * R + glance * r)
      h.pupils[k].scale.set(eyeSize * 0.52, eyeSize * 0.52 * blink * eyeHeight, eyeSize * 0.52)
    }
    h.mouth.position.set(face.mouth[0] * R, face.mouth[1] * R, 0)
    h.mouth.scale.set(0.075 * R, (0.055 + chew * 0.16) * R, face.width * R)
    h.halo.scale.setScalar(r * 1.8)
    const effect = w.traps.freeze > 0 ? 'freeze' : w.traps.slow > 0 ? 'slow' : w.traps.reverse > 0 ? 'reverse' : w.shrinkLeft > 0 ? 'shrink' : null
    h.status.visible = effect !== null
    if (effect) {
      ;(h.status.material as THREE.MeshBasicMaterial).color.setHex(SPECIAL_COLORS[effect])
      h.status.scale.setScalar(r * 2.5)
      h.status.rotation.z = calm ? 0 : t * (effect === 'reverse' ? -2 : 1)
    }
    h.shield.visible = w.shield > 0
    if (h.shield.visible) {
      h.shield.scale.setScalar(r * 2.2 * (calm ? 1 : 1 + 0.04 * Math.sin(t * 6)))
      const blinkS = w.shield < 3 && !calm ? (Math.floor(t * 6) % 2 ? 0.35 : 1) : 1
      h.shieldMat.uniforms.uOpacity.value = blinkS
      h.shieldMat.uniforms.uTime.value = calm ? 0 : t
    }
    h.magnet.visible = w.magnet > 0
    if (h.magnet.visible) {
      h.magnet.scale.setScalar(CONFIG.pickups.magnetRange * (calm ? 1 : 0.94 + 0.06 * Math.sin(t * 5)))
      h.magnet.rotation.z = calm ? 0 : t
    }
    h.boostGlow.visible = w.boosting
    h.boostGlow.scale.setScalar(r * (w.freeBoost > 0 ? 7 : 5))
    if (!w.isPlayer) this.threatLook(h, w, team, threat, t, calm)
    h.label.visible = !w.isPlayer
    const top = h.head.geometry.boundingBox!.max.y * R * 0.94
    const crownY = Math.max(r * 2.1, top + r * 0.6)
    if (h.label.visible) h.label.position.set(0, crowned ? crownY + r * 1.5 : Math.max(r * 2.4, top + r * 0.5), 0)
    h.crown.visible = crowned
    if (crowned) {
      h.crown.position.set(0, crownY + (calm ? 0 : Math.sin(t * 3) * 0.25), 0)
      h.crown.scale.setScalar(Math.max(2.6, r * 2.4))
    }
  }

  /**
   * Red ring and name tag for rivals (▲ = longer than you, wins head-on), gold for prey you can
   * bite through (▼), blue for allies.
   */
  private threatLook(h: HeadView, w: Worm, team: boolean, threat: RivalThreat | undefined, t: number, calm: boolean): void {
    const ally = team && !!threat?.ally
    const bigger = !ally && !!threat?.bigger
    const prey = !ally && !!threat?.prey
    const m = h.halo.material as THREE.MeshBasicMaterial
    m.color.set(ally ? THREAT_COLORS.ally : prey ? THREAT_COLORS.edible : THREAT_COLORS.lethal)
    const hot = threat?.level === 2 && !calm ? 0.2 * (0.5 + 0.5 * Math.sin(t * 12)) : 0
    m.opacity = ally ? 0.55 : prey ? 0.72 : (bigger ? 0.78 : 0.5) + hot
    const key = ally ? 'a' : bigger ? 'b' : prey ? 'p' : 'r'
    if (h.labelKey === key) return
    h.labelKey = key
    const text = bigger ? `${w.name} \u25b2` : prey ? `${w.name} \u25bc` : w.name
    const tex = labelTexture(text, ally ? '#8fd0ff' : bigger ? '#ff5a6a' : prey ? '#ffd36a' : '#ffc4cc')
    const lm = h.label.material as THREE.SpriteMaterial
    lm.map?.dispose()
    lm.map = tex
    lm.needsUpdate = true
    h.label.scale.set(1.5 * (tex.userData.aspect as number), 1.5, 1)
  }

  private disposeHead(h: HeadView): void {
    this.scene.remove(h.group)
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    h.group.traverse(object => {
      if (object instanceof THREE.Mesh) {
        // Procedural head shapes and the magnet ring are shared across living worms.
        if (object.geometry.userData.shared !== true && object.geometry !== this.magnetGeo) geometries.add(object.geometry)
      }
      if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
        for (const mat of Array.isArray(object.material) ? object.material : [object.material]) materials.add(mat)
      }
    })
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
  }

  private makeHead(w: Worm, skin: Skin, team: boolean): HeadView {
    const group = new THREE.Group()
    const headMat = jellyMaterial(false, skin.glow, true)
    headMat.uniforms.uColor.value.setHex(skin.head)
    headMat.uniforms.uFaceted.value = w.headStyle === 'crystal' ? 1 : 0
    const head = new THREE.Mesh(headGeometry(w.headStyle), headMat)
    group.add(head)
    const armor = new THREE.Group()
    const armorMat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.65 })
    const trimMat = new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.8 })
    const armorLayers = Array.from({ length: 3 }, (_, i) => new THREE.Mesh(headArmorGeometry(i), i === 2 ? trimMat : armorMat))
    for (const layer of armorLayers) { layer.visible = false; armor.add(layer) }
    group.add(armor)
    const eyeGeo = new THREE.SphereGeometry(1, 16, 12)
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15, emissive: 0xffffff, emissiveIntensity: 0.12 })
    const pupilColor = skin.eye === 0xffffff ? 0x120a26 : skin.eye
    const pupilMat = new THREE.MeshBasicMaterial({ color: pupilColor })
    const pupils: THREE.Mesh[] = []
    const eyes: THREE.Mesh[] = []
    for (let k = 0; k < (w.headStyle === 'cyclops' ? 1 : 2); k++) {
      const eye = new THREE.Mesh(eyeGeo, white)
      const pupil = new THREE.Mesh(eyeGeo, pupilMat)
      group.add(eye, pupil)
      eyes.push(eye)
      pupils.push(pupil)
    }
    const mouth = new THREE.Mesh(eyeGeo, new THREE.MeshBasicMaterial({ color: 0x1a0826 }))
    group.add(mouth)
    const haloColor = team && w.team >= 0 ? TEAM_COLORS[w.team] : w.isPlayer ? 0xffffff : skin.colors[0]
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.18, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(haloColor).multiplyScalar(team ? 1.1 : 0.9), transparent: true, opacity: team || w.isPlayer ? 0.6 : 0.25, side: THREE.DoubleSide, depthWrite: false }))
    halo.rotation.x = -Math.PI / 2
    halo.position.y = -1.2
    group.add(halo)
    const status = new THREE.Mesh(new THREE.RingGeometry(0.96, 1.04, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }))
    status.rotation.x = -Math.PI / 2
    status.position.y = -1.1
    status.visible = false
    group.add(status)
    const shieldMat = shieldMaterial()
    const shield = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 22), shieldMat)
    shield.visible = false
    group.add(shield)
    const magnet = new THREE.Mesh(this.magnetGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4fd8), transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }))
    magnet.rotation.x = -Math.PI / 2
    magnet.position.y = -1.1
    magnet.visible = false
    group.add(magnet)
    const boostGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: skin.colors[0], transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }))
    boostGlow.visible = false
    group.add(boostGlow)
    const labelColor = team && w.team >= 0 ? (w.team === 0 ? '#8fd0ff' : '#ffb07a') : '#e8e4ff'
    const label = makeLabel(w.name, labelColor, 1.5)
    group.add(label)
    label.position.set(0, w.radius * 2.4, 0)
    const crown = iconSprite('crown', 3)
    crown.visible = false
    group.add(crown)
    return { group, head, headMat, armor, armorLayers, armorMat, trimMat, eyes, pupils, mouth, halo, status, shield, shieldMat, magnet, boostGlow, label, labelKey: '', crown, skin: `${skin.id}:${w.color}:${w.headStyle}`, blinkAt: Math.random() * 3 }
  }
}
