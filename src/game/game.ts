/**
 * Orchestrates one arena: owns the Sim and View, turns input into steering, runs the camera,
 * converts simulation events into audio/particles/UI hooks and manages lives and match flow.
 */
import * as THREE from 'three'
import type { GlyphId, ThreatTone } from './glyphs'
import type { ThreatMode } from './threatMarks'
import { analyzeThreats, visibleThreatKinds, type HintId, type ThreatReport } from './threats'
import { assets } from '../engine/assets'
import type { Audio } from '../engine/audio'
import type { Input } from '../engine/input'
import type { Quality } from '../engine/save'
import type { Renderer } from '../engine/renderer'
import { CONFIG } from './config'
import { CELESTIALS, skinById, type CelestialId, type PickupId } from './content'
import { powerEffects, type CompetitiveRound, type Mode, type PowerStacks } from './rules'
import { validColor, validHead, type HeadStyle, type WormColor } from './appearance'
import { SPECIAL_COLORS, type SurpriseId, type TimedTrapId } from './specials'
import { bombLimit, type UpgradeLevels } from './upgrades'
import type { EnvironmentId } from './environmentDefs'
import { campaignGoalProgress, type CampaignStage, type CampaignStats } from './campaign'
import { Sim, type DeathCause, type PlayerControl, type RoundStanding, type Worm } from './sim'
import { View } from './view'
import { gulpFeedback } from './faceFeedback'
import { NetworkSim } from './networkSim'
import type { OnlineSnapshot, Team } from '../net/multiplayer'

export type GameMode = 'title' | 'playing' | 'paused' | 'dead' | 'ended'

export type LifeResult = {
  mode: Mode
  peakLength: number
  finalLength: number
  kills: number
  celestials: number
  shards: number
  seconds: number
  durationMs: number
  cause: DeathCause | 'matchEnd'
  killer: string | null
  powers: PowerStacks
  /** Team match only: the match ended with this life. */
  final: boolean
}

export type MatchResult = { scores: [number, number]; winner: 0 | 1 | -1; playerTeam: 0; standings?: RoundStanding[]; round?: CompetitiveRound; mode?: Mode }

export type FeedItem = { killer: string | null; victim: string; cause: DeathCause; involvesPlayer: boolean; playerKilled: boolean; team?: [number, number] }

export type GameHooks = {
  lifeStart(): void
  lifeEnd(result: LifeResult): void
  matchEnd(result: MatchResult): void
  toast(key: string, vars?: Record<string, string | number>, tone?: 'good' | 'bad' | 'info' | 'power'): void
  celestial(kind: CelestialId, powerAdded: boolean): void
  pickup(kind: PickupId): void
  shard(): void
  feed(item: FeedItem): void
  flash(kind: 'shield' | 'death' | 'celestial' | 'hit'): void
  /** Big centred celebration text (combos, streaks, crown). Tier 1-3 scales the drama. */
  callout(key: string, vars: Record<string, string | number>, tier: 1 | 2 | 3): void
  /** First time a threat type comes into view (once per save). */
  hint(id: HintId): void
  campaignClear(stage: CampaignStage, stats: CampaignStats): void
}
/** Edge-of-screen pointer toward an off-screen threat, in CSS pixels from the top-left. */
export type ThreatArrow = { key: string; x: number; y: number; angle: number; glyph: GlyphId; tone: ThreatTone; urgency: number }

export type HudState = {
  length: number
  stage: number
  environment: EnvironmentId
  arenaRadius: number
  nextStageLength: number | null
  peak: number
  rank: number
  total: number
  kills: number
  shards: number
  magnet: number
  shield: number
  freeBoost: number
  boosting: boolean
  canBoost: boolean
  slowed: boolean
  stacks: PowerStacks
  teamScores: [number, number]
  matchLeft: number
  round?: CompetitiveRound
  leaders: { name: string; length: number; isPlayer: boolean; team: number; rank: number }[]
  rimDanger: number
  respawnIn: number
  combo: number
  /** 0..1 time left before the combo resets. */
  comboLeft: number
  crowned: boolean
  crownName: string | null
  surprise: { kind: SurpriseId; left: number; distance: number; bearing: number } | null
  zoneLeft: number
  shrinkLeft: number
  ghostLeft: number
  ghostCooldown: number
  electricLeft: number
  bombs: { left: number; limit: number; next: number } | null
  laserUnlocked: boolean
  laserUsed: boolean
  upgradeLevels: UpgradeLevels
  traps: Record<TimedTrapId, number>
  trapGrace: number
  threatArrows: ThreatArrow[]
  /** A lethal hazard or rival is on the predicted path right now. */
  threatImminent: boolean
  online?: { ping: number; players: number; total: number; score: number; team: Team | 'spectator' }
  campaign?: { stage: number; goal: CampaignStage['goal']; progress: number; target: number }
}
const HINT_ORDER: HintId[] = ['rival', 'edible', 'asteroid', 'gate', 'well', 'rim', 'bite']
const projV = new THREE.Vector3()

const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const ray = new THREE.Raycaster()
const ndc = new THREE.Vector2()
const hit = new THREE.Vector3()

