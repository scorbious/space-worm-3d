/**
 * Staged asset loading. Nothing here depends on three.js so the boot chunk stays tiny.
 *
 * Stage 0 (boot)    HUD/menu icons and UI clicks (~100 KB). The only load that blocks the title.
 * Stage 1 (opening) everything the first match needs: loading art, painted backdrop, particle
 *                   atlas, every celestial/asteroid/pylon surface and the core SFX. Streams while
 *                   the title is up; `play()` shows a recoverable gate only if it is still late.
 * Stage 2 (mid)     title and arena music (the mixer starts a track whenever it lands) plus
 *                   heavier stings.
 * Stage 3 (late)    intense music layer, results music and rare stings.
 *
 * After stage 0 the scheduler streams the remaining stages in order, one request at a time during
 * play, and pauses whenever the game reports high "heat" (busy frames, many particles or worms on
 * screen). Consumers either `await ensure(stage)` or subscribe with `when(id)` and upgrade from a
 * procedural fallback once the file arrives, so late assets never block play.
 */
export type AssetKind = 'image' | 'audio'
export type AssetEntry = { id: string; url: string; kind: AssetKind; stage: 0 | 1 | 2 | 3 }

const img = (id: string, url: string, stage: AssetEntry['stage']): AssetEntry => ({ id, url, kind: 'image', stage })
const snd = (id: string, url: string, stage: AssetEntry['stage']): AssetEntry => ({ id, url, kind: 'audio', stage })

// Literal `new URL(...)` calls let Vite fingerprint every file under /assets/.
export const MANIFEST: AssetEntry[] = [
  img('icon/magnet', new URL('../media/icons/magnet.webp', import.meta.url).href, 0),
  img('icon/shield', new URL('../media/icons/shield.webp', import.meta.url).href, 0),
  img('icon/boost', new URL('../media/icons/boost.webp', import.meta.url).href, 0),
  img('icon/stardust', new URL('../media/icons/stardust.webp', import.meta.url).href, 0),
  img('icon/crown', new URL('../media/icons/crown.webp', import.meta.url).href, 0),
  img('icon/moon', new URL('../media/icons/moon.webp', import.meta.url).href, 0),
  img('icon/comet', new URL('../media/icons/comet.webp', import.meta.url).href, 0),
  img('icon/planet', new URL('../media/icons/planet.webp', import.meta.url).href, 0),
  img('icon/star', new URL('../media/icons/star.webp', import.meta.url).href, 0),
  img('icon/pulsar', new URL('../media/icons/pulsar.webp', import.meta.url).href, 0),
  snd('sfx/ui-hover', new URL('../media/audio/sfx-ui-hover.mp3', import.meta.url).href, 0),
  snd('sfx/ui-click', new URL('../media/audio/sfx-ui-click.mp3', import.meta.url).href, 0),
  img('bg/loading', new URL('../media/bg/loading.webp', import.meta.url).href, 1),
  img('bg/nebula', new URL('../media/bg/nebula.webp', import.meta.url).href, 1),
  img('fx/particles', new URL('../media/fx/particles.webp', import.meta.url).href, 1),
  img('tex/moon', new URL('../media/tex/moon.webp', import.meta.url).href, 1),
  img('tex/comet', new URL('../media/tex/comet.webp', import.meta.url).href, 1),
  img('tex/rock', new URL('../media/tex/rock.webp', import.meta.url).href, 1),
  img('tex/rock-normal', new URL('../media/tex/rock-normal.webp', import.meta.url).href, 1),
  img('tex/metal', new URL('../media/tex/metal.webp', import.meta.url).href, 1),
  img('tex/metal-normal', new URL('../media/tex/metal-normal.webp', import.meta.url).href, 1),
  snd('sfx/bite', new URL('../media/audio/sfx-bite.mp3', import.meta.url).href, 1),
  snd('sfx/nova', new URL('../media/audio/sfx-nova.mp3', import.meta.url).href, 1),
  snd('sfx/boost', new URL('../media/audio/sfx-boost.mp3', import.meta.url).href, 1),
  snd('sfx/pickup', new URL('../media/audio/sfx-pickup.mp3', import.meta.url).href, 1),
  snd('sfx/shield-up', new URL('../media/audio/sfx-shield-up.mp3', import.meta.url).href, 1),
  snd('sfx/shield-break', new URL('../media/audio/sfx-shield-break.mp3', import.meta.url).href, 1),
  snd('sfx/gulp', new URL('../media/audio/sfx-gulp.mp3', import.meta.url).href, 1),
  snd('sfx/power', new URL('../media/audio/sfx-power.mp3', import.meta.url).href, 1),
  snd('sfx/gate', new URL('../media/audio/sfx-gate.mp3', import.meta.url).href, 1),
  snd('sfx/well', new URL('../media/audio/sfx-well.mp3', import.meta.url).href, 1),
  snd('sfx/death', new URL('../media/audio/sfx-death.mp3', import.meta.url).href, 1),
  snd('sfx/kill', new URL('../media/audio/sfx-kill.mp3', import.meta.url).href, 1),
  snd('sfx/start', new URL('../media/audio/sfx-start.mp3', import.meta.url).href, 1),
  snd('sfx/bounce', new URL('../media/audio/sfx-bounce.mp3', import.meta.url).href, 1),
  snd('sfx/tick', new URL('../media/audio/sfx-tick.mp3', import.meta.url).href, 1),
  snd('sfx/expire', new URL('../media/audio/sfx-expire.mp3', import.meta.url).href, 1),
  snd('sfx/combo', new URL('../media/audio/sfx-combo.mp3', import.meta.url).href, 1),
  img('tex/gasgiant', new URL('../media/tex/gasgiant.webp', import.meta.url).href, 1),
  img('tex/star', new URL('../media/tex/star.webp', import.meta.url).href, 1),
  img('tex/pulsar', new URL('../media/tex/pulsar.webp', import.meta.url).href, 1),
  snd('bgm/title', new URL('../media/audio/bgm-title.mp3', import.meta.url).href, 2),
  snd('bgm/arena', new URL('../media/audio/bgm-arena.mp3', import.meta.url).href, 2),
  snd('sfx/supernova', new URL('../media/audio/sfx-supernova.mp3', import.meta.url).href, 2),
  snd('sfx/crown', new URL('../media/audio/sfx-crown.mp3', import.meta.url).href, 2),
  snd('bgm/intense', new URL('../media/audio/bgm-intense.mp3', import.meta.url).href, 3),
  snd('sfx/purchase', new URL('../media/audio/sfx-purchase.mp3', import.meta.url).href, 3),
  snd('bgm/results', new URL('../media/audio/bgm-results.mp3', import.meta.url).href, 3),



]

