import { describe, expect, it } from 'vitest'
import { firebaseConfig, isSignal } from '../src/net/firebaseSignaling'
import { ONLINE_PROTOCOL, isOnlineSnapshot } from '../src/net/multiplayer'
import { activePeers, authorizedMessage, electHost, frameMessage, isHostLease, isPeerInput, isPeerMessage, LEASE_MS, PEER_PROTOCOL,
  PeerAssembler, proposeLease, ROOM_TTL_MS, selectTransfer, SnapshotStream, type HostLease, type PeerInput, type PeerMessage, type PeerPresence } from '../src/net/p2pProtocol'
import { PeerSimulation } from '../src/net/peerSimulation'
import { NetworkSim } from '../src/game/networkSim'
const now = 100000
const peer = (n: number, joinedAt = now - 1000, team: 'blue' | 'red' = n % 2 ? 'blue' : 'red'): PeerPresence => ({
  peerId: `p${n.toString(16).padStart(16, '0')}`, uid: `user-${n}`, joinedAt, seenAt: now, team, creator: false, ready: true,
  name: `Peer ${n}`, skin: 'nebula', color: 'cyan', headStyle: 'cat',
})
const peers = [peer(1), peer(2)]
const lease: HostLease = { peerId: peers[0].peerId, uid: peers[0].uid, epoch: 1, expiresAt: now + LEASE_MS, roomExpiresAt: now + ROOM_TTL_MS, phase: 'running' }
const input: PeerInput = { type: 'input' as const, protocol: ONLINE_PROTOCOL, targetAngle: 1, boost: true, seq: 0 }
function snapshot() { return PeerSimulation.create(peers, () => true).snapshot() }
const message = (kind: 'input' = 'input'): PeerMessage => ({ version: PEER_PROTOCOL, epoch: 1, kind, payload: input })

describe('deterministic host election and failover', () => {
  it('makes the room creator first host even if another peer sorts first', () => {
    const creator = { ...peer(5, now), creator: true }
    expect(electHost([peer(1), creator], now, true)?.peerId).toBe(creator.peerId)
    expect(electHost([creator, peer(1)], now)?.peerId).toBe(peer(1).peerId)
  })
  it('uses joinedAt then bytewise peerId, independent of input order and locale', () => {
    const items = [peer(8), peer(3), peer(1, now - 500)]
    expect(electHost(items, now)?.peerId).toBe(peer(3).peerId)
    expect(electHost(items.reverse(), now)?.peerId).toBe(peer(3).peerId)
  })
  it('excludes stale/future presence and returns no host in an empty room', () => {
    expect(activePeers([{ ...peer(1), seenAt: now - 20001 }, { ...peer(2), seenAt: now + 10000 }, peer(3)], now)).toHaveLength(1)
    expect(electHost([], now)).toBeUndefined()
  })
  it('does not let a missing incumbent presence cause premature lease theft', () => {
    expect(proposeLease(lease, [peer(2)], peer(2).peerId, now)).toBeUndefined()
    expect(proposeLease(lease, peers, peer(1).peerId, now)?.epoch).toBe(1)
  })
  it('automatically elects the oldest survivor and increments the fencing epoch on expiry', () => {
    const expired = { ...lease, expiresAt: now }
    const survivors = [peer(4), peer(2), peer(3, now - 500)]
    const next = proposeLease(expired, survivors, peer(2).peerId, now)
    expect(next).toMatchObject({ peerId: peer(2).peerId, epoch: 2, expiresAt: now + LEASE_MS, phase: 'running' })
    expect(proposeLease(expired, survivors, peer(4).peerId, now)).toBeUndefined()
  })
  it('does not wait for delayed onDisconnect removal of a host with an expired lease', () => {
    const expired = { ...lease, expiresAt: now }
    expect(proposeLease(expired, peers, peers[1].peerId, now)?.peerId).toBe(peers[1].peerId)
    expect(proposeLease(expired, peers, peers[0].peerId, now)).toBeUndefined()
  })
  it('a second contender cannot overwrite the transaction winner', () => {
    const next = proposeLease({ ...lease, expiresAt: now }, [peer(2), peer(3)], peer(2).peerId, now)!
    expect(proposeLease(next, [peer(3)], peer(3).peerId, now)).toBeUndefined()
    expect(authorizedMessage(message(), peers[0].peerId, peers[1].peerId, next, now)).toBe(false)
  })
  it('never extends an expired room or selects an absent self', () => {
    expect(proposeLease({ ...lease, roomExpiresAt: now }, peers, peers[0].peerId, now)).toBeUndefined()
    expect(proposeLease(null, peers, peer(9).peerId, now)).toBeUndefined()
    expect(isHostLease({ ...lease, epoch: -1 })).toBe(false)
  })
})

