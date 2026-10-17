import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { HEAD_STYLES } from '../src/game/appearance'
import { ENVIRONMENTS, ENVIRONMENT_SECONDS, environmentEpoch, environmentFor } from '../src/game/environmentDefs'
import { ArenaEnvironment, ENVIRONMENT_FADE_SECONDS } from '../src/game/environments'
import { bodyArmorGeometry, headArmorGeometry } from '../src/game/headArmor'
import { HEAD_FEATURES, headGeometry } from '../src/game/headShapes'
import { armorTier, ARMOR_PROFILES } from '../src/game/growthVisuals'
import { radiusForLength } from '../src/game/rules'
import { Sim } from '../src/game/sim'
import { View } from '../src/game/view'

function clockArena(): Sim {
  const sim = new Sim({ mode: 'ffa', seed: 0, bots: 0, playerName: 'Clock', playerSkin: 'nebula' })
  sim.worms = []; sim.orbs = []; sim.shards = []; sim.pickups = []; sim.celestials = []
  sim.asteroids = []; sim.gates = []; sim.wells = []; sim.traps = []; sim.surprises = []
  sim.player.xs = Array(20).fill(0)
  return sim
}

describe('180-second active-round environment clock', () => {
  it('changes at 180.000 and 360.000, never one frame early', () => {
    expect(ENVIRONMENT_SECONDS).toBe(180)
    expect(environmentEpoch(179.999999)).toBe(0)
    expect(environmentEpoch(180)).toBe(1)
    expect(environmentEpoch(359.999999)).toBe(1)
    expect(environmentEpoch(360)).toBe(2)
    expect(environmentFor(1, 0, 179.999999)).toBe('forest')
    expect(environmentFor(1, 0, 180)).toBe('ocean')
    expect(environmentFor(1, 0, 1080)).toBe('forest')
  })
  it('stage changes rotate immediately but do not reset the round deadline', () => {
    const sim = clockArena()
    sim.step(0, null, 179)
    expect(sim.environment).toBe('forest')
    sim.stage = 2
    expect(sim.environment).toBe('ocean')
    sim.step(0, null, 1)
    expect(sim.environment).toBe('dunes')
    expect(sim.environmentTime).toBe(180)
  })
  it('uses unscaled time during hit-stop and no time while a round is inactive/ended', () => {
    const sim = clockArena()
    sim.step(0.25, null, 1)
    expect(sim.time).toBe(0.25)
    expect(sim.environmentTime).toBe(1)
    sim.step(10, null, 0) // Title/demo or paused round clock.
    expect(sim.environmentTime).toBe(1)
    sim.matchOver = true
    sim.step(1, null, 1)
    expect(sim.environmentTime).toBe(1)
  })
  it('hits the exact 60Hz boundary without accumulating timer drift', () => {
    const sim = clockArena()
    for (let i = 0; i < 10799; i++) sim.step(0, null, 1 / 60)
    expect(sim.environment).toBe('forest')
    sim.step(0, null, 1 / 60)
    expect(sim.environmentTime).toBeCloseTo(180, 10)
    expect(sim.environment).toBe('ocean')
  })
  it('wraps all six environments and sanitizes malformed clock inputs', () => {
    expect(new Set(ENVIRONMENTS.map((_, i) => environmentFor(4, -3, i * 180))).size).toBe(6)
    expect(environmentFor(0, -1)).toBe('crystal')
    expect(environmentFor(NaN, Infinity, NaN)).toBe('forest')
    expect(environmentFor(1, 0, -180)).toBe('forest')
  })
})

