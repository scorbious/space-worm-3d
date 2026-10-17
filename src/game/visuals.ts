/**
 * Visual building blocks. Surfaces come from the streamed media set (src/media) through
 * `assetTexture`, which returns a usable texture immediately and upgrades it in place when the
 * file arrives, so nothing waits on the network. Shaders stay small and bloom-friendly.
 */
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { assets } from '../engine/assets'
import type { CelestialId, PickupId } from './content'
import { PICKUP_COLORS } from './content'

// ─── Noise ─────────────────────────────────────────────────────────────────
function hash3(x: number, y: number, z: number, seed: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.19) * 43758.5453
  return s - Math.floor(s)
}

function valueNoise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const xf = x - xi, yf = y - yi, zf = z - zi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf)
  let out = 0
  for (let dx = 0; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) for (let dz = 0; dz <= 1; dz++) {
    const weight = (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w)
    out += weight * hash3(xi + dx, yi + dy, zi + dz, seed)
  }
  return out
}

// ─── Textures ──────────────────────────────────────────────────────────────
function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const texCache = new Map<string, THREE.Texture>()
/**
 * Texture backed by a streamed asset. Starts as a flat placeholder tinted `fallback` and swaps
 * to the real image (new Source, so GPU storage is reallocated) once `assets` delivers it.
 */
export function assetTexture(id: string, opts: { srgb?: boolean; repeat?: number; fallback?: string } = {}): THREE.Texture {
  const key = `${id}|${opts.repeat ?? 1}|${opts.srgb !== false}`
  const hit = texCache.get(key)
  if (hit) return hit
  const tex: THREE.Texture = canvasTexture(4, 4, ctx => {
    ctx.fillStyle = opts.fallback ?? '#808080'
    ctx.fillRect(0, 0, 4, 4)
  })
  tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace
  if (opts.repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(opts.repeat, opts.repeat)
  } else {
    tex.wrapS = THREE.RepeatWrapping
  }
  tex.anisotropy = 4
  texCache.set(key, tex)
  assets.when(id, v => {
    if (!(v instanceof HTMLImageElement)) return
    // Immutable GPU storage was sized for the placeholder: release it so the next upload
    // allocates storage matching the real image.
    tex.dispose()
    tex.image = v
    tex.needsUpdate = true
  })
  return tex
}

let glowTex: THREE.Texture | null = null
export function glowTexture(): THREE.Texture {
  glowTex ??= canvasTexture(128, 128, ctx => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)')
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
  })
  return glowTex
}

export function nebulaTexture(hue: number, seed: number): THREE.Texture {
  return canvasTexture(256, 256, ctx => {
    const rand = (i: number) => hash3(i, seed, 1, seed)
    for (let i = 0; i < 26; i++) {
      const x = 60 + rand(i) * 136
      const y = 60 + rand(i + 40) * 136
      const r = 30 + rand(i + 80) * 70
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      const h = hue + (rand(i + 120) - 0.5) * 60
      g.addColorStop(0, `hsla(${h},90%,65%,0.22)`)
      g.addColorStop(1, `hsla(${h},90%,40%,0)`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 256, 256)
    }
  })
}

const labelCache = new Map<string, THREE.Texture>()
/** Crisp text sprite texture (names, requirement numbers). */
export function labelTexture(text: string, color: string, size = 44): THREE.Texture {
  const key = `${text}|${color}|${size}`
  const cached = labelCache.get(key)
  if (cached) return cached
  const font = `700 ${size}px Sora, 'Noto Sans Arabic', system-ui, sans-serif`
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = font
  const w = Math.ceil(measure.measureText(text).width + size * 0.9)
  const h = Math.ceil(size * 1.5)
  const tex = canvasTexture(w, h, ctx => {
    ctx.font = font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.lineWidth = size * 0.22
    ctx.strokeStyle = 'rgba(5,4,20,0.85)'
    ctx.strokeText(text, w / 2, h / 2)
    ctx.fillStyle = color
    ctx.fillText(text, w / 2, h / 2)
  })
  tex.userData = { aspect: w / h }
  labelCache.set(key, tex)
  return tex
}

