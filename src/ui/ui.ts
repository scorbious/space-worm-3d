/**
 * DOM UI. Every visible string comes from i18n keys (`data-i18n` or `t()`), so adding a language
 * only needs a new dictionary. Screens are <section data-screen> elements toggled by `show()`.
 */
import type { Audio } from '../engine/audio'
import type { I18n } from '../engine/i18n'
import { CampaignStore, LOCALES, sanitizeName, type Locale, type SaveData, type SaveStore } from '../engine/save'
import { CONFIG } from '../game/config'
import { CELESTIALS, CELESTIAL_IDS, PICKUP_IDS, POWERS, POWER_IDS, SKINS, UPGRADE_IDS, skinById, type CelestialId, type PickupId, type UpgradeId } from '../game/content'
import { appearanceSkin, HEAD_STYLES, validColor, validHead, WORM_COLORS } from '../game/appearance'
import type { FeedItem, Game, HudState, LifeResult, MatchResult, ThreatArrow } from '../game/game'
import { glyphSvg, type GlyphId } from '../game/glyphs'
import type { HintId } from '../game/threats'
import { formatClock, type CompetitiveRound, type Mode, type Records } from '../game/rules'
import { CAMPAIGN_STAGES, campaignGoalProgress, type CampaignStage, type CampaignStats } from '../game/campaign'
import type { LobbyState, MultiplayerStatus, MultiplayerTransport, OnlineMatchEnd, PlayerSeat } from '../net/multiplayer'
import { icon } from './icons'
import { Minimap } from './minimap'
import { Sparks } from './sparks'
import { assets } from '../engine/assets'
import { LASER_PRICE, UPGRADE_DEFS, nextUpgradePrice } from '../game/upgrades'

export type Screen = 'boot' | 'loading' | 'title' | 'hud' | 'pause' | 'settings' | 'skins' | 'upgrades' | 'records' | 'howto' | 'death' | 'match' | 'multiplayer' | 'campaign' | 'campaignResult'

export type UiActions = {
  play(mode: Mode, round?: CompetitiveRound): void
  respawn(): void
  resume(): void
  pause(): void
  quit(): void
  settings(patch: Partial<SaveData>): void
  buySkin(id: string): boolean
  buyUpgrade(id: UpgradeId): boolean
  equipSkin(id: string): void
  ability(kind: 'ghost' | 'electric' | 'bomb' | 'laser'): void
  buyLaser(): boolean
  /** Forget which first-encounter hazard hints were shown. */
  resetHints(): void
  multiplayer(action: string, value?: string): void
  campaign(action: string, stage?: number): void
}
/** Glyph shown for each threat hint / legend row / death cause. */
const THREAT_GLYPH: Record<string, GlyphId> = { asteroid: 'skull', gate: 'bolt', well: 'spiral', rim: 'rim', rival: 'jaw', worm: 'jaw', head: 'jaw', self: 'jaw', ally: 'shield', edible: 'star', bite: 'bite' }

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const hexCss = (n: number) => `#${n.toString(16).padStart(6, '0')}`
const EFFECT_MAX: Record<PickupId, () => number> = {
  magnet: () => CONFIG.pickups.magnet,
  shield: () => CONFIG.pickups.shield,
  freeBoost: () => CONFIG.pickups.freeBoost,
}

type DeathInfo = { result: LifeResult; earned: number; newBest: boolean; localRank: number }
type CampaignResultInfo = { success: boolean; stage: CampaignStage; stats: CampaignStats; reward: number; unlockedStage: number }

export class Ui {
  screen: Screen = 'boot'
  private root: HTMLElement
  private settingsReturn: Screen = 'title'
  private subReturn: Screen = 'title'
  private minimap!: Minimap
  private toastsEl!: HTMLElement
  private bannerEl!: HTMLElement
  private feedEl!: HTMLElement
  private flashEl!: HTMLElement
  private vignetteEl!: HTMLElement
  private bannerTimer = 0
  private lastDeath: DeathInfo | null = null
  private lastMatch: { result: MatchResult; bestLife: number; earned: number } | null = null
  private lastOnlineMatch: OnlineMatchEnd | null = null
  private lastCampaignResult: CampaignResultInfo | null = null
  private onlineWaiting = false
  private hudCache = new Map<string, string>()
  private sparks!: Sparks
  private calloutsEl!: HTMLElement
  private lastHover: Element | null = null
  private lastLen = 0
  private lastLenBump = 0
  private lobbyState: LobbyState | null = null
  private lobbyStatus: MultiplayerStatus = 'idle'
  private lobbyDetail = ''
  private lobbyTeam: 'blue' | 'red' | 'spectator' = 'blue'
  private lobbyHost = false
  private lobbyTransport: MultiplayerTransport = 'server'
  private lastCombo = 0
  private loadingChoice: ((v: 'play' | 'cancel') => void) | null = null
  reduced = false

  constructor(
    private readonly i18n: I18n,
    private readonly save: SaveStore,
    private readonly campaignStore: CampaignStore,
    private readonly audio: Audio,
    private readonly actions: UiActions,
  ) {
    this.root = document.getElementById('ui')!
    this.build()
    i18n.onChange(() => this.retranslate())
  }

  private t(key: string, vars?: Record<string, string | number>): string {
    return this.i18n.t(key, vars)
  }