export type PlayerProfile = () => { name: string; skin: string; color?: WormColor; headStyle?: HeadStyle; upgrades?: Partial<UpgradeLevels>; laserUnlocked?: boolean }

export class Game {
  mode: GameMode = 'title'
  matchType: Mode = 'ffa'
  sim!: Sim
  readonly view = new View()
  private networkSim: NetworkSim | null = null
  private sendOnlineInput: ((angle: number, boost: boolean) => void) | null = null
  onlineControlsEnabled = true
  onlinePing = 0
  get isOnline(): boolean { return this.networkSim !== null }
  private _reduced = false
  private cam = { x: 0, z: 0, h: CONFIG.camera.height, fov: CONFIG.camera.fov }
  private shake = 0
  private focus = { x: 0, z: 0 }
  private demoTarget: Worm | null = null
  private demoTimer = 0
  private respawnTimer = 0
  private lastTarget: number | null = null
  private wasBoosting = false
  private warnCooldown = 0
  private hitstop = 0
  private streak = 0
  private streakTimer = 0
  private prevEffects = { magnet: 0, shield: 0, freeBoost: 0 }
  private threats: ThreatReport | null = null
  private threatCooldown = 0
  private hadFocus = false
  private hintClock = 0
  private hintCooldown = 2
  /** Hint ids already shown (persisted by the app); the game adds to it as hints fire. */
  seenHints = new Set<HintId>()
  hintsEnabled = true
  set threatMode(m: ThreatMode) {
    this.view.threatMode = m
  }
  get threatMode(): ThreatMode {
    return this.view.threatMode
  }

  constructor(
    private readonly renderer: Renderer,
    private readonly input: Input,
    private readonly audio: Audio,
    private readonly hooks: GameHooks,
    private readonly profile: PlayerProfile,
  ) {
    this.toTitle()
  }

  get reducedMotion(): boolean {
    return this._reduced
  }
  set reducedMotion(v: boolean) {
    this._reduced = v
    this.view.reducedMotion = v
    this.view.particles.scale = v ? 0.45 : 1
  }

  setQuality(q: Quality): void {
    this.renderer.applyQuality(q)
    this.view.environment.quality = q
  }

  // ─── flow ───────────────────────────────────────────────────────────────
  toTitle(): void {
    this.networkSim = null
    this.sendOnlineInput = null
    const p = this.profile()
    this.sim = new Sim({ mode: 'ffa', playerName: p.name, playerSkin: p.skin, playerColor: p.color, headStyle: p.headStyle })
    this.sim.player.alive = false
    this.sim.player.xs = []
    this.sim.player.zs = []
    this.sim.player.kinds = []
    this.sim.events.length = 0
    this.view.bind(this.sim)
    this.mode = 'title'
    this.demoTarget = null
    this.cam.h = 70
    this.audio.setBoosting(false)
    this.audio.setWell(0)
    this.audio.setScene('title')
  }

  start(mode: Mode, round?: CompetitiveRound, campaign?: CampaignStage): void {
    this.networkSim = null
    this.sendOnlineInput = null
    const p = this.profile()
    this.matchType = mode
    this.sim = new Sim({ mode, round, campaign, playerName: p.name, playerSkin: p.skin, playerColor: p.color, headStyle: p.headStyle, bots: campaign?.bots, premium: p.upgrades, laserUnlocked: p.laserUnlocked })
    this.sim.events.length = 0
    this.view.bind(this.sim)
    this.mode = 'playing'
    this.audio.setEnvironmentMusic(this.sim.environment)
    this.audio.setScene('arena')
    this.snapCamera()
    this.lastTarget = null
    this.input.clearBoost()
    this.hooks.lifeStart()
  }

  startOnline(snapshot: OnlineSnapshot, playerId: string, sendInput: (angle: number, boost: boolean) => void): void {
    this.networkSim = new NetworkSim(playerId)
    this.sim = this.networkSim
    this.sendOnlineInput = sendInput
    this.matchType = 'team'
    this.applyOnlineSnapshot(snapshot)
    this.view.bind(this.sim)
    this.snapCamera()
    this.lastTarget = null
    this.input.clearBoost()
    this.audio.setEnvironmentMusic(this.sim.environment)
    this.audio.setScene('arena')
  }