export function makeLabel(text: string, color: string, height: number): THREE.Sprite {
  const tex = labelTexture(text, color)
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false })
  const s = new THREE.Sprite(mat)
  s.scale.set(height * (tex.userData.aspect as number), height, 1)
  s.renderOrder = 20
  return s
}

/** Billboard using one of the HUD icons (pickups, crown). */
export function iconSprite(icon: string, size: number): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({ map: assetTexture(`icon/${icon}`, { fallback: '#00000000' }), transparent: true, depthWrite: false })
  const s = new THREE.Sprite(mat)
  s.scale.setScalar(size)
  s.renderOrder = 12
  return s
}

// ─── Materials ─────────────────────────────────────────────────────────────
const LIGHT_DIR = 'normalize(vec3(0.35, 0.9, 0.25))'

/**
 * Glossy translucent "jelly" used for worm bodies and heads: soft wrap diffuse, a bright fresnel
 * rim in the body colour, a tight specular highlight and a faint inner glow. Instanced variant
 * reads colour from `instanceColor`; the single-mesh variant from `uColor`.
 */
export function jellyMaterial(instanced: boolean, glow = 0.35, tinted = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: { ...(instanced ? { JELLY_INSTANCED: '' } : {}), ...(tinted ? { HEAD_TINT: '' } : {}) },
    uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uGlow: { value: glow }, uOpacity: { value: 1 }, uSolid: { value: 0 }, uFaceted: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vW; varying vec3 vC; uniform vec3 uColor;
      #ifdef HEAD_TINT
        attribute vec3 color;
      #endif
      void main(){
        mat4 m = modelMatrix;
        #ifdef JELLY_INSTANCED
          m = modelMatrix * instanceMatrix; vC = instanceColor;
        #else
          vC = uColor;
        #endif
        #ifdef HEAD_TINT
          vC *= color;
        #endif
        vec4 w = m * vec4(position, 1.0); vW = w.xyz;
        vN = normalize(mat3(m) * normal);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uGlow; uniform float uOpacity; uniform float uSolid; uniform float uFaceted; varying vec3 vN; varying vec3 vW; varying vec3 vC;
      void main(){
        vec3 N = normalize(mix(normalize(vN), normalize(cross(dFdx(vW), dFdy(vW))), uFaceted));
        vec3 V = normalize(cameraPosition - vW); vec3 L = ${LIGHT_DIR};
        float wrap = max(0.0, (dot(N, L) + 0.35) / 1.35);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 2.4);
        vec3 H = normalize(L + V); float spec = pow(max(dot(N, H), 0.0), 60.0);
        float ndv = max(dot(N, V), 0.0);
        float inner = pow(ndv, 3.0);
        // Contact darkening towards the silhouette separates overlapping beads; a tight rim
        // keeps the glassy edge without washing the body out.
        float contact = 0.45 + 0.55 * smoothstep(0.0, 0.55, ndv);
        float rim = pow(1.0 - ndv, 4.0);
        // Soft-compress pale skins so white bodies stay glossy instead of clipping to flat white.
        vec3 alb = vC / (1.0 + max(vC.r, max(vC.g, vC.b)) * 0.45);
        vec3 col = alb * (0.16 + 0.8 * wrap) * contact + alb * inner * 0.25 + alb * rim * (0.38 + uGlow * 0.65) + vec3(spec * 0.5);
        vec3 solid = alb * (0.2 + 0.85 * max(dot(N,L),0.0)) * contact + vec3(spec * 0.65) + alb * fres * 0.16;
        col = mix(col, solid, uSolid);
        gl_FragColor = vec4(col, uOpacity);
        #include <colorspace_fragment>
      }`,
    transparent: !instanced,
  })
}

/** Faceted glowing crystal for energy motes (instanced). */
export function crystalMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `varying vec3 vW; varying vec3 vC; varying vec3 vL;
      void main(){ mat4 m = modelMatrix * instanceMatrix; vC = instanceColor; vL = position;
        vec4 w = m * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying vec3 vW; varying vec3 vC; varying vec3 vL;
      void main(){
        vec3 N = normalize(cross(dFdx(vW), dFdy(vW)));
        vec3 V = normalize(cameraPosition - vW); vec3 L = ${LIGHT_DIR};
        float facet = 0.28 + 0.72 * max(dot(N, L), 0.0);
        float fres = pow(1.0 - abs(dot(N, V)), 2.0);
        float glint = pow(max(dot(reflect(-L, N), V), 0.0), 18.0);
        float core = 1.0 - length(vL) * 0.5;
        vec3 col = vC * facet * (0.85 + core * 0.55) + vec3(1.0) * (fres * 0.2 + glint * 0.45);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  })
}

