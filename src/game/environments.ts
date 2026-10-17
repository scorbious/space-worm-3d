/** Decorative scenery only: it never changes collision, lights, global fog or arena readability. */
import * as THREE from 'three'
import type { Quality } from '../engine/save'
import { ENVIRONMENTS, type EnvironmentId } from './environmentDefs'

const COUNT = 48
const matrix = new THREE.Matrix4()
const position = new THREE.Vector3()
const rotation = new THREE.Quaternion()
const scale = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)
const BACKGROUNDS: Record<EnvironmentId, number> = { forest: 0x041513, ocean: 0x041322, dunes: 0x21130d, solar: 0x24090b, aurora: 0x090c24, crystal: 0x160c2b }

export class ArenaEnvironment {
  readonly group = new THREE.Group()
  quality: Quality = 'high'
  private backdrop: THREE.Mesh
  private material: THREE.ShaderMaterial
  private trunks: THREE.InstancedMesh
  private trees: THREE.InstancedMesh
  private crystals: THREE.InstancedMesh
  private particles: THREE.Points
  private particleMaterial: THREE.ShaderMaterial
  private kind: EnvironmentId | null = null

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uKind: { value: 0 }, uRadius: { value: 128 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vP; uniform float uTime; uniform float uKind; uniform float uRadius;
        float noise(vec2 p){ return sin(p.x * 0.07 + sin(p.y * 0.045)) * cos(p.y * 0.053 - sin(p.x * 0.03)); }
        void main(){
          vec2 p = vP; float t = uTime; float d = length(p); vec3 c; float alpha = 0.65;
          if(uKind < 0.5){
            float moss = noise(p + vec2(t * 0.9,0.0));
            float mist = 0.5 + 0.5 * sin(p.x * 0.013 + p.y * 0.022 + t * 0.15);
            c = mix(vec3(0.015,0.06,0.045),vec3(0.045,0.19,0.13),moss * 0.5 + 0.5) + vec3(0.03,0.06,0.065) * mist;
          } else if(uKind < 1.5){
            float waves = sin(p.x * 0.08 + t * 1.2 + sin(p.y * 0.04 - t * 0.6)) + sin(p.y * 0.13 - t * 1.5) * 0.4;
            float foam = pow(max(0.0,waves * 0.65),6.0);
            float reflection = exp(-abs(p.x + 50.0) * 0.008) * (0.4 + 0.6 * max(0.0,waves));
            c = mix(vec3(0.01,0.05,0.11),vec3(0.025,0.21,0.27),waves * 0.25 + 0.5) + vec3(0.11,0.22,0.24) * foam + vec3(0.12,0.1,0.065) * reflection;
          } else if(uKind < 2.5){
            float dunes = sin(p.y * 0.045 + sin(p.x * 0.014) * 2.5 + t * 0.035);
            float sand = noise(p * 4.0 + vec2(t * 3.0,0.0));
            c = mix(vec3(0.12,0.065,0.025),vec3(0.38,0.235,0.095),dunes * 0.5 + 0.5) + sand * 0.025;
          } else if(uKind < 3.5){
            float a = atan(p.y,p.x); float surface = noise(p + vec2(sin(t * 0.1),cos(t * 0.1)) * 10.0);
            float corona = pow(max(0.0,sin(a * 23.0 + t * 0.2 + surface * 1.8)),4.0);
            float disk = 1.0 - smoothstep(uRadius * 1.65,uRadius * 2.0,d);
            c = mix(vec3(0.13,0.012,0.02),vec3(0.6,0.16,0.025),disk) + vec3(0.15,0.065,0.01) * (surface * 0.5 + 0.5 + corona * 0.4);
          } else if(uKind < 4.5){
            float ribbon = sin(p.y * 0.016 + sin(p.x * 0.011 + t * 0.12) * 2.2 + t * 0.07);
            float veil = pow(0.5 + 0.5 * ribbon,3.0);
            c = mix(vec3(0.015,0.02,0.07),vec3(0.055,0.25,0.19),veil) + vec3(0.09,0.025,0.13) * (noise(p) * 0.5 + 0.5);
          } else {
            float nebula = noise(p + vec2(t * 0.4,-t * 0.2));
            c = mix(vec3(0.045,0.02,0.1),vec3(0.16,0.065,0.25),nebula * 0.5 + 0.5);
          }
          alpha *= 1.0 - smoothstep(420.0,600.0,d);
          gl_FragColor = vec4(c,alpha);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    })
    this.backdrop = new THREE.Mesh(new THREE.CircleGeometry(600, 80), this.material)
    this.backdrop.rotation.x = -Math.PI / 2
    this.backdrop.position.y = -36
    this.backdrop.renderOrder = -2
    this.group.add(this.backdrop)

