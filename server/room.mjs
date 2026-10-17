import { randomBytes } from 'node:crypto'
import { Match, PROTOCOL } from './match.mjs'

export { PROTOCOL }
export const TEAMS = ['blue', 'red']
export const TEAM_SIZE = 3
export const RECONNECT_GRACE_MS = 60_000

export function cleanRoomCode(value) {
  const code = String(value || '').toUpperCase()
  return /^[A-Z0-9]{5,8}$/.test(code) ? code : ''
}

export function newRoomCode() {
  return randomBytes(4).toString('base64url').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 6).padEnd(6, '7')
}

export function token() {
  return randomBytes(18).toString('base64url')
}

export function cleanName(value) {
  const name = String(value || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16)
  return name || 'Stargazer'
}

export function cleanSkin(value) {
  const skin = String(value || '').replace(/[^a-z0-9-]/gi, '').slice(0, 24)
  return skin || 'nebula'
}

export class Room {
  constructor(code, options = {}) {
    this.code = code
    this.createdAt = Date.now()
    this.lastActivity = Date.now()
    this.options = options
    this.match = null
    this.phase = 'waiting'
    this.hostId = ''
    this.seq = 0
    this.players = new Map()
    this.seats = { blue: Array(TEAM_SIZE).fill(null), red: Array(TEAM_SIZE).fill(null) }
    this.observers = new Set()
    this.scores = { blue: 0, red: 0 }
    this.stage = 1
    this.arenaRadius = 128
  }

  touch() {
    this.lastActivity = Date.now()
  }

  connectedCount() {
    return [...this.players.values()].filter(player => player.socket).length
  }

  isReadyToStart() {
    const minimum = this.options.allowSmallMatch ? 1 : TEAM_SIZE
    return this.phase === 'waiting' && TEAMS.every(team => {
      const seated = this.seats[team].filter(Boolean)
      return seated.length >= minimum && seated.every(player => player.ready && player.socket)
    })
  }

  claim(socket, desiredTeam, resumeToken) {
    this.touch()
    for (const player of this.players.values()) {
      if (resumeToken && player.resumeToken === resumeToken && (!player.disconnectedAt || Date.now() - player.disconnectedAt <= RECONNECT_GRACE_MS)) {
        if (player.socket && player.socket !== socket) player.socket.close(4001, 'seat resumed elsewhere')
        player.socket = socket
        player.disconnectedAt = 0
        socket.player = player
        this.match?.setConnected(player.id, true)
        return player
      }
    }

    const team = TEAMS.includes(desiredTeam) ? desiredTeam : 'blue'
    const slot = this.seats[team].findIndex(player => !player)
    if (slot < 0 || this.phase !== 'waiting') {
      this.observers.add(socket)
      socket.player = null
      return null
    }
    const player = {
      id: token().slice(0, 10),
      resumeToken: token(),
      team,
      slot,
      name: 'Stargazer',
      skin: 'nebula',
      color: 'skin',
      headStyle: 'round',
      ready: false,
      socket,
      disconnectedAt: 0,
    }
    this.seats[team][slot] = player
    this.players.set(player.id, player)
    if (!this.hostId) this.hostId = player.id
    socket.player = player
    return player
  }

  setProfile(player, name, skin, color, headStyle) {
    if (!player || this.phase !== 'waiting') return
    player.name = cleanName(name)
    player.skin = cleanSkin(skin)
    player.color = ['skin', 'cyan', 'pink', 'gold', 'green', 'violet', 'orange', 'ice', 'dark'].includes(color) ? color : 'skin'
    player.headStyle = ['round', 'crystal', 'robot', 'comet', 'dragon', 'cat', 'cyclops', 'manta'].includes(headStyle) ? headStyle : 'round'
    this.touch()
  }

  setReady(player, value) {
    if (!player || this.phase !== 'waiting' || typeof value !== 'boolean') return false
    player.ready = value
    this.touch()
    return true
  }

  start(player) {
    if (!player || player.id !== this.hostId || this.phase !== 'waiting' || !this.isReadyToStart()) return false
    const seed = [...this.code].reduce((a, c) => Math.imul(a, 31) + c.charCodeAt(0), 7) >>> 0
    this.match = new Match([...this.players.values()], { seed, ...this.options.matchOptions })
    this.phase = 'running'
    this.touch()
    return true
  }

  release(socket) {
    this.touch()
    if (socket.player && socket.player.socket === socket) {
      socket.player.socket = null
      socket.player.disconnectedAt = Date.now()
      this.match?.setConnected(socket.player.id, false)
    } else {
      this.observers.delete(socket)
    }
  }

  leave(socket) {
    const player = socket.player
    if (player && player.socket === socket) this.removePlayer(player)
    this.observers.delete(socket)
    socket.player = null
    this.touch()
  }

  removePlayer(player) {
    this.seats[player.team][player.slot] = null
    this.players.delete(player.id)
    this.match?.removePlayer(player.id)
    if (player.id === this.hostId) this.hostId = [...this.players.values()].find(p => p.socket)?.id || [...this.players.keys()][0] || ''
  }

  expireDisconnected(now = Date.now()) {
    for (const player of [...this.players.values()]) {
      if (!player.socket && player.disconnectedAt && now - player.disconnectedAt > RECONNECT_GRACE_MS) {
        this.removePlayer(player)
      }
    }
    return this.players.size === 0 && this.observers.size === 0 && now - this.lastActivity > 10 * 60_000
  }

  state() {
    this.seq += 1
    const teamState = Object.fromEntries(TEAMS.map(team => [team, this.seats[team].map((player, slot) => player ? {
      id: player.id,
      slot,
      name: player.name,
      skin: player.skin,
      ready: player.ready,
      connected: Boolean(player.socket),
      host: player.id === this.hostId,
    } : null)]))
    return {
      type: 'state',
      protocol: PROTOCOL,
      room: this.code,
      seq: this.seq,
      phase: this.phase,
      teams: teamState,
      spectators: this.observers.size,
      readyToStart: this.isReadyToStart(),
      development: Boolean(this.options.allowSmallMatch),
      round: { stage: this.match?.stage ?? this.stage, arenaRadius: this.match?.arenaRadius ?? this.arenaRadius, scores: { ...(this.match?.scores ?? this.scores) } },
    }
  }
}
