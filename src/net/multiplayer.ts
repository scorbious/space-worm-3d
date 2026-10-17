import type { HeadStyle, WormColor } from '../game/appearance'
export const ONLINE_PROTOCOL = 'spaceworm-3v3-v2'
export type Team = 'blue' | 'red'
export type PlayerSeat = { id: string; slot: number; name: string; skin: string; ready: boolean; connected: boolean; host: boolean }
export type LobbyState = {
  type: 'state'; protocol: string; room: string; seq: number; phase: 'waiting' | 'running' | 'ended'
  teams: { blue: (PlayerSeat | null)[]; red: (PlayerSeat | null)[] }; spectators: number; readyToStart: boolean; development?: boolean
  round: { stage: number; arenaRadius: number; scores: { blue: number; red: number } }
}
export type OnlinePlayer = {
  id: string; team: Team; slot: number; name: string; skin: string; color: WormColor; headStyle: HeadStyle
  connected: boolean; alive: boolean; xs: number[]; zs: number[]; angle: number; length: number; boosting: boolean
  score: number; kills: number; inputSeq: number; generation: number; respawnIn: number; spawnGrace: number
}
export type OnlineFood = { id: number; x: number; z: number; value: number; color: number }
export type OnlineEvent = {
  id: number; tick: number; type: 'eat' | 'death' | 'spawn' | 'stage' | 'end'; playerId?: string; killerId?: string | null
  cause?: 'worm' | 'self' | 'rim' | 'head'; x?: number; z?: number; foodId?: number; value?: number; color?: number
  stage?: number; radius?: number; winner?: Team | 'draw'
}
export type OnlineSnapshot = {
  type: 'match' | 'matchEnd'; protocol: string; tick: number; seq: number; phase: 'running' | 'ended'; timeLeft: number
  arena: { stage: number; radius: number }; scores: { blue: number; red: number }
  players: OnlinePlayer[]; food: OnlineFood[]; events: OnlineEvent[]; winner?: Team | 'draw'
}
export type OnlineMatchEnd = OnlineSnapshot & { type: 'matchEnd'; winner: Team | 'draw' }
export type MultiplayerStatus = 'idle' | 'loading' | 'connecting' | 'reconnecting' | 'connected' | 'unavailable' | 'error'
export type MultiplayerCallbacks = {
  onWelcome: (welcome: { room: string; playerId: string; team: Team | 'spectator'; slot: number; host: boolean }) => void
  onState: (state: LobbyState) => void
  onStatus: (status: MultiplayerStatus, detail?: string) => void
  onMatchSnapshot: (snapshot: OnlineSnapshot) => void
  onMatchEnd: (snapshot: OnlineMatchEnd) => void
  onPing?: (milliseconds: number) => void
}
export type OnlineProfile = { name: string; skin: string; color?: WormColor; headStyle?: HeadStyle }
const tokenKey = (room: string, team: string) => `spaceworm.multiplayer.v2.${room}.${team}`
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const number = (v: unknown, min = 0, max = 1e9): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const integer = (v: unknown, min = 0, max = 1e9): v is number => number(v, min, max) && Number.isInteger(v)
const text = (v: unknown, max = 24): v is string => typeof v === 'string' && v.length <= max
const team = (v: unknown): v is Team => v === 'blue' || v === 'red'
const scores = (v: unknown) => object(v) && number(v.blue) && number(v.red)
const phase = (v: unknown) => ['waiting', 'running', 'ended'].includes(String(v))
export function isLobbyState(v: unknown): v is LobbyState {
  if (!object(v) || v.protocol !== ONLINE_PROTOCOL || v.type !== 'state' || !text(v.room, 8) || !integer(v.seq) || !phase(v.phase) ||
      typeof v.readyToStart !== 'boolean' || !integer(v.spectators, 0, 12) || !object(v.round) || !scores(v.round.scores) ||
      !integer(v.round.stage, 1, 5) || !number(v.round.arenaRadius, 64, 512) || !object(v.teams)) return false
  const teams = v.teams
  return ['blue', 'red'].every(t => Array.isArray(teams[t]) && teams[t].length === 3 && teams[t].every((p: unknown) =>
    p === null || (object(p) && text(p.id) && text(p.name, 16) && text(p.skin) && integer(p.slot, 0, 2) &&
      typeof p.ready === 'boolean' && typeof p.connected === 'boolean' && typeof p.host === 'boolean')))
}
export function isOnlineSnapshot(v: unknown): v is OnlineSnapshot {
  if (!object(v) || v.protocol !== ONLINE_PROTOCOL || !['match', 'matchEnd'].includes(String(v.type)) || !integer(v.tick) || !integer(v.seq) ||
      !['running', 'ended'].includes(String(v.phase)) || !number(v.timeLeft, 0, 600) || !object(v.arena) || !integer(v.arena.stage, 1, 5) ||
      !number(v.arena.radius, 64, 512) || !scores(v.scores) || !Array.isArray(v.players) || v.players.length > 6 ||
      !Array.isArray(v.food) || v.food.length > 800 || !Array.isArray(v.events) || v.events.length > 128) return false
  if (v.type === 'matchEnd' && (v.phase !== 'ended' || !['blue', 'red', 'draw'].includes(String(v.winner)))) return false
  const playerIds = new Set<string>()
  const validPlayers = v.players.every(p => {
    if (!object(p) || !text(p.id) || playerIds.has(p.id) || !team(p.team) || !integer(p.slot, 0, 2) || !text(p.name, 16) || !text(p.skin) ||
        !['skin', 'cyan', 'pink', 'gold', 'green', 'violet', 'orange', 'ice', 'dark'].includes(String(p.color)) ||
        !['round', 'crystal', 'robot', 'comet', 'dragon', 'cat', 'cyclops', 'manta'].includes(String(p.headStyle)) ||
        typeof p.alive !== 'boolean' || typeof p.connected !== 'boolean' || typeof p.boosting !== 'boolean' || !integer(p.length, 1, 240) ||
        !Array.isArray(p.xs) || !Array.isArray(p.zs) || p.xs.length !== p.length || p.zs.length !== p.length ||
        !p.xs.every(x => number(x, -1024, 1024)) || !p.zs.every(z => number(z, -1024, 1024)) || !number(p.angle, -Math.PI - 0.01, Math.PI + 0.01) ||
        !number(p.score) || !integer(p.kills) || !integer(p.inputSeq, -1, 0x7fffffff) || !integer(p.generation, 1) ||
        !number(p.respawnIn, 0, 3) || !number(p.spawnGrace, 0, 2)) return false
    playerIds.add(p.id); return true
  })
  return validPlayers && v.food.every(f => object(f) && integer(f.id) && number(f.x, -512, 512) && number(f.z, -512, 512) &&
    integer(f.value, 1, 2) && integer(f.color, 0, 0xffffff)) && v.events.every(e => object(e) && integer(e.id, 1) && integer(e.tick) &&
      ['eat', 'death', 'spawn', 'stage', 'end'].includes(String(e.type)) &&
      (e.playerId === undefined || text(e.playerId)) && (e.killerId == null || text(e.killerId)) &&
      (e.x === undefined || number(e.x, -1024, 1024)) && (e.z === undefined || number(e.z, -1024, 1024)) &&
      (e.color === undefined || integer(e.color, 0, 0xffffff)) && (e.value === undefined || integer(e.value, 1, 2)) &&
      (e.cause === undefined || ['worm', 'self', 'rim', 'head'].includes(String(e.cause))))
}