  applyOnlineSnapshot(snapshot: OnlineSnapshot): void {
    const sim = this.networkSim
    if (!sim) return
    const events = sim.applyNetworkSnapshot(snapshot)
    this.mode = snapshot.phase === 'ended' ? 'ended' : sim.player.alive ? 'playing' : 'dead'
    for (const e of events) {
      const player = snapshot.players.find(p => p.id === e.playerId)
      const mine = e.playerId === sim.localPlayerId
      const worm = sim.worms.find(w => w.id === (player ? 1 + player.slot + (player.team === 'red' ? 3 : 0) : -1))
      if (e.type === 'eat' && e.x !== undefined && e.z !== undefined) {
        if (this.near(e.x, e.z)) this.view.fx.bite(e.x, e.z, e.color ?? 0x5ef3ff, 0, mine)
        if (worm) this.view.flashGulp(worm.id, 0.35)
        if (mine) this.audio.play('eat')
      } else if (e.type === 'death' && worm && player) {
        this.view.fx.death(worm.xs, worm.zs, skinById(worm.skin).colors, worm.radius, mine)
        const killer = snapshot.players.find(p => p.id === e.killerId)
        this.hooks.feed({ killer: killer?.name ?? null, victim: player.name, cause: e.cause ?? 'worm',
          involvesPlayer: mine || e.killerId === sim.localPlayerId, playerKilled: !mine && e.killerId === sim.localPlayerId })
        if (mine) {
          this.focus = { x: e.x ?? worm.xs[0], z: e.z ?? worm.zs[0] }
          this.audio.play('death'); this.audio.setBoosting(false); this.hooks.flash('death')
        } else if (e.killerId === sim.localPlayerId) this.audio.play('kill')
      } else if (e.type === 'spawn' && mine) { this.lastTarget = null; this.input.clearBoost(); this.snapCamera() }
    }
    if (snapshot.phase === 'ended') { this.audio.setBoosting(false); this.audio.setScene('results') }
    // Deliberately no lifeEnd/matchEnd save hooks: online scores never rewrite local progression.
  }

  /** Free-for-all: continue in the same arena with a fresh worm. */
  respawn(): void {
    if (this.isOnline || this.mode !== 'dead' || this.sim.matchOver) return
    const p = this.profile()
    this.sim.player.skin = p.skin
    this.sim.player.color = validColor(p.color)
    this.sim.player.headStyle = validHead(p.headStyle)
    this.sim.spawnWorm(this.sim.player)
    this.sim.events = this.sim.events.filter(e => e.type !== 'spawn')
    this.mode = 'playing'
    this.snapCamera()
    this.input.clearBoost()
    this.hooks.lifeStart()
  }

  pause(): void {
    if (this.isOnline) { this.onlineControlsEnabled = false; this.input.clearBoost(); return }
    if (this.mode === 'playing' || this.mode === 'dead') this.mode = 'paused'
  }

  resume(): void {
    if (this.isOnline) { this.onlineControlsEnabled = true; this.input.clearBoost(); return }
    if (this.mode !== 'paused') return
    this.mode = this.sim.player.alive ? 'playing' : 'dead'
    this.input.clearBoost()
  }

  get playerAlive(): boolean {
    return this.sim.player.alive
  }

  private snapCamera(): void {
    const p = this.sim.player
    this.cam.x = p.xs[0]
    this.cam.z = p.zs[0]
    this.cam.h = this.targetHeight(p)
  }

  // ─── simulation ─────────────────────────────────────────────────────────
  step(dt: number): void {
    if (this.networkSim) { this.stepOnline(dt); return }
    if (this.mode === 'paused') return
    const environmentDt = this.mode === 'playing' || this.mode === 'dead' ? dt : 0
    // Hit-stop: a few frames of slow motion sell big impacts.
    if (this.hitstop > 0) {
      this.hitstop -= dt
      dt *= 0.25
    }
    if (this.streakTimer > 0) this.streakTimer -= dt
    const control = this.mode === 'playing' ? this.control() : null
    this.sim.step(dt, control, environmentDt)
    this.handleEvents()
    if (this.mode === 'dead' && this.sim.mode === 'team' && !this.sim.matchOver) {
      this.respawnTimer -= dt
      if (this.respawnTimer <= 0) {
        this.sim.spawnWorm(this.sim.player)
        this.sim.events = this.sim.events.filter(e => e.type !== 'spawn')
        this.mode = 'playing'
        this.snapCamera()
        this.hooks.lifeStart()
      }
    }
    if (this.mode === 'playing') this.warnings(dt)
  }

  private stepOnline(dt: number): void {
    if (!this.networkSim || this.mode === 'ended') return
    this.networkSim.interpolate()
    const p = this.sim.player
    if (!p.isPlayer || !p.alive) return
    const control = this.onlineControlsEnabled ? this.control() : { targetAngle: p.angle, turn: 0, boost: false }
    // Aim ahead of the interpolated heading; the server still clamps the actual turn rate.
    const angle = control.targetAngle ?? p.angle + control.turn * 2.8 * Math.max(0.25, dt)
    this.sendOnlineInput?.(angle, control.boost)
  }

  private control(): PlayerControl {
    const p = this.sim.player
    const s = this.input.steer
    let target: number | null = null
    let turn = 0
    if (s.kind === 'screen') {
      ndc.set((s.x / window.innerWidth) * 2 - 1, -(s.y / window.innerHeight) * 2 + 1)
      ray.setFromCamera(ndc, this.view.camera)
      if (ray.ray.intersectPlane(plane, hit)) {
        const dx = hit.x - p.xs[0]
        const dz = hit.z - p.zs[0]
        // Very close to the head the angle is noisy: keep the previous heading.
        target = Math.hypot(dx, dz) > p.radius * 1.6 ? Math.atan2(dz, dx) : this.lastTarget
      }
    } else if (s.kind === 'direction') {
      if (Math.hypot(s.x, s.y) > 0.15) target = Math.atan2(-s.y, s.x)
    } else if (s.kind === 'turn') {
      turn = s.axis
    }
    if (target !== null) this.lastTarget = target
    return {
      targetAngle: target,
      turn,
      boost: this.input.boost,
      ghost: this.input.consume('ghost'),
      electric: this.input.consume('electric'),
      bomb: this.input.consume('bomb'),
      laser: this.input.consume('laser'),
    }
  }

