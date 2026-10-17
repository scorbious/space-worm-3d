import { describe, expect, it, vi } from 'vitest'
import { HEAD_STYLES } from '../src/game/appearance'
import { Game } from '../src/game/game'
import { Sim, type SimEvent } from '../src/game/sim'
import { crystalFruitGeometry, fruitLeafGeometry } from '../src/game/visuals'

describe('event-to-vocal integration', () => {
  it.each(HEAD_STYLES)('voices only the playing player on a real large %s swallow', style => {
    const sim = new Sim({ mode: 'ffa', seed: 3, bots: 1, playerName: 'Voice', playerSkin: 'nebula', headStyle: style })
    const p = sim.player, rival = sim.worms.find(w => w !== p)!
    const playHeadVocal = vi.fn(), flashGulp = vi.fn()
    const handler = (Game.prototype as unknown as { handleEvents(): void }).handleEvents
    const context = {
      sim, mode: 'playing', near: () => false,
      audio: { play: vi.fn(), playHeadVocal },
      view: { flashGulp, bulge: vi.fn(), fx: { bite: vi.fn(), swallow: vi.fn() } },
      hooks: { celestial: vi.fn(), flash: vi.fn() },
    }
    const eat: SimEvent = { type: 'eat', worm: p, value: 1, x: 0, z: 0, color: 0xffffff, nova: false, combo: 1 }
    sim.events = [eat, { ...eat, worm: rival, sourceLength: 90 }]
    handler.call(context)
    expect(playHeadVocal).not.toHaveBeenCalled()
    expect(flashGulp).toHaveBeenCalledTimes(2)
    sim.events = [{ ...eat, sourceLength: 90 }]
    handler.call(context)
    expect(playHeadVocal).toHaveBeenCalledWith(style, 1)
    playHeadVocal.mockClear()
    context.mode = 'paused'
    sim.events = [{ ...eat, value: 4 }]
    handler.call(context)
    expect(playHeadVocal).not.toHaveBeenCalled()
    context.mode = 'playing'
    sim.events = [{ type: 'celestial', worm: p, kind: 'planet', powerAdded: false, x: 0, z: 0 }]
    handler.call(context)
    expect(playHeadVocal).toHaveBeenCalledWith(style, 1)
    expect(flashGulp).toHaveBeenLastCalledWith(p.id, 1)
  })
})

describe('bounded crystal fruit meshes', () => {
  it('creates finite low-poly fruit and merged garnish without missing attributes', () => {
    for (const build of [crystalFruitGeometry, fruitLeafGeometry]) {
      const geometry = build()
      for (const name of ['position', 'normal', 'uv']) {
        const attribute = geometry.getAttribute(name)
        expect(attribute.count).toBeGreaterThan(0)
        expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true)
      }
      expect(geometry.getAttribute('position').count).toBeLessThan(400)
      geometry.dispose()
    }
  })
})
