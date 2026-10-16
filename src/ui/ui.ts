/**
 * DOM UI. Every visible string comes from i18n keys (`data-i18n` or `t()`), so adding a language
 * only needs a new dictionary. Screens are <section data-screen> elements toggled by `show()`.
 */
import type { Audio } from '../engine/audio'
import type { I18n } from '../engine/i18n'
import { LOCALES, sanitizeName, type Locale, type SaveData, type SaveStore } from '../engine/save'
import { CONFIG } from '../game/config'
import { CELESTIALS, CELESTIAL_IDS, PICKUP_IDS, POWERS, POWER_IDS, SKINS, skinById, type CelestialId, type PickupId } from '../game/content'
import type { FeedItem, Game, HudState, LifeResult, MatchResult, ThreatArrow } from '../game/game'
import { glyphSvg, type GlyphId } from '../game/glyphs'
import type { HintId } from '../game/threats'
import { formatClock, type Mode, type Records } from '../game/rules'
import { icon } from './icons'
import { Minimap } from './minimap'
import { Sparks } from './sparks'
import { assets } from '../engine/assets'

export type Screen = 'boot' | 'loading' | 'title' | 'hud' | 'pause' | 'settings' | 'skins' | 'records' | 'howto' | 'death' | 'match'

export type UiActions = {
  play(mode: Mode): void
  respawn(): void
  resume(): void
  pause(): void
  quit(): void
  settings(patch: Partial<SaveData>): void
  buySkin(id: string): boolean
  equipSkin(id: string): void
  /** Forget which first-encounter hazard hints were shown. */
  resetHints(): void
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
  private hudCache = new Map<string, string>()
  private sparks!: Sparks
  private calloutsEl!: HTMLElement
  private lastHover: Element | null = null
  private lastLen = 0
  private lastLenBump = 0
  private lastCombo = 0
  private loadingChoice: ((v: 'play' | 'cancel') => void) | null = null
  reduced = false

  constructor(
    private readonly i18n: I18n,
    private readonly save: SaveStore,
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

      <section class="screen title" data-screen="title">
        <div class="title-wrap">
          ${logo('big')}
          <p class="tagline">${T('title.tagline')}</p>
          <div class="title-row">
            <label class="name-field"><span data-i18n="title.name"></span><input id="pilot-name" maxlength="16" autocomplete="off" spellcheck="false" /></label>
            <div class="wallet">${icon('stardust')}<b data-bind="stardust">0</b></div>
          </div>
          <div class="modes">
            <button class="mode-card ffa" data-action="play-ffa">${icon('play')}<strong>${T('title.ffa')}</strong><small>${T('title.ffaDesc')}</small></button>
            <button class="mode-card team" data-action="play-team">${icon('team')}<strong>${T('title.team')}</strong><small>${T('title.teamDesc')}</small></button>
          </div>
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
        <div class="hud-tr">
          <button class="icon-btn" data-action="pause" data-i18n-title="hud.pause">${icon('pause')}</button>
          <div class="leaders panel"><h4 data-i18n="hud.leaders"></h4><ol data-bind="leaders"></ol></div>
          <div class="feed" data-bind="feed"></div>
        </div>
        <div class="hud-bl">
          <canvas class="minimap" data-i18n-title="hud.minimap"></canvas>
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
          <div class="status">
            <span class="chip chip-boost" data-bind="boostChip"></span>
            <span class="chip chip-slow">${icon('well')}<span data-i18n="hud.slowed"></span></span>
            <span class="chip chip-rim">${icon('rim')}<span data-i18n="hud.rim"></span></span>
          </div>
        </div>
        <div class="hud-tc">
          <div class="crown-chip" data-bind="crown"></div>
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

      <section class="screen menu" data-screen="skins">
        <div class="panel card wide">
          <header><h2 data-i18n="skins.title"></h2><div class="wallet">${icon('stardust')}<b data-bind="stardust">0</b></div></header>
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

      <section class="screen menu" data-screen="settings">
        <div class="panel card">
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
      case 'respawn': return this.actions.respawn()
      case 'again': return this.actions.play(el.dataset.mode === 'team' ? 'team' : 'ffa')
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
    else if (this.screen === 'skins' || this.screen === 'records' || this.screen === 'howto') this.show(this.subReturn)
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
    if (screen === 'skins') {
      this.refreshWallet()
      this.renderSkins()
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
    if (this.screen === 'skins') this.renderSkins()
    if (this.screen === 'records') this.renderRecords()
    if (this.screen === 'howto') this.renderHowto()
    if (this.screen === 'death' && this.lastDeath) this.renderDeath()
    if (this.screen === 'match' && this.lastMatch) this.renderMatch()
  }

  private renderSkins(): void {
    const d = this.save.data
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
      <section><h3>${t('howto.team')}</h3><p>${t('howto.teamText')}</p></section>
      <footer><button class="btn ghost" data-action="back">${t('common.back')}</button></footer>`
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
    this.lastMatch = { result, bestLife, earned }
    this.renderMatch()
    this.show('match')
  }

  private renderMatch(): void {
    const { result, bestLife, earned } = this.lastMatch!
    const t = (k: string, v?: Record<string, string | number>) => esc(this.t(k, v))
    const title = result.winner === -1 ? 'match.draw' : result.winner === result.playerTeam ? 'match.victory' : 'match.defeat'
    const total = Math.max(1, result.scores[0] + result.scores[1])
    const el = this.root.querySelector<HTMLElement>('[data-bind="match"]')!
    el.innerHTML = `
      <h2 class="${title.split('.')[1]}">${t(title)}</h2>
      <p class="sub">${t('match.scores')}</p>
      <div class="versus">
        <div class="side blue"><small>${t('hud.team.blue')}</small><b>${this.i18n.n(result.scores[0])}</b></div>
        <div class="side orange"><small>${t('hud.team.orange')}</small><b>${this.i18n.n(result.scores[1])}</b></div>
      </div>
      <div class="team-bar big"><i class="a" style="width:${(result.scores[0] / total) * 100}%"></i><i class="b" style="width:${(result.scores[1] / total) * 100}%"></i></div>
      <p>${t('match.bestLife', { n: this.i18n.n(bestLife) })}</p>
      <p class="gold">${icon('stardust')} +<span data-count="${earned}">${this.i18n.n(earned)}</span></p>
      <div class="actions">
        <button class="btn primary" data-action="again" data-mode="team">${icon('play')}${t('match.again')}</button>
        <button class="btn ghost" data-action="quit">${t('death.title.menu')}</button>
      </div>`
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
    this.renderArrows(hud, h.threatArrows)
    hud.classList.toggle('threat-imminent', h.threatImminent)
    const team = game.sim.mode === 'team'
    hud.classList.toggle('is-team', team)
    this.setIf('length', String(h.length), () => this.bind('length', this.i18n.n(h.length)))
    const stageKey = `${h.stage}|${h.arenaRadius}|${h.nextStageLength ?? 0}`
    this.setIf('stage', stageKey, () => {
      const next = h.nextStageLength ? ` · ${this.t('hud.nextStage', { n: h.nextStageLength })}` : ''
      this.bind('stage', `${this.t('hud.stage', { n: h.stage })} · ${this.t('hud.arena', { n: Math.round(h.arenaRadius) })}${next}`)
    })
    const now = performance.now()
    if (h.length > this.lastLen && now - this.lastLenBump > 140 && !reduced) {
      this.lastLenBump = now
      hud.querySelector('.hud-len b')?.animate([{ transform: 'scale(1.18)', color: '#ffffff' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' })
    }
    this.lastLen = h.length
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
