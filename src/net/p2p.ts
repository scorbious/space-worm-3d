import { FirebaseSignaling, randomId, type Signal } from './firebaseSignaling'
import { ONLINE_PROTOCOL, type LobbyState, type MultiplayerCallbacks, type OnlineMatchEnd, type OnlineProfile, type OnlineSnapshot, type PlayerSeat, type Team } from './multiplayer'
import { activePeers, authorizedMessage, frameMessage, PEER_PROTOCOL, PeerAssembler, selectTransfer, SnapshotStream, type HostLease, type PeerMessage, type PeerPresence } from './p2pProtocol'
import { PeerSimulation, type AuthoritativePeerSimulation } from './peerSimulation'

type Connection = { peer: PeerPresence; id: string; epoch: number; pc: RTCPeerConnection; channel: RTCDataChannel | null; assembler: PeerAssembler;
  candidates: RTCIceCandidateInit[]; createdAt: number; frameId: number; pendingPing: number }
export function peerIceServers(env: Record<string, unknown>): RTCIceServer[] {
  // STUN is discovery, not a relay. Restrictive NATs need a user-provided TURN service or server mode.
  const configured = env.VITE_PEER_STUN_URLS
  const urls = typeof configured === 'string' && configured.trim() ? configured.split(',').map(s => s.trim()) : ['stun:stun.l.google.com:19302']
  if (urls.some(url => !/^stuns?:[^\s]+$/.test(url))) throw new Error('peer_invalid_stun')
  return [{ urls }]
}
/** Optional casual P2P. Firebase only signals; the elected browser runs the server's pure Match engine.
 * This is NOT anti-cheat: an elected host can alter snapshots or its own browser code.
 */
