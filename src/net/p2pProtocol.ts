import { isLobbyState, isOnlineSnapshot, ONLINE_PROTOCOL, type LobbyState, type OnlineSnapshot, type OnlineProfile, type Team } from './multiplayer'

export const PEER_PROTOCOL = 'spaceworm-peer-v1'
export const LEASE_MS = 8000
export const PRESENCE_TTL_MS = 20000
export const SIGNAL_TTL_MS = 60000
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000
export type PeerPresence = OnlineProfile & { peerId: string; uid: string; team: Team; joinedAt: number; seenAt: number; creator: boolean; ready: boolean }
export type HostLease = { peerId: string; uid: string; epoch: number; expiresAt: number; roomExpiresAt: number; phase: 'waiting' | 'running' | 'ended' }
export type PeerInput = { type: 'input'; protocol: typeof ONLINE_PROTOCOL; targetAngle: number; boost: boolean; seq: number }
export type PeerMessage =
  | { version: typeof PEER_PROTOCOL; epoch: number; kind: 'input'; payload: PeerInput }
  | { version: typeof PEER_PROTOCOL; epoch: number; kind: 'snapshot' | 'transfer'; payload: OnlineSnapshot }
  | { version: typeof PEER_PROTOCOL; epoch: number; kind: 'lobby'; payload: LobbyState }
  | { version: typeof PEER_PROTOCOL; epoch: number; kind: 'transferRequest'; payload: { previousEpoch: number } }
  | { version: typeof PEER_PROTOCOL; epoch: number; kind: 'notice'; payload: 'peer_migrated' | 'peer_resync' }
  | { version: typeof PEER_PROTOCOL; epoch: number; kind: 'ping' | 'pong'; payload: number }
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const int = (v: unknown, min = 0): v is number => finite(v) && Number.isSafeInteger(v) && v >= min
export const isPeerId = (v: unknown): v is string => typeof v === 'string' && /^p[a-f0-9]{16}$/.test(v)
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k))
export function isPeerPresence(v: unknown): v is PeerPresence {
  return obj(v) && isPeerId(v.peerId) && typeof v.uid === 'string' && v.uid.length > 0 && v.uid.length <= 128 &&
    ['blue', 'red'].includes(String(v.team)) && finite(v.joinedAt) && v.joinedAt > 0 && finite(v.seenAt) &&
    typeof v.creator === 'boolean' && typeof v.ready === 'boolean' && typeof v.name === 'string' && v.name.length <= 16 &&
    typeof v.skin === 'string' && v.skin.length <= 24 && (v.color === undefined || ['skin', 'cyan', 'pink', 'gold', 'green', 'violet', 'orange', 'ice', 'dark'].includes(String(v.color))) &&
    (v.headStyle === undefined || ['round', 'crystal', 'robot', 'comet', 'dragon', 'cat', 'cyclops', 'manta'].includes(String(v.headStyle)))
}
export function isHostLease(v: unknown): v is HostLease {
  return obj(v) && isPeerId(v.peerId) && typeof v.uid === 'string' && int(v.epoch, 1) && finite(v.expiresAt) &&
    finite(v.roomExpiresAt) && ['waiting', 'running', 'ended'].includes(String(v.phase))
}
export function activePeers(peers: PeerPresence[], now: number): PeerPresence[] {
  return peers.filter(p => isPeerPresence(p) && p.seenAt > now - PRESENCE_TTL_MS && p.seenAt <= now + 5000)
    .sort((a, b) => a.joinedAt - b.joinedAt || (a.peerId < b.peerId ? -1 : a.peerId > b.peerId ? 1 : 0))
}
export function electHost(peers: PeerPresence[], now: number, first = false): PeerPresence | undefined {
  const active = activePeers(peers, now)
  return (first ? active.find(p => p.creator) : undefined) || active[0]
}
/** Pure CAS proposal. An incumbent lease cannot be stolen even if its presence just disappeared. */
export function proposeLease(current: HostLease | null, peers: PeerPresence[], self: string, now: number): HostLease | undefined {
  if (current && current.roomExpiresAt <= now) return undefined
  if (current && current.expiresAt > now) {
    if (current.peerId !== self || !activePeers(peers, now).some(p => p.peerId === self)) return undefined
    return { ...current, expiresAt: now + LEASE_MS }
  }
  // RTDB onDisconnect can lag. An expired incumbent needs a fresh post-expiry presence
  // heartbeat to count as a survivor, otherwise it would block the next oldest peer.
  const survivors = current ? peers.filter(p => p.peerId !== current.peerId || p.seenAt > current.expiresAt) : peers
  const elected = electHost(survivors, now, !current)
  if (!elected || elected.peerId !== self) return undefined
  return { peerId: self, uid: elected.uid, epoch: (current?.epoch || 0) + 1, expiresAt: now + LEASE_MS,
    roomExpiresAt: current?.roomExpiresAt || now + ROOM_TTL_MS, phase: current?.phase || 'waiting' }
}
export function isPeerInput(v: unknown): v is PeerInput {
  return obj(v) && keys(v, ['type', 'protocol', 'targetAngle', 'boost', 'seq']) && v.type === 'input' && v.protocol === ONLINE_PROTOCOL &&
    finite(v.targetAngle) && Math.abs(v.targetAngle) <= Math.PI * 2 && typeof v.boost === 'boolean' && int(v.seq) && v.seq <= 0x7fffffff
}
export function isPeerMessage(v: unknown): v is PeerMessage {
  if (!obj(v) || !keys(v, ['version', 'epoch', 'kind', 'payload']) || v.version !== PEER_PROTOCOL || !int(v.epoch, 1)) return false
  switch (v.kind) {
    case 'input': return isPeerInput(v.payload)
    case 'snapshot': case 'transfer': return isOnlineSnapshot(v.payload)
    case 'lobby': return isLobbyState(v.payload)
    case 'transferRequest': return obj(v.payload) && keys(v.payload, ['previousEpoch']) && int(v.payload.previousEpoch, 1)
    case 'notice': return v.payload === 'peer_migrated' || v.payload === 'peer_resync'
    case 'ping': case 'pong': return finite(v.payload) && v.payload >= 0
    default: return false
  }
}
/** Sender identity comes from the authenticated signaling connection, never from a packet field. */
export function authorizedMessage(m: PeerMessage, sender: string, self: string, lease: HostLease, now: number, transferring = false): boolean {
  if (m.epoch !== lease.epoch || lease.expiresAt <= now || lease.roomExpiresAt <= now) return false
  if (m.kind === 'input') return lease.peerId === self && sender !== self
  if (m.kind === 'transfer') return lease.peerId === self && sender !== self && transferring
  if (m.kind === 'ping' || m.kind === 'pong') return sender === lease.peerId || self === lease.peerId
  return sender === lease.peerId && self !== lease.peerId
}
export function selectTransfer(cached: OnlineSnapshot | null, incoming: OnlineSnapshot): OnlineSnapshot | null {
  if (!isOnlineSnapshot(incoming)) return cached
  if (cached && (incoming.seq <= cached.seq || incoming.tick < cached.tick || (cached.phase === 'ended' && incoming.phase !== 'ended'))) return cached
  return structuredClone(incoming)
}

