import type { OnlineProfile, OnlineSnapshot, Team } from '../src/net/multiplayer'
export const PROTOCOL: string
export const TICK_HZ: number
export const SNAPSHOT_HZ: number
export const DT: number
export function validateInput(packet: unknown): boolean
export function seededRandom(seed: number): () => number
export class Match {
  constructor(seats: (OnlineProfile & { id: string; team: Team; slot: number; socket: unknown })[], options?: { seed?: number; seconds?: number; foodCount?: number })
  static fromSnapshot(snapshot: OnlineSnapshot): Match
  phase: 'running' | 'ended'
  seq: number
  tick: number
  players: Map<string, unknown>
  input(id: string, packet: unknown, now?: number): boolean
  setConnected(id: string, connected: boolean): void
  removePlayer(id: string): void
  step(): void
  snapshot(type?: 'match' | 'matchEnd'): OnlineSnapshot
}