type Loaded = HTMLImageElement | ArrayBuffer
type Status = 'queued' | 'loading' | 'done' | 'failed'

export class Assets {
  private status = new Map<string, Status>()
  private data = new Map<string, Loaded>()
  private waiters = new Map<string, ((v: Loaded | null) => void)[]>()
  private byId = new Map<string, AssetEntry>()
  private active = 0
  private hot = false
  private calmSince = 0
  private lastTrickle = 0
  private started = false
  private priorityStage = 0
  private listeners = new Set<() => void>()
  /** Max parallel requests while idle (menus) and while playing. */
  concurrency = { idle: 3, play: 1 }
  playing = false

  constructor(readonly manifest: AssetEntry[] = MANIFEST) {
    for (const e of manifest) {
      this.byId.set(e.id, e)
      this.status.set(e.id, 'queued')
    }
  }

  /**
   * Called every frame by the game. `heat` is 0..1; above 0.6 pauses prefetch until 1.5 s of calm.
   * Devices that never calm down (steady 30 fps) still get one request every `trickleMs` while
   * nothing else is in flight, so late-stage art always arrives eventually.
   */
  trickleMs = 4000
  setHeat(heat: number, now = performance.now()): void {
    if (heat > 0.6) {
      this.hot = true
      this.calmSince = now
      if (this.started && this.active === 0 && now - this.lastTrickle > this.trickleMs) {
        const next = this.manifest.find(e => e.stage <= this.priorityStage && this.status.get(e.id) === 'queued')
        if (next) {
          this.lastTrickle = now
          this.fetch(next.id)
        }
      }
    } else if (this.hot && now - this.calmSince > 1500) {
      this.hot = false
      this.pump()
    } else if (heat <= 0.6 && !this.hot) {
      this.calmSince = now
    }
  }
  get paused(): boolean {
    return this.hot
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  progress(stage: number): { done: number; total: number; ratio: number } {
    let done = 0
    let total = 0
    for (const e of this.manifest) {
      if (e.stage > stage) continue
      total++
      const s = this.status.get(e.id)
      if (s === 'done' || s === 'failed') done++
    }
    return { done, total, ratio: total ? done / total : 1 }
  }

  stageReady(stage: number): boolean {
    return this.progress(stage).ratio >= 1
  }

  /** Load everything up to `stage` with priority and resolve when complete (failures are tolerated). */
  ensure(stage: number): Promise<void> {
    this.priorityStage = Math.max(this.priorityStage, stage)
    this.started = true
    this.pump(true)
    const need = this.manifest.filter(e => e.stage <= stage)
    return Promise.all(need.map(e => this.load(e.id))).then(() => undefined)
  }

  /** Begin streaming remaining stages in the background after boot. */
  startBackground(): void {
    this.started = true
    this.priorityStage = 3
    this.pump()
  }

  get(id: string): Loaded | undefined {
    return this.data.get(id)
  }
  image(id: string): HTMLImageElement | undefined {
    const d = this.data.get(id)
    return d instanceof HTMLImageElement ? d : undefined
  }
  buffer(id: string): ArrayBuffer | undefined {
    const d = this.data.get(id)
    return d instanceof ArrayBuffer ? d : undefined
  }
  url(id: string): string {
    return this.byId.get(id)?.url ?? ''
  }

  /** Resolves with the asset (or null on failure) and starts loading it immediately if needed. */
  load(id: string): Promise<Loaded | null> {
    const cur = this.data.get(id)
    if (cur) return Promise.resolve(cur)
    if (this.status.get(id) === 'failed') return Promise.resolve(null)
    const p = new Promise<Loaded | null>(res => {
      const list = this.waiters.get(id) ?? []
      list.push(res)
      this.waiters.set(id, list)
    })
    if (this.status.get(id) === 'queued') this.fetch(id)
    return p
  }

  /** Callback once the asset exists (immediately if already loaded). Never starts a load. */
  when(id: string, fn: (v: Loaded) => void): void {
    const cur = this.data.get(id)
    if (cur) {
      fn(cur)
      return
    }
    const list = this.waiters.get(id) ?? []
    list.push(v => {
      if (v) fn(v)
    })
    this.waiters.set(id, list)
  }

  private limit(): number {
    return this.playing ? this.concurrency.play : this.concurrency.idle
  }

  private pump(force = false): void {
    if (!this.started) return
    if (this.hot && !force) return
    while (this.active < this.limit()) {
      const next = this.manifest.find(e => e.stage <= this.priorityStage && this.status.get(e.id) === 'queued')
      if (!next) return
      this.fetch(next.id)
    }
  }

  private fetch(id: string): void {
    const e = this.byId.get(id)
    if (!e) return
    this.status.set(id, 'loading')
    this.active++
    const job = e.kind === 'image' ? this.loadImage(e.url) : fetch(e.url).then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    job
      .then(v => {
        this.data.set(id, v)
        this.status.set(id, 'done')
        this.flush(id, v)
      })
      .catch(() => {
        this.status.set(id, 'failed')
        this.flush(id, null)
      })
      .finally(() => {
        this.active--
        for (const fn of this.listeners) fn()
        this.pump()
      })
  }

  private flush(id: string, v: Loaded | null): void {
    const list = this.waiters.get(id)
    this.waiters.delete(id)
    if (list) for (const fn of list) fn(v)
  }

  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const im = new Image()
      im.decoding = 'async'
      im.onload = () => {
        if (im.decode) im.decode().then(() => resolve(im), () => resolve(im))
        else resolve(im)
      }
      im.onerror = () => reject(new Error('image ' + url))
      im.src = url
    })
  }
}

export const assets = new Assets()
