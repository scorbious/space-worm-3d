import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { HeadStyle } from './appearance'

type Point = [number, number, number]
const cache = new Map<HeadStyle, THREE.BufferGeometry>()

/** Facial landmarks follow each silhouette, rather than floating inside a generic sphere. */
export const HEAD_FEATURES: Record<HeadStyle, { eye: Point; size: number; mouth: Point; width: number }> = {
  round: { eye: [0.55, 0.65, 0.48], size: 0.31, mouth: [1.19, -0.2, 0], width: 0.4 },
  crystal: { eye: [0.62, 0.57, 0.43], size: 0.27, mouth: [1.12, -0.18, 0], width: 0.33 },
  robot: { eye: [0.65, 0.58, 0.46], size: 0.26, mouth: [1.17, -0.21, 0], width: 0.38 },
  comet: { eye: [0.6, 0.56, 0.42], size: 0.29, mouth: [1.1, -0.16, 0], width: 0.32 },
  dragon: { eye: [0.51, 0.62, 0.55], size: 0.27, mouth: [1.45, -0.18, 0], width: 0.43 },
  cat: { eye: [0.56, 0.65, 0.46], size: 0.34, mouth: [1.02, -0.12, 0], width: 0.24 },
  cyclops: { eye: [0.64, 0.65, 0], size: 0.47, mouth: [1.13, -0.28, 0], width: 0.4 },
  manta: { eye: [0.55, 0.35, 0.48], size: 0.25, mouth: [1.2, -0.12, 0], width: 0.45 },
}

function tint(geometry: THREE.BufferGeometry, hex = 0xffffff): THREE.BufferGeometry {
  const c = new THREE.Color(hex)
  const color = new Float32Array(geometry.getAttribute('position').count * 3)
  for (let i = 0; i < color.length; i += 3) { color[i] = c.r; color[i + 1] = c.g; color[i + 2] = c.b }
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3))
  return geometry
}

/** A curved, tapering loft with rounded shoulders; used for horns, ears and flame lobes. */
function sweep(points: Point[], radii: number[], sides = 9, rings = 12, flatten = 1): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)))
  const frames = curve.computeFrenetFrames(rings, false)
  const positions: number[] = []
  const indices: number[] = []
  const center = new THREE.Vector3()
  for (let i = 0; i <= rings; i++) {
    const t = i / rings
    curve.getPoint(t, center)
    const k = t * (radii.length - 1)
    const a = Math.min(radii.length - 2, Math.floor(k))
    const r = THREE.MathUtils.lerp(radii[a], radii[a + 1], k - a)
    for (let j = 0; j <= sides; j++) {
      const angle = j / sides * Math.PI * 2
      const n = frames.normals[i], b = frames.binormals[i]
      const u = Math.cos(angle) * r, v = Math.sin(angle) * r * flatten
      positions.push(center.x + n.x * u + b.x * v, center.y + n.y * u + b.y * v, center.z + n.z * u + b.z * v)
      if (i < rings && j < sides) {
        const q = i * (sides + 1) + j
        indices.push(q, q + 1, q + sides + 1, q + 1, q + sides + 2, q + sides + 1)
      }
    }
  }
  // Close the base; the final ring is almost a point, without degenerate tip normals.
  positions.push(...points[0])
  const cap = positions.length / 3 - 1
  for (let j = 0; j < sides; j++) indices.push(cap, j + 1, j)
  positions.push(...points[points.length - 1])
  const tip = positions.length / 3 - 1, lastRing = rings * (sides + 1)
  for (let j = 0; j < sides; j++) indices.push(tip, lastRing + j, lastRing + j + 1)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** Closed swept manta fin: thick at the shoulder and thin, recurved at its wingtip. */