  private warnings(dt: number): void {
    const p = this.sim.player
    this.warnCooldown -= dt
    const edge = this.sim.radius - Math.hypot(p.xs[0], p.zs[0])
    if (edge < 10 && this.warnCooldown <= 0) {
      this.warnCooldown = 0.6
      this.audio.play('warn')
    }
    const boosting = p.boosting
    if (boosting !== this.wasBoosting) {
      this.wasBoosting = boosting
    }
    // Countdown ticks in the last 3 s of each timed effect, and a soft chime when it ends.
    for (const k of ['magnet', 'shield', 'freeBoost'] as const) {
      const now = p[k]
      const was = this.prevEffects[k]
      if (now > 0 && now < 3 && Math.ceil(now) !== Math.ceil(was)) this.audio.play('tick', 1 + (3 - Math.ceil(now)) * 0.08)
      if (was > 0 && now <= 0 && k !== 'shield') this.audio.play('expire')
      this.prevEffects[k] = now
    }
    let well = 0
    for (const w of this.sim.wells) well = Math.max(well, 1 - Math.hypot(p.xs[0] - w.x, p.zs[0] - w.z) / w.r)
    this.audio.setWell(Math.max(0, well))
    if (p.wantBoost && !boosting && this.warnCooldown <= 0) {
      this.warnCooldown = 1.5
      this.hooks.toast('toast.tooShortBoost', { n: CONFIG.worm.minBoostLength }, 'info')
    }
  }

  private near(x: number, z: number, pad = 0): boolean {
    const vr = this.viewRadius() + pad
    return Math.abs(x - this.cam.x) < vr && Math.abs(z - this.cam.z) < vr
  }

