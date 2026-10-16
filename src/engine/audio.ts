/**
 * Web Audio mixer with separate music and SFX buses. Browsers only allow audio after a user
 * gesture, so call `unlock()` from the first click/key press.
 *
 * Samples stream in through `assets` (see engine/assets.ts) and are decoded on first use. If a
 * sample is not ready yet a tiny synthesized blip plays instead, so feedback is never silent.
 * Music is scene-based (title / arena / results); in the arena it crossfades between a calm
 * and an intense layer from the `intensity` signal with hysteresis.
 */
import { assets } from './assets'

export type Sfx =
  | 'eat' | 'nova' | 'shard' | 'celestial' | 'power' | 'pickup' | 'shieldUp' | 'shield' | 'boost' | 'death' | 'kill'
  | 'ui' | 'hover' | 'buy' | 'warn' | 'gate' | 'bump' | 'win' | 'lose' | 'combo' | 'crown' | 'supernova' | 'start'
  | 'tick' | 'expire'

type SfxDef = { id: string; gain: number; vary: number; pitch?: number; gap?: number; voices?: number; blip: [number, number, number] }
const SFX: Record<Sfx, SfxDef> = {
  eat: { id: 'sfx/bite', gain: 0.42, vary: 0.1, gap: 0.045, voices: 5, blip: [880, 1320, 0.05] },
  nova: { id: 'sfx/nova', gain: 0.8, vary: 0.03, blip: [1200, 2400, 0.25] },
  shard: { id: 'sfx/nova', gain: 0.4, vary: 0.05, pitch: 1.35, gap: 0.05, blip: [1500, 2200, 0.1] },
  celestial: { id: 'sfx/gulp', gain: 1, vary: 0.05, blip: [180, 90, 0.35] },
  power: { id: 'sfx/power', gain: 0.75, vary: 0, blip: [440, 880, 0.4] },
  pickup: { id: 'sfx/pickup', gain: 0.75, vary: 0.04, blip: [520, 1560, 0.18] },
  shieldUp: { id: 'sfx/shield-up', gain: 0.6, vary: 0.03, blip: [300, 700, 0.2] },
  shield: { id: 'sfx/shield-break', gain: 0.9, vary: 0.05, blip: [900, 200, 0.25] },
  boost: { id: 'sfx/boost', gain: 0.5, vary: 0, blip: [200, 300, 0.1] },
  death: { id: 'sfx/death', gain: 0.9, vary: 0.03, blip: [400, 60, 0.5] },
  kill: { id: 'sfx/kill', gain: 0.85, vary: 0.03, blip: [660, 990, 0.25] },
  ui: { id: 'sfx/ui-click', gain: 0.45, vary: 0.04, gap: 0.03, blip: [700, 900, 0.05] },
  hover: { id: 'sfx/ui-hover', gain: 0.22, vary: 0.06, gap: 0.05, blip: [1200, 1300, 0.03] },
  buy: { id: 'sfx/purchase', gain: 0.8, vary: 0, blip: [660, 1320, 0.3] },
  warn: { id: 'sfx/tick', gain: 0.35, vary: 0, gap: 0.2, blip: [1000, 1000, 0.05] },
  gate: { id: 'sfx/gate', gain: 0.45, vary: 0.08, gap: 0.25, blip: [120, 90, 0.2] },
  bump: { id: 'sfx/bounce', gain: 0.6, vary: 0.08, gap: 0.2, blip: [240, 120, 0.12] },
  win: { id: 'sfx/crown', gain: 0.9, vary: 0, blip: [523, 1046, 0.5] },
  lose: { id: 'sfx/expire', gain: 0.8, vary: 0, pitch: 0.8, blip: [400, 200, 0.4] },
  combo: { id: 'sfx/combo', gain: 0.6, vary: 0, blip: [660, 1320, 0.15] },
  crown: { id: 'sfx/crown', gain: 0.8, vary: 0, blip: [523, 1046, 0.4] },
  supernova: { id: 'sfx/supernova', gain: 1, vary: 0.03, blip: [120, 40, 0.8] },
  start: { id: 'sfx/start', gain: 0.75, vary: 0, blip: [300, 900, 0.3] },
  tick: { id: 'sfx/tick', gain: 0.4, vary: 0, gap: 0.15, blip: [1000, 1000, 0.04] },
  expire: { id: 'sfx/expire', gain: 0.55, vary: 0, blip: [600, 300, 0.2] },
}

