import * as THREE from 'three'
import { SPECIAL_COLORS, type SurpriseId, type TrapId } from './specials'
import { glowTexture, makeLabel } from './visuals'

const SYMBOLS: Record<SurpriseId | TrapId, string> = { zone: '+', legendary: '★', shrink: '−', freeze: '❄', slow: '≈', reverse: '↶', half: '½', teleport: '↔' }
export function makeSpecial(kind: SurpriseId | TrapId, trap: boolean): THREE.Group {
  const group = new THREE.Group()
  const color = SPECIAL_COLORS[kind]
  const geometry = kind === 'legendary' ? new THREE.IcosahedronGeometry(1.25, 0)
    : kind === 'teleport' || kind === 'zone' ? new THREE.TorusGeometry(1, 0.28, 8, 24)
      : kind === 'half' ? new THREE.BoxGeometry(1.4, 1.4, 1.4)
        : new THREE.OctahedronGeometry(kind === 'shrink' ? 0.85 : 1.05, 0)
  const core = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.2 }))
  core.name = 'core'
  group.add(core)
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.7, 1.9, trap ? 6 : 40), new THREE.MeshBasicMaterial({ color: trap ? 0xff4d6d : 0xffd54f, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }))
  ring.rotation.x = -Math.PI / 2
  ring.position.y = -1.3
  group.add(ring)
  const symbol = makeLabel(SYMBOLS[kind], `#${color.toString(16).padStart(6, '0')}`, 1.6)
  symbol.position.y = 2.3
  group.add(symbol)
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, opacity: 0.2, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
  glow.scale.setScalar(5)
  group.add(glow)
  return group
}
/** Groups own geometries/materials; glow and label textures belong to bounded shared caches. */
export function disposeSpecial(group: THREE.Group): void {
  group.traverse(object => {
    if (object instanceof THREE.Mesh) object.geometry.dispose()
    if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) {
        material.dispose()
      }
    }
  })
}
