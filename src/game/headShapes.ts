import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { HeadStyle } from './appearance'

const cache = new Map<HeadStyle, THREE.BufferGeometry>()
/** Geometry is shared across worms. Eyes, halo and crown remain independent view layers. */
export function headGeometry(style: HeadStyle): THREE.BufferGeometry {
  const cached = cache.get(style)
  if (cached) return cached
  let core: THREE.BufferGeometry = new THREE.SphereGeometry(1, 28, 20)
  const extras: THREE.BufferGeometry[] = []
  const horn = (x: number, y: number, z: number, radius = 0.3, height = 0.8) =>
    new THREE.ConeGeometry(radius, height, 8).translate(x, y, z)
  switch (style) {
    case 'crystal': core.dispose(); core = new THREE.IcosahedronGeometry(1.1, 0); break
    case 'robot':
      core.dispose(); core = new THREE.BoxGeometry(1.75, 1.55, 1.65)
      extras.push(new THREE.BoxGeometry(0.35, 0.65, 2.2).translate(-0.3, 0, 0), horn(-0.35, 1, 0, 0.12, 0.65))
      break
    case 'comet': core.dispose(); core = new THREE.ConeGeometry(0.95, 2.3, 24).rotateZ(-Math.PI / 2); break
    case 'dragon':
      core.scale(1.1, 0.85, 0.9)
      extras.push(horn(-0.45, 0.95, -0.6), horn(-0.45, 0.95, 0.6), new THREE.BoxGeometry(0.7, 0.35, 0.85).translate(0.8, -0.1, 0))
      break
    case 'cat': extras.push(horn(-0.2, 0.95, -0.65, 0.4), horn(-0.2, 0.95, 0.65, 0.4)); break
    case 'cyclops': core.scale(0.95, 1.12, 0.95); break
    case 'manta':
      core.scale(1.05, 0.6, 1.2)
      extras.push(new THREE.ConeGeometry(0.55, 1.4, 3).rotateX(Math.PI / 2).translate(-0.3, 0, 1.15), new THREE.ConeGeometry(0.55, 1.4, 3).rotateX(-Math.PI / 2).translate(-0.3, 0, -1.15))
      break
  }
  const parts = [core, ...extras].map(g => g.index ? g.toNonIndexed() : g)
  const geometry = mergeGeometries(parts)!
  for (const g of new Set([core, ...extras, ...parts])) g.dispose()
  geometry.computeBoundingSphere()
  cache.set(style, geometry)
  return geometry
}
