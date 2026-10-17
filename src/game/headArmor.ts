import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const cache = new Map<number, THREE.BufferGeometry>()
/** Three cached merged layers, never a mesh per plate per worm. Facing is +X. */
export function headArmorGeometry(layer: number): THREE.BufferGeometry {
  const cached = cache.get(layer)
  if (cached) return cached
  const parts: THREE.BufferGeometry[] = []
  const x = -0.47 - layer * 0.24
  const radius = 0.88 + layer * 0.025
  // Horseshoe neck collar; a deliberate opening leaves the lower jaw unobstructed.
  const collar = new THREE.TorusGeometry(radius, 0.07 + layer * 0.025, 6, 24, Math.PI * 1.55)
  collar.rotateZ(-Math.PI * 0.275).rotateY(Math.PI / 2).translate(x, 0.05, 0)
  parts.push(collar)
  for (let side = -1; side <= 1; side++) {
    const plate = new THREE.SphereGeometry(1, 12, 8)
    plate.scale(0.47 + layer * 0.04, side === 0 ? 0.14 : 0.38, side === 0 ? 0.53 : 0.15)
    plate.translate(x + 0.12, side === 0 ? 0.94 : 0.2, side * 0.9)
    parts.push(plate)
  }
  const flat = parts.map(g => g.toNonIndexed())
  const geometry = mergeGeometries(flat)!
  for (const g of [...parts, ...flat]) g.dispose()
  geometry.computeBoundingSphere()
  geometry.userData.shared = true
  cache.set(layer, geometry)
  return geometry
}

let bodyPlate: THREE.BufferGeometry | null = null
/** A single instanced shell on selected body beads, not thousands of independent objects. */
export function bodyArmorGeometry(): THREE.BufferGeometry {
  if (bodyPlate) return bodyPlate
  bodyPlate = new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.44)
  bodyPlate.userData.shared = true
  return bodyPlate
}
