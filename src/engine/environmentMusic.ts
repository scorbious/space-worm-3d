import type { EnvironmentId } from '../game/environmentDefs'

export type EnvironmentMusicProfile = {
  track: 'arena' | 'intense'
  rate: number
  bpm: number
  root: number
  scale: readonly number[]
  steps: readonly number[]
  wave: OscillatorType
  cutoff: number
}

/** Original short generative motifs, not a transcription of any game's melody. MIDI roots. */
export const ENVIRONMENT_MUSIC: Record<EnvironmentId, EnvironmentMusicProfile> = {
  forest: { track: 'arena', rate: 1, bpm: 104, root: 48, scale: [0, 3, 5, 7, 10], steps: [0, 2, 4, 1, 3, 2, 1, 4], wave: 'triangle', cutoff: 1250 },
  ocean: { track: 'arena', rate: 0.96, bpm: 96, root: 45, scale: [0, 2, 5, 7, 9], steps: [0, 3, 1, 4, 2, 3, 0, 2], wave: 'sine', cutoff: 950 },
  dunes: { track: 'arena', rate: 1.02, bpm: 108, root: 50, scale: [0, 2, 3, 7, 8], steps: [0, 1, 3, 2, 4, 1, 2, 3], wave: 'triangle', cutoff: 1450 },
  solar: { track: 'intense', rate: 1.02, bpm: 116, root: 43, scale: [0, 4, 5, 7, 11], steps: [0, 2, 3, 1, 4, 3, 2, 1], wave: 'triangle', cutoff: 1800 },
  aurora: { track: 'arena', rate: 0.94, bpm: 100, root: 47, scale: [0, 2, 6, 7, 9], steps: [0, 4, 2, 3, 1, 4, 3, 2], wave: 'sine', cutoff: 1200 },
  crystal: { track: 'intense', rate: 0.98, bpm: 112, root: 52, scale: [0, 3, 5, 7, 9], steps: [0, 3, 4, 2, 1, 3, 2, 4], wave: 'sine', cutoff: 2100 },
}

export const MUSIC_FADE_SECONDS = 2.5
const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12)
type Note = { oscillator: OscillatorNode; envelope: GainNode }
type Layer = {
  environment: EnvironmentId
  gain: GainNode
  filter: BiquadFilterNode
  notes: Set<Note>
  step: number
  nextAt: number
  endsAt: number
}

/** Scheduled by the mixer's single 250ms tick. At most two crossfading layers, no worker/timer. */
export class EnvironmentSynth {
  private active: Layer | null = null
  private outgoing: Layer | null = null
  constructor(private readonly ctx: AudioContext, private readonly output: AudioNode) {}

  setEnvironment(environment: EnvironmentId): void {
    if (this.active?.environment === environment) return
    const now = this.ctx.currentTime
    // Rapid stage changes must not stack six synths; retain only the latest outgoing layer.
    if (this.outgoing) this.release(this.outgoing)
    this.outgoing = this.active
    if (this.outgoing) {
      this.outgoing.endsAt = now + MUSIC_FADE_SECONDS
      const gain = this.outgoing.gain.gain
      gain.cancelScheduledValues(now)
      gain.setValueAtTime(gain.value, now)
      gain.linearRampToValueAtTime(0, now + MUSIC_FADE_SECONDS)
    }
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(0.42, now + MUSIC_FADE_SECONDS)
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = ENVIRONMENT_MUSIC[environment].cutoff
    filter.Q.value = 0.55
    filter.connect(gain).connect(this.output)
    this.active = { environment, gain, filter, notes: new Set(), step: 0, nextAt: now + 0.025, endsAt: Infinity }
  }

  tick(): void {
    if (this.ctx.state !== 'running') return
    const now = this.ctx.currentTime
    if (this.outgoing && now >= this.outgoing.endsAt) { this.release(this.outgoing); this.outgoing = null }
    for (const layer of [this.outgoing, this.active]) {
      if (!layer) continue
      const profile = ENVIRONMENT_MUSIC[layer.environment]
      const beat = 60 / profile.bpm
      if (layer.nextAt < now) layer.nextAt = now + 0.015 // Never catch up a background-tab backlog.
      const horizon = Math.min(now + 0.35, layer.endsAt)
      let scheduled = 0
      while (layer.nextAt < horizon && scheduled++ < 3) {
        const step = layer.step++
        const index = profile.steps[step % profile.steps.length]
        const octave = Math.floor(step / 16) % 2 ? 12 : 0
        // Soft arpeggio, a small rounded dashboard pulse, and a restrained sub bass.
        this.note(layer, profile.root + 12 + profile.scale[index] + octave, profile.wave, layer.nextAt, beat * 0.65, 0.055)
        if (step % 2 === 0) this.note(layer, profile.root + 12, 'sine', layer.nextAt, beat * 0.27, 0.07)
        if (step % 4 === 0) this.note(layer, profile.root - 12 + (step % 8 ? 7 : 0), 'triangle', layer.nextAt, beat * 1.35, 0.1)
        layer.nextAt += beat / 2
      }
    }
  }

  private note(layer: Layer, midi: number, wave: OscillatorType, at: number, duration: number, level: number): void {
    if (layer.notes.size >= 18) return // Hard upper bound per layer, including overlap.
    const oscillator = this.ctx.createOscillator(), envelope = this.ctx.createGain()
    const end = Math.min(at + duration, layer.endsAt)
    if (end <= at + 0.015) { oscillator.disconnect(); envelope.disconnect(); return }
    oscillator.type = wave
    oscillator.frequency.setValueAtTime(frequency(midi), at)
    envelope.gain.setValueAtTime(0.0001, at)
    envelope.gain.exponentialRampToValueAtTime(level, at + 0.012)
    envelope.gain.exponentialRampToValueAtTime(0.0001, end)
    oscillator.connect(envelope).connect(layer.filter)
    const note = { oscillator, envelope }
    layer.notes.add(note)
    oscillator.onended = () => { layer.notes.delete(note); oscillator.disconnect(); envelope.disconnect() }
    oscillator.start(at)
    oscillator.stop(end + 0.01)
  }

  /** No more scheduled notes after leaving the arena; a tiny release avoids clicks. */
  stop(): void {
    for (const layer of [this.active, this.outgoing]) {
      if (!layer) continue
      const now = this.ctx.currentTime
      layer.gain.gain.cancelScheduledValues(now)
      layer.gain.gain.setValueAtTime(layer.gain.gain.value, now)
      layer.gain.gain.linearRampToValueAtTime(0, now + 0.12)
      for (const note of layer.notes) {
        try { note.oscillator.stop(now + 0.13) } catch { /* already ended */ }
      }
      // Only the existing notes retain the nodes until their short release has finished.
      const finish = () => { if (!layer.notes.size) { layer.filter.disconnect(); layer.gain.disconnect() } }
      for (const note of layer.notes) {
        const ended = note.oscillator.onended
        note.oscillator.onended = event => { ended?.call(note.oscillator, event); finish() }
      }
      finish()
    }
    this.active = this.outgoing = null
  }

  private release(layer: Layer): void {
    for (const note of layer.notes) {
      try { note.oscillator.stop() } catch { /* already ended */ }
      note.oscillator.disconnect(); note.envelope.disconnect()
    }
    layer.notes.clear()
    layer.filter.disconnect(); layer.gain.disconnect()
  }

  dispose(): void {
    if (this.active) this.release(this.active)
    if (this.outgoing) this.release(this.outgoing)
    this.active = this.outgoing = null
  }
}