  private handleEvents(): void {
    const sim = this.sim
    const P = sim.player
    const fx = this.view.fx
    for (const e of sim.events) {
      const gulp = gulpFeedback(e)
      if (gulp) {
        this.view.flashGulp(gulp.worm.id, gulp.strength)
        if (gulp.big && gulp.worm === P && this.mode === 'playing') this.audio.playHeadVocal(P.headStyle, gulp.strength)
      }
      switch (e.type) {
        case 'eat':
          if (e.nova) {
            if (this.near(e.x, e.z)) fx.nova(e.x, e.z)
            if (e.worm === P) {
              this.audio.play('nova')
              this.hooks.callout('callout.nova', {}, 2)
              this.view.bulge(P.id)
            }
          } else if (e.worm === P) {
            // Pitch climbs with the feast combo, capped at a musical fifth.
            this.audio.play('eat', 1 + Math.min(0.5, e.combo * 0.012), e.value > 2 ? 0.8 : 1)
            fx.bite(e.x, e.z, e.color, e.combo, true)
          } else if (this.near(e.x, e.z) && Math.random() < 0.3) fx.bite(e.x, e.z, e.color, 0, false)
          break
        case 'combo':
          this.audio.play('combo', 1 + Math.min(0.4, e.combo / 250))
          this.hooks.callout('callout.combo', { n: e.combo, bonus: e.bonus }, e.combo >= 50 ? 3 : e.combo >= 25 ? 2 : 1)
          this.hooks.shard()
          break
        case 'shard':
          if (e.worm !== P) break
          this.audio.play('shard')
          fx.shard(e.x, e.z)
          this.hooks.shard()
          break
        case 'pickup':
          if (this.near(e.x, e.z)) fx.pickup(e.x, e.z, e.kind)
          if (e.worm === P) {
            this.audio.play('pickup')
            if (e.kind === 'shield') this.audio.play('shieldUp')
            this.hooks.pickup(e.kind)
          }
          break
        case 'celestial': {
          if (this.near(e.x, e.z, 10)) fx.swallow(e.x, e.z, e.kind, e.worm.radius)
          this.view.bulge(e.worm.id)
          if (e.worm === P) {
            this.audio.play('celestial')
            if (e.powerAdded) window.setTimeout(() => this.audio.play('power'), 280)
            this.shake = Math.max(this.shake, 0.55)
            this.hitstop = 0.09
            this.hooks.celestial(e.kind, e.powerAdded)
            this.hooks.flash('celestial')
          }
          break
        }
        case 'tooSmall':
          this.audio.play('bump')
          if (P.alive) fx.tooSmall(P.xs[0], P.zs[0])
          this.hooks.toast('toast.tooSmall', { n: CELESTIALS[e.kind].minLength, body: `celestial.${e.kind}` }, 'bad')
          break
        case 'shieldBreak':
          if (this.near(e.x, e.z)) fx.shieldBreak(e.x, e.z)
          if (e.worm === P) {
            this.audio.play('shield')
            this.shake = Math.max(this.shake, 0.7)
            this.hitstop = 0.07
            this.hooks.toast('toast.shieldSaved', {}, 'info')
            this.hooks.flash('shield')
          }
          break
        case 'crown':
          if (e.worm && this.near(e.worm.xs[0], e.worm.zs[0])) fx.crown(e.worm.xs[0], e.worm.zs[0])
          if (e.worm === P) {
            this.audio.play('crown')
            this.hooks.callout('callout.crownYou', {}, 3)
          }
          break
        case 'crownTaken':
          if (e.killer === P) {
            this.audio.play('crown')
            this.hooks.callout('callout.crownTaken', { name: e.victim.name, n: e.bounty }, 3)
            this.hooks.shard()
          }
          break
        case 'death': {
          const w = e.worm
          const big = w.xs.length >= 80
          if (this.near(e.x, e.z, 20)) {
            fx.death(w.xs, w.zs, skinById(w.skin).colors, w.radius, big)
            if (big) {
              this.audio.play('supernova', 1, w === P ? 1 : 0.7)
              this.shake = Math.max(this.shake, w === P ? 1.2 : 0.6)
            }
          }
          const involves = w === P || e.killer === P
          if (involves || w.xs.length > 90) {
            this.hooks.feed({ killer: e.killer?.name ?? null, victim: w.name, cause: e.cause, involvesPlayer: involves, playerKilled: w === P, team: e.killer ? [e.killer.team, w.team] : undefined })
          }
          if (e.killer === P) {
            this.audio.play('kill')
            fx.kill(e.x, e.z)
            this.hitstop = 0.1
            this.shake = Math.max(this.shake, 0.35)
            this.streak = this.streakTimer > 0 ? this.streak + 1 : 1
            this.streakTimer = 10
            if (this.streak >= 2) this.hooks.callout(`callout.streak${Math.min(5, this.streak)}`, { n: this.streak }, Math.min(3, this.streak - 1) as 1 | 2 | 3)
            else this.hooks.toast('toast.kill', { name: w.name }, 'good')
            if (big) this.hooks.callout('callout.supernova', { name: w.name }, 3)
          }
          if (w === P) {
            this.audio.play('death')
            this.audio.setBoosting(false)
            this.audio.setWell(0)
            this.shake = Math.max(this.shake, 1)
            this.streak = 0
            this.focus = { x: e.x, z: e.z }
            this.mode = this.mode === 'paused' ? 'paused' : 'dead'
            this.respawnTimer = CONFIG.team.respawn
            this.hooks.flash('death')
            this.hooks.lifeEnd(this.lifeResult(e.cause, e.killer?.name ?? null, false))
          }
          break
        }
        case 'bite': {
          const mine = e.biter === P
          const me = e.victim === P
          if (this.near(e.x, e.z, 20)) fx.sever(e.x, e.z, e.xs, e.zs, skinById(e.victim.skin).colors, e.victim.radius, mine || me)
          if (mine) {
            this.audio.play('kill', 1.3, 0.8)
            this.audio.play('eat', 0.7, 1)
            this.hitstop = 0.08
            this.shake = Math.max(this.shake, 0.35)
            this.hooks.callout('callout.bite', { name: e.victim.name, n: e.lost }, e.lost >= 40 ? 3 : e.lost >= 15 ? 2 : 1)
            this.hooks.shard()
          } else if (me) {
            this.audio.play('bump', 0.8, 1)
            this.audio.play('shield', 0.7, 0.6)
            this.shake = Math.max(this.shake, 0.8)
            this.hitstop = 0.06
            this.hooks.flash('hit')
            this.hooks.callout('callout.bitten', { name: e.biter.name, n: e.lost }, 2)
          } else if (this.near(e.x, e.z, 12)) {
            this.audio.play('eat', 0.6, 0.5)
          }
          break
        }
        case 'matchEnd': {
          if (P.alive) {
            this.hooks.lifeEnd(this.lifeResult('matchEnd', null, true))
            P.alive = false
            this.focus = { x: P.xs[0], z: P.zs[0] }
          }
          this.mode = 'ended'
          this.audio.setBoosting(false)
          this.audio.setWell(0)
          this.audio.setScene('results')
          const winner = e.winner ?? (e.scores[0] === e.scores[1] ? -1 : e.scores[0] > e.scores[1] ? 0 : 1)
          this.audio.play(winner === 0 ? 'win' : 'lose')
          this.hooks.matchEnd({ scores: e.scores, winner, playerTeam: 0, standings: e.standings, round: sim.round, mode: sim.mode })
          break
        }
        case 'stage':
          this.audio.play('power', 1 + e.stage * 0.05, 0.85)
          this.hooks.callout('callout.stage', { n: e.stage }, 3)
          this.hooks.toast('toast.stage', { n: e.stage }, 'power')
          break
        case 'campaignClear':
          this.mode = 'ended'
          this.audio.setBoosting(false)
          this.audio.setWell(0)
          this.audio.setScene('results')
          this.audio.play('win')
          this.hooks.campaignClear(e.stage, e.stats)
          break
        case 'surpriseSpawn':
          if (this.mode === 'playing') {
            this.audio.play('warn', 1.4, 0.6)
            this.hooks.toast('toast.surpriseSpawn', { name: `surprise.${e.surprise.kind}`, n: 5 }, 'power')
          }
          break
        case 'surpriseExpire':
          if (this.mode === 'playing') {
            this.audio.play('expire', 0.9, 0.65)
            this.hooks.toast('toast.surpriseExpired', {}, 'info')
          }
          break
        case 'surprise':
          if (this.near(e.x, e.z)) fx.nova(e.x, e.z)
          if (e.worm === P || e.kind !== 'shrink') {
            if (this.mode === 'playing') {
              this.audio.play(e.kind === 'legendary' ? 'crown' : 'power')
              this.hooks.toast(`toast.surprise.${e.kind}`, { n: e.duration, name: e.worm.name }, 'power')
            }
          }
          break
        case 'zoneWarning':
          if (this.mode === 'playing') {
            this.audio.play('warn')
            this.hooks.toast('toast.zoneWarning', { n: Math.ceil(e.remaining) }, 'bad')
          }
          break
        case 'zoneEnd':
          if (this.mode === 'playing') {
            this.audio.play('expire')
            this.hooks.toast('toast.zoneEnd', {}, 'info')
          }
          break
        case 'shrinkEnd':
          if (e.worm === P && this.mode === 'playing') this.hooks.toast('toast.shrinkEnd', {}, 'info')
          break
        case 'ability':
          if (e.worm === P) {
            this.audio.play(e.kind === 'bomb' ? 'pickup' : 'power')
            this.hooks.toast(`toast.ability.${e.kind}`, { n: Math.ceil(e.duration) }, 'power')
          }
          break
        case 'electricHit':
          if (e.attacker === P) {
            this.audio.play('bump')
            this.hooks.flash('hit')
            this.hooks.toast('toast.electricHit', { n: e.damage }, 'bad')
          }
          break
        case 'bombDetonate':
          if (e.bomb.ownerId === P.id) {
            this.audio.play('shield')
            this.hooks.callout('callout.bomb', { n: e.damage }, 2)
          }
          break
        case 'bombExpire':
          if (e.bomb.ownerId === P.id && this.mode === 'playing') this.hooks.toast('toast.bombExpired', {}, 'info')
          break
        case 'trap':
          if (this.near(e.x, e.z)) fx.bite(e.x, e.z, SPECIAL_COLORS[e.kind], 0, e.worm === P)
          if (e.worm === P) {
            this.audio.play(e.resisted ? 'shield' : e.kind === 'teleport' ? 'power' : 'bump', 0.8)
            this.hooks.flash(e.resisted ? 'shield' : 'hit')
            this.hooks.toast(e.resisted ? 'toast.trapResisted' : `toast.trap.${e.kind}`, { n: Math.ceil(e.duration), name: `trap.${e.kind}` }, e.resisted ? 'good' : 'bad')
            if (e.kind === 'teleport' && !e.resisted) { this.lastTarget = null; this.snapCamera() }
          }
          break
        case 'trapEnd':
          if (e.worm === P) {
            this.audio.play('expire')
            this.hooks.toast('toast.trapEnd', { name: `trap.${e.kind}` }, 'info')
          }
          break
        case 'spawn':
          break
      }
    }
    sim.events.length = 0
  }