describe('sculpted heads and bounded growth armor', () => {
  it.each(HEAD_STYLES)('%s has finite normals, vertex tints, landmarks and a bounded cached sculpture', style => {
    const geometry = headGeometry(style)
    for (const name of ['position', 'normal', 'color']) {
      const attribute = geometry.getAttribute(name)
      expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true)
      expect(attribute.count).toBe(geometry.getAttribute('position').count)
    }
    expect(geometry.getAttribute('position').count).toBeLessThan(20000)
    expect(geometry.userData.shared).toBe(true)
    expect(HEAD_FEATURES[style].size).toBeGreaterThan(0.2)
    expect(headGeometry(style)).toBe(geometry)
  })
  it('distinct silhouettes retain curved horns, crests, flame tails and manta wings', () => {
    for (const style of HEAD_STYLES) headGeometry(style).computeBoundingBox()
    expect(headGeometry('dragon').boundingBox!.max.y).toBeGreaterThan(1.5)
    expect(headGeometry('crystal').boundingBox!.max.y).toBeGreaterThan(1.5)
    expect(headGeometry('cat').boundingBox!.max.y).toBeGreaterThan(1.4)
    expect(headGeometry('comet').boundingBox!.min.x).toBeLessThan(-2.2)
    expect(headGeometry('manta').boundingBox!.max.z).toBeGreaterThan(1.9)
  })
  it('adds three clear armor tiers and heavier bands as length AND radius grow', () => {
    const tiers = [20, 60, 130, 260].map(length => armorTier(length, radiusForLength(length)))
    expect(tiers).toEqual([0, 1, 2, 3])
    expect(armorTier(500, 0.9)).toBe(0)
    expect(ARMOR_PROFILES.map(profile => profile.plateEvery)).toEqual([0, 6, 4, 3])
    expect(ARMOR_PROFILES[3].scale).toBeGreaterThan(ARMOR_PROFILES[1].scale)
    expect(ARMOR_PROFILES[3].solid).toBeGreaterThan(0.9)
    for (let i = 0; i < 3; i++) {
      const geometry = headArmorGeometry(i)
      expect(geometry).toBe(headArmorGeometry(i))
      expect(geometry.getAttribute('position').count).toBeLessThan(5000)
    }
    expect(bodyArmorGeometry()).toBe(bodyArmorGeometry())
  })
  it('disposes owned head resources once while preserving shared sculpture/armor geometry', () => {
    const sharedHead = headGeometry('dragon'), sharedArmor = headArmorGeometry(2)
    const owned = new THREE.SphereGeometry(1, 8, 6), material = new THREE.MeshBasicMaterial()
    const headDispose = vi.spyOn(sharedHead, 'dispose'), armorDispose = vi.spyOn(sharedArmor, 'dispose')
    const ownDispose = vi.spyOn(owned, 'dispose'), materialDispose = vi.spyOn(material, 'dispose')
    const group = new THREE.Group()
    group.add(new THREE.Mesh(sharedHead, material), new THREE.Mesh(sharedArmor, material), new THREE.Mesh(owned, material), new THREE.Mesh(owned, material))
    const scene = new THREE.Scene()
    scene.add(group)
    const dispose = (View.prototype as unknown as { disposeHead(head: { group: THREE.Group }): void }).disposeHead
    dispose.call({ scene }, { group })
    expect(scene.children).not.toContain(group)
    expect(headDispose).not.toHaveBeenCalled()
    expect(armorDispose).not.toHaveBeenCalled()
    expect(ownDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })
})

describe('clean environment crossfade', () => {
  it('blends palettes, including interrupted fades, and snaps with reduced motion', () => {
    const environment = new ArenaEnvironment()
    const first = environment.update('forest', 0, 128, false).clone()
    expect(environment.update('ocean', 10, 128, false).equals(first)).toBe(true)
    const halfway = environment.update('ocean', 10 + ENVIRONMENT_FADE_SECONDS / 2, 128, false).clone()
    expect(halfway.equals(first)).toBe(false)
    expect(environment.update('solar', 11.5, 128, false).equals(halfway)).toBe(true)
    const snapped = environment.update('solar', 11.6, 128, true).clone()
    expect(environment.update('solar', 20, 128, true).equals(snapped)).toBe(true)
    const backdrop = environment.group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
    expect(backdrop.material.fragmentShader).not.toMatch(/sin\(|cos\(|noise\(|mod\(/)
    environment.dispose()
    expect(environment.group.children).toHaveLength(0)
  })
  it('does not allocate new scenery or shaders as environments repeatedly change', () => {
    const environment = new ArenaEnvironment()
    const children = [...environment.group.children]
    for (let i = 0; i < 30; i++) environment.update(ENVIRONMENTS[i % 6], i * 5, 128, false)
    expect(environment.group.children).toEqual(children)
    environment.dispose()
  })
})
