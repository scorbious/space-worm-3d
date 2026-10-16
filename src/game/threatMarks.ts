/**
 * "Threat Language" world markers, driven by `threats.ts`:
 * - hazard-striped ground zones (asteroids, rim), gate lane footprints and a dashed gravity-well
 *   boundary with inward-flowing chevrons;
 * - billboard glyph badges above hazards (gates carry a countdown arc and seconds label);
 * - a faint underglow under nearby rival (red) or allied (blue) bodies;
 * - a look-ahead line and reticle on the most urgent danger in the player's path.
 * Minimal mode keeps ground marks and underglow but hides badges, the reticle and the path line.
 * Reduced motion freezes pulses, flashes and flowing chevrons; states stay readable by colour/shape.
 */
import * as THREE from 'three'
import { drawBadge, THREAT_COLORS, type GlyphId, type ThreatTone } from './glyphs'
import type { Sim } from './sim'
import type { ThreatLevel, ThreatReport } from './threats'
import { labelTexture } from './visuals'

export type ThreatMode = 'full' | 'minimal'
const WARN_SECONDS = 1.2
const MAX_GLOW = 1400

const badgeCache = new Map<string, THREE.Texture>()
function badgeTexture(id: GlyphId, tone: ThreatTone): THREE.Texture {
  const key = `${id}:${tone}`
  let tex = badgeCache.get(key)
  if (!tex) {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    drawBadge(c.getContext('2d')!, id, tone, 128)
    tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    badgeCache.set(key, tex)
  }
  return tex
}
let bangTex: THREE.Texture | null = null
function bangTexture(): THREE.Texture {
  if (bangTex) return bangTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.beginPath()
  g.arc(32, 32, 28, 0, Math.PI * 2)
  g.fillStyle = THREAT_COLORS.lethal
  g.fill()
  g.lineWidth = 4
  g.strokeStyle = '#0b0820'
  g.stroke()
  g.fillStyle = '#fff'
  g.font = '900 42px Sora, system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('!', 32, 35)
  bangTex = new THREE.CanvasTexture(c)
  bangTex.colorSpace = THREE.SRGBColorSpace
  return bangTex
}
let reticleTex: THREE.Texture | null = null
function reticleTexture(): THREE.Texture {
  if (reticleTex) return reticleTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.strokeStyle = THREAT_COLORS.lethal
  g.lineWidth = 7
  g.beginPath()
  g.arc(64, 64, 40, 0, Math.PI * 2)
  g.stroke()
  g.lineWidth = 6
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2
    g.beginPath()
    g.moveTo(64 + Math.cos(a) * 26, 64 + Math.sin(a) * 26)
    g.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58)
    g.stroke()
  }
  g.fillStyle = THREAT_COLORS.lethal
  g.beginPath()
  g.arc(64, 64, 6, 0, Math.PI * 2)
  g.fill()
  reticleTex = new THREE.CanvasTexture(c)
  reticleTex.colorSpace = THREE.SRGBColorSpace
  return reticleTex
}
let discTex: THREE.Texture | null = null
function discTexture(): THREE.Texture {
  if (discTex) return discTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.55, 'rgba(255,255,255,0.55)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 64)
  discTex = new THREE.CanvasTexture(c)
  return discTex
}
const timerCache = new Map<string, THREE.Texture>()
function timerTexture(text: string, tone: ThreatTone): THREE.Texture {
  const key = `${text}:${tone}`
  let tex = timerCache.get(key)
  if (!tex) {
    tex = labelTexture(text, THREAT_COLORS[tone], 40)
    timerCache.set(key, tex)
  }
  return tex
}
const tone3 = (tone: ThreatTone) => new THREE.Color(THREAT_COLORS[tone])

