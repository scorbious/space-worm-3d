import type { HeadStyle } from '../game/appearance'

export const HEAD_VOCAL_COOLDOWN = 1.15
/** Original sound-design gestures, not speech/samples or imitations of copyrighted voices. */
export const HEAD_VOCALS: Record<HeadStyle, { wave: OscillatorType; pitches: readonly number[]; duration: number; partials: readonly number[]; filter: number; wobble: number; depth: number; noise: number }> = {
  cat: { wave: 'sawtooth', pitches: [155, 540, 370, 115], duration: 0.62, partials: [1, 1.006], filter: 1550, wobble: 27, depth: 18, noise: 0.12 },
  dragon: { wave: 'sawtooth', pitches: [98, 76, 62, 43], duration: 0.78, partials: [1, 0.501], filter: 650, wobble: 31, depth: 12, noise: 0.35 },
  robot: { wave: 'square', pitches: [180, 320, 240, 120], duration: 0.44, partials: [1, 1.5], filter: 1800, wobble: 65, depth: 70, noise: 0 },
  crystal: { wave: 'sine', pitches: [900, 898, 895, 890], duration: 0.82, partials: [1, 1.414, 2.76], filter: 6000, wobble: 0, depth: 0, noise: 0 },
  comet: { wave: 'sine', pitches: [240, 170, 90, 38], duration: 0.58, partials: [1], filter: 3000, wobble: 0, depth: 0, noise: 0.9 },
  manta: { wave: 'sine', pitches: [115, 95, 81, 70], duration: 0.76, partials: [1, 2.005], filter: 500, wobble: 4, depth: 3, noise: 0 },
  cyclops: { wave: 'triangle', pitches: [310, 105, 480, 80], duration: 0.55, partials: [1, 1.333], filter: 2300, wobble: 42, depth: 95, noise: 0 },
  round: { wave: 'triangle', pitches: [330, 110, 260, 65], duration: 0.43, partials: [1, 2], filter: 1400, wobble: 9, depth: 8, noise: 0 },
}

export type HeadVocalVoice = { dispose(): void }
const noiseBuffers = new WeakMap<AudioContext, AudioBuffer>()
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(ctx)
  if (!buffer) {
    buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.85), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let smooth = 0
    for (let i = 0; i < data.length; i++) { smooth = (smooth + (Math.random() * 2 - 1) * 0.28) / 1.28; data[i] = smooth * 2 }
    noiseBuffers.set(ctx, buffer)
  }
  return buffer
}

/** At most 5 finite sources; audio-clock stops and onended cleanup work with throttled timers. */
export function synthHeadVocal(ctx: AudioContext, bus: AudioNode, style: HeadStyle, strength: number, ended: () => void): HeadVocalVoice {
  const profile = HEAD_VOCALS[style]
  const amount = Number.isFinite(strength) ? Math.max(0.25, Math.min(1.5, strength)) : 1
  const t = ctx.currentTime, end = t + profile.duration
  const nodes: AudioNode[] = []
  const sources: (OscillatorNode | AudioBufferSourceNode)[] = []
  const filter = ctx.createBiquadFilter(), envelope = ctx.createGain()
  nodes.push(filter, envelope)
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(profile.filter, t)
  filter.frequency.exponentialRampToValueAtTime(Math.max(180, profile.filter * 0.35), end)
  filter.Q.value = style === 'cat' ? 2.4 : 0.7
  envelope.gain.setValueAtTime(0.0001, t)
  envelope.gain.exponentialRampToValueAtTime(0.17 * amount, t + (style === 'manta' ? 0.1 : 0.025))
  envelope.gain.exponentialRampToValueAtTime(0.0001, end)
  filter.connect(envelope).connect(bus)
  const carriers: OscillatorNode[] = []
  for (const [i, partial] of profile.partials.entries()) {
    const source = ctx.createOscillator(), gain = ctx.createGain()
    nodes.push(source, gain); sources.push(source); carriers.push(source)
    source.type = profile.wave
    const pitch = Math.pow(amount, -0.1) * partial
    profile.pitches.forEach((hz, step) => {
      const at = t + profile.duration * step / (profile.pitches.length - 1)
      if (step === 0 || style === 'robot') source.frequency.setValueAtTime(hz * pitch, at)
      else source.frequency.exponentialRampToValueAtTime(hz * pitch, at)
    })
    gain.gain.value = (style === 'comet' ? 0.18 : 0.8) / (i + 1)
    source.connect(gain).connect(filter)
  }
  if (profile.wobble) {
    const mod = ctx.createOscillator(), gain = ctx.createGain()
    nodes.push(mod, gain); sources.push(mod)
    mod.frequency.value = profile.wobble
    gain.gain.value = profile.depth
    mod.connect(gain)
    for (const carrier of carriers) gain.connect(carrier.frequency)
  }
  if (profile.noise) {
    const source = ctx.createBufferSource(), gain = ctx.createGain()
    nodes.push(source, gain); sources.push(source)
    source.buffer = noiseBuffer(ctx)
    gain.gain.value = profile.noise
    source.connect(gain).connect(filter)
  }
  let disposed = false, left = sources.length
  const cleanup = () => {
    if (disposed) return
    disposed = true
    for (const node of nodes) node.disconnect()
    ended()
  }
  const voice = { dispose() {
    if (disposed) return
    for (const source of sources) { source.onended = null; try { source.stop() } catch { /* already ended */ } }
    cleanup()
  } }
  for (const source of sources) {
    source.onended = () => { if (--left === 0) cleanup() }
    source.start(t)
    source.stop(end + 0.02)
  }
  return voice
}