  // ─── construction ───────────────────────────────────────────────────────
  private build(): void {
    const T = (k: string) => `<span data-i18n="${k}">${esc(this.t(k))}</span>`
    // Wordmark: "SPACE WORM 3D". The visible letters are styled spans; the accessible name comes from i18n.
    const logo = (cls: string) =>
      `<div class="logo ${cls}" role="img" data-i18n-label="game.name" aria-label="${esc(this.t('game.name'))}"><span aria-hidden="true">SPACE<span class="l2"><b>WORM</b><i class="d3">3D</i></span></span></div>`
    const btn = (action: string, key: string, cls = '', ico = '') =>
      `<button class="btn ${cls}" data-action="${action}">${ico ? icon(ico) : ''}${T(key)}</button>`
    document.title = this.t('game.name')
    this.root.innerHTML = `
      <section class="screen boot" data-screen="boot">
        ${logo('')}
        <div class="bar"><i></i></div>
        <p>${T('boot.loading')}</p>
      </section>

      <section class="screen boot loading" data-screen="loading">
        ${logo('')}
        <div class="bar"><i data-bind="loadBar"></i></div>
        <p data-bind="loadText"></p>
        <div class="actions slow-actions">
          <button class="btn primary" data-action="load-play">${icon('play')}${T('loading.playNow')}</button>
          <button class="btn ghost" data-action="load-cancel">${T('common.back')}</button>
        </div>
      </section>

      <section class="screen title title-screen" data-screen="title">
        <div class="title-wrap">
          ${logo('big')}
          <p class="tagline">${T('title.tagline')}</p>
          <p class="title-credit" data-i18n="multiplayer.credit"></p>
          <div class="title-row">
            <label class="name-field"><span data-i18n="title.name"></span><input id="pilot-name" maxlength="16" autocomplete="off" spellcheck="false" /></label>
            <div class="wallet">${icon('stardust')}<b data-bind="stardust">0</b></div>
          </div>
          <button class="campaign-launch" data-action="campaign">${icon('trophy')}<span><b>${T('campaign.title')}</b><small>${T('campaign.subtitle')}</small></span><strong>${T('campaign.open')}</strong></button>
          <button class="upgrade-launch" data-action="upgrades">${icon('bolt')}<span><b>${T('upgradeLab.title')}</b><small>${T('upgradeLab.subtitle')}</small></span><strong>${T('upgradeLab.open')}</strong></button>
          <div class="modes">
            <button class="mode-card ffa" data-action="play-ffa">${icon('play')}<strong>${T('title.ffa')}</strong><small>${T('title.ffaDesc')}</small></button>
            <button class="mode-card team" data-action="play-team">${icon('team')}<strong>${T('title.team')}</strong><small>${T('title.teamDesc')}</small></button>
          </div>
          <div class="competitive-panel">
            <div class="competitive-heading"><span class="eyebrow">${T('title.competitiveEyebrow')}</span><strong>${T('title.competitive')}</strong><small>${T('title.competitiveDesc')}</small></div>
            <div class="competitive-options">
              <label><span>${T('title.roundDuration')}</span><select data-round-setting="duration"><option value="180">${T('title.round3')}</option><option value="300">${T('title.round5')}</option></select></label>
              <label><span>${T('title.winCondition')}</span><select data-round-setting="win"><option value="score">${T('title.winScore')}</option><option value="survival">${T('title.winSurvival')}</option><option value="stars">${T('title.winStars')}</option></select></label>
              <label><span>${T('title.map')}</span><select data-round-setting="map"><option value="sprint">${T('title.mapSprint')}</option><option value="exploration">${T('title.mapExploration')}</option></select></label>
              <label><span>${T('title.teams')}</span><select data-round-setting="teams"><option value="2">${T('title.teams2v2')}</option><option value="6">${T('title.teams6v6')}</option><option value="ffa">${T('title.teamsFfa')}</option></select></label>
            </div>
            <button class="btn competitive-cta" data-action="play-competitive">${icon('trophy')}${T('title.playCompetitive')}</button>
          </div>
          <button class="btn multiplayer-cta" data-action="multiplayer">${icon('team')}${T('title.multiplayer')}</button>
          <a class="developer-link" href="https://t.me/LordOfShdow" target="_blank" rel="noopener noreferrer">${icon('team')}${T('title.developer')}</a>
          <div class="title-links">
            ${btn('skins', 'title.skins', 'ghost', 'palette')}
            ${btn('records', 'title.records', 'ghost', 'trophy')}
            ${btn('howto', 'title.howto', 'ghost', 'help')}
            ${btn('settings', 'title.settings', 'ghost', 'gear')}
          </div>
          <p class="title-best" data-bind="best"></p>
          <p class="hint"><span class="hint-mouse" data-i18n="title.hint"></span><span class="hint-touch" data-i18n="title.hintTouch"></span></p>
        </div>
      </section>

      <section class="screen menu" data-screen="campaign">
        <div class="panel card wide campaign-card" data-bind="campaign"></div>
      </section>

      <section class="screen menu" data-screen="campaignResult">
        <div class="panel card campaign-result-card" data-bind="campaignResult"></div>
      </section>

      <section class="screen menu" data-screen="upgrades">
        <div class="panel card wide upgrade-card" data-bind="upgrades"></div>
      </section>

      <section class="screen hud" data-screen="hud">
        <div class="threat-arrows" aria-hidden="true"></div>
        <div class="hint-card" role="status" aria-live="polite" hidden></div>
        <div class="hud-tl panel">
          <div class="hud-len"><small data-i18n="hud.length"></small><b data-bind="length">0</b></div>
          <div class="hud-meta">
            <span class="stage-pill" data-bind="stage"></span>
            <span data-bind="rank"></span>
            <span>${icon('skull')}<b data-bind="kills">0</b></span>
            <span class="gold">${icon('stardust')}<b data-bind="shards">0</b></span>
          </div>
        </div>
        <div class="hud-team">
          <div class="team-side blue"><span data-i18n="hud.team.blue"></span><b data-bind="teamA">0</b></div>
          <div class="team-bar"><i class="a"></i><i class="b"></i></div>
          <div class="team-side orange"><b data-bind="teamB">0</b><span data-i18n="hud.team.orange"></span></div>
          <div class="team-clock" data-bind="clock">4:00</div>
        </div>
        <div class="hud-round panel" hidden><span data-bind="roundLabel"></span><b data-bind="roundClock"></b></div>
        <div class="hud-tr">
          <button class="icon-btn" data-action="pause" data-i18n-title="hud.pause">${icon('pause')}</button>
          <div class="leaders panel"><h4 data-i18n="hud.leaders"></h4><ol data-bind="leaders"></ol></div>
          <div class="feed" data-bind="feed"></div>
        </div>
        <div class="hud-bl">
          <canvas class="minimap" data-i18n-title="hud.minimap"></canvas>
          <div class="online-panel panel" data-bind="onlinePanel" hidden>
            <p data-bind="onlineStatus" role="status" aria-live="polite"></p>
            <p data-bind="onlineStats"></p>
            <button class="btn ghost small" data-action="mp-leave">${T('multiplayer.leaveMatch')}</button>
          </div>
        </div>
        <div class="hud-bc">
          <div class="effects" data-bind="effects">
            ${PICKUP_IDS.map(id => `
              <div class="effect effect-${id}" data-effect="${id}">
                <svg class="ring" viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" class="track"/><circle cx="22" cy="22" r="19" class="fill"/></svg>
                ${icon(id)}
                <div class="effect-text"><small data-i18n="pickup.${id}"></small><b>0s</b></div>
              </div>`).join('')}
          </div>
          <div class="powers" data-bind="powers"></div>
          <div class="special-effects" data-bind="specialEffects"></div>
          <div class="status">
            <span class="chip chip-boost" data-bind="boostChip"></span>
            <span class="chip chip-slow">${icon('well')}<span data-i18n="hud.slowed"></span></span>
            <span class="chip chip-rim">${icon('rim')}<span data-i18n="hud.rim"></span></span>
            <div class="ability-buttons" role="group" data-i18n-label="hud.abilities">
              <button class="ability-btn ability-ghost" data-action="ability-ghost" data-i18n-title="ability.ghost"><b>G</b><small data-i18n="ability.ghost.short"></small><span></span></button>
              <button class="ability-btn ability-electric" data-action="ability-electric" data-i18n-title="ability.electric"><b>E</b><small data-i18n="ability.electric.short"></small><span></span></button>
              <button class="ability-btn ability-bomb" data-action="ability-bomb" data-i18n-title="ability.bomb"><b>B</b><small data-i18n="ability.bomb.short"></small><span></span></button>
              <button class="ability-btn ability-laser" data-action="ability-laser" data-i18n-title="ability.laser"><b>L</b><small data-i18n="ability.laser.short"></small><span></span></button>
            </div>
          </div>
        </div>
        <div class="campaign-hud panel" data-bind="campaignHud" hidden></div>
        <div class="hud-tc">
          <div class="crown-chip" data-bind="crown"></div>
          <div class="surprise-alert" data-bind="surprise" role="status" hidden></div>
          <div class="zone-alert" data-bind="zone" hidden></div>
          <div class="combo" data-bind="comboWrap"><b data-bind="combo"></b><small data-i18n="hud.feast"></small><span class="combo-bar"><i></i></span></div>
        </div>
        <div class="callouts" aria-live="polite"></div>
        <div class="respawn" data-bind="respawn"></div>
      </section>

      <section class="screen menu pause" data-screen="pause">
        <div class="panel card narrow">
          <h2 data-i18n="pause.title"></h2>
          ${btn('resume', 'pause.resume', 'primary', 'play')}
          ${btn('settings', 'pause.settings', '', 'gear')}
          ${btn('howto', 'title.howto', '', 'help')}
          ${btn('quit', 'pause.quit', 'ghost')}
        </div>
      </section>

      <section class="screen menu" data-screen="death">
        <div class="panel card death" data-bind="death"></div>
      </section>

      <section class="screen menu" data-screen="match">
        <div class="panel card match" data-bind="match"></div>
      </section>

      <section class="screen menu" data-screen="multiplayer">
        <div class="panel card wide multiplayer-card" data-bind="multiplayer"></div>
      </section>

      <section class="screen menu" data-screen="skins">
        <div class="panel card wide">
          <header><h2 data-i18n="skins.title"></h2><div class="wallet">${icon('stardust')}<b data-bind="stardust">0</b></div></header>
          <div class="appearance" data-bind="appearance"></div>
          <div class="skins" data-bind="skins"></div>
          <footer>${btn('back', 'common.back', 'ghost')}</footer>
        </div>
      </section>

      <section class="screen menu" data-screen="records">
        <div class="panel card wide">
          <header><h2 data-i18n="records.title"></h2></header>
          <div class="records" data-bind="records"></div>
          <footer>${btn('back', 'common.back', 'ghost')}</footer>
        </div>
      </section>

      <section class="screen menu" data-screen="howto">
        <div class="panel card wide scroll" data-bind="howto"></div>
      </section>

      <section class="screen menu settings-screen" data-screen="settings">
        <div class="panel card settings-card">
          <h2 data-i18n="settings.title"></h2>
          <div class="form">
            <label class="row"><span data-i18n="settings.language"></span><select data-setting="locale">${LOCALES.map(l => `<option value="${l}" data-i18n="lang.${l}"></option>`).join('')}</select></label>
            <label class="row"><span data-i18n="settings.music"></span><input type="range" min="0" max="1" step="0.05" data-setting="musicVolume" /></label>
            <label class="row"><span data-i18n="settings.sfx"></span><input type="range" min="0" max="1" step="0.05" data-setting="sfxVolume" /></label>
            <label class="row check"><span data-i18n="settings.mute"></span><input type="checkbox" data-setting="muted" /></label>
            <label class="row"><span data-i18n="settings.quality"></span><select data-setting="quality"><option value="low" data-i18n="settings.quality.low"></option><option value="medium" data-i18n="settings.quality.medium"></option><option value="high" data-i18n="settings.quality.high"></option></select></label>
            <label class="row check"><span><span data-i18n="settings.reducedMotion"></span><small data-i18n="settings.reducedMotionDesc"></small></span><input type="checkbox" data-setting="reducedMotion" /></label>
            <label class="row"><span><span data-i18n="settings.threats"></span><small data-i18n="settings.threatsDesc"></small></span><select data-setting="threatMode"><option value="full" data-i18n="settings.threats.full"></option><option value="minimal" data-i18n="settings.threats.minimal"></option></select></label>
            <div class="row"><span><span data-i18n="settings.hints"></span><small data-i18n="settings.hintsDesc"></small></span><button class="btn ghost small" data-action="reset-hints" data-i18n="settings.resetHints"></button></div>
            <label class="row"><span data-i18n="settings.keyTurn"></span><input type="range" min="0.5" max="1.8" step="0.1" data-setting="keyTurn" /></label>
          </div>
          <footer>${btn('back', 'common.back', 'ghost')}</footer>
        </div>
      </section>

      <div class="toasts" aria-live="polite"></div>
      <div class="banner" aria-live="polite"></div>
      <div class="flash"></div>
      <div class="vignette"></div>`

    this.toastsEl = this.root.querySelector('.toasts')!
    this.bannerEl = this.root.querySelector('.banner')!
    this.flashEl = this.root.querySelector('.flash')!
    this.vignetteEl = this.root.querySelector('.vignette')!
    this.feedEl = this.root.querySelector('[data-bind="feed"]')!
    this.minimap = new Minimap(this.root.querySelector('canvas.minimap')!)
    this.calloutsEl = this.root.querySelector('.callouts')!
    this.sparks = new Sparks(this.root)
    assets.when('bg/loading', v => {
      if (v instanceof HTMLImageElement) document.documentElement.style.setProperty('--loading-art', `url("${v.src}")`)
    })
    assets.when('icon/stardust', v => {
      if (v instanceof HTMLImageElement) this.sparks.image = v
    })
    // Hover blips for every interactive element (desktop pointers only).
    this.root.addEventListener('pointerover', e => {
      if (e.pointerType !== 'mouse') return
      const el = (e.target as HTMLElement).closest('.btn, .mode-card, .skin, .tab, .icon-btn')
      if (el && el !== this.lastHover) this.audio.play('hover')
      this.lastHover = el
    })

    this.root.addEventListener('click', e => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action], [data-tab], [data-skin]')
      if (!target) return
      this.audio.unlock()
      if (target.dataset.skin) {
        this.onSkin(target.dataset.skin)
        return
      }
      this.audio.play('ui')
      const primary = target.matches('.primary, .mode-card')
      this.sparks.burst(e.clientX || target.getBoundingClientRect().left + 20, e.clientY || target.getBoundingClientRect().top + 20, primary ? '#ffd54f' : '#7ff6ff', primary ? 18 : 8, primary ? 280 : 180)
      this.onAction(target.dataset.action!, target)
    })

    const name = this.root.querySelector<HTMLInputElement>('#pilot-name')!
    name.value = this.save.data.playerName
    name.addEventListener('change', () => {
      const clean = sanitizeName(name.value)
      name.value = clean
      this.save.update({ playerName: clean })
    })
    name.addEventListener('keydown', e => {
      if (e.key === 'Enter') name.blur()
    })

    for (const el of this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]')) {
      el.addEventListener('input', () => {
        const key = el.dataset.setting as keyof SaveData
        let value: unknown
        if (el instanceof HTMLInputElement && el.type === 'checkbox') value = el.checked
        else if (el instanceof HTMLInputElement && el.type === 'range') value = Number(el.value)
        else value = el.value
        this.actions.settings({ [key]: value } as Partial<SaveData>)
        if (key === 'sfxVolume') this.audio.play('ui')
      })
    }
    this.refreshSettings()
    this.retranslate()
  }

  private onAction(action: string, el: HTMLElement): void {
    switch (action) {
      case 'play-ffa': return this.actions.play('ffa')
      case 'play-team': return this.actions.play('team')
      case 'campaign': return this.actions.campaign('open')
      case 'upgrades':
        this.subReturn = this.screen
        return this.show('upgrades')
      case 'buy-upgrade':
        return this.onUpgrade(el.dataset.upgrade as UpgradeId)
      case 'ability-ghost': return this.actions.ability('ghost')
      case 'ability-electric': return this.actions.ability('electric')
      case 'ability-bomb': return this.actions.ability('bomb')
      case 'ability-laser': return this.actions.ability('laser')
      case 'buy-laser': return this.onLaser()
      case 'campaign-start': return this.actions.campaign('start', Number(el.dataset.stage))
      case 'campaign-next': return this.actions.campaign('next', Number(el.dataset.stage))
      case 'campaign-retry': return this.actions.campaign('start', Number(el.dataset.stage))
      case 'play-competitive': {
        const value = (key: string, fallback: string) => this.root.querySelector<HTMLSelectElement>(`[data-round-setting="${key}"]`)?.value ?? fallback
        const duration = value('duration', '180') === '300' ? 300 : 180
        const win = value('win', 'score') as CompetitiveRound['win']
        const map = value('map', 'sprint') as CompetitiveRound['map']
        const teamValue = value('teams', '2')
        const round: CompetitiveRound = { duration, win, map, teamSize: teamValue === '6' ? 6 : 2 }
        return this.actions.play(teamValue === 'ffa' ? 'ffa' : 'team', round)
      }
      case 'multiplayer':
        this.actions.multiplayer('open')
        return
      case 'mp-create-blue':
      case 'mp-create-red':
      case 'mp-transport-peer':
      case 'mp-transport-server':
      case 'mp-join-blue':
      case 'mp-join-red':
      case 'mp-ready':
      case 'mp-start':
      case 'mp-copy-blue':
      case 'mp-copy-red':
      case 'mp-leave':
        this.actions.multiplayer(action.slice(3), el.dataset.team)
        return
      case 'respawn': return this.actions.respawn()
      case 'again': { const mode = el.dataset.mode === 'team' ? 'team' : 'ffa'; return this.actions.play(mode, this.lastMatch?.result.round) }
      case 'resume': return this.actions.resume()
      case 'pause': return this.actions.pause()
      case 'quit': return this.actions.quit()
      case 'settings':
        this.settingsReturn = this.screen
        this.refreshSettings()
        return this.show('settings')
      case 'skins':
      case 'records':
      case 'howto':
        this.subReturn = this.screen
        return this.show(action)
      case 'appearance-color':
        this.actions.settings({ color: validColor(el.dataset.color) })
        this.renderSkins()
        return
      case 'appearance-head':
        this.actions.settings({ headStyle: validHead(el.dataset.head) })
        this.renderSkins()
        return
      case 'back':
        this.back()
        return
      case 'load-play':
        this.loadingChoice?.('play')
        return
      case 'load-cancel':
        this.loadingChoice?.('cancel')
        return
      case 'reset-hints':
        this.actions.resetHints()
        this.toast('toast.hintsReset', {}, 'info')
        return
    }
  }

  /** Escape / Back navigation. Returns false when there is nothing to go back to. */
  back(): boolean {
    if (this.screen === 'settings') this.show(this.settingsReturn)
    else if (this.screen === 'skins' || this.screen === 'upgrades' || this.screen === 'records' || this.screen === 'howto') this.show(this.subReturn)
    else if (this.screen === 'campaign' || this.screen === 'campaignResult') this.show('title')
    else if (this.screen === 'multiplayer') {
      this.actions.multiplayer('leave')
      this.show('title')
    }
    else return false
    return true
  }

  private onSkin(id: string): void {
    const owned = this.save.data.ownedSkins.includes(id)
    if (owned) {
      this.actions.equipSkin(id)
      this.audio.play('ui')
    } else if (this.actions.buySkin(id)) {
      this.audio.play('buy')
      this.toast('skins.bought', { name: this.t(`skin.${id}`) }, 'good')
      const card = this.root.querySelector(`[data-skin="${id}"]`)
      if (card) {
        const r = card.getBoundingClientRect()
        this.sparks.burstAround(card, '#ffd54f', 36)
        this.sparks.ring(r.left + r.width / 2, r.top + r.height / 2, '#ffd54f', r.width * 0.7)
      }
    } else {
      this.audio.play('bump')
    }
    this.renderSkins()
    this.refreshWallet()
  }

  private onUpgrade(id: UpgradeId): void {
    if (!UPGRADE_IDS.includes(id)) return
    if (this.actions.buyUpgrade(id)) {
      this.audio.play('buy')
      this.toast('upgradeLab.purchased', { name: this.t(`upgrade.${id}`), n: this.save.data.upgrades[id] }, 'good')
      const card = this.root.querySelector(`[data-upgrade="${id}"]`)
      if (card) {
        this.sparks.burstAround(card, '#7ff6ff', 30)
        const r = card.getBoundingClientRect()
        this.sparks.ring(r.left + r.width / 2, r.top + r.height / 2, '#7ff6ff', r.width * 0.65)
      }
    } else this.audio.play('bump')
    this.refreshWallet()
    this.renderUpgrades()
  }

  private onLaser(): void {
    if (this.save.data.laserUnlocked) return
    if (this.actions.buyLaser()) {
      this.audio.play('buy')
      this.toast('upgradeLab.laserPurchased', {}, 'good')
      this.sparks.burstAround(this.root.querySelector('.upgrade-laser') ?? this.root, '#ff4d62', 42)
    } else this.audio.play('bump')
    this.refreshWallet()
    this.renderUpgrades()
  }

  // ─── screens ────────────────────────────────────────────────────────────
  show(screen: Screen): void {
    this.screen = screen
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-screen]')) el.classList.toggle('is-active', el.dataset.screen === screen)
    document.body.dataset.activeScreen = screen
    if (screen === 'title') {
      this.refreshWallet()
      const best = this.save.data.records.bestLength
      this.bind('best', best > 0 ? this.t('title.best', { n: this.i18n.n(best) }) : '')
      const input = this.root.querySelector<HTMLInputElement>('#pilot-name')!
      input.value = this.save.data.playerName
    }
    if (screen === 'campaign') this.renderCampaign()
    if (screen === 'campaignResult' && this.lastCampaignResult) this.renderCampaignResult()
    if (screen === 'skins') {
      this.refreshWallet()
      this.renderSkins()
    }
    if (screen === 'upgrades') {
      this.refreshWallet()
      this.renderUpgrades()
    }
    if (screen === 'records') this.renderRecords()
    if (screen === 'howto') this.renderHowto()
    if (screen === 'hud') {
      ;(document.activeElement as HTMLElement | null)?.blur?.()
      this.hudCache.clear()
      this.feedEl.innerHTML = ''
    }
    // Focus the primary action for keyboard/gamepad players.
    const primary = this.root.querySelector<HTMLElement>(`[data-screen="${screen}"] .btn.primary, [data-screen="${screen}"] .mode-card`)
    if (primary && screen !== 'hud' && !matchMedia('(pointer: coarse)').matches) primary.focus({ preventScroll: true })
  }

  setBootProgress(p: number): void {
    const bar = this.root.querySelector<HTMLElement>('.boot .bar i')
    if (bar) bar.style.width = `${Math.round(Math.min(1, p) * 100)}%`
  }

  private bind(name: string, text: string): void {
    for (const el of this.root.querySelectorAll<HTMLElement>(`[data-bind="${name}"]`)) el.textContent = text
  }

  private refreshWallet(): void {
    this.bind('stardust', this.i18n.n(this.save.data.stardust))
  }

  refreshSettings(): void {
    const d = this.save.data
    for (const el of this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]')) {
      const key = el.dataset.setting as keyof SaveData
      const value = key === 'locale' ? this.i18n.locale : d[key]
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = value === true
      else el.value = String(value)
    }
  }

  private retranslate(): void {
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = this.t(el.dataset.i18n!)
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-i18n-label]')) el.setAttribute('aria-label', this.t(el.dataset.i18nLabel!))
    document.title = this.t('game.name')
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
      el.title = this.t(el.dataset.i18nTitle!)
      el.setAttribute('aria-label', el.title)
    }
    this.refreshSettings()
    this.hudCache.clear()
    if (this.screen === 'title') this.show('title')
    if (this.screen === 'campaign') this.renderCampaign()
    if (this.screen === 'campaignResult' && this.lastCampaignResult) this.renderCampaignResult()
    if (this.screen === 'skins') this.renderSkins()
    if (this.screen === 'upgrades') this.renderUpgrades()
    if (this.screen === 'records') this.renderRecords()
    if (this.screen === 'howto') this.renderHowto()
    if (this.screen === 'multiplayer') this.renderMultiplayer()
    if (this.screen === 'death' && this.lastDeath) this.renderDeath()
    if (this.screen === 'match' && this.lastOnlineMatch) this.renderOnlineMatch()
    else if (this.screen === 'match' && this.lastMatch) this.renderMatch()
    if (this.screen === 'multiplayer') this.renderMultiplayer()
  }

  private renderCampaign(): void {
    const data = this.campaignStore.data
    const t = (key: string, vars?: Record<string, string | number>) => esc(this.t(key, vars))
    const completed = new Set(data.completedStages)
    const cards = CAMPAIGN_STAGES.map(stage => {
      const open = stage.id <= data.unlockedStage
      const done = completed.has(stage.id)
      const best = data.bestScores[String(stage.id)]
      const state = done ? `<span class="campaign-state complete">${t('campaign.completed')}</span>` : open ? `<span class="campaign-state open">${t('campaign.open')}</span>` : `<span class="campaign-state locked">${t('campaign.locked')}</span>`
      return `<article class="campaign-stage ${open ? 'is-open' : 'is-locked'} ${done ? 'is-complete' : ''}" style="--stage:${stage.id}">
        <div class="campaign-stage-top"><span class="stage-index">${String(stage.id).padStart(2, '0')}</span><span>${state}</span></div>
        <h3>${t(`campaign.stage.${stage.id}.name`)}</h3><p>${t(`campaign.stage.${stage.id}.desc`)}</p>
        <div class="campaign-goal"><small>${t('campaign.goal')}</small><b>${t(`campaign.goal.${stage.goal}`)} · ${this.i18n.n(stage.target)}${stage.goal === 'survival' ? ` ${t('campaign.seconds')}` : ''}</b></div>
        <div class="campaign-reward">${icon('stardust')}<span>${t('campaign.reward', { n: stage.reward })}</span>${best ? `<em>${t('campaign.best', { n: best })}</em>` : ''}</div>
        <button class="btn ${open ? (done ? '' : 'primary') : 'ghost'}" data-action="campaign-start" data-stage="${stage.id}" ${open ? '' : 'disabled'}>${open ? t(done ? 'campaign.replay' : 'campaign.start') : t('campaign.locked')}</button>
      </article>`
    }).join('')
    const current = Math.min(data.unlockedStage, CAMPAIGN_STAGES.length)
    const percent = Math.round((data.completedStages.length / CAMPAIGN_STAGES.length) * 100)
    const el = this.root.querySelector<HTMLElement>('[data-bind="campaign"]')!
    el.innerHTML = `<header class="campaign-header"><div><p class="eyebrow">${t('campaign.eyebrow')}</p><h2>${t('campaign.title')}</h2><p>${t('campaign.desc')}</p></div><div class="campaign-progress"><b>${this.i18n.n(data.completedStages.length)} / ${this.i18n.n(CAMPAIGN_STAGES.length)}</b><span>${t('campaign.progress')}</span><i><em style="width:${percent}%"></em></i></div></header>
      <div class="campaign-current"><span>${t('campaign.current')}</span><strong>${t(`campaign.stage.${current}.name`)}</strong><small>${t('campaign.unlockHint')}</small></div>
      <div class="campaign-grid">${cards}</div><footer><button class="btn ghost" data-action="back">${t('common.back')}</button></footer>`
  }

  showCampaignResult(success: boolean, stage: CampaignStage, stats: CampaignStats, reward: number, unlockedStage: number): void {
    this.lastCampaignResult = { success, stage, stats, reward, unlockedStage }
    this.renderCampaignResult()
    this.show('campaignResult')
  }

  private renderCampaignResult(): void {
    const result = this.lastCampaignResult!
    const t = (key: string, vars?: Record<string, string | number>) => esc(this.t(key, vars))
    const progress = campaignGoalProgress(result.stage, result.stats)
    const next = result.stage.id < CAMPAIGN_STAGES.length && result.unlockedStage > result.stage.id ? result.stage.id + 1 : 0
    const el = this.root.querySelector<HTMLElement>('[data-bind="campaignResult"]')!
    const stat = (label: string, value: string | number) => `<div class="stat"><small>${label}</small><b>${typeof value === 'number' ? this.i18n.n(value) : value}</b></div>`
    el.innerHTML = `<p class="eyebrow">${t(`campaign.stage.${result.stage.id}.name`)}</p><h2 class="${result.success ? 'success' : 'failure'}">${t(result.success ? 'campaign.clear' : 'campaign.failed')}</h2>
      <p class="campaign-result-note">${t(result.success ? 'campaign.clearDesc' : 'campaign.failedDesc', { goal: t(`campaign.goal.${result.stage.goal}`), target: result.stage.target })}</p>
      <div class="campaign-objective"><span>${t('campaign.goal')} · ${t(`campaign.goal.${result.stage.goal}`)}</span><b>${this.i18n.n(progress)} / ${this.i18n.n(result.stage.target)}</b><i><em style="width:${Math.min(100, progress / result.stage.target * 100)}%"></em></i></div>
      <div class="stats">${stat(t('campaign.stat.length'), result.stats.length)}${stat(t('campaign.stat.peak'), result.stats.peak)}${stat(t('campaign.stat.kills'), result.stats.kills)}${stat(t('campaign.stat.stars'), result.stats.stars)}${stat(t('campaign.stat.time'), formatClock(result.stats.seconds))}</div>
      ${result.success ? `<p class="campaign-reward-earned">${icon('stardust')}<b>${result.reward ? `+${this.i18n.n(result.reward)}` : t('campaign.claimed')}</b> ${t('campaign.rewardWord')}</p><p class="campaign-evolution">${t('campaign.evolution', { n: result.stage.id })}</p>` : ''}
      <div class="actions">${result.success && next ? `<button class="btn primary" data-action="campaign-next" data-stage="${next}">${icon('play')}${t('campaign.next')}</button>` : ''}<button class="btn ${result.success && !next ? 'primary' : ''}" data-action="campaign-retry" data-stage="${result.stage.id}">${t('campaign.retry')}</button><button class="btn ghost" data-action="quit">${t('death.title.menu')}</button></div>`
    if (result.success) window.setTimeout(() => this.sparks.burstAround(el.querySelector('h2') ?? el, '#ffd54f', 42), 200)
  }

  private renderUpgrades(): void {
    const el = this.root.querySelector<HTMLElement>('[data-bind="upgrades"]')
    if (!el) return
    const d = this.save.data
    const t = (key: string, vars?: Record<string, string | number>) => esc(this.t(key, vars))
    const cards = UPGRADE_IDS.map(id => {
      const level = d.upgrades[id]
      const def = UPGRADE_DEFS[id]
      const price = nextUpgradePrice(id, level)
      const maxed = price === null
      const affordable = !maxed && d.stardust >= price
      const status = maxed ? t('upgradeLab.maxed') : affordable ? t('upgradeLab.buy') : t('upgradeLab.need', { n: this.i18n.n(price! - d.stardust) })
      return `<article class="upgrade-tile upgrade-${id}" data-upgrade="${id}" style="--c:${hexCss(def.color)}">
        <header><span class="upgrade-mark">${id.slice(0, 1).toUpperCase()}</span><div><h3>${t(`upgrade.${id}`)}</h3><p>${t(`upgrade.${id}.desc`)}</p></div></header>
        <div class="upgrade-level"><span>${t('upgradeLab.level', { n: level })}</span><i><em style="width:${level / def.maxLevel * 100}%"></em></i><b>${level}/${def.maxLevel}</b></div>
        <p class="upgrade-effect">${t(`upgrade.${id}.effect`, { n: level > 0 ? level : 1 })}</p>
        <button class="btn ${affordable ? 'primary' : 'ghost'}" data-action="buy-upgrade" data-upgrade="${id}" ${maxed || !affordable ? 'disabled' : ''}>${maxed ? status : `${icon('stardust')}${t('upgradeLab.buyFor', { n: this.i18n.n(price!) })}`}</button>
        <small class="upgrade-status ${affordable || maxed ? '' : 'locked'}">${status}</small>
      </article>`
    }).join('')
    const laserOwned = d.laserUnlocked
    const laserAffordable = !laserOwned && d.stardust >= LASER_PRICE
    const laserStatus = laserOwned ? t('upgradeLab.laserOwned') : laserAffordable ? t('upgradeLab.laserBuy') : t('upgradeLab.need', { n: this.i18n.n(LASER_PRICE - d.stardust) })
    const laser = `<article class="upgrade-tile upgrade-laser" style="--c:#ff4d62"><header><span class="upgrade-mark">L</span><div><h3>${t('upgradeLab.laser')}</h3><p>${t('upgradeLab.laserDesc')}</p></div></header><div class="upgrade-level"><span>${t('upgradeLab.oneShot')}</span><i><em style="width:${laserOwned ? 100 : 0}%"></em></i><b>${laserOwned ? '1/1' : '0/1'}</b></div><p class="upgrade-effect">${t('upgradeLab.laserEffect')}</p><button class="btn ${laserAffordable ? 'primary' : 'ghost'}" data-action="buy-laser" ${laserOwned || !laserAffordable ? 'disabled' : ''}>${laserOwned ? t('upgradeLab.laserOwned') : `${icon('stardust')}${t('upgradeLab.buyFor', { n: this.i18n.n(LASER_PRICE) })}`}</button><small class="upgrade-status ${laserAffordable || laserOwned ? '' : 'locked'}">${laserStatus}</small></article>`
    el.innerHTML = `<header><div><p class="eyebrow">${t('upgradeLab.eyebrow')}</p><h2>${t('upgradeLab.title')}</h2><p class="upgrade-note">${t('upgradeLab.note')} ${t('upgradeLab.laserNote')}</p></div><div class="wallet">${icon('stardust')}<b>${this.i18n.n(d.stardust)}</b></div></header><div class="upgrade-grid">${cards}${laser}</div><footer><button class="btn ghost" data-action="back">${t('common.back')}</button></footer>`
  }

  private renderSkins(): void {
    const d = this.save.data
    const selected = appearanceSkin(d.skin, d.color)
    const appearance = this.root.querySelector<HTMLElement>('[data-bind="appearance"]')!
    appearance.innerHTML = `
      <p class="appearance-note">${esc(this.t('skins.customize'))}</p>
      <div class="appearance-preview" aria-label="${esc(this.t('skins.preview'))}">
        ${Array.from({ length: 6 }, (_, i) => `<i class="preview-segment ${i === 5 ? `head-${d.headStyle}` : ''}" style="--c:${hexCss(i === 5 ? selected.head : selected.colors[i % selected.colors.length])}"></i>`).join('')}
      </div>
      <h3>${esc(this.t('skins.color'))}</h3>
      <div class="cosmetic-options">${WORM_COLORS.map(c => `<button class="cosmetic color-choice" data-action="appearance-color" data-color="${c.id}" aria-pressed="${d.color === c.id}" style="--c:${hexCss(c.value ?? skinById(d.skin).head)}"><i></i><span>${esc(this.t(`color.${c.id}`))}</span></button>`).join('')}</div>
      <h3>${esc(this.t('skins.head'))}</h3>
      <div class="cosmetic-options heads">${HEAD_STYLES.map(head => `<button class="cosmetic head-choice" data-action="appearance-head" data-head="${head}" aria-pressed="${d.headStyle === head}" style="--c:${hexCss(selected.head)}"><i class="head-${head}"></i><span>${esc(this.t(`head.${head}`))}</span></button>`).join('')}</div>
      <h3>${esc(this.t('skins.palette'))}</h3>`
    const el = this.root.querySelector<HTMLElement>('[data-bind="skins"]')!
    el.innerHTML = SKINS.map(s => {
      const owned = d.ownedSkins.includes(s.id)
      const equipped = d.skin === s.id
      const dots = Array.from({ length: 9 }, (_, i) => {
        const c = i === 8 ? s.head : s.colors[Math.floor((8 - i) / s.band) % s.colors.length]
        const size = i === 8 ? 30 : 16 + i * 1.3
        return `<i style="--c:${hexCss(c)};--s:${size}px;--g:${s.glow}"></i>`
      }).join('')
      const state = equipped ? `<span class="tag on">${esc(this.t('skins.equipped'))}</span>`
        : owned ? `<span class="tag">${esc(this.t('skins.equip'))}</span>`
          : d.stardust >= s.price ? `<span class="tag buy">${icon('stardust')}${esc(this.t('skins.buy', { n: this.i18n.n(s.price) }))}</span>`
            : `<span class="tag locked">${icon('stardust')}${esc(this.t('skins.locked', { n: this.i18n.n(s.price - d.stardust) }))}</span>`
      return `<button class="skin ${equipped ? 'is-equipped' : ''} ${owned ? 'is-owned' : ''}" data-skin="${s.id}">
        <div class="swatch">${dots}</div><strong>${esc(this.t(`skin.${s.id}`))}</strong>${state}</button>`
    }).join('')
  }

  private renderRecords(): void {
    const el = this.root.querySelector<HTMLElement>('[data-bind="records"]')!
    const d = this.save.data
    const r = d.records
    const stat = (key: keyof Records, value: string) => `<div class="stat"><small>${esc(this.t(`records.${key}`))}</small><b>${esc(value)}</b></div>`
    const rows = d.lives.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}</td><td><b>${this.i18n.n(l.length)}</b></td><td>${l.kills}</td><td>${esc(this.t(`records.mode.${l.mode}`))}</td></tr>`).join('')
    el.innerHTML = `
        <div class="stats">
          ${stat('bestLength', this.i18n.n(r.bestLength))}
          ${stat('mostKills', this.i18n.n(r.mostKills))}
          ${stat('mostCelestials', this.i18n.n(r.mostCelestials))}
          ${stat('longestLife', formatClock(r.longestLife))}
          ${stat('lives', this.i18n.n(r.lives))}
          ${stat('totalKills', this.i18n.n(r.totalKills))}
          ${stat('totalStardust', this.i18n.n(r.totalStardust))}
          ${stat('teamWins', `${this.i18n.n(r.teamWins)} / ${this.i18n.n(r.teamMatches)}`)}
        </div>
        <h3>${esc(this.t('records.topLives'))}</h3>
        ${rows ? `<table class="board"><thead><tr><th>${esc(this.t('records.col.rank'))}</th><th>${esc(this.t('records.col.name'))}</th><th>${esc(this.t('records.col.length'))}</th><th>${esc(this.t('records.col.kills'))}</th><th>${esc(this.t('records.col.mode'))}</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="empty">${esc(this.t('records.empty'))}</p>`}`
  }

  private renderHowto(): void {
    const el = this.root.querySelector<HTMLElement>('[data-bind="howto"]')!
    const t = (k: string, v?: Record<string, string | number>) => esc(this.t(k, v))
    el.innerHTML = `
      <h2>${t('howto.title')}</h2>
      <section><h3>${t('howto.goal')}</h3><p>${t('howto.goalText')}</p></section>
      <section><h3>${t('howto.controls')}</h3>
        <ul class="list"><li>${t('howto.mouse')}</li><li>${t('howto.keys')}</li><li>${t('howto.touch')}</li><li>${t('howto.pad')}</li><li>${t('howto.boost')}</li></ul></section>
      <section><h3>${t('howto.celestials')}</h3><p>${t('howto.celestialsText')}</p>
        <div class="grid5">${CELESTIAL_IDS.map(id => {
          const def = CELESTIALS[id]
          return `<div class="tile" style="--c:${hexCss(def.color)}">${icon(id)}<b>${t(`celestial.${id}`)}</b><em>${t(`power.${def.power}`)}</em><small>${t(`power.${def.power}.desc`)}</small><span class="need">${t('howto.needs', { n: def.minLength })}</span></div>`
        }).join('')}</div></section>
      <section><h3>${t('howto.powerups')}</h3>
        <div class="grid3">${PICKUP_IDS.map(id => `<div class="tile effect-${id}">${icon(id)}<b>${t(`pickup.${id}`)}</b><small>${t(`pickup.${id}.desc`)}</small></div>`).join('')}</div></section>
      <section><h3>${t('howto.hazards')}</h3>
        <p class="legend-key"><span class="k lethal">${t('legend.lethal')}</span><span class="k warn">${t('legend.warn')}</span><span class="k slow">${t('legend.slow')}</span><span class="k ally">${t('legend.ally')}</span><span class="k edible">${t('legend.edible')}</span></p>
        <ul class="list legend">${(['asteroid', 'gate', 'well', 'rim', 'rival', 'ally', 'edible', 'bite'] as const).map(id => `<li>${glyphSvg(THREAT_GLYPH[id])}<span><b>${t(`hint.${id}.title`)}</b>${t(`hint.${id}.text`)}</span></li>`).join('')}</ul></section>
      <section><h3>${t('howto.feast')}</h3><p>${t('howto.feastText')}</p></section>
      <section><h3>${t('howto.specials')}</h3><p>${t('howto.specialsText')}</p>
        <ul class="list">${['zone', 'legendary', 'shrink'].map(id => `<li><b>${t(`surprise.${id}`)}</b> — ${t(`surprise.${id}.desc`)}</li>`).join('')}</ul></section>
      <section><h3>${t('howto.traps')}</h3><p>${t('howto.trapsText')}</p>
        <ul class="list">${['freeze', 'slow', 'reverse', 'half', 'teleport'].map(id => `<li><b>${t(`trap.${id}`)}</b> — ${t(`trap.${id}.desc`)}</li>`).join('')}</ul></section>
      <section><h3>${t('howto.team')}</h3><p>${t('howto.teamText')}</p></section>
      <footer><button class="btn ghost" data-action="back">${t('common.back')}</button></footer>`
  }

  setMultiplayerStatus(status: MultiplayerStatus, detail = ''): void {
    this.lobbyStatus = status
    const known = ['multiplayer_unavailable', 'invalid_room', 'clipboard_denied', 'protocol_mismatch', 'seat_replaced',
      'connection_rejected', 'resume_expired', 'invalid_server_message', 'room_create_failed', 'not_ready', 'not_ready_to_start', 'invalid_input', 'invalid_message',
      'peer_config_missing', 'peer_auth_required', 'peer_room_unavailable', 'peer_rules_denied', 'peer_not_supported', 'peer_connection_failed', 'peer_invalid_stun',
      'peer_signaling_offline', 'peer_migrating', 'peer_migrated', 'peer_resync', 'peer_room_expired']
    this.lobbyDetail = detail ? `multiplayer.errors.${known.includes(detail) ? detail : 'connection_rejected'}` : ''
    if (this.screen === 'multiplayer') this.renderMultiplayer()
  }

  clearMultiplayer(): void {
    this.lobbyState = null; this.lobbyHost = false; this.lobbyDetail = ''; this.onlineWaiting = false
    this.lastOnlineMatch = null
    this.root.querySelector<HTMLElement>('[data-bind="onlinePanel"]')!.hidden = true
  }

  showOnlineLoading(): void { this.onlineWaiting = true; this.show('hud') }
  onlineSnapshotReady(): void { this.onlineWaiting = false }

  private multiplayerStatusText(): string {
    const key = this.onlineWaiting && this.lobbyStatus === 'connected' ? this.lobbyTransport === 'peer' ? 'peerMatchLoading' : 'matchLoading' : this.lobbyStatus
    const status = this.t(`multiplayer.${key}`)
    return this.lobbyTransport === 'peer' ? `${this.t('multiplayer.peer')} · ${this.lobbyHost ? `${this.t('multiplayer.host')} · ` : ''}${status}` : status
  }

  setMultiplayerTransport(transport: MultiplayerTransport): void {
    this.lobbyTransport = transport
    if (this.screen === 'multiplayer') this.renderMultiplayer()
  }

  setMultiplayerWelcome(team: 'blue' | 'red' | 'spectator', host: boolean): void {
    this.lobbyTeam = team
    this.lobbyHost = host
    if (this.screen === 'multiplayer') this.renderMultiplayer()
  }

  setMultiplayerState(state: LobbyState): void {
    this.lobbyState = state
    if (this.screen === 'multiplayer') this.renderMultiplayer()
  }

  private renderMultiplayer(): void {
    const el = this.root.querySelector<HTMLElement>('[data-bind="multiplayer"]')
    if (!el) return
    const statusText = this.multiplayerStatusText()
    const s = this.lobbyState
    const seat = (player: PlayerSeat | null) => player
      ? `<li class="seat ${player.connected ? 'online' : 'offline'}"><b>${esc(player.name)}${player.host ? ` · ${this.t('multiplayer.host')}` : ''}</b><span>${player.ready ? this.t('multiplayer.ready') : this.t('multiplayer.notReady')}</span></li>`
      : `<li class="seat empty">${this.t('multiplayer.openSeat')}</li>`
    const teamCard = (team: 'blue' | 'red', label: string) => {
      const players = s?.teams[team] ?? [null, null, null]
      return `<article class="team-lobby ${team}"><header><h3>${label}</h3><b>${players.filter(Boolean).length}/3</b></header><ol>${players.map(player => seat(player)).join('')}</ol>${s ? `<button class="btn ghost small" data-action="mp-copy-${team}">${this.t('multiplayer.copyInvite')}</button><a class="invite-code" href="${esc(this.lobbyRoomLink(team))}" target="_blank" rel="noopener">${esc(this.lobbyRoomLink(team))}</a>` : ''}</article>`
    }
    const hasRoom = Boolean(s)
    const roomCode = s?.room ?? ''
    el.innerHTML = `
      <header class="lobby-head"><div><p class="eyebrow">${this.t('multiplayer.eyebrow')}</p><h2>${this.t('multiplayer.title')}</h2></div>${roomCode ? `<span class="room-code">${esc(roomCode)}</span>` : ''}</header>
      ${!hasRoom ? `<div class="transport-selector" role="group" aria-label="${esc(this.t('multiplayer.transport'))}"><button class="btn ${this.lobbyTransport === 'peer' ? 'primary' : 'ghost'}" data-action="mp-transport-peer" aria-pressed="${this.lobbyTransport === 'peer'}">${this.t('multiplayer.peer')}</button><button class="btn ${this.lobbyTransport === 'server' ? 'primary' : 'ghost'}" data-action="mp-transport-server" aria-pressed="${this.lobbyTransport === 'server'}">${this.t('multiplayer.server')}</button></div>` : ''}
      <p class="lobby-status ${this.lobbyStatus}">${statusText}${this.lobbyDetail ? ` · ${esc(this.t(this.lobbyDetail))}` : ''}</p>
      ${hasRoom ? `<p class="lobby-instruction">${this.t(this.lobbyTransport === 'peer' ? s?.phase === 'running' ? 'multiplayer.peerRunning' : 'multiplayer.peerHint' : s?.phase === 'running' ? 'multiplayer.running' : s?.development ? 'multiplayer.testHint' : 'multiplayer.inviteHint')}</p>
        <div class="team-lobby-grid">${teamCard('blue', this.t('hud.team.blue'))}${teamCard('red', this.t('hud.team.orange'))}</div>
        <div class="lobby-actions">
          ${s?.phase === 'waiting' && this.lobbyTeam !== 'spectator' ? `<button class="btn primary" data-action="mp-ready">${this.t('multiplayer.readyUp')}</button>` : ''}
          ${s?.phase === 'waiting' && this.lobbyHost ? `<button class="btn primary" data-action="mp-start" ${s.readyToStart ? '' : 'disabled'}>${this.t(this.lobbyTransport === 'peer' ? 'multiplayer.peerStart' : s.development ? 'multiplayer.startTest' : 'multiplayer.start')}</button>` : ''}
          <button class="btn ghost" data-action="mp-leave">${this.t('multiplayer.leave')}</button>
        </div>`
        : `<p class="lobby-instruction">${this.t(this.lobbyTransport === 'peer' ? 'multiplayer.peerDescription' : 'multiplayer.description')}</p>
          <div class="lobby-create"><button class="btn primary" data-action="mp-create-blue">${this.t('multiplayer.createBlue')}</button><button class="btn primary red" data-action="mp-create-red">${this.t('multiplayer.createRed')}</button></div>
          <div class="lobby-join"><label>${this.t('multiplayer.roomLabel')}<input data-mp-room maxlength="8" autocomplete="off" placeholder="ABC123" /></label><div><button class="btn ghost" data-action="mp-join-blue">${this.t('multiplayer.joinBlue')}</button><button class="btn ghost" data-action="mp-join-red">${this.t('multiplayer.joinRed')}</button></div></div>`}
      <p class="lobby-foot">${this.t('multiplayer.credit')}</p>
      <footer><button class="btn ghost" data-action="back">${this.t('common.back')}</button></footer>`
  }

  private lobbyRoomLink(team: 'blue' | 'red'): string {
    const room = this.lobbyState?.room
    if (!room) return ''
    const url = new URL(location.href)
    url.search = ''
    url.searchParams.set('match', room)
    url.searchParams.set('team', team)
    url.searchParams.set('transport', this.lobbyTransport)
    return url.toString()
  }

  // ─── death & match ──────────────────────────────────────────────────────
  showDeath(info: DeathInfo): void {
    this.lastDeath = info
    if (info.result.mode === 'ffa') {
      this.renderDeath()
      this.show('death')
    }
  }

  private renderDeath(): void {
    const info = this.lastDeath!
    const r = info.result
    const t = (k: string, v?: Record<string, string | number>) => esc(this.t(k, v))
    const cause = t(`death.${r.cause}`, { name: r.killer ?? '?' })
    const powers = POWER_IDS.filter(p => r.powers[p] > 0).map(p => `<span class="power" style="--c:${hexCss(CELESTIALS[POWERS[p].celestial].color)}" title="${t(`power.${p}`)}">${icon(POWERS[p].icon)}<b>×${r.powers[p]}</b></span>`).join('')
    const el = this.root.querySelector<HTMLElement>('[data-bind="death"]')!
    el.innerHTML = `
      <h2>${t('death.title')}</h2>
      <p class="cause">${THREAT_GLYPH[r.cause] ? glyphSvg(THREAT_GLYPH[r.cause]) : ''}${cause}</p>
      <p class="death-tip">${t(`tip.${r.cause}`)}</p>
      ${info.newBest ? `<p class="badge">${icon('trophy')}${t('death.newBest')}</p>` : ''}
      <div class="stats">
        <div class="stat hero"><small>${t('death.peak')}</small><b data-count="${r.peakLength}">${this.i18n.n(r.peakLength)}</b></div>
        <div class="stat"><small>${t('death.kills')}</small><b>${r.kills}</b></div>
        <div class="stat"><small>${t('death.celestials')}</small><b>${r.celestials}</b></div>
        <div class="stat"><small>${t('death.time')}</small><b>${formatClock(r.seconds)}</b></div>
        <div class="stat gold"><small>${t('death.earned')}</small><b>${icon('stardust')}+<span data-count="${info.earned}">${this.i18n.n(info.earned)}</span></b></div>
      </div>
      ${powers ? `<div class="powers big">${powers}</div>` : ''}
      ${info.localRank >= 0 ? `<p class="local">${t('death.localRank', { n: info.localRank + 1 })}</p>` : ''}
      <div class="actions">
        <button class="btn primary" data-action="respawn">${icon('play')}${t('death.respawn')}</button>
        <button class="btn" data-action="skins">${icon('palette')}${t('death.skins')}</button>
        <button class="btn ghost" data-action="quit">${t('death.title.menu')}</button>
      </div>`
    el.querySelector<HTMLElement>('.btn.primary')?.focus({ preventScroll: true })
    this.countUp(el)
    if (info.newBest) window.setTimeout(() => this.sparks.burstAround(el.querySelector('.badge') ?? el, '#ffd54f', 30), 250)
  }

  /** Animate `[data-count]` numbers from zero (skipped under reduced motion). */
  private countUp(root: HTMLElement): void {
    if (this.reduced) return
    for (const el of root.querySelectorAll<HTMLElement>('[data-count]')) {
      if (el.dataset.counted) continue
      el.dataset.counted = '1'
      const to = Number(el.dataset.count)
      const t0 = performance.now()
      const dur = Math.min(1100, 400 + to * 4)
      const tick = (now: number) => {
        const k = Math.min(1, (now - t0) / dur)
        el.textContent = this.i18n.n(Math.round(to * (1 - Math.pow(1 - k, 3))))
        if (k < 1) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }
  }

  showMatch(result: MatchResult, bestLife: number, earned: number): void {
    this.lastOnlineMatch = null
    this.lastMatch = { result, bestLife, earned }
    this.renderMatch()
    this.show('match')
  }

  showOnlineMatch(result: OnlineMatchEnd): void {
    this.lastOnlineMatch = result; this.lastMatch = null; this.onlineWaiting = false
    this.renderOnlineMatch(); this.show('match')
  }

  private renderOnlineMatch(): void {
    const result = this.lastOnlineMatch!
    const title = result.winner === 'draw' ? 'match.draw' : this.lobbyTeam === 'spectator' ? 'multiplayer.roundEnd'
      : result.winner === this.lobbyTeam ? 'match.victory' : 'match.defeat'
    const el = this.root.querySelector<HTMLElement>('[data-bind="match"]')!
    el.innerHTML = `<p class="eyebrow">${esc(this.t('multiplayer.roundEnd'))}</p><h2>${esc(this.t(title))}</h2>
      <div class="online-result-scores"><span>${esc(this.t('hud.team.blue'))} <b>${this.i18n.n(result.scores.blue)}</b></span>
      <span>${esc(this.t('hud.team.orange'))} <b>${this.i18n.n(result.scores.red)}</b></span></div>
      <p>${esc(this.t(this.lobbyTransport === 'peer' ? 'multiplayer.peerResultsHint' : 'multiplayer.resultsHint'))}</p><ol class="online-results">${[...result.players].sort((a, b) => b.score - a.score).map(p =>
        `<li class="${p.team}"><b>${esc(p.name)}</b><span>${esc(this.t('multiplayer.playerResult', { score: this.i18n.n(p.score), kills: p.kills }))}</span></li>`).join('')}</ol>
      <button class="btn primary" data-action="mp-leave">${esc(this.t('multiplayer.leaveMatch'))}</button>`
  }

  private renderMatch(): void {
    const { result, bestLife, earned } = this.lastMatch!
    const t = (k: string, v?: Record<string, string | number>) => esc(this.t(k, v))
    const el = this.root.querySelector<HTMLElement>('[data-bind="match"]')!
    const round = result.round
    if (round && result.standings?.length) {
      const title = result.winner === -1 ? 'match.draw' : result.winner === 0 ? 'match.victory' : 'match.defeat'
      const ruleKey = round.win === 'stars' ? 'title.winStars' : round.win === 'survival' ? 'title.winSurvival' : 'title.winScore'
      const mapKey = round.map === 'exploration' ? 'title.mapExploration' : 'title.mapSprint'
      const formatKey = result.mode === 'team' ? (round.teamSize === 2 ? 'title.teams2v2' : 'title.teams6v6') : 'title.teamsFfa'
      const value = (row: typeof result.standings[number]) => round.win === 'stars' ? `${this.i18n.n(row.stars)} ${t('match.stars')}` : round.win === 'survival' ? `${formatClock(row.survival)} ${t('match.survival')}` : this.i18n.n(row.length)
      const rows = result.standings.slice(0, 3).map((row, i) => `<li class="${row.isPlayer ? 'me' : ''}"><span class="place">${t('match.place', { n: i + 1 })}</span><b>${esc(row.name)}${row.isPlayer ? ` (${t('hud.you')})` : ''}</b><strong>${value(row)}</strong><small>${t('death.kills')}: ${this.i18n.n(row.kills)} · ${this.i18n.n(row.stars)} ${t('match.stars')}</small></li>`).join('')
      el.innerHTML = `<p class="eyebrow">${t('match.round')}</p><h2 class="${title.split('.')[1]}">${t(title)}</h2>
        <p class="round-summary">${t('match.rule', { name: this.t(ruleKey) })} · ${t('match.map', { name: this.t(mapKey) })} · ${t('match.format', { name: this.t(formatKey) })}</p>
        <h3 class="top-three-title">${t('match.topThree')}</h3><ol class="top-three">${rows}</ol>
        <p>${t('match.bestLife', { n: this.i18n.n(bestLife) })}</p><p class="gold">${icon('stardust')} +<span data-count="${earned}">${this.i18n.n(earned)}</span></p>
        <div class="actions"><button class="btn primary" data-action="again" data-mode="${result.mode === 'team' ? 'team' : 'ffa'}">${icon('play')}${t('match.again')}</button><button class="btn ghost" data-action="quit">${t('death.title.menu')}</button></div>`
      this.countUp(el)
      if (result.winner === 0) window.setTimeout(() => this.sparks.burstAround(el.querySelector('h2') ?? el, '#ffd54f', 40), 200)
      return
    }
    const title = result.winner === -1 ? 'match.draw' : result.winner === result.playerTeam ? 'match.victory' : 'match.defeat'
    const total = Math.max(1, result.scores[0] + result.scores[1])
    el.innerHTML = `
      <h2 class="${title.split('.')[1]}">${t(title)}</h2>
      <p class="sub">${t('match.scores')}</p>
      <div class="versus"><div class="side blue"><small>${t('hud.team.blue')}</small><b>${this.i18n.n(result.scores[0])}</b></div><div class="side orange"><small>${t('hud.team.orange')}</small><b>${this.i18n.n(result.scores[1])}</b></div></div>
      <div class="team-bar big"><i class="a" style="width:${(result.scores[0] / total) * 100}%"></i><i class="b" style="width:${(result.scores[1] / total) * 100}%"></i></div>
      <p>${t('match.bestLife', { n: this.i18n.n(bestLife) })}</p><p class="gold">${icon('stardust')} +<span data-count="${earned}">${this.i18n.n(earned)}</span></p>
      <div class="actions"><button class="btn primary" data-action="again" data-mode="team">${icon('play')}${t('match.again')}</button><button class="btn ghost" data-action="quit">${t('death.title.menu')}</button></div>`
    this.countUp(el)
    if (result.winner === result.playerTeam) window.setTimeout(() => this.sparks.burstAround(el.querySelector('h2') ?? el, '#ffd54f', 40), 200)
  }

  // ─── HUD ────────────────────────────────────────────────────────────────
  private setIf(key: string, value: string, apply: () => void): void {
    if (this.hudCache.get(key) === value) return
    this.hudCache.set(key, value)
    apply()
  }

  updateHud(h: HudState, game: Game, dt: number, reduced: boolean): void {
    const hud = this.root.querySelector<HTMLElement>('[data-screen="hud"]')!
    const onlinePanel = hud.querySelector<HTMLElement>('[data-bind="onlinePanel"]')!
    onlinePanel.hidden = !h.online && !this.onlineWaiting
    if (!onlinePanel.hidden) {
      const status = `${this.multiplayerStatusText()}${this.lobbyDetail ? ` · ${this.t(this.lobbyDetail)}` : ''}`
      this.setIf('onlineStatus', status, () => this.bind('onlineStatus', status))
      const stats = h.online ? this.t('multiplayer.hud', {
        ping: h.online.ping, players: h.online.players, total: h.online.total, score: this.i18n.n(h.online.score),
        team: this.t(h.online.team === 'spectator' ? 'multiplayer.spectator' : h.online.team === 'blue' ? 'hud.team.blue' : 'hud.team.orange'),
      }) : ''
      this.setIf('onlineStats', stats, () => this.bind('onlineStats', stats))
    }
    this.renderArrows(hud, h.threatArrows)
    hud.classList.toggle('threat-imminent', h.threatImminent)
    const team = game.sim.mode === 'team'
    hud.classList.toggle('is-team', team)
    this.setIf('length', String(h.length), () => this.bind('length', this.i18n.n(h.length)))
    const stageKey = `${h.stage}|${h.environment}|${h.arenaRadius}|${h.nextStageLength ?? 0}`
    this.setIf('stage', stageKey, () => {
      const next = h.nextStageLength ? ` · ${this.t('hud.nextStage', { n: h.nextStageLength })}` : ''
      this.bind('stage', `${this.t('hud.stage', { n: h.stage })} · ${this.t(`environment.${h.environment}`)} · ${this.t('hud.arena', { n: Math.round(h.arenaRadius) })}${next}`)
    })
    const now = performance.now()
    if (h.length > this.lastLen && now - this.lastLenBump > 140 && !reduced) {
      this.lastLenBump = now
      hud.querySelector('.hud-len b')?.animate([{ transform: 'scale(1.18)', color: '#ffffff' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' })
    }
    this.lastLen = h.length
    const campaignHud = hud.querySelector<HTMLElement>('[data-bind="campaignHud"]')!
    campaignHud.hidden = !h.campaign
    if (h.campaign) {
      const goal = this.t(`campaign.goal.${h.campaign.goal}`)
      const key = `${h.campaign.stage}|${h.campaign.progress}|${h.campaign.target}`
      this.setIf('campaignHud', key, () => {
        campaignHud.innerHTML = `<span class="campaign-hud-title">${esc(this.t('campaign.hud', { n: h.campaign!.stage }))}</span><b>${esc(goal)}</b><span>${this.i18n.n(h.campaign!.progress)} / ${this.i18n.n(h.campaign!.target)}</span><i><em style="width:${Math.min(100, h.campaign!.progress / h.campaign!.target * 100)}%"></em></i>`
      })
    }
    // Feast combo meter
    const comboOn = h.combo >= 5
    const combo = hud.querySelector<HTMLElement>('[data-bind="comboWrap"]')!
    combo.classList.toggle('is-on', comboOn)
    if (comboOn) {
      this.setIf('combo', String(h.combo), () => {
        this.bind('combo', `×${h.combo}`)
        combo.dataset.tier = h.combo >= 50 ? '3' : h.combo >= 25 ? '2' : '1'
        if (!reduced && h.combo > this.lastCombo) combo.animate([{ transform: 'translateX(-50%) scale(1.14)' }, { transform: 'translateX(-50%) scale(1)' }], { duration: 160, easing: 'ease-out' })
      })
      combo.querySelector<HTMLElement>('.combo-bar i')!.style.transform = `scaleX(${h.comboLeft.toFixed(3)})`
    }
    this.lastCombo = h.combo
    // Bounty crown
    const crownKey = h.crowned ? 'me' : h.crownName ?? ''
    this.setIf('crown', crownKey, () => {
      const el = hud.querySelector<HTMLElement>('[data-bind="crown"]')!
      el.className = `crown-chip ${crownKey ? 'is-on' : ''} ${h.crowned ? 'is-me' : ''}`
      el.innerHTML = crownKey ? `${icon('crown')}<span>${esc(h.crowned ? this.t('hud.crownYou') : this.t('hud.crownOther', { name: h.crownName ?? '' }))}</span>` : ''
    })
    const rare = hud.querySelector<HTMLElement>('[data-bind="surprise"]')!
    rare.hidden = !h.surprise
    if (h.surprise) {
      const s = h.surprise
      const text = this.t('hud.surprise', { name: this.t(`surprise.${s.kind}`), n: Math.ceil(s.left) })
      const distance = this.t('hud.surpriseDistance', { n: Math.ceil(s.distance) })
      const key = `${text}|${distance}|${Math.round(s.bearing * 180 / Math.PI)}`
      this.setIf('surprise', key, () => {
        rare.innerHTML = `<b>${esc(text)}</b><span><i aria-hidden="true" style="transform:rotate(${s.bearing * 180 / Math.PI - 90}deg)">➤</i>${esc(distance)}</span>`
      })
      rare.classList.toggle('is-ending', s.left <= 2)
    }
    const zone = hud.querySelector<HTMLElement>('[data-bind="zone"]')!
    zone.hidden = h.zoneLeft <= 0
    zone.classList.toggle('is-ending', h.zoneLeft <= 5)
    this.setIf('zone', String(Math.ceil(h.zoneLeft)), () => { zone.textContent = this.t('hud.zone', { n: Math.ceil(h.zoneLeft) }) })
    const specialEffects: [string, number, boolean][] = [
      ['surprise.shrink', h.shrinkLeft, false], ['trap.freeze', h.traps.freeze, true],
      ['trap.slow', h.traps.slow, true], ['trap.reverse', h.traps.reverse, true],
      ['hud.trapRecovery', h.trapGrace > 0 && !Object.values(h.traps).some(t => t > 0) ? h.trapGrace : 0, false],
    ]
    const effectsKey = specialEffects.map(([key, left]) => `${key}:${Math.ceil(left)}`).join('|')
    this.setIf('specialEffects', effectsKey, () => {
      hud.querySelector('[data-bind="specialEffects"]')!.innerHTML = specialEffects.filter(([, left]) => left > 0)
        .map(([key, left, bad]) => `<span class="special-chip ${bad ? 'bad' : ''}">${esc(this.t(key))} · ${esc(this.t('common.seconds', { n: Math.ceil(left) }))}</span>`).join('')
    })
    this.setIf('rank', `${h.rank}/${h.total}`, () => this.bind('rank', h.rank > 0 ? this.t('hud.rank', { rank: h.rank, total: h.total }) : ''))
    this.setIf('kills', String(h.kills), () => this.bind('kills', String(h.kills)))
    this.setIf('shards', String(h.shards), () => this.bind('shards', `+${h.shards}`))
    if (team) {
      const [a, b] = h.teamScores
      this.setIf('team', `${a}|${b}`, () => {
        this.bind('teamA', this.i18n.n(a))
        this.bind('teamB', this.i18n.n(b))
        const total = Math.max(1, a + b)
        hud.querySelector<HTMLElement>('.team-bar .a')!.style.width = `${(a / total) * 100}%`
        hud.querySelector<HTMLElement>('.team-bar .b')!.style.width = `${(b / total) * 100}%`
      })
      const clock = formatClock(h.matchLeft)
      this.setIf('clock', clock, () => {
        this.bind('clock', clock)
        hud.querySelector('.team-clock')!.classList.toggle('urgent', h.matchLeft <= 30)
      })
    }
    const roundEl = hud.querySelector<HTMLElement>('.hud-round')!
    roundEl.hidden = !h.round
    if (h.round) {
      const ruleKey = h.round.win === 'stars' ? 'hud.winStars' : h.round.win === 'survival' ? 'hud.winSurvival' : 'hud.winScore'
      this.setIf('roundClock', formatClock(h.matchLeft), () => this.bind('roundClock', formatClock(h.matchLeft)))
      this.setIf('roundLabel', ruleKey, () => this.bind('roundLabel', `${this.t('hud.round')} · ${this.t(ruleKey)}`))
      roundEl.classList.toggle('urgent', h.matchLeft <= 30)
    }
    const leadersKey = h.leaders.map(l => `${l.rank}${l.name}${l.length}`).join('|')
    this.setIf('leaders', leadersKey, () => {
      hud.querySelector('[data-bind="leaders"]')!.innerHTML = h.leaders.map(l => {
        const cls = `${l.isPlayer ? 'me' : ''} ${team ? (l.team === 0 ? 'blue' : 'orange') : ''}`
        return `<li class="${cls}"><span>${l.rank}</span><em>${esc(l.isPlayer ? `${l.name} (${this.t('hud.you')})` : l.name)}</em><b>${this.i18n.n(l.length)}</b></li>`
      }).join('')
    })

    // Effect timers
    for (const id of PICKUP_IDS) {
      const left = id === 'magnet' ? h.magnet : id === 'shield' ? h.shield : h.freeBoost
      const el = hud.querySelector<HTMLElement>(`[data-effect="${id}"]`)!
      const on = left > 0
      el.classList.toggle('is-on', on)
      if (!on) continue
      const frac = Math.max(0, Math.min(1, left / EFFECT_MAX[id]()))
      const c = 2 * Math.PI * 19
      el.querySelector<SVGCircleElement>('.fill')!.style.strokeDasharray = `${c * frac} ${c}`
      el.classList.toggle('is-ending', left < 3)
      el.classList.toggle('blink', left < 3 && !reduced)
      const secs = Math.ceil(left)
      this.setIf(`eff-${id}`, String(secs), () => { el.querySelector('b')!.textContent = this.t('common.seconds', { n: secs }) })
    }
    // Permanent powers
    const powersKey = POWER_IDS.map(p => h.stacks[p]).join('')
    this.setIf('powers', powersKey, () => {
      hud.querySelector('[data-bind="powers"]')!.innerHTML = POWER_IDS.filter(p => h.stacks[p] > 0).map(p => {
        const def = POWERS[p]
        const pips = Array.from({ length: def.maxStacks }, (_, i) => `<i class="${i < h.stacks[p] ? 'on' : ''}"></i>`).join('')
        return `<span class="power" style="--c:${hexCss(CELESTIALS[def.celestial].color)}" title="${esc(`${this.t(`power.${p}`)} — ${this.t(`power.${p}.desc`)}`)}">${icon(def.icon)}<span class="pips">${pips}</span></span>`
      }).join('')
    })
    // Status chips
    const boostKey = h.freeBoost > 0 ? 'free' : h.boosting ? 'on' : h.canBoost ? 'ready' : 'no'
    this.setIf('boost', boostKey, () => {
      const chip = hud.querySelector<HTMLElement>('.chip-boost')!
      chip.className = `chip chip-boost is-${boostKey}`
      chip.innerHTML = `${icon('freeBoost')}${esc(this.t(h.freeBoost > 0 ? 'hud.boostFree' : 'hud.boost'))}`
    })
    hud.querySelector('.chip-slow')!.classList.toggle('is-on', h.slowed)
    hud.querySelector('.chip-rim')!.classList.toggle('is-on', h.rimDanger > 0.3)
    const abilityState: { kind: 'ghost' | 'electric' | 'bomb' | 'laser'; left: number; level: number }[] = [
      { kind: 'ghost', left: h.ghostLeft, level: h.upgradeLevels.ghost },
      { kind: 'electric', left: h.electricLeft, level: h.upgradeLevels.electric },
      { kind: 'bomb', left: h.bombs?.next ?? 0, level: h.upgradeLevels.bomb },
      { kind: 'laser', left: h.laserUsed ? 0 : h.laserUnlocked ? 1 : 0, level: h.laserUnlocked ? 1 : 0 },
    ]
    for (const ability of abilityState) {
      const button = hud.querySelector<HTMLButtonElement>(`.ability-${ability.kind}`)
      if (!button) continue
      const owned = ability.level > 0
      const cooldown = ability.kind === 'ghost' ? h.ghostCooldown : 0
      const laserBlocked = ability.kind === 'laser' && (game.isOnline || h.laserUsed)
      button.disabled = !owned || cooldown > 0 || laserBlocked
      button.classList.toggle('is-owned', owned)
      const label = ability.kind === 'laser'
        ? game.isOnline ? this.t('ability.localOnly') : h.laserUsed ? this.t('ability.used') : this.t('hud.abilityReady')
        : ability.kind === 'bomb'
        ? h.bombs ? `${h.bombs.left}/${h.bombs.limit}${h.bombs.next > 0 ? ` · ${Math.ceil(h.bombs.next)}s` : ''}` : '—'
        : ability.left > 0 ? this.t('common.seconds', { n: Math.ceil(ability.left) }) : cooldown > 0 ? this.t('ability.cooldown', { n: Math.ceil(cooldown) }) : owned ? this.t('hud.abilityReady') : '—'
      button.querySelector('span')!.textContent = label
      button.classList.toggle('is-active', ability.left > 0 && ability.kind !== 'bomb' && ability.kind !== 'laser')
      button.classList.toggle('is-used', ability.kind === 'laser' && h.laserUsed)
      button.classList.toggle('is-cooldown', cooldown > 0)
      button.classList.toggle('is-ending', ability.left > 0 && ability.left <= 2)
    }
    this.vignetteEl.style.opacity = String(h.rimDanger * 0.85)
    const respawn = h.respawnIn > 0 ? this.t('hud.respawnIn', { n: Math.ceil(h.respawnIn) }) : ''
    this.setIf('respawn', respawn, () => {
      const el = hud.querySelector<HTMLElement>('[data-bind="respawn"]')!
      el.textContent = respawn
      el.classList.toggle('is-on', respawn !== '')
    })
    this.minimap.draw(game, dt)
  }

  // ─── transient messages ─────────────────────────────────────────────────
  toast(key: string, vars: Record<string, string | number> = {}, tone: 'good' | 'bad' | 'info' | 'power' = 'info'): void {
    const resolved: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(vars)) resolved[k] = typeof v === 'string' && this.i18n.has(v) ? this.t(v) : v
    const text = this.t(key, resolved)
    const last = this.toastsEl.lastElementChild as HTMLElement | null
    if (last && last.textContent === text) return
    const el = document.createElement('div')
    el.className = `toast ${tone}`
    el.textContent = text
    this.toastsEl.appendChild(el)
    while (this.toastsEl.children.length > 3) this.toastsEl.firstElementChild!.remove()
    window.setTimeout(() => el.classList.add('out'), 2200)
    window.setTimeout(() => el.remove(), 2700)
  }

  celestial(kind: CelestialId, powerAdded: boolean): void {
    const def = CELESTIALS[kind]
    const power = this.t(`power.${def.power}`)
    const sub = powerAdded ? this.t('banner.power', { power, desc: this.t(`power.${def.power}.desc`) }) : this.t('banner.maxed', { power })
    this.bannerEl.innerHTML = `<div class="banner-card" style="--c:${hexCss(def.color)}">${icon(kind)}<div><strong>${esc(this.t('banner.swallowed', { body: this.t(`celestial.${kind}`) }))}</strong><small>${esc(sub)}</small></div></div>`
    this.bannerEl.classList.remove('is-on')
    void this.bannerEl.offsetWidth
    this.bannerEl.classList.add('is-on')
    this.bannerTimer = 3
    const card = this.bannerEl.querySelector('.banner-card')
    if (card) window.setTimeout(() => this.sparks.burstAround(card, hexCss(def.color), 30), 120)
  }

  pickup(kind: PickupId): void {
    this.toast(`pickup.${kind}.toast`, {}, 'power')
    const el = this.root.querySelector<HTMLElement>(`[data-effect="${kind}"]`)
    if (!el) return
    requestAnimationFrame(() => {
      const r = el.getBoundingClientRect()
      const color = kind === 'magnet' ? '#ff4fd8' : kind === 'shield' ? '#4fb8ff' : '#ffd84f'
      this.sparks.burst(r.left + r.width / 2, r.top + r.height / 2, color, 16, 200)
      this.sparks.ring(r.left + r.width / 2, r.top + r.height / 2, color, 46)
      if (!this.reduced) el.animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'cubic-bezier(.2,1.6,.4,1)' })
    })
  }

  /** Stardust gained in play: icons fly from the worm (screen centre) into the counter. */
  shard(): void {
    const target = this.root.querySelector<HTMLElement>('.hud-meta .gold')
    if (!target || this.screen !== 'hud') return
    this.sparks.flyTo(window.innerWidth / 2, window.innerHeight / 2, target, 5, () => {
      if (!this.reduced) target.animate([{ transform: 'scale(1.3)', filter: 'brightness(1.8)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' })
      const r = target.getBoundingClientRect()
      this.sparks.burst(r.left + r.width / 2, r.top + r.height / 2, '#ffd54f', 8, 140)
    })
  }

  /** Big centred celebration text. Tier 1-3 scales size, colour and sparkle. */
  // ─── Threat Language ────────────────────────────────────────────────────
  private arrowEls = new Map<string, { el: HTMLElement; look: string }>()
  private renderArrows(hud: HTMLElement, arrows: ThreatArrow[]): void {
    const layer = hud.querySelector<HTMLElement>('.threat-arrows')!
    const live = new Set<string>()
    for (const a of arrows) {
      live.add(a.key)
      let e = this.arrowEls.get(a.key)
      if (!e) {
        const el = document.createElement('div')
        el.className = 'tarrow'
        layer.appendChild(el)
        e = { el, look: '' }
        this.arrowEls.set(a.key, e)
      }
      const look = `${a.glyph}:${a.tone}`
      if (e.look !== look) {
        e.look = look
        e.el.className = `tarrow tone-${a.tone}`
        e.el.innerHTML = `<span class="chev"></span>${glyphSvg(a.glyph, a.tone)}`
      }
      e.el.style.transform = `translate(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px)`
      e.el.style.setProperty('--rot', `${a.angle.toFixed(3)}rad`)
      e.el.style.setProperty('--u', a.urgency.toFixed(2))
      e.el.classList.toggle('urgent', a.urgency >= 0.95)
    }
    for (const [key, e] of this.arrowEls) {
      if (live.has(key)) continue
      e.el.remove()
      this.arrowEls.delete(key)
    }
  }
  private hintTimer = 0
  /** First-encounter card: glyph, name and one line on how to deal with the threat. */
  showHint(id: HintId): void {
    const el = this.root.querySelector<HTMLElement>('.hint-card')!
    const t = (k: string) => esc(this.t(k))
    el.innerHTML = `${glyphSvg(THREAT_GLYPH[id])}<span><b>${t(`hint.${id}.title`)}</b>${t(`hint.${id}.text`)}</span>`
    el.hidden = false
    el.classList.remove('out')
    this.audio.play('ui')
    window.clearTimeout(this.hintTimer)
    this.hintTimer = window.setTimeout(() => {
      el.classList.add('out')
      this.hintTimer = window.setTimeout(() => { el.hidden = true }, 350)
    }, 5600)
  }

  callout(key: string, vars: Record<string, string | number>, tier: 1 | 2 | 3): void {
    const el = document.createElement('div')
    el.className = `callout tier-${tier}`
    el.textContent = this.t(key, vars)
    this.calloutsEl.appendChild(el)
    while (this.calloutsEl.children.length > 2) this.calloutsEl.firstElementChild!.remove()
    requestAnimationFrame(() => {
      const r = el.getBoundingClientRect()
      const color = tier === 3 ? '#ffd54f' : tier === 2 ? '#ff7ad9' : '#7ff6ff'
      this.sparks.burst(r.left + r.width / 2, r.top + r.height / 2, color, 8 + tier * 8, 160 + tier * 60)
    })
    window.setTimeout(() => el.classList.add('out'), 1300 + tier * 200)
    window.setTimeout(() => el.remove(), 1800 + tier * 200)
  }

  /** Loading gate shown when the arena's assets are late. Resolves with the player's choice. */
  showLoading(progress: () => number, slowAfterMs = 6000): { done(): void; choice: Promise<'play' | 'cancel'> } {
    this.show('loading')
    const scr = this.root.querySelector<HTMLElement>('[data-screen="loading"]')!
    scr.classList.remove('is-slow')
    this.bind('loadText', this.t('loading.arena'))
    const bar = scr.querySelector<HTMLElement>('[data-bind="loadBar"]')!
    const timer = window.setInterval(() => (bar.style.width = `${Math.round(progress() * 100)}%`), 100)
    const slow = window.setTimeout(() => {
      scr.classList.add('is-slow')
      this.bind('loadText', this.t('loading.slow'))
    }, slowAfterMs)
    const choice = new Promise<'play' | 'cancel'>(res => (this.loadingChoice = res))
    return {
      choice,
      done: () => {
        window.clearInterval(timer)
        window.clearTimeout(slow)
        this.loadingChoice = null
      },
    }
  }

  feed(item: FeedItem): void {
    const text = item.killer ? this.t('feed.kill', { killer: item.killer, victim: item.victim }) : this.t('feed.lost', { victim: item.victim })
    const el = document.createElement('div')
    el.className = `feed-item ${item.involvesPlayer ? 'me' : ''} ${item.playerKilled ? 'bad' : ''}`
    el.innerHTML = `${icon('skull')}<span>${esc(text)}</span>`
    this.feedEl.prepend(el)
    while (this.feedEl.children.length > 4) this.feedEl.lastElementChild!.remove()
    window.setTimeout(() => el.classList.add('out'), 4500)
    window.setTimeout(() => el.remove(), 5000)
  }

  flash(kind: 'shield' | 'death' | 'celestial' | 'hit', reduced: boolean): void {
    this.flashEl.className = `flash ${kind}${reduced ? ' calm' : ''}`
    void this.flashEl.offsetWidth
    this.flashEl.classList.add('is-on')
  }

  frame(dt: number): void {
    this.sparks.reduced = this.reduced
    this.sparks.update(Math.min(0.05, dt))
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt
      if (this.bannerTimer <= 0) this.bannerEl.classList.remove('is-on')
    }
  }

  setLocale(locale: Locale): void {
    this.i18n.set(locale)
  }

  get skinName(): string {
    return this.t(`skin.${skinById(this.save.data.skin).id}`)
  }
}