/** Camera-facing additive halo quads (instanced), used under motes, shards and pickups. */
export function glowQuadMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0.5 } },
    vertexShader: `varying vec2 vUv; varying vec3 vC;
      void main(){ vUv = uv; vC = instanceColor;
        vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float s = length(instanceMatrix[0].xyz);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 p = center + (right * position.x + up * position.y) * s;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `uniform float uOpacity; varying vec2 vUv; varying vec3 vC;
      void main(){ float r = length(vUv - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - r), 2.2);
        gl_FragColor = vec4(vC, a * uOpacity); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
}

export function fresnelMaterial(color: number, power = 2.2, intensity = 0.9): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uPower: { value: power }, uIntensity: { value: intensity }, uOpacity: { value: 1 } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uPower; uniform float uIntensity; uniform float uOpacity; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - abs(dot(vN, vV)), uPower); gl_FragColor = vec4(uColor * uIntensity, (f * 0.9 + 0.06) * uOpacity); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
}

/** Hexagonal energy shield bubble with a moving scanline and fresnel edge. */
export function shieldMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 }, uColor: { value: new THREE.Color(0x5cc8ff) } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform float uTime; uniform float uOpacity; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      float hexd(vec2 p){ p = abs(p); return max(dot(p, normalize(vec2(1.0,1.732))), p.x); }
      void main(){
        vec2 uv = vec2(atan(vP.z, vP.x) * 2.2, vP.y * 3.4);
        vec2 a = mod(uv, vec2(1.0,1.732)) - vec2(0.5,0.866);
        vec2 b = mod(uv + vec2(0.5,0.866), vec2(1.0,1.732)) - vec2(0.5,0.866);
        vec2 g = dot(a,a) < dot(b,b) ? a : b;
        float edge = smoothstep(0.40, 0.48, hexd(g));
        float f = pow(1.0 - abs(dot(vN, vV)), 2.0);
        float scan = smoothstep(0.08, 0.0, abs(fract(vP.y * 0.5 + uTime * 0.6) - 0.5) - 0.42);
        float a2 = (f * 0.32 + edge * 0.1 + scan * 0.06 + 0.01) * uOpacity;
        gl_FragColor = vec4(uColor * (0.6 + edge * 0.3), a2);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  })
}

/** Expanding shockwave ring (flat on the arena). `uT` 0..1 drives radius and fade. */
export function shockwaveMaterial(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uColor: { value: new THREE.Color(color) }, uWidth: { value: 0.12 } },
    vertexShader: 'varying vec2 vP; void main(){ vP = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uT; uniform vec3 uColor; uniform float uWidth; varying vec2 vP;
      void main(){ float r = length(vP); float R = uT; float w = uWidth * (1.0 - uT * 0.5);
        float ring = smoothstep(w, 0.0, abs(r - R)); float inner = smoothstep(R, 0.0, r) * 0.18 * (1.0 - uT);
        float a = (ring + inner) * (1.0 - uT) * (1.0 - uT);
        if (a < 0.003) discard; gl_FragColor = vec4(uColor * 0.9, a * 0.8); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  })
}

// ─── Celestial bodies ──────────────────────────────────────────────────────
export type CelestialVisual = THREE.Group & {
  userData: { kind: CelestialId; spinner: THREE.Object3D; tail?: THREE.Object3D; beams?: THREE.Object3D; corona?: THREE.Sprite; surface?: THREE.ShaderMaterial }
}

