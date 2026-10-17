import { Match } from '../../server/match.mjs'
import { isOnlineSnapshot, type OnlineSnapshot } from './multiplayer'
import type { PeerInput, PeerPresence } from './p2pProtocol'

export interface AuthoritativePeerSimulation {
  readonly phase: 'running' | 'ended'
  input(peerId: string, control: PeerInput): boolean
  step(): void
  snapshot(): OnlineSnapshot
  setConnected(peerId: string, connected: boolean): void
}
/** Both server and peer hosts execute exactly the same physics/scoring engine. */
export class PeerSimulation implements AuthoritativePeerSimulation {
  private constructor(private readonly match: Match) {}
  static create(peers: PeerPresence[], connected: (id: string) => boolean, seq = 0): PeerSimulation {
    const seats = (['blue', 'red'] as const).flatMap(team => peers.filter(p => p.team === team).slice(0, 3)
      .map((p, slot) => ({ ...p, id: p.peerId, slot, socket: connected(p.peerId) })))
    const match = new Match(seats, { seed: peers.reduce((n, p) => n + p.joinedAt, 0) >>> 0 })
    match.seq = seq
    return new PeerSimulation(match)
  }
  static restore(snapshot: OnlineSnapshot): PeerSimulation {
    if (!isOnlineSnapshot(snapshot) || !snapshot.players.length) throw new Error('peer_invalid_transfer')
    return new PeerSimulation(Match.fromSnapshot(structuredClone(snapshot)))
  }
  get phase(): 'running' | 'ended' { return this.match.phase }
  input(id: string, control: PeerInput): boolean { return this.match.input(id, control) }
  step(): void { this.match.step() }
  snapshot(): OnlineSnapshot { return this.match.snapshot(this.phase === 'ended' ? 'matchEnd' : 'match') }
  setConnected(id: string, connected: boolean): void { this.match.setConnected(id, connected) }
}