/** Raw host sequences may restart only with a new epoch; render callbacks remain monotonic. */
export class SnapshotStream {
  private epoch = 0
  private rawSeq = -1
  private displaySeq = 0
  private tick = 0
  accept(snapshot: OnlineSnapshot, epoch: number): { snapshot: OnlineSnapshot; reset: boolean } | null {
    if (!isOnlineSnapshot(snapshot) || !Number.isSafeInteger(epoch) || epoch < 1 || epoch < this.epoch ||
      (epoch === this.epoch && snapshot.seq <= this.rawSeq)) return null
    const reset = !!this.epoch && epoch !== this.epoch && snapshot.tick < this.tick
    this.epoch = epoch; this.rawSeq = snapshot.seq; this.tick = snapshot.tick
    this.displaySeq = Math.max(this.displaySeq + 1, snapshot.seq)
    return { snapshot: { ...structuredClone(snapshot), seq: this.displaySeq }, reset }
  }
}

// SCTP messages stay below 16 KiB even with multi-byte names. A snapshot may be larger than 64 KiB.
const CHUNK_CHARS = 3000
export const MAX_PEER_MESSAGE = 512 * 1024
export function frameMessage(message: PeerMessage, id: number): string[] {
  const raw = JSON.stringify(message)
  if (raw.length > MAX_PEER_MESSAGE) throw new Error('peer_message_too_large')
  const total = Math.ceil(raw.length / CHUNK_CHARS)
  return Array.from({ length: total }, (_, index) => JSON.stringify({ frame: PEER_PROTOCOL, id, index, total, data: raw.slice(index * CHUNK_CHARS, (index + 1) * CHUNK_CHARS) }))
}
export class PeerAssembler {
  private pending: { id: number; total: number; parts: string[]; size: number; at: number } | null = null
  receive(raw: unknown, now: number): PeerMessage | null {
    if (typeof raw !== 'string' || raw.length > 16000) return null
    try {
      const f: unknown = JSON.parse(raw)
      if (!obj(f) || !keys(f, ['frame', 'id', 'index', 'total', 'data']) || f.frame !== PEER_PROTOCOL || !int(f.id) || !int(f.index) || !int(f.total, 1) ||
        f.total > 180 || f.index >= f.total || typeof f.data !== 'string' || f.data.length > CHUNK_CHARS) return null
      if (this.pending && now - this.pending.at > 5000) this.pending = null
      if (f.index === 0) this.pending = { id: f.id, total: f.total, parts: [], size: 0, at: now }
      const p = this.pending
      if (!p || p.id !== f.id || p.total !== f.total || p.parts.length !== f.index) return null
      p.parts.push(f.data); p.size += f.data.length
      if (p.size > MAX_PEER_MESSAGE) { this.pending = null; return null }
      if (p.parts.length !== p.total) return null
      this.pending = null
      const message: unknown = JSON.parse(p.parts.join(''))
      return isPeerMessage(message) ? message : null
    } catch { return null }
  }
  clear(): void { this.pending = null }
}