export class MultiplayerClient {
  private socket: WebSocket | null = null
  private endpoint = ''
  private room = ''
  private team: Team = 'blue'
  private resumeToken = ''
  private playerId = ''
  private reconnectTimer = 0
  private pingTimer = 0
  private connectTimer = 0
  private intentionalClose = false
  private profile: OnlineProfile = { name: 'Stargazer', skin: 'nebula' }
  private lastState: LobbyState | null = null
  private lastSnapshotSeq = -1
  private inputSeq = 0
  private lastInputSent = -Infinity
  private retries = 0
  private lostAt = 0
  private generation = 0
  private pendingPing = 0
  ping = 0
  constructor(private readonly callbacks: MultiplayerCallbacks) {}
  get currentRoom(): string { return this.room }
  get currentTeam(): Team { return this.team }
  get currentPlayerId(): string { return this.playerId }
  get currentState(): LobbyState | null { return this.lastState }
  get isConnected(): boolean { return this.socket?.readyState === WebSocket.OPEN }

  async create(profile: OnlineProfile, team: Team = 'blue'): Promise<void> {
    const generation = ++this.generation
    this.leaveConnection(); this.profile = profile
    await this.loadEndpoint()
    const base = this.endpoint.replace(/^ws/i, 'http').replace(/\/ws\/?$/, '')
    const response = await fetch(`${base}/api/room`, { method: 'POST', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error('room_create_failed')
    const data: unknown = await response.json()
    if (!object(data) || data.protocol !== ONLINE_PROTOCOL || !text(data.room, 8) || !/^[A-Z0-9]{5,8}$/.test(data.room)) throw new Error('protocol_mismatch')
    if (generation === this.generation) this.connectRoom(data.room, team)
  }
  async join(room: string, team: Team, profile: OnlineProfile): Promise<void> {
    if (!/^[A-Z0-9]{5,8}$/.test(room.toUpperCase())) throw new Error('invalid_room')
    const generation = ++this.generation
    this.leaveConnection(); this.profile = profile
    await this.loadEndpoint()
    if (generation === this.generation) this.connectRoom(room, team)
  }
  async joinFromLocation(profile: OnlineProfile): Promise<boolean> {
    const params = new URLSearchParams(location.search), room = params.get('match')?.toUpperCase()
    if (!room) return false
    await this.join(room, params.get('team') === 'red' ? 'red' : 'blue', profile)
    return true
  }
  async loadEndpoint(): Promise<string> {
    if (this.endpoint) return this.endpoint
    this.callbacks.onStatus('loading')
    try {
      const configured = (import.meta.env.VITE_MULTIPLAYER_URL as string | undefined)?.trim()
      let endpoint = configured || ''
      if (!endpoint) {
        const response = await fetch(new URL('multiplayer/bootstrap.json', document.baseURI), { cache: 'no-store', signal: AbortSignal.timeout(8000) })
        if (!response.ok) throw new Error('multiplayer_unavailable')
        const config: unknown = await response.json()
        if (object(config) && typeof config.signalingUrl === 'string') endpoint = config.signalingUrl.trim()
      }
      const url = new URL(endpoint)
      if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || (location.protocol === 'https:' && url.protocol !== 'wss:')) throw new Error('multiplayer_unavailable')
      this.endpoint = url.toString()
      return this.endpoint
    } catch {
      this.callbacks.onStatus('unavailable', 'multiplayer_unavailable')
      throw new Error('multiplayer_unavailable')
    }
  }
  private connectRoom(room: string, team: Team): void {
    this.intentionalClose = false; this.room = room.toUpperCase(); this.team = team
    this.lastState = null; this.playerId = ''; this.lastSnapshotSeq = -1; this.inputSeq = 0; this.lostAt = 0; this.retries = 0
    try { this.resumeToken = sessionStorage.getItem(tokenKey(this.room, this.team)) || '' } catch { this.resumeToken = '' }
    this.connectSocket()
  }
  private connectSocket(): void {
    this.closeSocket()
    this.callbacks.onStatus(this.lostAt ? 'reconnecting' : 'connecting')
    const url = new URL(this.endpoint)
    url.searchParams.set('room', this.room); url.searchParams.set('team', this.team); url.searchParams.set('protocol', ONLINE_PROTOCOL)
    if (this.resumeToken) url.searchParams.set('resume', this.resumeToken)
    const socket = new WebSocket(url); this.socket = socket
    this.connectTimer = window.setTimeout(() => { if (this.socket === socket) socket.close() }, 8000)
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return
      window.clearTimeout(this.connectTimer)
      this.send({ type: 'hello', ...this.profile })
      this.pingTimer = window.setInterval(() => {
        if (this.pendingPing && Date.now() - this.pendingPing > 8000) { socket.close(); return }
        if (this.pendingPing) return
        this.pendingPing = Date.now(); this.send({ type: 'ping', t: this.pendingPing })
      }, 2000)
    })
    socket.addEventListener('message', event => { if (this.socket === socket) this.receive(String(event.data)) })
    socket.addEventListener('close', event => {
      if (this.socket !== socket) return
      this.socket = null; window.clearInterval(this.pingTimer); window.clearTimeout(this.connectTimer); this.pendingPing = 0
      if (event.code === 4001 || event.code === 4002 || event.code === 1008 || event.code === 1013) {
        this.intentionalClose = true
        this.callbacks.onStatus('error', event.code === 4002 ? 'protocol_mismatch' : event.code === 4001 ? 'seat_replaced' : 'connection_rejected')
        return
      }
      if (!this.intentionalClose && this.room) {
        this.lostAt ||= Date.now()
        if (Date.now() - this.lostAt >= 60_000) { this.callbacks.onStatus('error', 'resume_expired'); return }
        this.callbacks.onStatus('reconnecting')
        this.reconnectTimer = window.setTimeout(() => this.connectSocket(), Math.min(5000, 500 * 2 ** Math.min(4, this.retries++)))
      } else this.callbacks.onStatus('idle')
    })
    socket.addEventListener('error', () => { if (this.socket === socket) this.callbacks.onStatus('reconnecting') })
  }
  private receive(raw: string): void {
    if (raw.length > 512 * 1024) { this.callbacks.onStatus('error', 'invalid_server_message'); return }
    try {
      const m: unknown = JSON.parse(raw)
      if (!object(m) || m.protocol !== ONLINE_PROTOCOL) throw new Error('protocol_mismatch')
      if (m.type === 'welcome') {
        if (!isLobbyState(m.state) || !text(m.playerId) || !text(m.resumeToken, 80) || !integer(m.slot, -1, 2) ||
            (!team(m.team) && m.team !== 'spectator')) throw new Error('invalid_server_message')
        this.playerId = m.playerId; this.resumeToken = m.resumeToken; this.lostAt = 0; this.retries = 0
        if (this.resumeToken && team(m.team)) { try { sessionStorage.setItem(tokenKey(this.room, m.team), this.resumeToken) } catch { /* optional storage */ } }
        this.callbacks.onWelcome({ room: this.room, playerId: this.playerId, team: m.team, slot: m.slot, host: m.host === true })
        this.callbacks.onStatus('connected'); this.lastState = m.state; this.callbacks.onState(m.state)
      } else if (isLobbyState(m)) {
        if (!this.lastState || m.seq > this.lastState.seq) { this.lastState = m; this.callbacks.onState(m) }
      } else if (isOnlineSnapshot(m)) {
        if (m.seq <= this.lastSnapshotSeq) return
        this.lastSnapshotSeq = m.seq
        const p = m.players.find(p => p.id === this.playerId)
        if (p) this.inputSeq = Math.max(this.inputSeq, p.inputSeq + 1)
        if (m.type === 'matchEnd') this.callbacks.onMatchEnd(m as OnlineMatchEnd)
        else this.callbacks.onMatchSnapshot(m)
      } else if (m.type === 'pong' && m.t === this.pendingPing && this.pendingPing) {
        this.ping = Math.max(0, Date.now() - this.pendingPing); this.pendingPing = 0; this.callbacks.onPing?.(this.ping)
      } else if (m.type === 'error' && text(m.code, 64)) this.callbacks.onStatus('error', m.code)
      else throw new Error('invalid_server_message')
    } catch (e) { this.callbacks.onStatus('error', (e as Error).message === 'protocol_mismatch' ? 'protocol_mismatch' : 'invalid_server_message') }
  }
  sendInput(targetAngle: number, boost: boolean): void {
    const now = performance.now()
    if (!this.playerId || !this.isConnected || now - this.lastInputSent < 50 || !Number.isFinite(targetAngle)) return
    this.lastInputSent = now
    this.send({ type: 'input', targetAngle: Math.atan2(Math.sin(targetAngle), Math.cos(targetAngle)), boost, seq: this.inputSeq++ })
  }
  ready(value: boolean): void { this.send({ type: 'ready', value }) }
  start(): void { this.send({ type: 'start' }) }
  leave(): void {
    ++this.generation
    this.send({ type: 'leave' }); this.leaveConnection()
    try { sessionStorage.removeItem(tokenKey(this.room, this.team)) } catch { /* optional storage */ }
    this.room = ''; this.lastState = null; this.playerId = ''; this.resumeToken = ''
    this.callbacks.onStatus('idle')
  }
  invite(team: Team): string {
    const url = new URL(location.href); url.search = ''; url.searchParams.set('match', this.room); url.searchParams.set('team', team)
    return url.toString()
  }
  async copyInvite(team: Team): Promise<void> { await navigator.clipboard.writeText(this.invite(team)) }
  private send(payload: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN && this.socket.bufferedAmount < 64 * 1024) this.socket.send(JSON.stringify({ ...payload, protocol: ONLINE_PROTOCOL }))
  }
  private leaveConnection(): void { this.intentionalClose = true; this.send({ type: 'leave' }); this.closeSocket() }
  private closeSocket(): void {
    window.clearTimeout(this.reconnectTimer); window.clearInterval(this.pingTimer); window.clearTimeout(this.connectTimer); this.pendingPing = 0
    const socket = this.socket; this.socket = null
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close()
  }
}
