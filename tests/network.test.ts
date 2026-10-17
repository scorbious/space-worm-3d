import { describe, expect, it } from 'vitest'
import { isLobbyState, isOnlineSnapshot, ONLINE_PROTOCOL, type OnlinePlayer, type OnlineSnapshot } from '../src/net/multiplayer'
import { NetworkSim } from '../src/game/networkSim'
const player = (id: string, team: 'blue' | 'red', x: number): OnlinePlayer => ({
  id, team, slot: 0, name: id, skin: 'nebula', color: 'cyan', headStyle: 'cat', connected: true, alive: true,
  xs: Array.from({ length: 20 }, (_, i) => x - i * 1.3), zs: Array(20).fill(0), angle: 0, length: 20,
  boosting: false, score: 4, kills: 0, inputSeq: 5, generation: 1, respawnIn: 0, spawnGrace: 0,
})
function snapshot(seq = 1): OnlineSnapshot {
  return {
    type: 'match', protocol: ONLINE_PROTOCOL, tick: seq * 2, seq, phase: 'running', timeLeft: 240 - seq / 10,
    arena: { stage: 1, radius: 128 }, scores: { blue: 4, red: 4 }, players: [player('blue-id', 'blue', -50), player('red-id', 'red', 50)],
    food: [{ id: 1, x: 0, z: 12, value: 1, color: 0x5ef3ff }], events: [],
  }
}

describe('v2 client safe parsing', () => {
  it('accepts valid bounded snapshots and matchEnd; rejects unknown versions and corrupt arrays', () => {
    expect(isOnlineSnapshot(snapshot())).toBe(true)
    expect(isOnlineSnapshot({ ...snapshot(), type: 'matchEnd', phase: 'ended', winner: 'blue', timeLeft: 0 })).toBe(true)
    for (const invalid of [null, [], {}, { ...snapshot(), protocol: 'spaceworm-3v3-v1' }, { ...snapshot(), timeLeft: NaN },
      { ...snapshot(), seq: -1 }, { ...snapshot(), arena: { stage: 10, radius: 0 } }, { ...snapshot(), food: Array(801).fill({}) },
      { ...snapshot(), type: 'matchEnd', winner: 'invalid' }, { ...snapshot(), players: [player('same', 'blue', 0), player('same', 'red', 0)] }]) {
      expect(isOnlineSnapshot(invalid)).toBe(false)
    }
    const bad = snapshot(); bad.players[0].zs.pop(); expect(isOnlineSnapshot(bad)).toBe(false)
    const nan = snapshot(); nan.players[0].xs[0] = Infinity; expect(isOnlineSnapshot(nan)).toBe(false)
  })
  it('checks event coordinates and cosmetic fields before rendering', () => {
    const s = snapshot(); s.events = [{ id: 1, tick: 2, type: 'eat', x: NaN, z: 0 }]
    expect(isOnlineSnapshot(s)).toBe(false)
    const invalid = snapshot(); (invalid.players[0] as unknown as { color: string }).color = 'not-a-color'
    expect(isOnlineSnapshot(invalid)).toBe(false)
  })
  it('validates the complete lobby shape instead of trusting a cast', () => {
    const lobby = { type: 'state', protocol: ONLINE_PROTOCOL, room: 'ABC123', seq: 1, phase: 'waiting',
      teams: { blue: [null, null, null], red: [null, null, null] }, spectators: 0, readyToStart: false,
      round: { stage: 1, arenaRadius: 128, scores: { blue: 0, red: 0 } } }
    expect(isLobbyState(lobby)).toBe(true)
    expect(isLobbyState({ ...lobby, teams: { blue: [], red: [] } })).toBe(false)
    expect(isLobbyState({ ...lobby, phase: 'unknown' })).toBe(false)
  })
})

describe('NetworkSim is a render adapter, not a game authority', () => {
  it('contains only server worms and food, with no local bots or hazards', () => {
    const sim = new NetworkSim('red-id'); sim.applyNetworkSnapshot(snapshot(), 1000)
    expect(sim.worms).toHaveLength(2); expect(sim.player.team).toBe(1); expect(sim.player.isPlayer).toBe(true)
    expect(sim.worms.every(w => w.brain === null)).toBe(true)
    for (const entities of [sim.celestials, sim.asteroids, sim.gates, sim.wells, sim.shards, sim.traps, sim.pickups, sim.surprises]) expect(entities).toEqual([])
    expect(sim.orbs).toHaveLength(1); expect(sim.teamScores()).toEqual([4, 4]); expect(sim.playerScore).toBe(4)
    const before = JSON.stringify({ worms: sim.worms, food: sim.orbs, time: sim.time })
    for (let i = 0; i < 600; i++) sim.step()
    expect(JSON.stringify({ worms: sim.worms, food: sim.orbs, time: sim.time })).toBe(before)
  })
  it('interpolates snapshots without mutating them and ignores out-of-order packets', () => {
    const sim = new NetworkSim('blue-id'), first = snapshot(1), second = snapshot(2)
    second.players[0].xs = second.players[0].xs.map(x => x + 2)
    sim.applyNetworkSnapshot(first, 1000); sim.applyNetworkSnapshot(second, 1100)
    sim.interpolate(1150); expect(sim.player.xs[0]).toBe(-49)
    sim.interpolate(1200); expect(sim.player.xs[0]).toBe(-48)
    expect(first.players[0].xs[0]).toBe(-50); expect(second.players[0].xs[0]).toBe(-48)
    sim.applyNetworkSnapshot(first, 1250); expect(sim.latest?.seq).toBe(2)
  })
  it('snaps respawns/reconnect gaps, uses server respawn timer and deduplicates events', () => {
    const sim = new NetworkSim('blue-id'), first = snapshot(1)
    first.events = [{ id: 1, tick: 2, type: 'spawn', playerId: 'blue-id', x: -50, z: 0 }]
    expect(sim.applyNetworkSnapshot(first, 1000)).toHaveLength(1)
    const death = snapshot(2); death.players[0].alive = false; death.players[0].respawnIn = 3; death.events = first.events
    expect(sim.applyNetworkSnapshot(death, 1100)).toHaveLength(0)
    expect(sim.player.alive).toBe(false); expect(sim.respawnIn).toBe(3)
    const respawn = snapshot(3); respawn.players[0].generation = 2; respawn.players[0].xs = Array(20).fill(20)
    sim.applyNetworkSnapshot(respawn, 1200); expect(sim.player.xs[0]).toBe(20)
    const resume = snapshot(4); sim.applyNetworkSnapshot(resume, 3000); expect(sim.player.xs[0]).toBe(-50)
  })
})