const sphereGeo = new THREE.SphereGeometry(1, 48, 32)
const lowSphereGeo = new THREE.SphereGeometry(1, 24, 16)
const shared = <T extends THREE.Material>(m: T): T => {
  m.userData.shared = true
  return m
}

/** Emissive surface that slowly churns its texture (stars, pulsars). */
function burningSurface(tex: string, tint: number, intensity: number, fallback: string): THREE.ShaderMaterial {
  return shared(new THREE.ShaderMaterial({
    uniforms: { uMap: { value: assetTexture(tex, { fallback }) }, uTime: { value: 0 }, uTint: { value: new THREE.Color(tint) }, uI: { value: intensity } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D uMap; uniform float uTime; uniform vec3 uTint; uniform float uI; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        vec2 w = vec2(sin(vUv.y * 18.0 + uTime * 0.9) * 0.006, cos(vUv.x * 22.0 - uTime * 0.7) * 0.006);
        vec3 a = texture2D(uMap, vUv + w + vec2(uTime * 0.004, 0.0)).rgb;
        vec3 b = texture2D(uMap, vUv * 1.7 - w + vec2(-uTime * 0.006, 0.0)).rgb;
        vec3 c = mix(a, b, 0.35);
        float limb = pow(max(dot(normalize(vN), normalize(vV)), 0.0), 0.45);
        gl_FragColor = vec4(c * uTint * uI * (0.3 + 0.7 * limb) + uTint * pow(1.0 - limb, 3.0) * 0.35, 1.0);
      }`,
  }))
}

const MATS: Partial<Record<string, THREE.Material>> = {}
function mat<T extends THREE.Material>(key: string, make: () => T): T {
  return (MATS[key] ??= shared(make())) as T
}

function planetRingMaterial(): THREE.ShaderMaterial {
  return mat('planet-ring', () => new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec2 vUv;
      void main(){ float r = vUv.x; float bands = 0.55 + 0.45 * sin(r * 70.0) * sin(r * 23.0 + 1.3);
        float gap = smoothstep(0.52, 0.55, r) * (1.0 - smoothstep(0.58, 0.61, r));
        float edge = smoothstep(0.0, 0.08, r) * (1.0 - smoothstep(0.9, 1.0, r));
        vec3 c = mix(vec3(1.0, 0.8, 0.55), vec3(0.85, 0.6, 0.95), r);
        gl_FragColor = vec4(c, edge * bands * (1.0 - gap * 0.85) * 0.75); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }))
}

/** Ring geometry whose uv.x runs 0..1 from inner to outer edge. */
function radialRing(inner: number, outer: number, seg = 96): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(inner, outer, seg, 1)
  const pos = g.attributes.position as THREE.BufferAttribute
  const uv = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i))
    uv.setXY(i, (r - inner) / (outer - inner), 0)
  }
  return g
}

function tailMaterial(): THREE.ShaderMaterial {
  return mat('comet-tail', () => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uTime; varying vec2 vUv;
      void main(){ float x = vUv.x; float y = abs(vUv.y - 0.5) * 2.0;
        float width = mix(0.25, 1.0, x);
        float body = smoothstep(width, 0.0, y) * pow(1.0 - x, 1.4);
        float streak = 0.6 + 0.4 * sin(y * 20.0 + x * 12.0 - uTime * 6.0);
        vec3 c = mix(vec3(0.75, 1.0, 1.0), vec3(0.25, 0.55, 1.0), x);
        gl_FragColor = vec4(c * 0.9, body * streak * 0.5); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }))
}

function beamMaterial(): THREE.ShaderMaterial {
  return mat('pulsar-beam', () => new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec2 vUv;
      void main(){ float a = pow(vUv.y, 2.2) * (0.75 + 0.25 * sin(vUv.x * 6.2832 * 3.0)); gl_FragColor = vec4(vec3(0.62, 0.55, 1.0), a * 0.28); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }))
}

function buildCelestial(kind: CelestialId): CelestialVisual {
  const g = new THREE.Group() as CelestialVisual
  const spinner = new THREE.Group()
  g.add(spinner)
  g.userData = { kind, spinner }
  const glowSprite = (color: number, size: number, opacity: number) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }))
  s.userData.base = opacity
    s.scale.setScalar(size)
    return s
  }
  switch (kind) {
    case 'moon': {
      const m = mat('moon', () => new THREE.MeshStandardMaterial({
        map: assetTexture('tex/moon', { fallback: '#a8a4b8' }), roughness: 0.95, metalness: 0,
        emissive: 0x3a3650, emissiveMap: assetTexture('tex/moon', { fallback: '#a8a4b8' }), emissiveIntensity: 0.3,
      }))
      spinner.add(new THREE.Mesh(sphereGeo, m))
      const atmo = new THREE.Mesh(lowSphereGeo, mat('moon-atmo', () => fresnelMaterial(0xcfd8ff, 3.2, 0.6)))
      atmo.scale.setScalar(1.08)
      g.add(atmo)
      break
    }
    case 'comet': {
      const m = mat('comet', () => new THREE.MeshStandardMaterial({
        map: assetTexture('tex/comet', { fallback: '#8fd8ee' }), roughness: 0.55, metalness: 0.05,
        emissive: 0x2fa8d8, emissiveMap: assetTexture('tex/comet', { fallback: '#8fd8ee' }), emissiveIntensity: 0.38,
      }))
      const core = new THREE.Mesh(sphereGeo, m)
      core.scale.set(1, 0.86, 0.92)
      spinner.add(core)
      g.add(glowSprite(0x8fe8ff, 3.6, 0.28))
      const tail = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.6), tailMaterial())
      tail.rotation.x = -Math.PI / 2
      tail.position.x = -3.3
      const pivot = new THREE.Group()
      pivot.add(tail)
      g.add(pivot)
      g.userData.tail = pivot
      break
    }
    case 'planet': {
      const m = mat('planet', () => new THREE.MeshStandardMaterial({
        map: assetTexture('tex/gasgiant', { fallback: '#e0a070' }), roughness: 0.8, metalness: 0,
        emissive: 0x6a3818, emissiveMap: assetTexture('tex/gasgiant', { fallback: '#e0a070' }), emissiveIntensity: 0.26,
      }))
      spinner.add(new THREE.Mesh(sphereGeo, m))
      const ring = new THREE.Mesh(radialRing(1.35, 2.25), planetRingMaterial())
      ring.rotation.x = -Math.PI / 2 + 0.42
      ring.rotation.y = 0.2
      g.add(ring)
      g.add(new THREE.Mesh(lowSphereGeo, mat('planet-atmo', () => fresnelMaterial(0xffc890, 3, 0.7))))
      ;(g.children[g.children.length - 1] as THREE.Mesh).scale.setScalar(1.06)
      break
    }
    case 'star': {
      const surface = burningSurface('tex/star', 0xffc27a, 1.0, '#ff9a3d')
      spinner.add(new THREE.Mesh(sphereGeo, surface))
      g.userData.surface = surface
      const corona = glowSprite(0xff8a3d, 4.0, 0.3)
      g.add(corona)
      g.userData.corona = corona
      g.add(glowSprite(0xffe2a8, 2.4, 0.3))
      break
    }
    case 'pulsar': {
      const surface = burningSurface('tex/pulsar', 0xd6ccff, 0.95, '#b9a8ff')
      spinner.add(new THREE.Mesh(sphereGeo, surface))
      g.userData.surface = surface
      const beams = new THREE.Group()
      const bm = beamMaterial()
      for (const dir of [1, -1]) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.42, 4.6, 20, 1, true), bm)
        cone.position.y = dir * 3.6
        cone.rotation.x = dir > 0 ? Math.PI : 0
        beams.add(cone)
      }
      beams.rotation.z = 1.05
      g.add(beams)
      g.userData.beams = beams
      const halo = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.05, 8, 64), mat('pulsar-halo', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb9a8ff), transparent: true, opacity: 0.35 })))
      halo.rotation.x = Math.PI / 2
      g.add(halo)
      const corona = glowSprite(0xb9a8ff, 3.4, 0.26)
      g.add(corona)
      g.userData.corona = corona
      break
    }
  }
  return g
}

export function makeCelestial(kind: CelestialId): CelestialVisual {
  return buildCelestial(kind)
}

export function animateCelestial(v: CelestialVisual, t: number, spin: number, heading: number, calm: boolean): void {
  const u = v.userData
  u.spinner.rotation.y = spin
  if (u.tail) u.tail.rotation.y = -heading
  if (u.beams) u.beams.rotation.y = calm ? 0 : t * 3.2
  if (u.corona && !calm) u.corona.material.opacity = (u.corona.userData.base ?? 0.3) * (0.85 + 0.15 * Math.sin(t * 3 + spin))
  if (u.surface) u.surface.uniforms.uTime.value = calm ? 0 : t
  const tail = MATS['comet-tail'] as THREE.ShaderMaterial | undefined
  if (tail) tail.uniforms.uTime.value = calm ? 0 : t
}

// ─── Hazards ───────────────────────────────────────────────────────────────
/** Smooth lumpy rock with spherical UVs so the rock texture and normal map wrap cleanly. */
export function asteroidGeometry(seed: number): THREE.BufferGeometry {
  let geo: THREE.BufferGeometry = new THREE.SphereGeometry(1, 40, 28)
  geo.deleteAttribute('normal')
  geo = mergeVertices(geo)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const n = valueNoise(v.x * 1.4 + 3, v.y * 1.4, v.z * 1.4, seed) * 0.65
      + valueNoise(v.x * 3.1, v.y * 3.1 + 7, v.z * 3.1, seed + 3) * 0.25
      + valueNoise(v.x * 7, v.y * 7, v.z * 7 + 1, seed + 9) * 0.1
    v.multiplyScalar(0.78 + n * 0.42)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
  return geo
}

export function rockMaterial(): THREE.MeshStandardMaterial {
  return mat('rock', () => new THREE.MeshStandardMaterial({
    map: assetTexture('tex/rock', { fallback: '#5c5468', repeat: 2 }),
    normalMap: assetTexture('tex/rock-normal', { fallback: '#8080ff', repeat: 2, srgb: false }),
    normalScale: new THREE.Vector2(1.4, 1.4),
    color: 0xb4a8c4, roughness: 0.93, metalness: 0.04, emissive: 0x160f22, emissiveIntensity: 1,
  }))
}

export function metalMaterial(): THREE.MeshStandardMaterial {
  return mat('metal', () => new THREE.MeshStandardMaterial({
    map: assetTexture('tex/metal', { fallback: '#3a3f58', repeat: 1 }),
    normalMap: assetTexture('tex/metal-normal', { fallback: '#8080ff', repeat: 1, srgb: false }),
    color: 0xc8cce8, roughness: 0.38, metalness: 0.75, emissive: 0x0c1030, emissiveIntensity: 1,
  }))
}

// ─── Pickups ───────────────────────────────────────────────────────────────
const PICKUP_ICON: Record<PickupId, string> = { magnet: 'magnet', shield: 'shield', freeBoost: 'boost' }

export function makePickup(kind: PickupId): THREE.Group {
  const g = new THREE.Group()
  const color = PICKUP_COLORS[kind]
  const orb = new THREE.Mesh(lowSphereGeo, mat(`pickup-orb-${kind}`, () => fresnelMaterial(color, 2.2, 1.5)))
  orb.scale.setScalar(1.35)
  orb.name = 'orb'
  g.add(orb)
  const icon = iconSprite(PICKUP_ICON[kind], 2.1)
  icon.name = 'icon'
  g.add(icon)
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.7, 1.95, 48), mat(`pickup-ring-${kind}`, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.05), transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false })))
  ring.rotation.x = -Math.PI / 2
  ring.position.y = -1.9
  ring.name = 'ring'
  g.add(ring)
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.26, blending: THREE.AdditiveBlending, depthWrite: false }))
  glow.scale.setScalar(5.5)
  g.add(glow)
  return g
}
