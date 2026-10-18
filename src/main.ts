import './styles/main.css'
import './styles/online.css'
import { assets } from './engine/assets'
import { Audio } from './engine/audio'
import { I18n, resolveLocale } from './engine/i18n'
import { Input } from './engine/input'
import { GameLoop } from './engine/loop'
import { CampaignStore, purchaseSkin, SAVE_KEY, SaveStore, type SaveData } from './engine/save'
import type { Game, LifeResult } from './game/game'
import type { HintId } from './game/threats'
import { applyLife, insertLife, stardustForLife, type CompetitiveRound, type Mode } from './game/rules'
import { campaignStage, completeCampaignStage, type CampaignStage, type CampaignStats } from './game/campaign'
import { tuning } from './game/tuning'
import { TouchControls } from './ui/touch'
import { Ui } from './ui/ui'
import { MultiplayerClient } from './net/multiplayer'

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!
  const firstRun = safeGet(SAVE_KEY) === null
  const save = new SaveStore()
  const campaign = new CampaignStore()
  const i18n = new I18n(resolveLocale(save.data.locale, navigator.languages))
  const input = new Input(canvas)
  const audio = new Audio()
  let game: Game | undefined
  let match = { bestLife: 0, earned: 0 }
  let deathTimer = 0
  let activeCampaign: CampaignStage | null = null

  if (firstRun) save.update({ reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches })

  const applySettings = (d: SaveData) => {
    input.keyTurn = d.keyTurn
    audio.setVolumes(d.musicVolume, d.sfxVolume, d.muted)
    document.body.classList.toggle('reduced-motion', d.reducedMotion)
    if (game) {
      game.reducedMotion = d.reducedMotion
      game.threatMode = d.threatMode
    }
    if (uiRef) uiRef.reduced = d.reducedMotion
  }
  let uiRef: Ui | null = null
  let network: MultiplayerClient | null = null

  const unlockAudio = () => {
    audio.unlock()
    audio.startMusic()
  }
  window.addEventListener('pointerdown', unlockAudio, { once: true })
  window.addEventListener('keydown', unlockAudio, { once: true })

  let starting = false
  const launch = async (mode: Mode, round?: CompetitiveRound, mission?: CampaignStage) => {
    if (!game || starting) return
    network?.leave()
    ui.clearMultiplayer()
    unlockAudio()
    window.clearTimeout(deathTimer)
    if (!assets.stageReady(1)) {
      starting = true
      const gate = ui.showLoading(() => assets.progress(1).ratio)
      const result = await Promise.race([assets.ensure(1).then(() => 'ready' as const), gate.choice])
      gate.done()
      starting = false
      if (result === 'cancel') { ui.show('title'); return }
    }
    tuning.activate('run')
    match = { bestLife: 0, earned: 0 }
    activeCampaign = mission ?? null
    game.start(mode, round, mission)
    audio.setScene('arena')
    audio.play('start')
    ui.show('hud')
    if (mission) {
      ui.callout('callout.campaignStage', { n: mission.id }, 2)
      ui.toast('toast.campaignStart', { n: mission.id }, 'power')
    }
    loop.resetAccumulator()
  }
  const play = async (mode: Mode, round?: CompetitiveRound) => launch(mode, round)
  const startCampaign = async (stageId: number) => {
    const mission = campaignStage(stageId)
    if (!mission || mission.id > campaign.data.unlockedStage) return
    await launch('ffa', undefined, mission)
  }
  const pause = () => {
    if (!game || (game.mode !== 'playing' && !(game.mode === 'dead' && game.sim.mode === 'team'))) return
    game.pause()
    ui.show('pause')
  }
  const resume = () => {
    if (!game || (!game.isOnline && game.mode !== 'paused')) return
    game.resume()
    ui.show((game.mode as string) === 'dead' && game.sim.mode === 'ffa' ? 'death' : 'hud')
    loop.resetAccumulator()
  }

  const ui = new Ui(i18n, save, campaign, audio, {
    play,
    respawn: () => {
      if (!game) return
      window.clearTimeout(deathTimer)
      game.respawn()
      ui.show('hud')
    },
    resume,
    pause,
    quit: () => {
      window.clearTimeout(deathTimer)
      network?.leave()
      ui.clearMultiplayer()
      activeCampaign = null
      game?.toTitle()
      audio.setScene('title')
      ui.show('title')
    },
    settings: patch => {
      const qualityChanged = patch.quality !== undefined && patch.quality !== save.data.quality
      save.update(patch)
      applySettings(save.data)
      if (patch.locale) i18n.set(patch.locale)
      if (qualityChanged) game?.setQuality(save.data.quality)
    },
    buySkin: id => {
      const next = purchaseSkin(save.data, id)
      if (!next) return false
      save.replace(next)
      return true
    },
    equipSkin: id => save.update({ skin: id }),
    campaign: (action, stageId) => {
      if (action === 'open') ui.show('campaign')
      else if (action === 'start' && stageId) void startCampaign(Number(stageId))
      else if (action === 'next' && stageId) void startCampaign(Number(stageId))
    },
    resetHints: () => {
      save.update({ seenHints: [] })
      game?.seenHints.clear()
    },
    multiplayer: action => {
      const profile = () => ({ name: save.data.playerName, skin: save.data.skin, color: save.data.color, headStyle: save.data.headStyle })
      if (!network) return
      if (action === 'open') {
        ui.show('multiplayer')
        void network.loadTransport().then(transport => { ui.setMultiplayerTransport(transport); return network!.prepare() }).catch(error => ui.setMultiplayerStatus('unavailable', String((error as Error).message)))
      } else if (action === 'transport-peer' || action === 'transport-server') {
        network.setTransport(action === 'transport-peer' ? 'peer' : 'server')
        ui.clearMultiplayer(); ui.setMultiplayerTransport(network.currentTransport)
        void network.prepare().catch(error => ui.setMultiplayerStatus('unavailable', String((error as Error).message)))
      } else if (action === 'create-blue' || action === 'create-red') {
        ui.show('multiplayer')
        void network.create(profile(), action.endsWith('red') ? 'red' : 'blue').catch(error => ui.setMultiplayerStatus('error', String((error as Error).message)))
      } else if (action === 'join-blue' || action === 'join-red') {
        const room = document.querySelector<HTMLInputElement>('[data-mp-room]')?.value.trim().toUpperCase() || ''
        if (!/^[A-Z0-9]{5,8}$/.test(room)) {
          ui.setMultiplayerStatus('error', 'invalid_room')
          return
        }
        ui.show('multiplayer')
        void network.join(room, action.endsWith('red') ? 'red' : 'blue', profile()).catch(error => ui.setMultiplayerStatus('error', String((error as Error).message)))
      } else if (action === 'ready') network.ready(true)
      else if (action === 'start') network.start()
      else if (action === 'copy-blue' || action === 'copy-red') void network.copyInvite(action.endsWith('red') ? 'red' : 'blue').then(() => ui.toast('multiplayer.copied', {}, 'good')).catch(() => ui.setMultiplayerStatus('error', 'clipboard_denied'))
      else if (action === 'leave') {
        network.leave(); ui.clearMultiplayer()
        if (game?.isOnline) game.toTitle()
        ui.show('title')
      }
    },
  })
  uiRef = ui
  network = new MultiplayerClient({
    onWelcome: welcome => { ui.setMultiplayerTransport(network!.currentTransport); ui.setMultiplayerWelcome(welcome.team, welcome.host) },
    onState: state => {
      ui.setMultiplayerState(state)
      if (state.phase === 'running' && ui.screen === 'multiplayer') {
        ui.showOnlineLoading()
        void assets.ensure(1)
      }
    },
    onStatus: (status, detail) => ui.setMultiplayerStatus(status, detail),
    onMatchSnapshot: snapshot => {
      if (!game || !network) return
      if (!game.isOnline) {
        window.clearTimeout(deathTimer)
        tuning.activate('run')
        game.startOnline(snapshot, network.currentPlayerId, (angle, boost) => network?.sendInput(angle, boost))
        ui.show('hud'); audio.play('start')
      } else game.applyOnlineSnapshot(snapshot)
      ui.onlineSnapshotReady()
    },
    onMatchEnd: snapshot => {
      if (!game || !network) return
      if (!game.isOnline) game.startOnline(snapshot, network.currentPlayerId, (angle, boost) => network?.sendInput(angle, boost))
      else game.applyOnlineSnapshot(snapshot)
      ui.showOnlineMatch(snapshot)
      audio.setScene('results')
      audio.play(snapshot.winner === network.currentTeam ? 'win' : 'lose')
    },
    onPing: milliseconds => { if (game) game.onlinePing = milliseconds },
    onResync: () => { if (game?.isOnline) game.toTitle(); ui.showOnlineLoading() },
  })
  ui.show('boot')
  applySettings(save.data)

  // The boot UI is already on screen; three.js and the game load as a separate chunk.
  // Stage 0 (title art, HUD icons, menu music) loads alongside the code; later stages stream in
  // the background once the title is up.
  let loaded = 0
  const bootProgress = () => ui.setBootProgress(0.1 + (loaded / 3) * 0.45 + assets.progress(0).ratio * 0.45)
  const track = <T>(p: Promise<T>): Promise<T> => p.then(v => (loaded++, bootProgress(), v))
  const offProgress = assets.onChange(bootProgress)
  ui.setBootProgress(0.1)
  const [{ Game }, { Renderer, suggestQuality }] = await Promise.all([
    track(import('./game/game')),
    track(import('./engine/renderer')),
    track(document.fonts.ready),
    assets.ensure(0),
  ])
  offProgress()
  if (firstRun) {
    save.update({ quality: suggestQuality() })
    ui.refreshSettings()
  }
  const renderer = new Renderer(canvas, save.data.quality)

  const recordLife = (r: LifeResult) => {
    const earned = stardustForLife(r)
    const { records, newBests } = applyLife(save.data.records, r, earned)
    const entry = { name: save.data.playerName, length: r.peakLength, kills: r.kills, seconds: Math.floor(r.seconds), mode: r.mode, at: Date.now() }
    const { board, rank } = insertLife(save.data.lives, entry)
    save.update({ stardust: save.data.stardust + earned, records, lives: board })
    return { earned, newBest: newBests.includes('bestLength') && records.lives > 1, localRank: rank }
  }

  game = new Game(renderer, input, audio, {
    lifeStart: () => {
    },
    lifeEnd: result => {
      const info = recordLife(result)
      match.bestLife = Math.max(match.bestLife, result.peakLength)
      match.earned += info.earned
      const death = { result, earned: info.earned, newBest: info.newBest, localRank: info.localRank }
      if (activeCampaign && !result.final) {
        const stats: CampaignStats = { length: result.finalLength, peak: result.peakLength, kills: result.kills, stars: result.shards, seconds: result.seconds }
        ui.showCampaignResult(false, activeCampaign, stats, 0, campaign.data.unlockedStage)
      } else if (!result.final && result.mode === 'ffa') {
        deathTimer = window.setTimeout(() => ui.showDeath(death), 1100)
      } else if (!result.final) {
        ui.showDeath(death)
        ui.toast('toast.stardust', { n: info.earned }, 'power')
      }
    },
    matchEnd: result => {
      const r = save.data.records
      save.update({ records: { ...r, teamMatches: r.teamMatches + 1, teamWins: r.teamWins + (result.winner === 0 ? 1 : 0) } })
      deathTimer = window.setTimeout(() => {
        audio.setScene('results')
        ui.showMatch(result, match.bestLife, match.earned)
      }, 1300)
    },
    campaignClear: (stage, stats) => {
      const completed = completeCampaignStage(campaign.data, stage, stats)
      campaign.replace(completed.data)
      if (completed.newlyCompleted) save.update({ stardust: save.data.stardust + stage.reward })
      ui.showCampaignResult(true, stage, stats, completed.newlyCompleted ? stage.reward : 0, completed.unlockedStage)
    },
    toast: (key, vars, tone) => ui.toast(key, vars, tone),
    celestial: (kind, added) => ui.celestial(kind, added),
    pickup: kind => ui.pickup(kind),
    shard: () => ui.shard(),
    callout: (key, vars, tier) => ui.callout(key, vars, tier),
    feed: item => ui.feed(item),
    flash: kind => ui.flash(kind, save.data.reducedMotion),
    hint: id => {
      if (!save.data.seenHints.includes(id)) save.update({ seenHints: [...save.data.seenHints, id] })
      ui.showHint(id)
    },
  }, () => ({ name: save.data.playerName, skin: save.data.skin, color: save.data.color, headStyle: save.data.headStyle }))
  game.reducedMotion = save.data.reducedMotion
  game.threatMode = save.data.threatMode
  game.setQuality(save.data.quality)
  for (const id of save.data.seenHints) game.seenHints.add(id as HintId)

  if (import.meta.env.DEV) {
    const { registerGameTuning } = await import('../scripts/manus-tuning/adapter.js')
    await registerGameTuning(tuning)
  }

  const g = game
  const touch = new TouchControls(document.getElementById('ui')!, input)
  const loop = new GameLoop({
    step: dt => g.step(dt),
    render: (alpha, frameSeconds) => {
      input.update()
      if (input.consume('pause') && !ui.back()) {
        if (g.isOnline && ui.screen === 'pause') resume()
        else if (g.mode === 'playing' || (g.mode === 'dead' && ui.screen === 'hud')) pause()
        else if (g.mode === 'paused' && ui.screen === 'pause') resume()
      }
      ui.frame(frameSeconds)
      g.onlineControlsEnabled = ui.screen === 'hud' && network?.isConnected === true && !document.hidden
      loop.paused = g.mode === 'paused'
      g.render(alpha, frameSeconds)
      if (ui.screen === 'hud') ui.updateHud(g.hud(), g, frameSeconds, save.data.reducedMotion)
      touch.sync(ui.screen === 'hud' && g.mode === 'playing')
      input.endFrame()
    },
  })
  loop.start()

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause()
  })
  window.addEventListener('game:pause', pause)
  window.addEventListener('pagehide', () => network?.close())
  window.setTimeout(() => {
    ui.show('title')
    assets.startBackground()
    const invite = new URLSearchParams(location.search).get('match')
    if (invite) {
      ui.show('multiplayer')
      if (network) void network.joinFromLocation({ name: save.data.playerName, skin: save.data.skin, color: save.data.color, headStyle: save.data.headStyle }).catch(error => ui.setMultiplayerStatus('unavailable', String((error as Error).message)))
    }
  }, 250)
  // Debug/test hook (read-only use): smoke tests inspect state through it.
  ;(window as unknown as { __game: unknown }).__game = { game: g, ui, input, save, assets, audio }
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

boot().catch(err => {
  console.error(err)
  const el = document.getElementById('ui')
  if (el) el.innerHTML = `<div class="fatal">Failed to start: ${String((err as Error)?.message ?? err).replace(/[<>&]/g, '')}</div>`
})
