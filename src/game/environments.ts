/** Decorative scenery only: never changes collision, lighting or arena navigational lines. */
import * as THREE from 'three'
import type { Quality } from '../engine/save'
import { ENVIRONMENTS, type EnvironmentId } from './environmentDefs'

const COUNT = 48
export const ENVIRONMENT_FADE_SECONDS = 3
const matrix = new THREE.Matrix4()
const position = new THREE.Vector3()
const rotation = new THREE.Quaternion()
const scale = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)
const PALETTES: Record<EnvironmentId, { base: number; glow: number; mist: number; anchor: [number, number] }> = {
  forest: { base: 0x061917, glow: 0x163e31, mist: 0x73ba79, anchor: [-170, 120] },
  ocean: { base: 0x061728, glow: 0x155266, mist: 0x9bdfed, anchor: [150, -170] },
  dunes: { base: 0x271910, glow: 0x634624, mist: 0xd7a868, anchor: [-160, -130] },
  solar: { base: 0x280e15, glow: 0x77381b, mist: 0xffab42, anchor: [130, 100] },
  aurora: { base: 0x10132b, glow: 0x264a46, mist: 0xa1efd9, anchor: [-100, 160] },
  crystal: { base: 0x1b112f, glow: 0x51366b, mist: 0xbb9eff, anchor: [170, 60] },
}

