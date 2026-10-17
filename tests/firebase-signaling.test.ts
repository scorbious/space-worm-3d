import { afterEach, describe, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ data: {} as Record<string, unknown>, operations: [] as string[], detached: 0 }))
const at = (path: string): unknown => path.split('/').reduce<unknown>((node, part) => node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : null, fake.data)
function put(path: string, value: unknown): void {
  const parts = path.split('/'), key = parts.pop()!
  let node = fake.data
  for (const part of parts) node = (node[part] ||= {}) as Record<string, unknown>
  if (value === null) delete node[key]; else node[key] = value
}
vi.mock('firebase/app', () => ({ getApps: () => [], initializeApp: () => ({ name: 'test' }) }))
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: 'guest' }, authStateReady: async () => {} }), signInAnonymously: vi.fn() }))
vi.mock('firebase/database', () => ({
  getDatabase: () => ({}), ref: (_db: unknown, path: string) => ({ path }), serverTimestamp: () => Date.now(),
  get: async ({ path }: { path: string }) => ({ val: () => at(path), exists: () => !!at(path) }),
  set: async ({ path }: { path: string }, value: unknown) => { fake.operations.push(`set:${path}`); put(path, value) },
  update: async ({ path }: { path: string }, value: object) => { put(path, { ...(at(path) as object), ...value }) },
  remove: async ({ path }: { path: string }) => { put(path, null) },
  push: ({ path }: { path: string }) => ({ path: `${path}/candidate` }),
  runTransaction: async ({ path }: { path: string }, change: (value: unknown) => unknown) => {
    const value = change(at(path)); if (value !== undefined) put(path, value)
    return { committed: value !== undefined }
  },
  onDisconnect: ({ path }: { path: string }) => ({
    remove: async () => { fake.operations.push(`disconnect:${path}`) }, cancel: async () => {},
  }),
  onValue: ({ path }: { path: string }, callback: (snapshot: { val(): unknown }) => void) => {
    callback({ val: () => path === '.info/connected' ? true : path === '.info/serverTimeOffset' ? 0 : at(path) })
    return () => { fake.detached++ }
  },
}))
import { FirebaseSignaling } from '../src/net/firebaseSignaling'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe('Firebase startup and cleanup without external network', () => {
  it('primes connection/member lease before replaying a cached offer, and registers disconnect first', async () => {
    fake.data = {}; fake.operations = []; fake.detached = 0
    for (const [key, value] of Object.entries({ VITE_FIREBASE_API_KEY: 'test-only-not-a-production-key', VITE_FIREBASE_AUTH_DOMAIN: 'unit-test.firebaseapp.com',
      VITE_FIREBASE_DATABASE_URL: 'https://unit-test.firebaseio.com', VITE_FIREBASE_PROJECT_ID: 'unit-test', VITE_FIREBASE_APP_ID: 'test-app' })) vi.stubEnv(key, value)
    vi.stubGlobal('RTCPeerConnection', class {})
    const connected = vi.fn(), presence = vi.fn(), error = vi.fn()
    let signaling: FirebaseSignaling
    const signal = vi.fn(() => {
      expect(signaling.connected).toBe(true)
      expect(signaling.lease?.peerId).toBe('p1111111111111111')
    })
    signaling = new FirebaseSignaling({ connected, presence, error, signal })
    const now = Date.now(), host = 'p1111111111111111', room = 'ROOM1234'
    put(`rooms/${room}/presence/host-user/${host}`, { uid: 'host-user', peerId: host, team: 'blue', name: 'Host', skin: 'nebula',
      joinedAt: now - 1000, seenAt: now, creator: true, ready: true })
    put(`rooms/${room}/presence/_lease`, { peerId: host, uid: 'host-user', epoch: 1, expiresAt: now + 8000, roomExpiresAt: now + 86400000, phase: 'waiting' })
    put(`rooms/${room}/offers/${signaling.peerId}/${host}`, { id: 'c1111111111111111', from: host, to: signaling.peerId,
      fromUid: 'host-user', toUid: 'guest', epoch: 1, createdAt: now, expiresAt: now + 60000, sdp: { type: 'offer', sdp: 'mock SDP' } })
    try {
      await signaling.open(room, 'red', { name: 'Guest', skin: 'nebula' })
      expect(signal).toHaveBeenCalledTimes(1); expect(error).not.toHaveBeenCalled()
      const own = `rooms/${room}/presence/guest/${signaling.peerId}`
      expect(fake.operations.indexOf(`disconnect:${own}`)).toBeLessThan(fake.operations.indexOf(`set:${own}`))
      expect(presence).toHaveBeenCalled(); expect(connected).toHaveBeenCalledWith(true)
      await signaling.close()
      expect(at(own)).toBeUndefined(); expect(fake.detached).toBe(6)
    } finally { await signaling.close() }
  })
})