export type MusicScene = 'none' | 'title' | 'arena' | 'results'
type Track = 'title' | 'arena' | 'intense' | 'results'
type Voice = { src: AudioBufferSourceNode; gain: GainNode; track: Track }

export class Audio {
  readonly ctx: AudioContext
  private master: GainNode
  private music: GainNode
  private sfx: GainNode
  private decoded = new Map<string, AudioBuffer>()
  private decoding = new Map<string, Promise<AudioBuffer | null>>()
  private lastPlay = new Map<Sfx, number>()
  private live = new Map<Sfx, number>()
  private loops = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>()
  private scene: MusicScene = 'none'
  private current: Voice | null = null
  private layer: Track = 'arena'
  private hotFor = 0
  private coolFor = 0
  private lastTick = 0
  /** 0..1 danger/excitement used to pick the arena layer. */
  intensity = 0

  constructor() {
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    this.music = this.ctx.createGain()
    this.sfx = this.ctx.createGain()
    const comp = this.ctx.createDynamicsCompressor()
    comp.threshold.value = -12
    comp.ratio.value = 4
    this.music.connect(this.master)
    this.sfx.connect(this.master)
    this.master.connect(comp).connect(this.ctx.destination)
    window.setInterval(() => this.tickMusic(), 250)
  }