  private lifeResult(cause: DeathCause | 'matchEnd', killer: string | null, final: boolean): LifeResult {
    const p = this.sim.player
    const seconds = this.sim.time - p.born
    return {
      mode: this.sim.mode, peakLength: p.peak, finalLength: p.xs.length, kills: p.kills, celestials: p.celestials,
      shards: p.shards, seconds, durationMs: Math.round(seconds * 1000), cause, killer, powers: { ...p.stacks }, final,
    }
  }

  // ─── camera & render ────────────────────────────────────────────────────
  private targetHeight(w: Worm): number {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight)
    const portrait = aspect < 1 ? Math.min(1.6, 1 / Math.sqrt(aspect)) : 1
    return CONFIG.camera.height * (0.86 + (w.radius - 0.9) * 0.34) * portrait + (w.boosting ? 3 : 0)
  }

  private viewRadius(): number {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight)
    const half = Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2)) * this.cam.h * (1 + CONFIG.camera.tilt)
    return half * Math.max(1, aspect) * 1.25 + 6
  }

  render(_alpha: number, frameSeconds: number): void {
    const dt = Math.min(0.1, frameSeconds)
    this.networkSim?.interpolate()
    const sim = this.sim
    const P = sim.player
    if (this.mode === 'playing' || this.mode === 'dead' || this.mode === 'paused') this.audio.setEnvironmentMusic(sim.environment)
    let tx = this.focus.x
    let tz = this.focus.z
    let th = this.cam.h
    if (this.mode === 'title') {
      this.demoTimer -= dt
      if (!this.demoTarget || !this.demoTarget.alive || this.demoTimer <= 0) {
        const alive = sim.ranking()
        this.demoTarget = alive[Math.min(alive.length - 1, Math.floor(Math.random() * 3))] ?? null
        this.demoTimer = 14
      }
      if (this.demoTarget) {
        tx = this.demoTarget.xs[0]
        tz = this.demoTarget.zs[0]
      }
      th = 62
    } else if (P.alive) {
      const lead = this._reduced ? 0 : Math.min(8, P.speed * 0.35)
      tx = P.xs[0] + Math.cos(P.angle) * lead
      tz = P.zs[0] + Math.sin(P.angle) * lead
      th = this.targetHeight(P)
      this.audio.setBoosting(P.boosting && this.mode === 'playing', P.freeBoost > 0)
      let near = 0
      for (const w of sim.worms) if (w !== P && w.alive && Math.hypot(w.xs[0] - P.xs[0], w.zs[0] - P.zs[0]) < 32) near++
      this.audio.intensity = Math.min(1, near * 0.22 + P.xs.length / 400 + (P.boosting ? 0.2 : 0) + (sim.crownId === P.id ? 0.3 : 0))
    } else {
      th = CONFIG.camera.height * 1.25
    }
    const follow = 1 - Math.exp(-dt * CONFIG.camera.follow * (this.mode === 'title' ? 0.35 : 1))
    this.cam.x += (tx - this.cam.x) * follow
    this.cam.z += (tz - this.cam.z) * follow
    this.cam.h += (th - this.cam.h) * (1 - Math.exp(-dt * 1.6))
    const fovTarget = CONFIG.camera.fov + (P.alive && P.boosting && !this._reduced ? 5 : 0)
    this.cam.fov += (fovTarget - this.cam.fov) * (1 - Math.exp(-dt * 5))

    const camera = this.view.camera
    let sx = 0
    let sz = 0
    if (this.shake > 0) {
      if (!this._reduced) {
        sx = (Math.random() - 0.5) * this.shake * 1.6
        sz = (Math.random() - 0.5) * this.shake * 1.6
      }
      this.shake = Math.max(0, this.shake - dt * 2.2)
    }
    const tilt = this.mode === 'title' ? 0.62 : CONFIG.camera.tilt
    camera.position.set(this.cam.x + sx, this.cam.h, this.cam.z + this.cam.h * tilt + sz)
    camera.lookAt(this.cam.x + sx, 0, this.cam.z + sz)
    if (Math.abs(camera.fov - this.cam.fov) > 0.01) {
      camera.fov = this.cam.fov
      camera.updateProjectionMatrix()
    }
    this.updateThreats(dt, this.cam.x, this.cam.z + this.cam.h * tilt * 0.35)
    this.view.update(dt, this.cam.x, this.cam.z + this.cam.h * tilt * 0.35, this.viewRadius())
    this.renderer.render(this.view.scene, camera)
    // Render heat drives the asset prefetcher: busy frames pause optional downloads.
    assets.setHeat(Math.max(this.view.heat, frameSeconds > 1 / 40 ? 0.8 : 0))
  }

  /** Threat Language: look-ahead analysis, warning tick and first-encounter hints. */
  private updateThreats(dt: number, fx: number, fz: number): void {
    const sim = this.sim
    const P = sim.player
    if (this.isOnline || this.mode !== 'playing' || !P?.alive) {
      this.threats = null
      this.view.threats = null
      this.hadFocus = false
      return
    }
    const rep = analyzeThreats(sim)
    this.threats = rep
    this.view.threats = rep
    this.threatCooldown -= dt
    const focus = !!rep.focus && P.spawnGrace <= 0
    // Soft warning when a new danger appears on the path (not every frame it stays there).
    if (focus && !this.hadFocus && this.threatCooldown <= 0 && rep.focus?.kind !== 'rim') {
      this.threatCooldown = 1.4
      this.audio.play('warn', 1.25, 0.55)
    }
    this.hadFocus = focus
    if (!this.hintsEnabled) return
    this.hintCooldown -= dt
    this.hintClock += dt
    if (this.hintClock < 0.5 || this.hintCooldown > 0) return
    this.hintClock = 0
    const seen = visibleThreatKinds(sim, fx, fz, this.viewRadius())
    const next = HINT_ORDER.find(id => seen.has(id) && !this.seenHints.has(id))
    if (!next) return
    this.seenHints.add(next)
    this.hintCooldown = 7
    this.hooks.hint(next)
  }

  /** Project threat targets to the screen edge when they are off-screen. */
  private threatArrows(): ThreatArrow[] {
    const rep = this.threats
    if (!rep || this.view.threatMode !== 'full') return []
    const W = window.innerWidth
    const H = window.innerHeight
    const inset = Math.max(34, Math.min(W, H) * 0.07)
    const out: ThreatArrow[] = []
    for (const a of rep.arrows) {
      projV.set(a.x, 0, a.z).project(this.view.camera)
      let nx = projV.x
      let ny = projV.y
      if (projV.z > 1) {
        nx = -nx
        ny = -ny
      } else if (Math.abs(nx) < 0.94 && Math.abs(ny) < 0.94) continue
      const sx = (nx * W) / 2
      const sy = (-ny * H) / 2
      const k = Math.min((W / 2 - inset) / Math.max(1e-3, Math.abs(sx)), (H / 2 - inset) / Math.max(1e-3, Math.abs(sy)))
      let tone: ThreatTone = 'lethal'
      if (a.kind === 'gate') {
        const g = this.sim.gates[Number(a.key.slice(1))]
        if (g && this.sim.gateAt(g).phase === 'warn') tone = 'warn'
      }
      out.push({ key: a.key, x: W / 2 + sx * k, y: H / 2 + sy * k, angle: Math.atan2(sy, sx), glyph: a.kind === 'gate' ? 'bolt' : 'jaw', tone, urgency: a.urgency })
    }
    return out
  }

  // ─── HUD data ───────────────────────────────────────────────────────────
  hud(): HudState {
    const sim = this.sim
    const P = sim.player
    const ranking = sim.ranking()
    const rank = ranking.indexOf(P) + 1
    const leaders = ranking.slice(0, 5).map((w, i) => ({ name: w.name, length: w.xs.length, isPlayer: w === P, team: w.team, rank: i + 1 }))
    if (P.alive && rank > 5) leaders.push({ name: P.name, length: P.xs.length, isPlayer: true, team: P.team, rank })
    const fx = powerEffects(P.stacks)
    void fx
    const surprise = sim.surprises.find(s => s.alive && s.expiresAt > sim.time)
    const campaignStats = sim.campaignProgress()
    return {
      length: P.alive ? P.xs.length : 0,
      stage: sim.stage,
      environment: sim.environment,
      arenaRadius: sim.radius,
      nextStageLength: sim.nextStageLength(),
      peak: P.peak,
      rank,
      total: ranking.length,
      kills: P.kills,
      shards: P.shards,
      magnet: P.magnet,
      shield: P.shield,
      freeBoost: P.freeBoost,
      boosting: P.boosting,
      canBoost: P.freeBoost > 0 || P.xs.length > CONFIG.worm.minBoostLength,
      slowed: P.slowed,
      stacks: P.stacks,
      teamScores: sim.teamScores(),
      matchLeft: sim.matchLeft,
      round: sim.round,
      ...(sim.campaignStage && campaignStats ? { campaign: {
        stage: sim.campaignStage.id,
        goal: sim.campaignStage.goal,
        progress: campaignGoalProgress(sim.campaignStage, campaignStats),
        target: sim.campaignStage.target,
      } } : {}),
      ...(this.networkSim?.latest ? { online: {
        ping: this.onlinePing, players: this.networkSim.latest.players.filter(p => p.connected).length,
        total: this.networkSim.latest.players.length, score: this.networkSim.playerScore,
        team: this.networkSim.latest.players.find(p => p.id === this.networkSim?.localPlayerId)?.team ?? 'spectator',
      } } : {}),
      leaders,
      rimDanger: P.alive ? Math.max(0, Math.min(1, 1 - (sim.radius - Math.hypot(P.xs[0], P.zs[0])) / 14)) : 0,
      respawnIn: this.networkSim ? this.networkSim.respawnIn : this.mode === 'dead' && sim.mode === 'team' ? Math.max(0, this.respawnTimer) : 0,
      combo: P.alive ? P.combo : 0,
      comboLeft: P.alive && P.combo > 0 ? Math.max(0, P.comboTimer / CONFIG.feast.comboWindow) : 0,
      crowned: P.alive && sim.crownId === P.id,
      crownName: sim.worms.find(w => w.id === sim.crownId)?.name ?? null,
      surprise: P.alive && surprise ? {
        kind: surprise.kind, left: surprise.expiresAt - sim.time,
        distance: Math.hypot(surprise.x - P.xs[0], surprise.z - P.zs[0]),
        bearing: Math.atan2(surprise.z - P.zs[0], surprise.x - P.xs[0]) - P.angle,
      } : null,
      zoneLeft: sim.zoneLeft,
      shrinkLeft: P.alive ? P.shrinkLeft : 0,
      ghostLeft: P.alive ? P.ghostLeft : 0,
      ghostCooldown: P.alive ? P.ghostCooldownLeft : 0,
      electricLeft: P.alive ? P.electricLeft : 0,
      bombs: sim.playerUpgrades.bomb > 0 ? {
        left: sim.bombs.filter(b => b.alive && b.ownerId === P.id).length,
        limit: bombLimit(sim.playerUpgrades.bomb),
        next: sim.bombs.filter(b => b.alive && b.ownerId === P.id).reduce((min, b) => Math.min(min, Math.max(0, b.expiresAt - sim.time)), 0),
      } : null,
      upgradeLevels: { ...sim.playerUpgrades },
      laserUnlocked: sim.laserUnlocked,
      laserUsed: sim.laserUsed,
      traps: P.alive ? P.traps : { freeze: 0, slow: 0, reverse: 0 },
      trapGrace: P.alive ? P.trapGrace : 0,
      threatArrows: P.alive ? this.threatArrows() : [],
      threatImminent: !!this.threats?.focus,
    }
  }

  /** Camera view center, for the minimap viewport box. */
  viewCenter(): { x: number; z: number; r: number } {
    return { x: this.cam.x, z: this.cam.z, r: this.viewRadius() * 0.72 }
  }
}