    this.trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.7, 1.1, 9, 6), new THREE.MeshStandardMaterial({ color: 0x493831, roughness: 1 }), COUNT)
    this.trees = new THREE.InstancedMesh(new THREE.ConeGeometry(5.5, 13, 7), new THREE.MeshStandardMaterial({ color: 0x26795f, roughness: 0.9, emissive: 0x0e251d, emissiveIntensity: 0.3 }), COUNT)
    this.crystals = new THREE.InstancedMesh(new THREE.OctahedronGeometry(5, 0), new THREE.MeshStandardMaterial({ color: 0x786dc7, emissive: 0x4f2490, emissiveIntensity: 0.45, roughness: 0.25, metalness: 0.3 }), COUNT)
    for (const mesh of [this.trunks, this.trees, this.crystals]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.frustumCulled = false
      this.group.add(mesh)
    }
    const positions = new Float32Array(180 * 3)
    const phases = new Float32Array(180)
    for (let i = 0; i < 180; i++) {
      const a = i * 2.39996
      const r = 35 + Math.sqrt(i / 180) * 340
      positions[i * 3] = Math.cos(a) * r
      positions[i * 3 + 1] = -17 - (i % 9) * 1.5
      positions[i * 3 + 2] = Math.sin(a) * r
      phases[i] = i * 1.71
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('phase', new THREE.BufferAttribute(phases, 1))
    this.particleMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color() }, uKind: { value: 0 } },
      vertexShader: `attribute float phase; uniform float uTime; uniform float uKind; varying float vA;
        void main(){ vec3 p = position; p.x += sin(uTime * 0.3 + phase) * 5.0; p.z += cos(uTime * 0.2 + phase) * 4.0;
          p.y += sin(uTime * 0.4 + phase) * 2.0; vA = 0.4 + 0.25 * sin(phase + uTime * 0.3);
          vec4 mv = modelViewMatrix * vec4(p,1.0); gl_PointSize = clamp(180.0 / -mv.z,1.0,4.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if(d > 0.5) discard; gl_FragColor = vec4(uColor,vA * (1.0 - d * 2.0)); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    this.particles = new THREE.Points(geo, this.particleMaterial)
    this.group.add(this.particles)
  }

  update(kind: EnvironmentId, time: number, radius: number, reduced: boolean): number {
    this.kind = kind
    const t = reduced ? 0 : time
    this.material.uniforms.uTime.value = t
    this.material.uniforms.uKind.value = ENVIRONMENTS.indexOf(kind)
    this.material.uniforms.uRadius.value = radius
    this.particleMaterial.uniforms.uTime.value = t
    this.particleMaterial.uniforms.uColor.value.setHex(kind === 'forest' ? 0x73ba79 : kind === 'dunes' ? 0xd7a868 : kind === 'solar' ? 0xffab42 : 0x9395ff)
    this.trunks.visible = this.trees.visible = kind === 'forest'
    this.crystals.visible = kind === 'crystal'
    this.particles.visible = kind !== 'ocean'
    this.particles.geometry.setDrawRange(0, this.quality === 'low' ? 60 : 180)
    const count = this.quality === 'low' ? 24 : COUNT
    this.trunks.count = this.trees.count = this.crystals.count = count
    if (kind === 'forest' || kind === 'crystal') {
      for (let i = 0; i < count; i++) {
        const a = i * 2.39996
        const r = radius + 24 + (i % 7) * 12
        const x = Math.cos(a) * r
        const z = Math.sin(a) * r
        const s = 0.8 + (i % 4) * 0.18
        rotation.setFromAxisAngle(UP, a + (kind === 'crystal' ? t * 0.05 : 0))
        matrix.compose(position.set(x, -21, z), rotation, scale.set(s, s, s))
        this.trunks.setMatrixAt(i, matrix)
        matrix.compose(position.set(x + Math.sin(t * 0.5 + i) * (reduced ? 0 : 0.3), -13, z), rotation, scale.set(s, s, s))
        this.trees.setMatrixAt(i, matrix)
        matrix.compose(position.set(x, -15 + (reduced ? 0 : Math.sin(t * 0.4 + i)), z), rotation, scale.set(s, s * 1.8, s))
        this.crystals.setMatrixAt(i, matrix)
      }
      this.trunks.instanceMatrix.needsUpdate = this.trees.instanceMatrix.needsUpdate = this.crystals.instanceMatrix.needsUpdate = true
    }
    return BACKGROUNDS[this.kind]
  }
}