  unlock(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  /** Volumes in 0..1. */
  setVolumes(music: number, sfx: number, muted = false): void {
    const t = this.ctx.currentTime
    this.music.gain.setTargetAtTime(muted ? 0 : music * 0.55, t, 0.05)
    this.sfx.gain.setTargetAtTime(muted ? 0 : sfx * 0.9, t, 0.05)
  }

  private buffer(id: string): AudioBuffer | null {
    const hit = this.decoded.get(id)
    if (hit) return hit
    if (!this.decoding.has(id)) {
      const raw = assets.buffer(id)
      if (!raw) {
        void assets.load(id)
        return null
      }
      const p = this.ctx.decodeAudioData(raw.slice(0)).then(
        b => {
          this.decoded.set(id, b)
          return b
        },
        () => null,
      )
      this.decoding.set(id, p)
    }
    return null
  }

  private blip([from, to, dur]: [number, number, number], vol: number): void {
    const t = this.ctx.currentTime
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = 'triangle'
    o.frequency.setValueAtTime(from, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol * 0.25, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(this.sfx)
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  /** Play a one-shot. `pitch` scales playback rate; `gain` scales the preset level. */
  play(name: Sfx, pitch = 1, gain = 1): void {
    if (this.ctx.state !== 'running') return
    const def = SFX[name]
    const now = this.ctx.currentTime
    if (now - (this.lastPlay.get(name) ?? -1) < (def.gap ?? 0.02)) return
    if ((this.live.get(name) ?? 0) >= (def.voices ?? 3)) return
    this.lastPlay.set(name, now)
    const buf = this.buffer(def.id)
    if (!buf) {
      this.blip(def.blip, def.gain * gain)
      return
    }
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = (def.pitch ?? 1) * pitch * (1 + (Math.random() * 2 - 1) * def.vary)
    const g = this.ctx.createGain()
    g.gain.value = def.gain * gain
    src.connect(g).connect(this.sfx)
    this.live.set(name, (this.live.get(name) ?? 0) + 1)
    src.onended = () => this.live.set(name, Math.max(0, (this.live.get(name) ?? 1) - 1))
    src.start()
  }

  private setLoop(key: string, id: string, level: number, rate = 1): void {
    const cur = this.loops.get(key)
    const t = this.ctx.currentTime
    if (level <= 0.001) {
      if (cur) {
        cur.gain.gain.setTargetAtTime(0, t, 0.08)
        const node = cur
        window.setTimeout(() => {
          try {
            node.src.stop()
          } catch {
            /* already stopped */
          }
        }, 400)
        this.loops.delete(key)
      }
      return
    }
    if (cur) {
      cur.gain.gain.setTargetAtTime(level, t, 0.1)
      cur.src.playbackRate.setTargetAtTime(rate, t, 0.1)
      return
    }
    if (this.ctx.state !== 'running') return
    const buf = this.buffer(id)
    if (!buf) return
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    src.playbackRate.value = rate
    const g = this.ctx.createGain()
    g.gain.value = 0
    g.gain.setTargetAtTime(level, t, 0.06)
    src.connect(g).connect(this.sfx)
    src.start()
    this.loops.set(key, { src, gain: g })
  }

  setBoosting(on: boolean, free = false): void {
    this.setLoop('boost', 'sfx/boost', on ? (free ? 0.55 : 0.42) : 0, free ? 1.12 : 1)
  }

  /** 0..1 how deep the player is inside a gravity well. */
  setWell(amount: number): void {
    this.setLoop('well', 'sfx/well', Math.min(1, amount) * 0.6, 0.85 + amount * 0.2)
  }

  // ─── music ────────────────────────────────────────────────────────────────
  /** Legacy entry point: start the title theme after unlock. */
  startMusic(): void {
    if (this.scene === 'none') this.setScene('title')
    else this.tickMusic()
  }

  setScene(scene: MusicScene): void {
    if (scene === this.scene) return
    this.scene = scene
    if (scene === 'arena') {
      this.layer = 'arena'
      this.hotFor = this.coolFor = 0
    }
    this.tickMusic()
  }

  stopMusic(): void {
    this.setScene('none')
  }

  private wanted(): Track | null {
    switch (this.scene) {
      case 'title':
        return 'title'
      case 'results':
        return 'results'
      case 'arena':
        return this.layer
      default:
        return null
    }
  }

  private tickMusic(): void {
    const now = performance.now() / 1000
    const dt = this.lastTick ? Math.min(1, now - this.lastTick) : 0.25
    this.lastTick = now
    if (this.scene === 'arena') {
      if (this.intensity > 0.62) {
        this.hotFor += dt
        this.coolFor = 0
      } else if (this.intensity < 0.35) {
        this.coolFor += dt
        this.hotFor = 0
      }
      if (this.layer === 'arena' && this.hotFor > 2.5 && this.decoded.has('bgm/intense')) this.layer = 'intense'
      else if (this.layer === 'intense' && this.coolFor > 6) this.layer = 'arena'
      if (!this.decoded.has('bgm/intense')) this.buffer('bgm/intense')
    }
    if (this.ctx.state !== 'running') return
    const want = this.wanted()
    if (this.current?.track === want) return
    if (want === null) {
      this.fadeOut(this.current, 1.2)
      this.current = null
      return
    }
    const buf = this.buffer(`bgm/${want}`)
    if (!buf) return
    this.fadeOut(this.current, 2)
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.loop = want !== 'results'
    const g = this.ctx.createGain()
    const t = this.ctx.currentTime
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(1, t + (want === 'results' ? 0.2 : 2))
    src.connect(g).connect(this.music)
    src.start()
    this.current = { src, gain: g, track: want }
  }

  private fadeOut(v: Voice | null, seconds: number): void {
    if (!v) return
    const t = this.ctx.currentTime
    v.gain.gain.cancelScheduledValues(t)
    v.gain.gain.setValueAtTime(v.gain.gain.value, t)
    v.gain.gain.linearRampToValueAtTime(0, t + seconds)
    window.setTimeout(() => {
      try {
        v.src.stop()
      } catch {
        /* already stopped */
      }
    }, seconds * 1000 + 100)
  }
}