/** All shapes are allocated once. Transitions blend uniforms and six bounded scenery weights. */
export class ArenaEnvironment {
  readonly group = new THREE.Group()
  quality: Quality = 'high'
  private backdrop: THREE.Mesh
  private material: THREE.ShaderMaterial
  private trunks: THREE.InstancedMesh
  private trees: THREE.InstancedMesh
  private crystals: THREE.InstancedMesh
  private swells: THREE.InstancedMesh
  private dunes: THREE.InstancedMesh
  private sun: THREE.Group
  private aurora: THREE.Group
  private particles: THREE.Points
  private particleMaterial: THREE.ShaderMaterial
  private kind: EnvironmentId | null = null
  private changedAt = 0
  private weights = Array<number>(6).fill(0)
  private fromWeights = Array<number>(6).fill(0)
  private background = new THREE.Color()
  private fromBase = new THREE.Color()
  private fromGlow = new THREE.Color()
  private fromMist = new THREE.Color()
  private targetBase = new THREE.Color()
  private targetGlow = new THREE.Color()
  private targetMist = new THREE.Color()
  private fromAnchor = new THREE.Vector2()
  private targetAnchor = new THREE.Vector2()

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: { uBase: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uAnchor: { value: new THREE.Vector2() } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      // No textures, noise, waves, ribbons, grids or repeating patterns on the backdrop.
      fragmentShader: `varying vec2 vP; uniform vec3 uBase; uniform vec3 uGlow; uniform vec2 uAnchor;
        void main(){
          vec2 p = (vP - uAnchor) / 430.0;
          float soft = exp(-dot(p,p) * 1.5);
          vec3 color = mix(uBase,uGlow,soft * 0.7);
          gl_FragColor = vec4(color,1.0);
          #include <colorspace_fragment>
        }`,
      depthWrite: false, side: THREE.DoubleSide,
    })
    this.backdrop = new THREE.Mesh(new THREE.CircleGeometry(1800, 64), this.material)
    this.backdrop.rotation.x = -Math.PI / 2
    this.backdrop.position.y = -44
    this.backdrop.renderOrder = -4
    this.group.add(this.backdrop)

    const sceneryMaterial = (color: number, emissive = 0x000000, metalness = 0) => new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0.35, roughness: 0.75 - metalness * 0.5, metalness, transparent: true, depthWrite: false })
    this.trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.7, 1.1, 9, 6), sceneryMaterial(0x493831), COUNT)
    this.trees = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8).scale(5.3, 8, 5.3), sceneryMaterial(0x26795f, 0x0e251d), COUNT)
    this.crystals = new THREE.InstancedMesh(new THREE.OctahedronGeometry(5, 0), sceneryMaterial(0x9987db, 0x4f2490, 0.3), COUNT)
    this.swells = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 8), sceneryMaterial(0x327b91, 0x0f314a, 0.15), 16)
    this.dunes = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 8), sceneryMaterial(0xa47b48, 0x342212), 16)
    for (const mesh of [this.trunks, this.trees, this.crystals, this.swells, this.dunes]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.frustumCulled = false
      mesh.renderOrder = -2
      this.group.add(mesh)
    }

    this.sun = new THREE.Group()
    const disk = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshBasicMaterial({ color: 0xffba63, transparent: true, depthWrite: false }))
    disk.scale.set(30, 13, 30)
    const glow = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshBasicMaterial({ color: 0xff752e, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending }))
    glow.scale.set(42, 17, 42)
    glow.userData.opacity = 0.12
    this.sun.add(disk, glow)
    this.group.add(this.sun)

    // Separate distant light veils, NOT stripes drawn into the backdrop shader.
    this.aurora = new THREE.Group()
    for (let i = 0; i < 3; i++) {
      const veil = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), new THREE.MeshBasicMaterial({ color: [0x65ddb9, 0x839dff, 0xd39bef][i], transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }))
      veil.scale.set(36 + i * 6, 2.5, 12)
      veil.rotation.y = i * 0.65
      veil.userData.opacity = 0.16
      this.aurora.add(veil)
    }
    this.group.add(this.aurora)

    const positions = new Float32Array(180 * 3)
    const phases = new Float32Array(180)
    for (let i = 0; i < 180; i++) {
      const a = i * 2.39996
      const r = 1 + (i % 7) * 0.055
      positions[i * 3] = Math.cos(a) * r
      positions[i * 3 + 1] = -19 - (i % 9) * 1.5
      positions[i * 3 + 2] = Math.sin(a) * r
      phases[i] = i * 1.71
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('phase', new THREE.BufferAttribute(phases, 1))
    this.particleMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color() }, uRadius: { value: 128 }, uOpacity: { value: 0 } },
      vertexShader: `attribute float phase; uniform float uTime; uniform float uRadius; varying float vA;
        void main(){ vec3 p = position; p.xz *= uRadius + 30.0;
          p.x += sin(uTime * 0.3 + phase) * 5.0; p.z += cos(uTime * 0.2 + phase) * 4.0;
          p.y += sin(uTime * 0.4 + phase) * 2.0; vA = 0.4 + 0.25 * sin(phase + uTime * 0.3);
          vec4 mv = modelViewMatrix * vec4(p,1.0); gl_PointSize = clamp(180.0 / -mv.z,1.0,4.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); if(d > 0.5) discard; gl_FragColor = vec4(uColor,uOpacity * vA * (1.0 - d * 2.0)); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    this.particles = new THREE.Points(geo, this.particleMaterial)
    this.group.add(this.particles)
  }

  /** A new round snaps to its initial palette; stage/timed changes crossfade in update. */
  reset(): void { this.kind = null }

  update(kind: EnvironmentId, time: number, radius: number, reduced: boolean): THREE.Color {
    const palette = PALETTES[kind]
    const index = ENVIRONMENTS.indexOf(kind)
    if (this.kind !== kind) {
      const first = this.kind === null
      this.kind = kind
      this.changedAt = first ? time - ENVIRONMENT_FADE_SECONDS : time
      this.fromBase.copy(first ? this.targetBase.setHex(palette.base) : this.background)
      this.fromGlow.copy(first ? this.targetGlow.setHex(palette.glow) : this.material.uniforms.uGlow.value)
      this.fromMist.copy(first ? this.targetMist.setHex(palette.mist) : this.particleMaterial.uniforms.uColor.value)
      this.fromAnchor.copy(first ? this.targetAnchor.set(...palette.anchor) : this.material.uniforms.uAnchor.value)
      this.fromWeights.splice(0, 6, ...this.weights)
      if (first) { this.fromWeights.fill(0); this.fromWeights[index] = 1 }
      this.targetBase.setHex(palette.base)
      this.targetGlow.setHex(palette.glow)
      this.targetMist.setHex(palette.mist)
      this.targetAnchor.set(...palette.anchor)
    }
    const progress = reduced ? 1 : THREE.MathUtils.clamp((time - this.changedAt) / ENVIRONMENT_FADE_SECONDS, 0, 1)
    const blend = progress * progress * (3 - 2 * progress)
    this.background.lerpColors(this.fromBase, this.targetBase, blend)
    this.material.uniforms.uBase.value.copy(this.background)
    this.material.uniforms.uGlow.value.lerpColors(this.fromGlow, this.targetGlow, blend)
    this.material.uniforms.uAnchor.value.lerpVectors(this.fromAnchor, this.targetAnchor, blend)
    this.particleMaterial.uniforms.uColor.value.lerpColors(this.fromMist, this.targetMist, blend)
    for (let i = 0; i < 6; i++) this.weights[i] = THREE.MathUtils.lerp(this.fromWeights[i], i === index ? 1 : 0, blend)
    const [forest, ocean, dunes, solar, aurora, crystal] = this.weights
    const opacity = (mesh: THREE.InstancedMesh, amount: number) => {
      mesh.visible = amount > 0.002
      ;(mesh.material as THREE.MeshStandardMaterial).opacity = amount * 0.72
    }
    opacity(this.trunks, forest); opacity(this.trees, forest); opacity(this.crystals, crystal)
    opacity(this.swells, ocean); opacity(this.dunes, dunes)
    const fadeGroup = (group: THREE.Group, amount: number) => {
      group.visible = amount > 0.002
      for (const child of group.children) {
        const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
        mesh.material.opacity = amount * (mesh.userData.opacity as number ?? 0.7)
      }
    }
    fadeGroup(this.sun, solar); fadeGroup(this.aurora, aurora)
    const t = reduced ? 0 : time
    this.particleMaterial.uniforms.uTime.value = t
    this.particleMaterial.uniforms.uRadius.value = radius
    this.particleMaterial.uniforms.uOpacity.value = 1 - ocean * 0.55
    this.particles.geometry.setDrawRange(0, this.quality === 'low' ? 60 : 180)
    const count = this.quality === 'low' ? 24 : COUNT
    this.trunks.count = this.trees.count = this.crystals.count = count
    if (forest > 0.002 || crystal > 0.002) {
      for (let i = 0; i < count; i++) {
        const a = i * 2.39996
        const r = radius + 32 + (i % 7) * 12
        const x = Math.cos(a) * r, z = Math.sin(a) * r
        const s = 0.8 + (i % 4) * 0.18
        rotation.setFromAxisAngle(UP, a)
        matrix.compose(position.set(x, -24, z), rotation, scale.set(s, s, s))
        this.trunks.setMatrixAt(i, matrix)
        matrix.compose(position.set(x + Math.sin(t * 0.5 + i) * (reduced ? 0 : 0.3), -16, z), rotation, scale.set(s, s, s))
        this.trees.setMatrixAt(i, matrix)
        rotation.setFromAxisAngle(UP, a + t * 0.05)
        matrix.compose(position.set(x, -19 + (reduced ? 0 : Math.sin(t * 0.4 + i)), z), rotation, scale.set(s, s * 1.8, s))
        this.crystals.setMatrixAt(i, matrix)
      }
      this.trunks.instanceMatrix.needsUpdate = this.trees.instanceMatrix.needsUpdate = this.crystals.instanceMatrix.needsUpdate = true
    }
    const blobs = this.quality === 'low' ? 8 : 16
    this.swells.count = this.dunes.count = blobs
    if (ocean > 0.002 || dunes > 0.002) for (let i = 0; i < blobs; i++) {
      const a = i * 2.39996, r = radius + 65 + i % 4 * 25
      const drift = reduced ? 0 : Math.sin(t * 0.16 + i) * 5
      rotation.setFromAxisAngle(UP, a + 0.4)
      matrix.compose(position.set(Math.cos(a) * r + drift, -29, Math.sin(a) * r), rotation, scale.set(28 + i % 3 * 5, 5 + (reduced ? 0 : Math.sin(t * 0.35 + i)), 15))
      this.swells.setMatrixAt(i, matrix)
      matrix.compose(position.set(Math.cos(a) * r, -31, Math.sin(a) * r + drift * 0.2), rotation, scale.set(30 + i % 4 * 5, 8, 17))
      this.dunes.setMatrixAt(i, matrix)
    }
    this.swells.instanceMatrix.needsUpdate = this.dunes.instanceMatrix.needsUpdate = true
    this.sun.position.set(Math.cos(0.7) * (radius + 90), -22, Math.sin(0.7) * (radius + 90))
    this.sun.scale.setScalar(reduced ? 1 : 1 + Math.sin(t * 0.3) * 0.035)
    this.aurora.position.set(-radius - 85, -25, -radius * 0.3)
    this.aurora.rotation.y = reduced ? 0 : Math.sin(t * 0.07) * 0.24
    this.aurora.position.y += reduced ? 0 : Math.sin(t * 0.2) * 3
    return this.background
  }

  /** Environment-owned resources only; no globally shared worm geometries are touched. */
  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>()
    this.group.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        geometries.add(object.geometry)
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material)
      }
    })
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
    this.group.clear()
  }
}