function mantaWing(side: number): THREE.BufferGeometry {
  const positions: number[] = [], indices: number[] = []
  const spans = 12, chords = 10
  for (let layer = 0; layer < 2; layer++) for (let i = 0; i <= spans; i++) {
    const u = i / spans
    const width = 1.5 * Math.pow(1 - u, 0.65) + 0.025
    const centerX = -0.1 - 0.75 * u + 0.35 * u * u
    for (let j = 0; j <= chords; j++) {
      const v = j / chords
      const arch = Math.sin(v * Math.PI)
      positions.push(centerX + (v - 0.5) * width, 0.12 * Math.sin(u * Math.PI) + 0.26 * u * u + (layer ? -1 : 1) * arch * (0.19 * (1 - u) + 0.015), side * (0.65 + u * 1.35))
    }
  }
  const row = chords + 1, layerSize = (spans + 1) * row
  for (let layer = 0; layer < 2; layer++) for (let i = 0; i < spans; i++) for (let j = 0; j < chords; j++) {
    const a = layer * layerSize + i * row + j
    indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1)
  }
  for (let i = 0; i < spans; i++) for (const j of [0, chords]) {
    const a = i * row + j, b = a + row
    indices.push(a, a + layerSize, b, b, a + layerSize, b + layerSize)
  }
  for (const i of [0, spans]) for (let j = 0; j < chords; j++) {
    const a = i * row + j
    indices.push(a, a + 1, a + layerSize, a + 1, a + layerSize + 1, a + layerSize)
  }
  // Orient both wings/layers consistently, including the closed edges.
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  // Mirrored surfaces and their underside use geometric outward normals below.
  const p = geometry.getAttribute('position')
  for (let i = 0; i < indices.length; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(p, indices[i])
    const b = new THREE.Vector3().fromBufferAttribute(p, indices[i + 1])
    const c = new THREE.Vector3().fromBufferAttribute(p, indices[i + 2])
    const normal = b.sub(a).cross(c.sub(a))
    const midY = (p.getY(indices[i]) + p.getY(indices[i + 1]) + p.getY(indices[i + 2])) / 3
    const midZ = Math.abs((p.getZ(indices[i]) + p.getZ(indices[i + 1]) + p.getZ(indices[i + 2])) / 3)
    const u = (midZ - 0.65) / 1.35
    const centerY = 0.12 * Math.sin(u * Math.PI) + 0.26 * u * u
    if (normal.y * (midY - centerY) < 0) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]]
  }
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** Shared, one-draw-call sculptures. Eyes, gameplay halo and bounty crown stay separate. */
export function headGeometry(style: HeadStyle): THREE.BufferGeometry {
  const cached = cache.get(style)
  if (cached) return cached
  const parts: THREE.BufferGeometry[] = []
  const lobe = (at: Point, size: Point, color = 0xffffff, detail = 20) => {
    parts.push(tint(new THREE.SphereGeometry(1, detail, 12).scale(...size).translate(...at), color))
  }
  const curved = (points: Point[], radii: number[], color = 0xffffff, sides = 9, flatten = 1) => {
    parts.push(tint(sweep(points, radii, sides, 12, flatten), color))
  }
  switch (style) {
    case 'round':
      lobe([-0.16, 0.06, 0], [0.96, 0.94, 0.95])
      lobe([0.58, -0.16, 0], [0.7, 0.53, 0.73], 0xdce7f2)
      lobe([0.47, -0.52, 0], [0.68, 0.29, 0.67], 0x9cacc6)
      for (const side of [-1, 1]) lobe([0.28, 0.05, side * 0.64], [0.48, 0.5, 0.34], 0xf4f8ff)
      break
    case 'crystal':
      parts.push(tint(new THREE.IcosahedronGeometry(1.02, 1).scale(1.04, 0.87, 0.94)))
      lobe([0.6, -0.25, 0], [0.62, 0.36, 0.64], 0xa9b7ef, 10)
      // An integrated mineral crest, NOT the independent bounty-crown layer.
      for (let i = -2; i <= 2; i++) {
        const z = i * 0.29, height = 1.6 - Math.abs(i) * 0.18
        curved([[-0.25, 0.55, z], [-0.35, 0.96, z * 1.1], [-0.56, height, z * 1.25]], [0.25, 0.23, 0.008], i % 2 ? 0xc6ddff : 0xeaf1ff, 5)
      }
      for (const side of [-1, 1]) curved([[-0.5, 0.12, side * 0.6], [-0.66, 0.35, side * 0.96], [-0.91, 0.45, side * 1.06]], [0.25, 0.2, 0.006], 0x9dacde, 5)
      break
    case 'robot':
      lobe([-0.15, 0, 0], [0.98, 0.84, 0.88], 0x6e809f)
      lobe([-0.24, 0.43, 0], [0.9, 0.55, 0.87], 0xecf3ff)
      lobe([0.64, -0.1, 0], [0.62, 0.4, 0.65], 0xb2c5df)
      lobe([0.43, -0.46, 0], [0.72, 0.23, 0.73], 0x7185a5)
      for (const side of [-1, 1]) {
        lobe([-0.24, -0.04, side * 0.79], [0.63, 0.6, 0.22], 0xd2e4ff)
        lobe([-0.38, 0.02, side * 0.96], [0.33, 0.34, 0.08], 0x5b749e)
        curved([[0.27, 0.61, side * 0.46], [0.63, 0.73, side * 0.42], [0.86, 0.58, side * 0.34]], [0.16, 0.16, 0.08], 0xe9f7ff)
      }
      curved([[-0.65, 0.55, 0], [-0.94, 0.97, 0], [-0.75, 1.21, 0]], [0.11, 0.07, 0.035], 0xbde8ff)
      break
    case 'comet':
      lobe([0.22, 0, 0], [0.94, 0.81, 0.83], 0xffedd1)
      lobe([0.62, -0.3, 0], [0.5, 0.33, 0.57], 0xf2ba87)
      // Curling flame streamers trail behind a rounded hot nucleus.
      curved([[-0.34, 0.1, 0], [-1.09, 0.18, 0], [-1.8, 0.56, 0], [-2.27, 0.47, 0]], [0.68, 0.5, 0.24, 0.008], 0xf0b980)
      for (const side of [-1, 1]) curved([[-0.31, 0.04, side * 0.44], [-0.96, 0.28, side * 0.63], [-1.56, 0.57, side * 0.54], [-1.86, 0.72, side * 0.7]], [0.34, 0.27, 0.11, 0.008], 0xffdba9)
      break
    case 'dragon':
      lobe([-0.15, 0.05, 0], [1.02, 0.86, 0.92])
      lobe([0.75, -0.06, 0], [0.82, 0.44, 0.64], 0xc3d8c8)
      lobe([0.57, -0.49, 0], [0.88, 0.25, 0.64], 0x879aab)
      for (const side of [-1, 1]) {
        curved([[-0.44, 0.63, side * 0.55], [-0.63, 1.04, side * 0.75], [-0.99, 1.35, side * 0.78], [-1.17, 1.61, side * 0.66]], [0.27, 0.22, 0.12, 0.008], 0xffe4be)
        curved([[-0.56, -0.04, side * 0.69], [-0.87, 0.15, side * 1.05], [-1.22, 0.32, side * 1.08]], [0.27, 0.24, 0.01], 0x8eacba, 8, 0.65)
        lobe([0.46, 0.69, side * 0.51], [0.48, 0.16, 0.29], 0xc1d5e4)
        lobe([1.11, 0.2, side * 0.32], [0.16, 0.12, 0.13], 0x6a798e)
      }
      break
    case 'cat':
      lobe([-0.14, 0.07, 0], [0.93, 0.9, 0.94])
      for (const side of [-1, 1]) {
        // Curved, flattened ears with a soft inner-ear inset rather than cones.
        curved([[-0.3, 0.64, side * 0.55], [-0.33, 1.02, side * 0.66], [-0.39, 1.44, side * 0.74]], [0.36, 0.26, 0.012], 0xffffff, 10, 0.65)
        curved([[-0.04, 0.78, side * 0.55], [-0.15, 1.08, side * 0.65], [-0.28, 1.33, side * 0.71]], [0.17, 0.14, 0.008], 0xdba3bd, 9, 0.45)
        lobe([0.53, -0.2, side * 0.24], [0.54, 0.37, 0.41], 0xf9f2e9)
        lobe([0.28, 0.01, side * 0.76], [0.35, 0.25, 0.17], 0xeec4d2)
      }
      lobe([0.99, 0.03, 0], [0.13, 0.1, 0.17], 0x9c738a)
      break
    case 'cyclops':
      lobe([-0.15, 0.04, 0], [0.98, 1.05, 0.98])
      lobe([0.61, -0.34, 0], [0.6, 0.4, 0.67], 0xbdc7df)
      // Heavy orbital brow frames the single large eye.
      curved([[0.5, 0.64, -0.49], [0.32, 1.02, -0.34], [0.26, 1.16, 0], [0.32, 1.02, 0.34], [0.5, 0.64, 0.49]], [0.16, 0.22, 0.24, 0.22, 0.16], 0xe3ebff)
      for (const side of [-1, 1]) lobe([-0.13, -0.05, side * 0.85], [0.47, 0.41, 0.25], 0x96a9c9)
      break
    case 'manta':
      lobe([0.13, 0, 0], [1.05, 0.44, 0.83])
      lobe([0.64, -0.2, 0], [0.6, 0.22, 0.66], 0xc3dce5)
      for (const side of [-1, 1]) {
        parts.push(tint(mantaWing(side), 0xc2deec))
        curved([[0.65, 0, side * 0.56], [1.06, 0.08, side * 0.66], [1.34, 0.25, side * 0.47]], [0.23, 0.15, 0.016], 0xe4f2ff)
      }
      break
  }
  // Lofted surfaces have no UVs; the head shader needs only position, normal and color.
  for (const part of parts) part.deleteAttribute('uv')
  const flat = parts.map(g => g.index ? g.toNonIndexed() : g)
  const geometry = mergeGeometries(flat)!
  for (const g of new Set([...parts, ...flat])) g.dispose()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  geometry.userData.shared = true
  cache.set(style, geometry)
  return geometry
}