describe('controls-only peer trust boundary', () => {
  it('accepts bounded steering intent, never client positions/scores/player impersonation', () => {
    expect(isPeerInput(input)).toBe(true)
    for (const forged of [{ ...input, xs: [1] }, { ...input, score: 200 }, { ...input, playerId: peer(2).peerId },
      { ...input, targetAngle: NaN }, { ...input, targetAngle: 20 }, { ...input, seq: -1 }, { ...input, boost: 1 }, { ...input, protocol: 'old' }]) expect(isPeerInput(forged)).toBe(false)
  })
  it('only the current host may send authoritative snapshots/events or lobby state', () => {
    const m: PeerMessage = { version: PEER_PROTOCOL, epoch: 1, kind: 'snapshot', payload: snapshot() }
    expect(isPeerMessage(m)).toBe(true)
    expect(authorizedMessage(m, peers[0].peerId, peers[1].peerId, lease, now)).toBe(true)
    expect(authorizedMessage(m, peers[1].peerId, peers[0].peerId, lease, now)).toBe(false)
    expect(authorizedMessage(message(), peers[1].peerId, peers[0].peerId, lease, now)).toBe(true)
    expect(authorizedMessage(message(), peers[1].peerId, peer(3).peerId, lease, now)).toBe(false)
  })
  it('rejects old epochs, expired leases, unknown kinds and corrupt snapshots', () => {
    expect(authorizedMessage(message(), peers[1].peerId, peers[0].peerId, { ...lease, epoch: 2 }, now)).toBe(false)
    expect(authorizedMessage(message(), peers[1].peerId, peers[0].peerId, { ...lease, expiresAt: now }, now)).toBe(false)
    expect(isPeerMessage({ ...message(), kind: 'score' })).toBe(false)
    expect(isPeerMessage({ ...message(), payload: { ...input, score: 99 } })).toBe(false)
    expect(isPeerMessage({ ...message(), kind: 'snapshot', payload: { ...snapshot(), scores: { blue: NaN, red: 0 } } })).toBe(false)
  })
  it('allows snapshot transfer only to the elected host during an explicit migration window', () => {
    const m: PeerMessage = { version: PEER_PROTOCOL, epoch: 1, kind: 'transfer', payload: snapshot() }
    expect(authorizedMessage(m, peers[1].peerId, peers[0].peerId, lease, now)).toBe(false)
    expect(authorizedMessage(m, peers[1].peerId, peers[0].peerId, lease, now, true)).toBe(true)
    expect(authorizedMessage(m, peers[0].peerId, peers[1].peerId, lease, now, true)).toBe(false)
  })
  it('accepts only current, bounded, correctly typed signaling', () => {
    const s = { id: 'c0000000000000001', from: peer(1).peerId, to: peer(2).peerId, fromUid: 'u1', toUid: 'u2', epoch: 1,
      createdAt: now, expiresAt: now + 60000, sdp: { type: 'offer', sdp: 'test SDP' } }
    expect(isSignal(s, now)).toBe(true)
    expect(isSignal({ ...s, expiresAt: now }, now)).toBe(false)
    expect(isSignal({ ...s, from: '../escape' }, now)).toBe(false)
    expect(isSignal({ ...s, sdp: { type: 'offer', sdp: 'x'.repeat(20001) } }, now)).toBe(false)
  })
  it('fails closed on missing or placeholder Firebase configuration without authenticating', () => {
    expect(() => firebaseConfig({})).toThrow('peer_config_missing')
    expect(() => firebaseConfig({ VITE_FIREBASE_API_KEY: 'YOUR_KEY' })).toThrow('peer_config_missing')
  })
})

describe('bounded DataChannel framing', () => {
  it('round-trips large snapshots over sub-16KiB ordered frames', () => {
    const s = snapshot(); s.players[0].length = 240; s.players[0].xs = Array(240).fill(11); s.players[0].zs = Array(240).fill(1)
    s.food = Array.from({ length: 800 }, (_, id) => ({ id, x: 1, z: 2, value: 1 as const, color: 4 }))
    const m: PeerMessage = { version: PEER_PROTOCOL, epoch: 1, kind: 'snapshot', payload: s }
    const frames = frameMessage(m, 1), assembler = new PeerAssembler()
    expect(frames.length).toBeGreaterThan(1)
    expect(frames.every(f => new TextEncoder().encode(f).length < 16384)).toBe(true)
    let result: PeerMessage | null = null
    for (const frame of frames) result = assembler.receive(frame, now)
    expect(result).toEqual(m)
  })
  it('rejects oversized, unordered, duplicate and expired incomplete frames', () => {
    const s = snapshot(); s.food = Array.from({ length: 800 }, (_, id) => ({ id, x: 1, z: 2, value: 1 as const, color: 4 }))
    const frames = frameMessage({ version: PEER_PROTOCOL, epoch: 1, kind: 'snapshot', payload: s }, 1)
    const assembler = new PeerAssembler()
    expect(assembler.receive('x'.repeat(16001), now)).toBeNull()
    expect(assembler.receive(frames[1], now)).toBeNull()
    assembler.receive(frames[0], now)
    expect(assembler.receive(frames[1], now + 6000)).toBeNull()
    expect(assembler.receive(JSON.stringify({ frame: PEER_PROTOCOL, id: 1, total: 99999, index: 0, data: '' }), now)).toBeNull()
  })
})

