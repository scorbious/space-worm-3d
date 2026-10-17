import { getApps, initializeApp, type FirebaseOptions } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { get, getDatabase, onDisconnect, onValue, push, ref, remove, runTransaction, serverTimestamp, set, update, type Database, type Unsubscribe } from 'firebase/database'
import type { OnlineProfile, Team } from './multiplayer'
import { activePeers, isHostLease, isPeerId, isPeerPresence, proposeLease, SIGNAL_TTL_MS, type HostLease, type PeerPresence } from './p2pProtocol'

export function firebaseConfig(env: Record<string, unknown>): FirebaseOptions {
  const fields = { apiKey: 'VITE_FIREBASE_API_KEY', authDomain: 'VITE_FIREBASE_AUTH_DOMAIN', databaseURL: 'VITE_FIREBASE_DATABASE_URL',
    projectId: 'VITE_FIREBASE_PROJECT_ID', appId: 'VITE_FIREBASE_APP_ID' } as const
  const config: Record<string, string> = {}
  for (const [field, key] of Object.entries(fields)) {
    const value = env[key]
    if (typeof value !== 'string' || !value.trim() || /^(YOUR_|REPLACE_|EXAMPLE)/i.test(value.trim())) throw new Error('peer_config_missing')
    config[field] = value.trim()
  }
  try {
    const url = new URL(config.databaseURL)
    if (url.protocol !== 'https:' || url.username || url.password || !/\.(firebaseio\.com|firebasedatabase\.app)$/.test(url.hostname)) throw new Error()
  } catch { throw new Error('peer_config_missing') }
  return config
}
export type Signal = { id: string; from: string; to: string; fromUid: string; toUid: string; epoch: number; createdAt: number; expiresAt: number;
  sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export function isSignal(v: unknown, now: number): v is Signal {
  if (!object(v) || !isPeerId(v.from) || !isPeerId(v.to) || typeof v.id !== 'string' || !/^c[a-f0-9]{16}$/.test(v.id) ||
    typeof v.fromUid !== 'string' || typeof v.toUid !== 'string' || !Number.isSafeInteger(v.epoch) || Number(v.epoch) < 1 ||
    typeof v.createdAt !== 'number' || typeof v.expiresAt !== 'number' || v.expiresAt <= now || v.expiresAt > now + SIGNAL_TTL_MS + 10000) return false
  return (object(v.sdp) && ['offer', 'answer'].includes(String(v.sdp.type)) && typeof v.sdp.sdp === 'string' && v.sdp.sdp.length <= 20000) ||
    (object(v.candidate) && typeof v.candidate.candidate === 'string' && v.candidate.candidate.length <= 4096)
}
export function randomId(prefix: 'p' | 'c'): string {
  return prefix + Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('')
}
function roomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), b => alphabet[b % alphabet.length]).join('')
}
export type SignalingCallbacks = {
  presence(peers: PeerPresence[], lease: HostLease | null): void
  signal(kind: 'offers' | 'answers' | 'candidates', signal: Signal): void
  connected(connected: boolean): void
  error(code: string): void
}
/** No game scores/state enter RTDB. The lease lives under presence/_lease as coordination metadata. */
export class FirebaseSignaling {
  readonly peerId = randomId('p')
  room = ''
  uid = ''
  peers: PeerPresence[] = []
  lease: HostLease | null = null
  connected = false
  private db: Database | null = null
  private me: PeerPresence | null = null
  private offset = 0
  private off: Unsubscribe[] = []
  private timer: ReturnType<typeof setInterval> | undefined
  private closed = false
  private busy = false
  private disconnects: ReturnType<typeof onDisconnect>[] = []
  private signalsSeen = new Map<string, number>()
  private stalePaths = new Set<string>()
  constructor(private readonly callbacks: SignalingCallbacks) {}
  now(): number { return Date.now() + this.offset }
  private path(suffix: string): string { return `rooms/${this.room}/${suffix}` }
  private ownPath(): string { return this.path(`presence/${this.uid}/${this.peerId}`) }
  async open(room: string | null, team: Team, profile: OnlineProfile): Promise<void> {
    const config = firebaseConfig(import.meta.env)
    if (typeof RTCPeerConnection === 'undefined') throw new Error('peer_not_supported')
    const app = getApps().find(a => a.name === 'spaceworm-peer') || initializeApp(config, 'spaceworm-peer')
    const auth = getAuth(app)
    try {
      await auth.authStateReady()
      if (!auth.currentUser) await signInAnonymously(auth)
    } catch { throw new Error('peer_auth_required') }
    if (this.closed) return
    this.uid = auth.currentUser!.uid; this.db = getDatabase(app)
    this.room = room || roomCode()
    this.off.push(onValue(ref(this.db, '.info/serverTimeOffset'), snap => { this.offset = Number(snap.val()) || 0 }))
    this.me = { peerId: this.peerId, uid: this.uid, team, name: profile.name.slice(0, 16), skin: profile.skin.slice(0, 24),
      color: profile.color || 'skin', headStyle: profile.headStyle || 'round', joinedAt: this.now(), seenAt: this.now(), creator: !room, ready: false }
    const own = ref(this.db, this.ownPath()), cleanup = onDisconnect(own)
    await cleanup.remove(); this.disconnects.push(cleanup)
    if (this.closed) return
    try {
      await set(own, { ...this.me, joinedAt: serverTimestamp(), seenAt: serverTimestamp() })
      const saved: unknown = (await get(own)).val()
      if (!isPeerPresence(saved)) throw new Error('peer_room_unavailable')
      this.me = saved
    } catch { throw new Error('peer_room_unavailable') }
    if (this.closed) { await remove(own); return }
    this.off.push(onValue(ref(this.db, '.info/connected'), snap => {
      const connected = snap.val() === true
      this.connected = connected; this.callbacks.connected(connected)
      if (connected) void this.republish().catch(() => this.fail())
    }))
    // A host may publish an offer as soon as our presence is written. Prime its
    // identity/lease before attaching SDP listeners, which replay existing offers.
    const initialPresence: unknown = (await get(ref(this.db, this.path('presence')))).val()
    if (this.closed) return
    this.applyPresence(initialPresence)
    this.off.push(onValue(ref(this.db, this.path('presence')), snap => this.applyPresence(snap.val()), () => this.fail()))
    for (const kind of ['offers', 'answers', 'candidates'] as const) {
      this.off.push(onValue(ref(this.db, this.path(`${kind}/${this.peerId}`)), snap => {
        const walk = (v: unknown, path: string) => {
          if (!object(v)) return
          if (typeof v.expiresAt === 'number') {
            if (v.expiresAt <= this.now()) { void remove(ref(this.db!, path)).catch(() => {}); return }
            if (!isSignal(v, this.now()) || v.to !== this.peerId || v.toUid !== this.uid) return
            if (!this.peers.some(p => p.peerId === v.from && p.uid === v.fromUid)) return
            const key = `${kind}/${path}/${v.id}`
            if (this.signalsSeen.has(key)) return
            this.signalsSeen.set(key, v.expiresAt)
            this.callbacks.signal(kind, v)
          } else for (const [key, child] of Object.entries(v)) walk(child, `${path}/${key}`)
        }
        walk(snap.val(), this.path(`${kind}/${this.peerId}`))
      }, () => this.fail()))
    }
    this.timer = setInterval(() => { void this.heartbeat() }, 2000)
    await this.heartbeat()
  }
  private applyPresence(value: unknown): void {
    if (this.closed) return
    const peers: PeerPresence[] = []
    if (object(value)) for (const [uid, records] of Object.entries(value)) {
      if (uid === '_lease' || !object(records)) continue
      for (const [peerId, entry] of Object.entries(records)) if (isPeerPresence(entry) && entry.uid === uid && entry.peerId === peerId) peers.push(entry)
    }
    this.peers = activePeers(peers, this.now())
    for (const p of peers) if (p.seenAt < this.now() - 20000) this.stalePaths.add(this.path(`presence/${p.uid}/${p.peerId}`))
    this.lease = object(value) && isHostLease(value._lease) ? value._lease : null
    this.callbacks.presence(this.peers, this.lease)
  }
  private async republish(): Promise<void> {
    if (!this.db || !this.me || this.closed) return
    const own = ref(this.db, this.ownPath()), cleanup = onDisconnect(own)
    await cleanup.remove()
    this.disconnects.push(cleanup)
    if (this.closed) return
    const existing = (await get(own)).exists()
    await set(own, { ...this.me, creator: existing ? this.me.creator : false, seenAt: serverTimestamp() })
    if (!existing) this.me.creator = false
    await this.heartbeat()
  }
  private fail(): void {
    if (this.closed) return
    this.connected = false
    this.callbacks.connected(false)
    this.callbacks.error('peer_rules_denied')
  }
  async heartbeat(): Promise<void> {
    if (!this.db || !this.me || !this.connected || this.closed || this.busy) return
    this.busy = true
    try {
      await update(ref(this.db, this.ownPath()), { seenAt: serverTimestamp() })
      if (this.closed) return
      this.peers = activePeers(this.peers, this.now())
      this.callbacks.presence(this.peers, this.lease)
      await runTransaction(ref(this.db, this.path('presence/_lease')), current => {
        if (this.closed || !this.connected) return
        return proposeLease(isHostLease(current) ? current : null, this.peers, this.peerId, this.now())
      }, { applyLocally: false })
      // Opportunistic TTL deletion only; RTDB does not offer native TTL deletion on Spark.
      for (const path of this.stalePaths) { await remove(ref(this.db, path)).catch(() => {}); this.stalePaths.delete(path) }
      for (const [key, expiry] of this.signalsSeen) if (expiry <= this.now()) this.signalsSeen.delete(key)
    } catch { this.fail() }
    finally { this.busy = false }
  }
  async ready(value: boolean): Promise<void> {
    if (!this.db || !this.me || this.closed) return
    this.me.ready = value
    await update(ref(this.db, this.ownPath()), { ready: value, seenAt: serverTimestamp() })
  }
  async phase(phase: HostLease['phase']): Promise<boolean> {
    if (!this.db || this.closed || !this.connected) return false
    const epoch = this.lease?.epoch
    const result = await runTransaction(ref(this.db, this.path('presence/_lease')), current => {
      if (!isHostLease(current) || current.peerId !== this.peerId || current.epoch !== epoch || current.expiresAt <= this.now() || this.closed) return
      return { ...current, phase }
    }, { applyLocally: false })
    return result.committed
  }
  async send(kind: 'offers' | 'answers' | 'candidates', to: PeerPresence, id: string, epoch: number, content: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }): Promise<void> {
    if (!this.db || this.closed || !this.connected) return
    const base = this.path(`${kind}/${to.peerId}/${this.peerId}`)
    const target = kind === 'candidates' ? push(ref(this.db, base)) : ref(this.db, base)
    await set(target, { id, from: this.peerId, to: to.peerId, fromUid: this.uid, toUid: to.uid, epoch, createdAt: serverTimestamp(),
      expiresAt: this.now() + SIGNAL_TTL_MS, ...content })
    const cleanup = onDisconnect(target); await cleanup.remove(); this.disconnects.push(cleanup)
  }
  async clearConnection(to: PeerPresence): Promise<void> {
    if (!this.db) return
    for (const kind of ['offers', 'answers', 'candidates']) {
      for (const path of [`${kind}/${to.peerId}/${this.peerId}`, `${kind}/${this.peerId}/${to.peerId}`]) {
        await remove(ref(this.db, this.path(path))).catch(() => {})
      }
    }
  }
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    clearInterval(this.timer); this.off.splice(0).forEach(off => off())
    this.callbacks.connected(false); this.signalsSeen.clear(); this.stalePaths.clear()
    if (!this.db || !this.room) return
    // Release with an epoch-preserving CAS; never delete a successor's lease.
    if (this.connected && this.lease?.peerId === this.peerId) await runTransaction(ref(this.db, this.path('presence/_lease')), current => {
      if (isHostLease(current) && current.peerId === this.peerId && current.epoch === this.lease?.epoch) return { ...current, expiresAt: this.now() }
    }, { applyLocally: false }).catch(() => {})
    await Promise.all(this.peers.filter(p => p.peerId !== this.peerId).map(p => this.clearConnection(p)))
    await remove(ref(this.db, this.ownPath())).catch(() => {})
    await Promise.all(this.disconnects.splice(0).map(d => d.cancel().catch(() => {})))
    this.connected = false
  }
}