export class PeerClient {
  private readonly signaling: FirebaseSignaling
  private connections = new Map<string, Connection>()
  private orphanCandidates = new Map<string, RTCIceCandidateInit[]>()
  private peers: PeerPresence[] = []
  private lease: HostLease | null = null
  private simulation: AuthoritativePeerSimulation | null = null
  private latest: OnlineSnapshot | null = null
  private snapshotEpoch = 0
  private migrationUntil = 0
  private previousEpoch = 0
  private migrationSnapshot: OnlineSnapshot | null = null
  private loop: ReturnType<typeof setInterval> | undefined
  private closed = false
  private lobbySeq = 0
  private inputSeq = 0
  private lastInputAt = -Infinity
  private lastLobbyAt = 0
  private lastPingAt = 0
  private lastStatus = ''
  private iceServers: RTCIceServer[] = []
  private startPending = false
  private readonly stream = new SnapshotStream()
  private noticeUntil = 0
  private noticeCode = ''
  private fatalError = ''
  ping = 0
  constructor(private readonly callbacks: MultiplayerCallbacks) {
    this.signaling = new FirebaseSignaling({
      presence: (peers, lease) => this.presence(peers, lease),
      signal: (kind, signal) => { void this.signal(kind, signal).catch(() => this.status('error', 'peer_connection_failed')) },
      connected: connected => { if (connected) this.fatalError = ''; else if (!this.closed) this.status('waiting', 'peer_signaling_offline') },
      error: code => { if (!this.closed) { this.fatalError = code; this.status('error', code) } },
    })
  }
  get currentRoom(): string { return this.signaling.room }
  get currentPlayerId(): string { return this.signaling.peerId }
  get isHost(): boolean { return this.lease?.peerId === this.currentPlayerId }
  get isConnected(): boolean {
    if (!this.hasLease()) return false
    return this.isHost || this.connectedPeer(this.lease!.peerId)
  }
  private hasLease(): boolean {
    return !this.closed && this.signaling.connected && !!this.lease && this.lease.expiresAt > this.signaling.now() + 1000 && this.lease.roomExpiresAt > this.signaling.now()
  }
  async open(room: string | null, team: Team, profile: OnlineProfile): Promise<void> {
    this.iceServers = peerIceServers(import.meta.env)
    this.status('connecting')
    await this.signaling.open(room, team, profile)
    if (this.closed) return
    this.loop = setInterval(() => this.tick(), 50)
    this.tick()
  }
  private status(status: Parameters<MultiplayerCallbacks['onStatus']>[0], detail = ''): void {
    if (detail === 'peer_migrated' || detail === 'peer_resync') { this.noticeCode = detail; this.noticeUntil = this.signaling.now() + 12000 }
    if (status === 'connected' && !detail && this.noticeUntil > this.signaling.now()) detail = this.noticeCode
    const key = `${status}/${detail}`
    if (key !== this.lastStatus && !this.closed) { this.lastStatus = key; this.callbacks.onStatus(status, detail) }
  }
  private presence(peers: PeerPresence[], lease: HostLease | null): void {
    if (this.closed) return
    const previous = this.lease
    this.peers = peers; this.lease = lease
    if (lease && (previous?.epoch !== lease.epoch || previous?.peerId !== lease.peerId)) {
      this.connections.forEach(c => this.drop(c)); this.connections.clear(); this.orphanCandidates.clear()
      this.simulation = null
      this.previousEpoch = previous?.epoch || Math.max(1, lease.epoch - 1)
      this.migrationUntil = 0
      if (this.isHost && lease.phase !== 'waiting') {
        this.migrationSnapshot = this.snapshotEpoch === this.previousEpoch ? this.latest : null
        this.migrationUntil = this.signaling.now() + (this.migrationSnapshot ? 500 : 10000)
        this.status('waiting', 'peer_migrating')
      }
    }
    this.emitLobby()
  }
  private occupied(): PeerPresence[] { return activePeers(this.peers, this.signaling.now()) }
  private connectedPeer(id: string): boolean {
    if (id === this.currentPlayerId) return this.hasLease()
    const c = this.connections.get(id)
    return c?.pc.connectionState === 'connected' && c.channel?.readyState === 'open'
  }
  private lobby(): LobbyState {
    const teams: LobbyState['teams'] = { blue: [null, null, null], red: [null, null, null] }
    const peers = this.occupied()
    let seated = 0
    for (const team of ['blue', 'red'] as const) {
      const roster = this.lease?.phase !== 'waiting' && this.latest ? this.latest.players.filter(p => p.team === team) : peers.filter(p => p.team === team).slice(0, 3).map((p, slot) => ({ ...p, id: p.peerId, slot }))
      for (const p of roster) {
        const live = peers.find(peer => peer.peerId === p.id)
        const seat: PlayerSeat = { id: p.id, slot: p.slot, name: p.name, skin: p.skin, ready: live?.ready || false,
          connected: this.isHost ? !!live && this.connectedPeer(p.id) : !!live, host: p.id === this.lease?.peerId }
        teams[team][p.slot] = seat; seated++
      }
    }
    const seats = [...teams.blue, ...teams.red].filter((p): p is PlayerSeat => !!p)
    const readyToStart = teams.blue.some(Boolean) && teams.red.some(Boolean) && seats.every(p => p.connected && (p.ready || p.host))
    return { type: 'state', protocol: ONLINE_PROTOCOL, room: this.currentRoom, seq: ++this.lobbySeq,
      phase: this.lease?.phase || 'waiting', teams, spectators: Math.min(12, Math.max(0, peers.length - seated)), readyToStart,
      round: { stage: this.latest?.arena.stage || 1, arenaRadius: this.latest?.arena.radius || 128, scores: this.latest?.scores || { blue: 0, red: 0 } } }
  }
  private emitLobby(): void {
    if (!this.currentRoom) return
    const state = this.lobby()
    const own = (['blue', 'red'] as const).flatMap(team => state.teams[team].flatMap(p => p?.id === this.currentPlayerId ? [{ team, slot: p.slot }] : []))[0]
    this.callbacks.onWelcome({ room: this.currentRoom, playerId: this.currentPlayerId, team: own?.team || 'spectator', slot: own?.slot ?? -1, host: this.isHost })
    this.callbacks.onState(state)
    if (this.isHost && this.hasLease()) this.broadcast({ version: PEER_PROTOCOL, epoch: this.lease!.epoch, kind: 'lobby', payload: state })
  }
  private tick(): void {
    if (this.closed) return
    if (this.fatalError) { this.status('error', this.fatalError); return }
    const now = this.signaling.now()
    if (!this.hasLease()) { this.status('waiting', this.lease?.roomExpiresAt && this.lease.roomExpiresAt <= now ? 'peer_room_expired' : 'peer_migrating'); return }
    if (this.isHost) {
      for (const peer of this.occupied()) {
        if (peer.peerId === this.currentPlayerId) continue
        const c = this.connections.get(peer.peerId)
        if (c && (c.pc.connectionState === 'failed' || c.channel?.readyState === 'closed' || (c.channel?.readyState !== 'open' && now - c.createdAt > 12000))) {
          this.drop(c); this.connections.delete(peer.peerId)
        }
        if (!this.connections.has(peer.peerId)) void this.offer(peer).catch(() => this.status('error', 'peer_connection_failed'))
      }
      const active = new Set(this.occupied().map(p => p.peerId))
      for (const [id, c] of this.connections) if (!active.has(id)) { this.drop(c); this.connections.delete(id) }
      if (this.migrationUntil && now >= this.migrationUntil) this.finishMigration()
      if (this.simulation && !this.migrationUntil && !this.startPending) {
        for (const p of this.latest?.players || []) this.simulation.setConnected(p.id, active.has(p.id) && this.connectedPeer(p.id))
        if (this.simulation.phase === 'running') {
          this.simulation.step()
          // Same 20 Hz authoritative simulation / 10 Hz snapshots as the WebSocket server.
          if (!this.latest || this.simulation.phase !== 'running' || Math.round(now / 50) % 2 === 0) this.publish(this.simulation.snapshot())
        }
      }
    }
    if (this.isConnected && !this.migrationUntil) this.status('connected')
    else if (!this.migrationUntil) this.status('waiting')
    if (now - this.lastLobbyAt >= 2000) { this.lastLobbyAt = now; this.emitLobby() }
    if (now - this.lastPingAt >= 2000) {
      this.lastPingAt = now
      if (!this.isHost) {
        const c = this.connections.get(this.lease!.peerId)
        if (c && !c.pendingPing) { c.pendingPing = now; this.send(c, { version: PEER_PROTOCOL, epoch: this.lease!.epoch, kind: 'ping', payload: now }) }
        else if (c && now - c.pendingPing > 8000) { c.channel?.close(); c.pendingPing = 0 }
      }
    }
  }
  private connection(peer: PeerPresence, id: string, epoch: number): Connection {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    const c: Connection = { peer, id, epoch, pc, channel: null, assembler: new PeerAssembler(), candidates: this.orphanCandidates.get(id) || [],
      createdAt: this.signaling.now(), frameId: 0, pendingPing: 0 }
    this.orphanCandidates.delete(id); this.connections.set(peer.peerId, c)
    pc.onicecandidate = event => {
      if (event.candidate && this.validConnection(c)) void this.signaling.send('candidates', peer, id, epoch, { candidate: event.candidate.toJSON() }).catch(() => this.status('error', 'peer_rules_denied'))
    }
    pc.ondatachannel = event => this.channel(c, event.channel)
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') this.status('waiting', 'peer_connection_failed') }
    return c
  }
  private validConnection(c: Connection): boolean { return !this.closed && this.connections.get(c.peer.peerId) === c && c.epoch === this.lease?.epoch }
  private async offer(peer: PeerPresence): Promise<void> {
    if (!this.hasLease() || !this.isHost || this.connections.has(peer.peerId)) return
    const c = this.connection(peer, randomId('c'), this.lease!.epoch)
    this.channel(c, c.pc.createDataChannel('spaceworm', { ordered: true }))
    const offer = await c.pc.createOffer()
    if (!this.validConnection(c)) return
    await c.pc.setLocalDescription(offer)
    if (this.validConnection(c)) await this.signaling.send('offers', peer, c.id, c.epoch, { sdp: { type: 'offer', sdp: offer.sdp } })
  }
  private async signal(kind: 'offers' | 'answers' | 'candidates', s: Signal): Promise<void> {
    if (!this.hasLease() || s.epoch !== this.lease!.epoch) return
    const peer = this.peers.find(p => p.peerId === s.from && p.uid === s.fromUid)
    if (!peer || (this.isHost ? kind === 'offers' : s.from !== this.lease!.peerId)) return
    let c = this.connections.get(peer.peerId)
    if (kind === 'offers' && s.sdp?.type === 'offer' && !this.isHost) {
      if (c?.id === s.id) return
      if (c) this.drop(c)
      c = this.connection(peer, s.id, s.epoch)
      await c.pc.setRemoteDescription(s.sdp)
      if (!this.validConnection(c)) return
      await this.flushCandidates(c)
      const answer = await c.pc.createAnswer()
      if (!this.validConnection(c)) return
      await c.pc.setLocalDescription(answer)
      await this.signaling.send('answers', peer, c.id, c.epoch, { sdp: { type: 'answer', sdp: answer.sdp } })
    } else if (kind === 'answers' && c?.id === s.id && s.sdp?.type === 'answer' && this.isHost && !c.pc.remoteDescription) {
      await c.pc.setRemoteDescription(s.sdp); await this.flushCandidates(c)
    } else if (kind === 'candidates' && s.candidate) {
      if (c?.id !== s.id) {
        if (this.orphanCandidates.size >= 12) return
        const queued = this.orphanCandidates.get(s.id) || []
        if (queued.length < 64) { queued.push(s.candidate); this.orphanCandidates.set(s.id, queued) }
      } else if (c.pc.remoteDescription) await c.pc.addIceCandidate(s.candidate)
      else if (c.candidates.length < 64) c.candidates.push(s.candidate)
    }
  }
  private async flushCandidates(c: Connection): Promise<void> {
    for (const candidate of c.candidates.splice(0)) if (this.validConnection(c)) await c.pc.addIceCandidate(candidate)
  }
  private channel(c: Connection, channel: RTCDataChannel): void {
    if (c.channel || channel.label !== 'spaceworm') { channel.close(); return }
    c.channel = channel
    channel.onopen = () => {
      if (!this.validConnection(c)) { channel.close(); return }
      this.emitLobby()
      if (this.isHost) {
        if (this.migrationUntil) this.send(c, { version: PEER_PROTOCOL, epoch: c.epoch, kind: 'transferRequest', payload: { previousEpoch: this.previousEpoch } })
        else if (this.latest) this.send(c, { version: PEER_PROTOCOL, epoch: c.epoch, kind: 'snapshot', payload: this.latest })
      }
    }
    channel.onmessage = event => {
      if (!this.validConnection(c)) return
      const message = c.assembler.receive(event.data, this.signaling.now())
      if (message) this.receive(c, message)
    }
    channel.onclose = () => { if (this.validConnection(c)) { this.emitLobby(); this.status('waiting', 'peer_connection_failed') } }
    channel.onerror = () => { if (this.validConnection(c)) this.status('waiting', 'peer_connection_failed') }
  }
  private receive(c: Connection, m: PeerMessage): void {
    if (!this.lease || !this.hasLease() || !authorizedMessage(m, c.peer.peerId, this.currentPlayerId, this.lease, this.signaling.now(), !!this.migrationUntil)) return
    switch (m.kind) {
      case 'input': this.simulation?.input(c.peer.peerId, m.payload); break
      case 'snapshot': this.accept(m.payload, m.epoch); break
      case 'lobby': this.callbacks.onState(m.payload); break
      case 'ping': this.send(c, { version: PEER_PROTOCOL, epoch: m.epoch, kind: 'pong', payload: m.payload }); break
      case 'pong':
        if (m.payload === c.pendingPing) { this.ping = Math.max(0, this.signaling.now() - m.payload); c.pendingPing = 0; this.callbacks.onPing?.(this.ping) }
        break
      case 'notice': this.status('connected', m.payload); break
      case 'transferRequest':
        if (this.latest && this.snapshotEpoch === m.payload.previousEpoch) this.send(c, { version: PEER_PROTOCOL, epoch: m.epoch, kind: 'transfer', payload: this.latest })
        break
      case 'transfer':
        if (this.migrationUntil && m.payload.players.every(p => this.latest?.players.some(old => old.id === p.id) || this.peers.some(peer => peer.peerId === p.id))) this.migrationSnapshot = selectTransfer(this.migrationSnapshot, m.payload)
        break
    }
  }
  private finishMigration(): void {
    if (!this.isHost || !this.hasLease()) return
    this.migrationUntil = 0
    let notice: 'peer_migrated' | 'peer_resync' = 'peer_migrated'
    try {
      if (!this.migrationSnapshot) throw new Error('missing_snapshot')
      this.simulation = PeerSimulation.restore(this.migrationSnapshot)
    } catch {
      this.simulation = PeerSimulation.create(this.occupied(), id => this.connectedPeer(id), this.latest?.seq || 0)
      void this.signaling.phase('running').catch(() => this.status('error', 'peer_rules_denied'))
      notice = 'peer_resync'
    }
    if (notice === 'peer_resync') this.callbacks.onResync?.()
    this.publish(this.simulation.snapshot())
    this.status('connected', notice)
    this.broadcast({ version: PEER_PROTOCOL, epoch: this.lease!.epoch, kind: 'notice', payload: notice })
    this.emitLobby()
  }
  private publish(snapshot: OnlineSnapshot): void {
    if (!this.hasLease() || !this.isHost) return
    this.accept(snapshot, this.lease!.epoch)
    this.broadcast({ version: PEER_PROTOCOL, epoch: this.lease!.epoch, kind: 'snapshot', payload: snapshot })
    if (snapshot.type === 'matchEnd' && this.lease?.phase !== 'ended') void this.signaling.phase('ended').catch(() => this.status('error', 'peer_rules_denied'))
  }
  private accept(snapshot: OnlineSnapshot, epoch: number): void {
    const accepted = this.stream.accept(snapshot, epoch)
    if (!accepted) return
    if (accepted.reset) this.callbacks.onResync?.()
    this.latest = structuredClone(snapshot); this.snapshotEpoch = epoch
    this.inputSeq = Math.max(this.inputSeq, (snapshot.players.find(p => p.id === this.currentPlayerId)?.inputSeq ?? -1) + 1)
    const display = accepted.snapshot
    if (snapshot.type === 'matchEnd') this.callbacks.onMatchEnd(display as OnlineMatchEnd)
    else this.callbacks.onMatchSnapshot(display)
  }
  private send(c: Connection, m: PeerMessage): void {
    if (!this.validConnection(c) || c.channel?.readyState !== 'open' || c.channel.bufferedAmount > 256 * 1024 || !this.hasLease()) return
    try { for (const frame of frameMessage(m, c.frameId++)) c.channel.send(frame) }
    catch { c.channel.close() }
  }
  private broadcast(m: PeerMessage): void { this.connections.forEach(c => this.send(c, m)) }
  sendInput(angle: number, boost: boolean): void {
    const now = performance.now()
    if (!this.isConnected || !Number.isFinite(angle) || now - this.lastInputAt < 50) return
    this.lastInputAt = now
    const m: PeerMessage = { version: PEER_PROTOCOL, epoch: this.lease!.epoch, kind: 'input', payload: {
      type: 'input', protocol: ONLINE_PROTOCOL, targetAngle: Math.atan2(Math.sin(angle), Math.cos(angle)), boost, seq: this.inputSeq++ } }
    if (this.isHost) this.simulation?.input(this.currentPlayerId, m.payload)
    else { const c = this.connections.get(this.lease!.peerId); if (c) this.send(c, m) }
  }
  ready(value: boolean): void { void this.signaling.ready(value).catch(() => this.status('error', 'peer_rules_denied')) }
  start(): void {
    if (!this.isHost || !this.hasLease() || this.startPending || this.lease?.phase !== 'waiting') { this.status('error', 'not_ready_to_start'); return }
    if (!this.lobby().readyToStart) { this.status('error', 'not_ready_to_start'); return }
    this.startPending = true
    void (async () => {
      await this.signaling.ready(true) // Host does not need a separate ready click.
      const sim = PeerSimulation.create(this.occupied(), id => this.connectedPeer(id), this.latest?.seq || 0)
      if (await this.signaling.phase('running') && this.hasLease() && this.isHost) { this.simulation = sim; this.publish(sim.snapshot()); this.emitLobby() }
    })().catch(() => this.status('error', 'peer_rules_denied')).finally(() => { this.startPending = false })
  }
  private drop(c: Connection): void {
    if (c.channel) c.channel.onopen = c.channel.onmessage = c.channel.onclose = c.channel.onerror = null
    c.pc.onicecandidate = c.pc.ondatachannel = c.pc.onconnectionstatechange = null
    c.channel?.close(); c.pc.close(); c.assembler.clear()
  }
  close(): void {
    if (this.closed) return
    this.closed = true; clearInterval(this.loop)
    this.connections.forEach(c => this.drop(c)); this.connections.clear(); this.orphanCandidates.clear(); this.simulation = null
    void this.signaling.close()
  }
}