describe('authoritative simulation snapshot migration', () => {
  it('rebases a fallback new round for NetworkSim and rejects earlier epochs/duplicates', () => {
    const stream = new SnapshotStream(), old = { ...snapshot(), tick: 100, seq: 99 }
    expect(stream.accept(old, 1)?.snapshot.seq).toBe(99)
    const next = stream.accept(snapshot(), 2)!
    expect(next.reset).toBe(true); expect(next.snapshot.seq).toBe(100)
    expect(stream.accept(old, 1)).toBeNull(); expect(stream.accept(snapshot(), 2)).toBeNull()
  })
  it('transfers an immutable cache and picks the newest valid, non-regressing snapshot', () => {
    const a = snapshot(), b = { ...a, tick: a.tick + 2, seq: a.seq + 1 }
    const chosen = selectTransfer(a, b)!
    expect(chosen.seq).toBe(b.seq); chosen.players[0].score = 999
    expect(b.players[0].score).not.toBe(999)
    expect(selectTransfer(b, a)).toBe(b)
    expect(selectTransfer(b, { ...b, seq: b.seq + 1, tick: b.tick - 1 })).toBe(b)
  })
  it('restores bodies, score, tick, sequence, food, spawn/respawn timers and input sequence', () => {
    const s = snapshot(); s.tick = 120; s.timeLeft = 234; s.players[0].score = 50; s.players[0].kills = 1; s.players[0].inputSeq = 10
    s.players[1].alive = false; s.players[1].respawnIn = 2; s.players[0].spawnGrace = 1
    s.scores.blue = 50
    const before = JSON.stringify(s), resumed = PeerSimulation.restore(s), next = resumed.snapshot()
    expect(next).toMatchObject({ tick: 120, timeLeft: 234, seq: s.seq + 1, scores: s.scores, food: s.food })
    expect(next.players[1].respawnIn).toBe(2); expect(next.players[0].spawnGrace).toBe(1)
    expect(next.players[0].xs).toEqual(s.players[0].xs)
    expect(resumed.input(peers[0].peerId, { ...input, seq: 9 })).toBe(false)
    expect(resumed.input(peers[0].peerId, { ...input, seq: 11 })).toBe(true)
    resumed.step(); const advanced = resumed.snapshot()
    expect(advanced.tick).toBe(121); expect(advanced.timeLeft).toBe(233.95)
    expect(advanced.players[0].score).toBe(50); expect(JSON.stringify(s)).toBe(before)
    expect(isOnlineSnapshot(advanced)).toBe(true)
  })
  it('remains compatible with the existing NetworkSim render/event adapter', () => {
    const original = PeerSimulation.create(peers, () => true)
    original.step(); const first = original.snapshot()
    const host = PeerSimulation.restore(first); host.step(); const after = host.snapshot()
    const render = new NetworkSim(peers[0].peerId)
    render.applyNetworkSnapshot(first, 1000); render.applyNetworkSnapshot(after, 1100)
    expect(render.latest?.tick).toBe(2); expect(render.worms).toHaveLength(2)
  })
  it('does not reset steering/boost when connectivity is unchanged across host ticks', () => {
    const host = PeerSimulation.create(peers, () => true)
    host.input(peers[0].peerId, input)
    host.setConnected(peers[0].peerId, true); host.step()
    expect(host.snapshot().players[0].boosting).toBe(true)
    host.setConnected(peers[0].peerId, false)
    expect(host.input(peers[0].peerId, { ...input, seq: 1 })).toBe(false)
  })
  it('keeps ended rounds ended and rejects corrupt/empty transfer snapshots', () => {
    const s = snapshot(); const end = { ...s, type: 'matchEnd' as const, phase: 'ended' as const, timeLeft: 0, winner: 'blue' as const }
    const host = PeerSimulation.restore(end); host.step()
    expect(host.snapshot()).toMatchObject({ type: 'matchEnd', phase: 'ended', winner: 'draw', tick: end.tick })
    expect(() => PeerSimulation.restore({ ...s, players: [] })).toThrow('peer_invalid_transfer')
    expect(() => PeerSimulation.restore({ ...s, timeLeft: NaN })).toThrow('peer_invalid_transfer')
  })
})