// ─── Shaders ────────────────────────────────────────────────────────────────
const worldVert = 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }'
/** Polar ground zone around `uCenter`: 0 = hazard stripes, 1 = dashed boundary + inward chevrons. */
function zoneMaterial(mode: 0 | 1, tone: ThreatTone, cx: number, cz: number, inner: number, outer: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uCenter: { value: new THREE.Vector2(cx, cz) }, uInner: { value: inner }, uOuter: { value: outer },
      uColor: { value: tone3(tone) }, uLevel: { value: 0 }, uTime: { value: 0 }, uPulse: { value: 1 }, uMode: { value: mode },
    },
    vertexShader: worldVert,
    fragmentShader: `uniform vec2 uCenter; uniform float uInner; uniform float uOuter; uniform vec3 uColor; uniform float uLevel; uniform float uTime; uniform float uPulse; uniform float uMode; varying vec3 vW;
      void main(){
        vec2 d = vW.xz - uCenter; float r = length(d);
        if (r < uInner || r > uOuter) discard;
        float a = atan(d.y, d.x) / 6.28318;
        float edge = smoothstep(0.0, 0.2, r - uInner) * smoothstep(0.0, 0.2, uOuter - r);
        vec3 c; float al;
        if (uMode < 0.5) {
          float n = floor(6.28318 * (uInner + uOuter) * 0.5 / 2.2 + 0.5);
          float s = step(0.5, fract(a * n + (r - uInner) / 2.2));
          c = mix(vec3(0.06, 0.02, 0.05), uColor, s);
          al = mix(0.42, 0.8, s) * (0.5 + 0.2 * uLevel);
          float line = max(smoothstep(0.22, 0.0, r - uInner), smoothstep(0.22, 0.0, uOuter - r));
          c = mix(c, uColor, line);
          al = max(al, line * (0.75 + 0.1 * uLevel));
        } else {
          float rr = uOuter - 0.45;
          float n = floor(6.28318 * uOuter / 2.4 + 0.5);
          float dash = step(0.4, fract(a * n - uTime * 0.04));
          float ring = 1.0 - smoothstep(0.12, 0.42, abs(r - rr));
          float m = floor(6.28318 * uOuter / 8.0 + 0.5);
          float u = fract(a * m) - 0.5;
          float v = (rr - r) / 4.5;
          float f = v + abs(u) * 1.1;
          float chev = smoothstep(0.16, 0.05, abs(fract(f * 1.3 - uTime * 0.7) - 0.5))
            * smoothstep(0.24, 0.16, abs(u)) * smoothstep(0.08, 0.22, v) * smoothstep(1.0, 0.75, v);
          c = uColor;
          al = (ring * dash * 0.9 + chev * 0.6) * (0.6 + 0.2 * uLevel);
        }
        gl_FragColor = vec4(c, al * edge * uPulse);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  })
}
function laneMaterial(len: number, width: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uLen: { value: len }, uWidth: { value: width }, uColor: { value: tone3('off') }, uAlpha: { value: 0.3 }, uStripes: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uLen; uniform float uWidth; uniform vec3 uColor; uniform float uAlpha; uniform float uStripes; varying vec2 vUv;
      void main(){
        float x = vUv.x * uLen; float y = vUv.y * uWidth;
        float s = step(0.5, fract((x + y) / 1.8));
        float line = smoothstep(0.24, 0.0, min(y, uWidth - y));
        float ends = smoothstep(0.0, 1.2, x) * smoothstep(0.0, 1.2, uLen - x);
        vec3 c = mix(vec3(0.06, 0.02, 0.05), uColor, max(s, line));
        float al = max(mix(0.38, 0.78, s) * uStripes, line * 0.85);
        gl_FragColor = vec4(c, al * ends * uAlpha);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  })
}
function arcMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uP: { value: 1 }, uColor: { value: tone3('lethal') } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uP; uniform vec3 uColor; varying vec2 vUv;
      void main(){ vec2 p = vUv * 2.0 - 1.0; float r = length(p);
        float band = smoothstep(0.84, 0.88, r) * (1.0 - smoothstep(0.96, 1.0, r));
        if (band < 0.01) discard;
        float a = atan(p.x, p.y); a = a < 0.0 ? a + 6.28318 : a;
        float on = step(a / 6.28318, uP);
        gl_FragColor = vec4(mix(vec3(0.12, 0.1, 0.2), uColor, on), band * mix(0.45, 1.0, on)); }`,
    transparent: true, depthWrite: false, depthTest: false,
  })
}
function pathMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uLen: { value: 1 }, uTime: { value: 0 }, uColor: { value: tone3('lethal') } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uLen; uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
      void main(){ float x = vUv.x * uLen; float dash = step(0.45, fract(x / 1.6 - uTime * 1.5));
        float y = abs(vUv.y - 0.5) * 2.0; float a = dash * smoothstep(1.0, 0.4, y) * smoothstep(0.0, 1.5, x);
        if (a < 0.01) discard; gl_FragColor = vec4(uColor, a * 0.85); }`,
    transparent: true, depthWrite: false, depthTest: false,
  })
}

// ─── Badges ─────────────────────────────────────────────────────────────────
const planeGeo = new THREE.PlaneGeometry(1, 1)
type Badge = {
  group: THREE.Group; face: THREE.Mesh; faceMat: THREE.MeshBasicMaterial; bang: THREE.Mesh
  arc?: THREE.Mesh; arcMat?: THREE.ShaderMaterial; timer?: THREE.Sprite; timerKey: string; key: string
}
function makeBadge(id: GlyphId, tone: ThreatTone, withTimer: boolean): Badge {
  const group = new THREE.Group()
  const faceMat = new THREE.MeshBasicMaterial({ map: badgeTexture(id, tone), transparent: true, depthWrite: false, depthTest: false })
  const face = new THREE.Mesh(planeGeo, faceMat)
  face.renderOrder = 18
  group.add(face)
  const bang = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: bangTexture(), transparent: true, depthWrite: false, depthTest: false }))
  bang.scale.setScalar(0.42)
  bang.position.set(0.4, 0.4, 0.01)
  bang.renderOrder = 19
  bang.visible = false
  group.add(bang)
  const b: Badge = { group, face, faceMat, bang, timerKey: '', key: `${id}:${tone}` }
  if (withTimer) {
    b.arcMat = arcMaterial()
    b.arc = new THREE.Mesh(planeGeo, b.arcMat)
    b.arc.scale.setScalar(1.28)
    b.arc.renderOrder = 18
    group.add(b.arc)
    b.timer = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }))
    b.timer.renderOrder = 19
    b.timer.position.set(0, -0.92, 0)
    group.add(b.timer)
  }
  return b
}
function setBadgeLook(b: Badge, id: GlyphId, tone: ThreatTone): void {
  const key = `${id}:${tone}`
  if (b.key === key) return
  b.key = key
  b.faceMat.map = badgeTexture(id, tone)
  b.faceMat.needsUpdate = true
}
function setTimer(b: Badge, text: string, tone: ThreatTone): void {
  if (!b.timer) return
  const key = `${text}:${tone}`
  if (b.timerKey === key) return
  b.timerKey = key
  const tex = timerTexture(text, tone)
  const m = b.timer.material as THREE.SpriteMaterial
  m.map = tex
  m.needsUpdate = true
  const h = 0.5
  b.timer.scale.set(h * (tex.userData.aspect as number), h, 1)
}

type AsteroidMark = { zone: THREE.ShaderMaterial; badge: Badge; x: number; z: number; y: number }
type GateMark = { lane: THREE.ShaderMaterial; badge: Badge; x: number; z: number }
type WellMark = { zone: THREE.ShaderMaterial; badge: Badge; x: number; z: number; r: number }

export class ThreatMarks {
  readonly group = new THREE.Group()
  private readonly world = new THREE.Group()
  private asteroids: AsteroidMark[] = []
  private gates: GateMark[] = []
  private wells: WellMark[] = []
  private rim: THREE.ShaderMaterial | null = null
  private glow: THREE.InstancedMesh
  private reticle: THREE.Sprite
  private path: THREE.Mesh
  private pathMat = pathMaterial()
  private readonly m4 = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly v = new THREE.Vector3()
  private readonly s = new THREE.Vector3()
  private readonly red = tone3('lethal')
  private readonly blue = tone3('ally')

  constructor() {
    this.group.add(this.world)
    const glowGeo = new THREE.PlaneGeometry(1, 1)
    glowGeo.rotateX(-Math.PI / 2)
    this.glow = new THREE.InstancedMesh(glowGeo, new THREE.MeshBasicMaterial({ map: discTexture(), transparent: true, opacity: 0.34, depthWrite: false }), MAX_GLOW)
    this.glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.glow.frustumCulled = false
    this.glow.count = 0
    this.glow.renderOrder = 1
    this.glow.position.y = -1.36
    this.group.add(this.glow)
    this.reticle = new THREE.Sprite(new THREE.SpriteMaterial({ map: reticleTexture(), transparent: true, depthWrite: false, depthTest: false }))
    this.reticle.renderOrder = 17
    this.reticle.visible = false
    this.group.add(this.reticle)
    this.path = new THREE.Mesh(planeGeo, this.pathMat)
    this.path.rotation.x = -Math.PI / 2
    this.path.renderOrder = 16
    this.path.visible = false
    this.group.add(this.path)
  }

  bind(sim: Sim): void {
    for (const child of [...this.world.children]) {
      this.world.remove(child)
      child.traverse(o => {
        // Materials are per-arena; their canvas textures are cached and shared, so keep those.
        const mesh = o as THREE.Mesh
        ;(mesh.material as THREE.Material | undefined)?.dispose()
        if (mesh.geometry && mesh.geometry !== planeGeo) mesh.geometry.dispose()
      })
    }
    this.asteroids = []
    this.gates = []
    this.wells = []
    for (const a of sim.asteroids) {
      const inner = a.r * 1.02, outer = a.r * 1.02 + 1.7
      const zone = zoneMaterial(0, 'lethal', a.x, a.z, inner, outer)
      const m = new THREE.Mesh(new THREE.RingGeometry(inner - 0.1, outer + 0.1, 64), zone)
      m.rotation.x = -Math.PI / 2
      m.position.set(a.x, -1.34, a.z)
      m.renderOrder = 2
      const badge = makeBadge('skull', 'lethal', false)
      this.world.add(m, badge.group)
      // Lift the badge up-screen (−z) so it sits above the rock instead of covering it.
      this.asteroids.push({ zone, badge, x: a.x, z: a.z - a.r * 0.9, y: a.r + 2.4 })
    }
    for (const g of sim.gates) {
      const len = Math.hypot(g.bx - g.ax, g.bz - g.az)
      const width = 3.4
      const lane = laneMaterial(len, width)
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, width), lane)
      m.rotation.x = -Math.PI / 2
      m.rotation.z = -Math.atan2(g.bz - g.az, g.bx - g.ax)
      m.position.set((g.ax + g.bx) / 2, -1.22, (g.az + g.bz) / 2)
      m.renderOrder = 2
      const badge = makeBadge('bolt', 'off', true)
      this.world.add(m, badge.group)
      this.gates.push({ lane, badge, x: (g.ax + g.bx) / 2, z: (g.az + g.bz) / 2 })
    }
    for (const w of sim.wells) {
      const zone = zoneMaterial(1, 'slow', w.x, w.z, w.r * 0.35, w.r + 0.1)
      const m = new THREE.Mesh(new THREE.RingGeometry(w.r * 0.35, w.r + 0.2, 96), zone)
      m.rotation.x = -Math.PI / 2
      m.position.set(w.x, -1.24, w.z)
      m.renderOrder = 3
      const badge = makeBadge('spiral', 'slow', false)
      this.world.add(m, badge.group)
      this.wells.push({ zone, badge, x: w.x, z: w.z - w.r * 0.92, r: w.r })
    }
    const R = sim.radius
    this.rim = zoneMaterial(0, 'lethal', 0, 0, R - 3.2, R - 0.3)
    const rim = new THREE.Mesh(new THREE.RingGeometry(R - 3.3, R - 0.2, 320), this.rim)
    rim.rotation.x = -Math.PI / 2
    rim.position.y = -1.34
    rim.renderOrder = 2
    this.world.add(rim)
    this.glow.count = 0
    this.reticle.visible = false
    this.path.visible = false
  }

  update(sim: Sim, rep: ThreatReport, camera: THREE.Camera, t: number, calm: boolean, mode: ThreatMode, viewR: number): void {
    const full = mode === 'full'
    const tt = calm ? 0 : t
    const size = Math.min(2.4, Math.max(0.85, viewR / 42)) * 2.1
    const pulse = (lvl: ThreatLevel) => (lvl === 2 && !calm ? 0.8 + 0.2 * Math.sin(t * 12) : 1)
    const place = (b: Badge, x: number, y: number, z: number, lvl: ThreatLevel) => {
      b.group.visible = full
      if (!full) return
      b.group.position.set(x, y, z)
      b.group.quaternion.copy(camera.quaternion)
      const k = size * (lvl === 2 ? (calm ? 1.18 : 1.12 + 0.08 * Math.sin(t * 10)) : lvl === 1 ? 1.06 : 1)
      b.group.scale.setScalar(k)
      b.bang.visible = lvl === 2
    }
    this.asteroids.forEach((m, i) => {
      const lvl = rep.asteroids[i] ?? 0
      m.zone.uniforms.uLevel.value = lvl
      m.zone.uniforms.uPulse.value = pulse(lvl)
      place(m.badge, m.x, m.y, m.z, lvl)
    })
    sim.gates.forEach((g, i) => {
      const m = this.gates[i]
      if (!m) return
      const s = sim.gateAt(g)
      const lvl = rep.gates[i] ?? 0
      const tone: ThreatTone = s.phase === 'on' ? 'lethal' : s.phase === 'warn' ? 'warn' : 'off'
      const flash = s.phase === 'warn' && !calm ? (Math.floor(t * 6) % 2 ? 0.55 : 1) : 1
      m.lane.uniforms.uColor.value.set(THREAT_COLORS[tone])
      m.lane.uniforms.uStripes.value = s.phase === 'off' ? 0 : 1
      m.lane.uniforms.uAlpha.value = (s.phase === 'off' ? 0.35 : 0.8 + lvl * 0.1) * flash * pulse(lvl)
      setBadgeLook(m.badge, 'bolt', tone)
      place(m.badge, m.x, 5.2, m.z, lvl)
      if (full && m.badge.arcMat) {
        const span = s.phase === 'on' ? g.on : s.phase === 'warn' ? WARN_SECONDS : g.period - g.on - WARN_SECONDS
        m.badge.arcMat.uniforms.uP.value = Math.max(0, Math.min(1, s.remaining / Math.max(0.01, span)))
        m.badge.arcMat.uniforms.uColor.value.set(THREAT_COLORS[tone])
        // Seconds until lit while off/charging; seconds until safe while lit.
        const secs = s.phase === 'off' ? s.remaining + WARN_SECONDS : s.remaining
        setTimer(m.badge, `${Math.max(1, Math.ceil(secs))}s`, tone)
      }
    })
    this.wells.forEach((m, i) => {
      const lvl = rep.wells[i] ?? 0
      m.zone.uniforms.uLevel.value = lvl
      m.zone.uniforms.uTime.value = tt
      place(m.badge, m.x, 2.6, m.z, lvl)
    })
    if (this.rim) {
      this.rim.uniforms.uLevel.value = rep.rim
      this.rim.uniforms.uPulse.value = pulse(rep.rim)
    }

    // Underglow under nearby rival (red) and allied (blue) bodies.
    let n = 0
    for (const w of sim.worms) {
      const info = rep.rivals.get(w.id)
      if (!info || !w.alive || (!info.glow && !info.ally)) continue
      if (info.ally && !info.glow) continue
      const col = info.ally ? this.blue : this.red
      const sc = w.radius * (info.level === 2 ? 3.6 : 3.1)
      for (let s = 0; s < w.xs.length && n < MAX_GLOW; s += 2) {
        this.m4.compose(this.v.set(w.xs[s], 0, w.zs[s]), this.q, this.s.set(sc, 1, sc))
        this.glow.setMatrixAt(n, this.m4)
        this.glow.setColorAt(n, col)
        n++
      }
    }
    this.glow.count = n
    this.glow.instanceMatrix.needsUpdate = true
    if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true

    // Look-ahead line and reticle on the most urgent danger.
    const P = sim.player
    const f = rep.focus
    const show = full && !!f && P.alive
    this.reticle.visible = show
    this.path.visible = show
    if (show && f) {
      const k = calm ? 1 : 1 + 0.12 * Math.sin(t * 14)
      this.reticle.position.set(f.x, 1.2, f.z)
      this.reticle.scale.setScalar(size * 0.9 * k)
      const hx = P.xs[0], hz = P.zs[0]
      const dx = f.x - hx, dz = f.z - hz
      const len = Math.max(0.5, Math.hypot(dx, dz) - size * 0.3)
      this.path.position.set(hx + (dx / (Math.hypot(dx, dz) || 1)) * len * 0.5, -1.0, hz + (dz / (Math.hypot(dx, dz) || 1)) * len * 0.5)
      this.path.rotation.set(-Math.PI / 2, 0, -Math.atan2(dz, dx))
      this.path.scale.set(len, 0.45, 1)
      this.pathMat.uniforms.uLen.value = len
      this.pathMat.uniforms.uTime.value = tt
    }
  }

  clear(): void {
    this.glow.count = 0
    this.reticle.visible = false
    this.path.visible = false
  }
}
