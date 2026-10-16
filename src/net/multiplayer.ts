export type Team = 'blue' | 'red'
export type PlayerSeat = {
  id: string
  slot: number
  name: string
  skin: string
  ready: boolean
  connected: boolean
  host: boolean
}

export type LobbyState = {
  type: 'state'
  protocol: string
  room: string
  seq: number
  phase: 'waiting' | 'running' | 'ended'
  teams: { blue: (PlayerSeat | null)[]; red: (PlayerSeat | null)[] }
  spectators: number
  readyToStart: boolean
  round: { stage: number; arenaRadius: number; scores: { blue: number; red: number } }
}

export type MultiplayerStatus = 'idle' | 'loading' | 'connecting' | 'connected' | 'unavailable' | 'error'
export type MultiplayerCallbacks = {
  onWelcome: (welcome: { room: string; team: Team | 'spectator'; slot: number; host: boolean }) => void
  onState: (state: LobbyState) => void
  onStatus: (status: MultiplayerStatus, detail?: string) => void
}

type Bootstrap = { build: string; signalingUrl: string; iceTransportPolicy?: string }

const tokenKey = (room: string, team: string) => `spaceworm.multiplayer.${room}.${team}`

export class MultiplayerClient {
  private socket: WebSocket | null = null
  private endpoint = ''
  private room = ''
  private team: Team = 'blue'
  private resumeToken = ''
  private reconnectTimer = 0
  private intentionalClose = false
  private profile = { name: 'Stargazer', skin: 'nebula' }
  private lastState: LobbyState | null = null

  constructor(private readonly callbacks: MultiplayerCallbacks) {}

  get currentRoom(): string { return this.room }
  get currentTeam(): Team { return this.team }
  get currentState(): LobbyState | null { return this.lastState }
  get isConnected(): boolean { return this.socket?.readyState === WebSocket.OPEN }

  async create(profile: { name: string; skin: string }, team: Team = 'blue'): Promise<void> {
    this.profile = profile
    await this.loadEndpoint()
    const base = this.endpoint.replace(/^ws/i, 'http').replace(/\/ws\/?$/, '')
    const response = await fetch(`${base}/api/room`, { method: 'POST', headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`room_create_${response.status}`)
    const data = await response.json() as { room?: string }
    if (!data.room) throw new Error('room_create_invalid')
    await this.connect(data.room, team)
  }

  async join(room: string, team: Team, profile: { name: string; skin: string }): Promise<void> {
    this.profile = profile
    await this.loadEndpoint()
    await this.connect(room, team)
  }

  async joinFromLocation(profile: { name: string; skin: string }): Promise<boolean> {
    const params = new URLSearchParams(location.search)
    const room = params.get('match')?.toUpperCase()
    const team = params.get('team') === 'red' ? 'red' : params.get('team') === 'blue' ? 'blue' : null
    if (!room || !team) return false
    try {
      await this.join(room, team, profile)
      return true
    } catch {
      return false
    }
  }

  async loadEndpoint(): Promise<string> {
    if (this.endpoint) return this.endpoint
    this.callbacks.onStatus('loading')
    const configured = (import.meta.env.VITE_MULTIPLAYER_URL as string | undefined)?.trim()
    if (configured) {
      this.endpoint = configured
    } else {
      const url = new URL('multiplayer/bootstrap.json', document.baseURI)
      const response = await fetch(url.toString(), { cache: 'no-store' })
      if (!response.ok) throw new Error('multiplayer_config_missing')
      const config = await response.json() as Bootstrap
      this.endpoint = config.signalingUrl?.trim() || ''
    }
    if (!this.endpoint || !/^wss?:\/\//i.test(this.endpoint)) {
      this.callbacks.onStatus('unavailable', 'Configure a public wss:// multiplayer server first.')
      throw new Error('multiplayer_unavailable')
    }
    return this.endpoint
  }

  private async connect(room: string, team: Team): Promise<void> {
    this.closeSocket()
    this.intentionalClose = false
    this.room = room.toUpperCase()
    this.team = team
    try { this.resumeToken = sessionStorage.getItem(tokenKey(this.room, this.team)) || '' } catch { this.resumeToken = '' }
    this.callbacks.onStatus('connecting')
    const url = new URL(this.endpoint)
    url.searchParams.set('room', this.room)
    url.searchParams.set('team', this.team)
    if (this.resumeToken) url.searchParams.set('resume', this.resumeToken)
    const socket = new WebSocket(url)
    this.socket = socket
    socket.addEventListener('open', () => {
      this.callbacks.onStatus('connected')
      this.send({ type: 'hello', name: this.profile.name, skin: this.profile.skin })
    })
    socket.addEventListener('message', event => this.receive(String(event.data)))
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return
      this.socket = null
      if (!this.intentionalClose && this.room) {
        this.callbacks.onStatus('connecting', 'Connection lost. Retrying…')
        window.clearTimeout(this.reconnectTimer)
        this.reconnectTimer = window.setTimeout(() => { void this.connect(this.room, this.team) }, 1500)
      } else this.callbacks.onStatus('idle')
    })
    socket.addEventListener('error', () => this.callbacks.onStatus('error', 'Could not reach the multiplayer server.'))
  }

  private receive(raw: string): void {
    try {
      const message = JSON.parse(raw) as Record<string, unknown>
      if (message.type === 'welcome') {
        const team = message.team === 'red' || message.team === 'blue' ? message.team : 'spectator'
        this.resumeToken = typeof message.resumeToken === 'string' ? message.resumeToken : ''
        if (this.resumeToken && team !== 'spectator') {
          try { sessionStorage.setItem(tokenKey(this.room, team), this.resumeToken) } catch { /* storage is optional */ }
        }
        this.callbacks.onWelcome({ room: this.room, team, slot: Number(message.slot ?? -1), host: message.host === true })
        if (message.state && typeof message.state === 'object') this.receive(JSON.stringify(message.state))
        return
      }
      if (message.type === 'state' && message.protocol === 'spaceworm-3v3-v1') {
        this.lastState = message as unknown as LobbyState
        this.callbacks.onState(this.lastState)
        return
      }
      if (message.type === 'error') this.callbacks.onStatus('error', String(message.message || message.code || 'Network error'))
    } catch {
      this.callbacks.onStatus('error', 'Invalid server message')
    }
  }

  ready(value: boolean): void { this.send({ type: 'ready', value }) }
  start(): void { this.send({ type: 'start' }) }
  leave(): void {
    this.intentionalClose = true
    this.send({ type: 'leave' })
    this.closeSocket()
    this.room = ''
    this.lastState = null
    this.callbacks.onStatus('idle')
  }

  invite(team: Team): string {
    const url = new URL(location.href)
    url.search = ''
    url.searchParams.set('match', this.room)
    url.searchParams.set('team', team)
    return url.toString()
  }

  async copyInvite(team: Team): Promise<void> {
    const text = this.invite(team)
    await navigator.clipboard.writeText(text)
  }

  private send(payload: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload))
  }

  private closeSocket(): void {
    window.clearTimeout(this.reconnectTimer)
    const socket = this.socket
    this.socket = null
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close()
  }
}
