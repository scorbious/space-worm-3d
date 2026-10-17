import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Audio } from '../src/engine/audio'
import { ENVIRONMENT_MUSIC, EnvironmentSynth, MUSIC_FADE_SECONDS } from '../src/engine/environmentMusic'
import { ENVIRONMENTS } from '../src/game/environmentDefs'

vi.mock('../src/engine/assets', () => ({ assets: { buffer: () => new ArrayBuffer(1), load: vi.fn() } }))

class Param {
  value = 0
  events: { value: number; at: number; kind: string }[] = []
  setValueAtTime(value: number, at: number) { this.value = value; this.events.push({ value, at, kind: 'set' }) }
  linearRampToValueAtTime(value: number, at: number) { this.value = value; this.events.push({ value, at, kind: 'linear' }) }
  exponentialRampToValueAtTime(value: number, at: number) { this.value = value; this.events.push({ value, at, kind: 'exponential' }) }
  setTargetAtTime(value: number, at: number) { this.value = value; this.events.push({ value, at, kind: 'target' }) }
  cancelScheduledValues(_at: number) {}
}
class Node {
  disconnected = false
  connect(node: Node) { return node }
  disconnect() { this.disconnected = true }
}
class Gain extends Node { gain = new Param() }
class Filter extends Node { frequency = new Param(); Q = new Param(); type = 'lowpass' }
class Source extends Node {
  frequency = new Param()
  playbackRate = new Param()
  buffer: unknown = null
  loop = false
  type = 'sine'
  startAt = Infinity
  stopAt = Infinity
  ended = false
  onended: ((event: Event) => void) | null = null
  start(at = 0) { this.startAt = at }
  stop(at = 0) { this.stopAt = at }
}
class FakeAudioContext {
  state = 'suspended'
  currentTime = 0
  destination = new Node()
  sources: Source[] = []
  oscillators: Source[] = []
  gains: Gain[] = []
  filters: Filter[] = []
  createGain() { const gain = new Gain(); this.gains.push(gain); return gain }
  createBiquadFilter() { const filter = new Filter(); this.filters.push(filter); return filter }
  createDynamicsCompressor() { return Object.assign(new Node(), { threshold: new Param(), ratio: new Param() }) }
  createBufferSource() { const source = new Source(); this.sources.push(source); return source }
  createOscillator() { const source = new Source(); this.oscillators.push(source); return source }
  decodeAudioData() { return Promise.resolve({ duration: 12 }) }
  resume() { this.state = 'running'; return Promise.resolve() }
  close() { this.state = 'closed'; return Promise.resolve() }
  advance(seconds: number) {
    this.currentTime += seconds
    for (const source of [...this.sources, ...this.oscillators]) if (!source.ended && source.stopAt <= this.currentTime) {
      source.ended = true
      source.onended?.(new Event('ended'))
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('window', globalThis)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('environment-aware arcade music', () => {
  it('provides six distinct restrained synth profiles using only existing arena/intense tracks', () => {
    expect(new Set(ENVIRONMENTS.map(id => JSON.stringify(ENVIRONMENT_MUSIC[id]))).size).toBe(6)
    for (const id of ENVIRONMENTS) {
      const profile = ENVIRONMENT_MUSIC[id]
      expect(['arena', 'intense']).toContain(profile.track)
      expect(profile.bpm).toBeGreaterThanOrEqual(90)
      expect(profile.bpm).toBeLessThanOrEqual(120)
      expect(profile.steps.every(step => step < profile.scale.length)).toBe(true)
    }
  })
  it('never starts a sample or oscillator before explicit unlock, even if context is running', async () => {
    const audio = new Audio(), ctx = audio.ctx as unknown as FakeAudioContext
    ctx.state = 'running' // Explicit unlock is still required on permissive browsers.
    audio.setEnvironmentMusic('solar')
    audio.setScene('arena')
    await vi.advanceTimersByTimeAsync(1000)
    expect(ctx.sources).toHaveLength(0)
    expect(ctx.oscillators).toHaveLength(0)
    audio.unlock()
    await vi.advanceTimersByTimeAsync(250)
    expect(ctx.sources.length).toBeGreaterThan(0)
    expect(ctx.oscillators.length).toBeGreaterThan(0)
    audio.dispose()
  })
  it('crossfades a new environment even when it uses the same sample, and ignores repeated ids', async () => {
    const audio = new Audio(), ctx = audio.ctx as unknown as FakeAudioContext
    audio.setScene('arena'); audio.unlock()
    await vi.advanceTimersByTimeAsync(250)
    const first = ctx.sources.at(-1)!
    ctx.advance(1)
    audio.setEnvironmentMusic('ocean')
    const second = ctx.sources.at(-1)!
    expect(second).not.toBe(first)
    expect(first.stopAt).toBeCloseTo(ctx.currentTime + MUSIC_FADE_SECONDS + 0.02)
    expect(second.playbackRate.value).toBe(ENVIRONMENT_MUSIC.ocean.rate)
    const count = ctx.sources.length
    audio.setEnvironmentMusic('ocean')
    expect(ctx.sources).toHaveLength(count)
    ctx.advance(3)
    expect(first.disconnected).toBe(true)
    audio.dispose()
  })
  it.each(['title', 'results', 'none'] as const)('stops arena synth scheduling and sample loops on %s', async scene => {
    const audio = new Audio(), ctx = audio.ctx as unknown as FakeAudioContext
    audio.setScene('arena'); audio.unlock()
    await vi.advanceTimersByTimeAsync(250)
    const arena = ctx.sources.at(-1)!
    audio.setScene(scene)
    const count = ctx.oscillators.length
    ctx.advance(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(ctx.oscillators).toHaveLength(count)
    expect(arena.disconnected).toBe(true)
    expect(ctx.oscillators.every(source => source.disconnected)).toBe(true)
    audio.dispose()
    expect(ctx.state).toBe('closed')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('bounds rapid crossfades and disconnects every live synth node on disposal', () => {
    const ctx = new FakeAudioContext()
    ctx.state = 'running'
    const synth = new EnvironmentSynth(ctx as unknown as AudioContext, ctx.destination as unknown as AudioNode)
    for (let i = 0; i < 36; i++) {
      ctx.advance(0.08)
      synth.setEnvironment(ENVIRONMENTS[i % 6]); synth.tick()
    }
    expect(ctx.filters.filter(filter => !filter.disconnected).length).toBeLessThanOrEqual(2)
    expect(ctx.oscillators.filter(source => !source.disconnected).length).toBeLessThanOrEqual(36)
    synth.dispose()
    expect(ctx.filters.every(filter => filter.disconnected)).toBe(true)
    expect(ctx.oscillators.every(source => source.disconnected)).toBe(true)
  })
})
