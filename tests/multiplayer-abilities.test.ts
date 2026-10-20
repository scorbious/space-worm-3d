import { describe, expect, it } from 'vitest'
import { Match, validateInput } from '../server/match.mjs'
import { bombDamage } from '../src/game/upgrades'
import { isOnlineSnapshot, ONLINE_PROTOCOL, type AbilityId, type OnlineSnapshot } from '../src/net/multiplayer'
import { isPeerInput, type PeerInput } from '../src/net/p2pProtocol'
import { PeerSimulation } from '../src/net/peerSimulation'
import { NetworkSim } from '../src/game/networkSim'
const seats = ['blue', 'red'].map((team, i) => ({ id: team, team: team as 'blue' | 'red', slot: i, name: team, skin: 'nebula', socket: true }))
const input = (seq: number, abilities: AbilityId[] = [], targetAngle = 0): PeerInput => ({ type: 'input', protocol: ONLINE_PROTOCOL, seq, targetAngle, boost: false, abilities })
function initial(): OnlineSnapshot {
  const s = new Match(seats, { seed: 1, foodCount: 0 }).snapshot()
  s.events = []
  s.players.forEach((w, index) => {
    w.xs = Array.from({ length: w.length }, (_, i) => (index ? 40 : 0) - i * 1.3)
    w.zs = Array(w.length).fill(30)
    w.angle = 0; w.spawnGrace = 0
  })
  return s
}
describe('validated authoritative multiplayer abilities', () => {
  it('accepts only bounded action names, never levels/position/damage/score/target identifiers', () => {
    const good = input(1, ['ghost', 'bomb'])
    expect(validateInput(good)).toBe(true); expect(isPeerInput(good)).toBe(true)
    for (const bad of [
      { ...good, score: 9999 }, { ...good, damage: 9999 }, { ...good, x: 10 }, { ...good, targetId: 'red' },
      { ...good, levels: { ghost: 10 } }, { ...good, abilities: ['ghost', 'ghost'] }, { ...good, abilities: ['fake'] },
      { ...good, abilities: [{ kind: 'bomb', x: 0 }] }, { ...good, abilities: 'laser' }, { ...good, seq: NaN },
    ]) { expect(validateInput(bad)).toBe(false); expect(isPeerInput(bad)).toBe(false) }
  })
  it('assigns an identical host-owned loadout even when a profile claims premium levels', () => {
    const dishonest = { ...seats[0], upgrades: { ghost: 10 }, laserUnlocked: false }
    const match = new Match([dishonest, seats[1]], { foodCount: 0 })
    const s = match.snapshot()
    expect(s.players[0].abilities).toEqual(s.players[1].abilities)
    expect(s.players[0].abilities?.levels).toEqual({ ghost: 1, electric: 1, bomb: 1, shrink: 1 })
    expect(s.players[0].abilities?.laserUnlocked).toBe(true)
  })
  it('executes intent once on fixed ticks and rejects replay or client damage', () => {
    const match = Match.fromSnapshot(initial())
    const command = input(1, ['ghost'])
    expect(match.input('blue', command)).toBe(true)
    expect(match.snapshot().players[0].abilities?.ghostLeft).toBe(0)
    expect(match.input('blue', command)).toBe(false)
    expect(match.input('blue', { ...input(2), damage: 100 })).toBe(false)
    match.step()
    const active = match.snapshot()
    expect(active.players[0].abilities?.ghostLeft).toBe(5)
    expect(active.events.filter(e => e.type === 'ability')).toHaveLength(1)
    expect(match.input('blue', input(3, ['ghost']))).toBe(true)
    match.step()
    expect(match.snapshot().events.filter(e => e.type === 'ability')).toHaveLength(1)
  })
  it('prevents ghost/electric stacking and repeated electric activation', () => {
    const match = Match.fromSnapshot(initial())
    match.input('blue', input(1, ['electric', 'ghost'])); match.step()
    const first = match.snapshot().players[0].abilities!
    expect(first.electricLeft).toBeGreaterThan(0); expect(first.ghostLeft).toBe(0)
    match.input('blue', input(2, ['electric'])); match.step()
    expect(match.snapshot().events.filter(e => e.type === 'ability')).toHaveLength(1)
    expect(match.snapshot().players[0].abilities!.electricLeft).toBeLessThan(first.electricLeft)
    expect(match.snapshot().players[0].abilities!.electricCooldown).toBeGreaterThan(20)
  })
  it('places world-fixed bombs with authoritative expiry/count/drop cooldown', () => {
    const match = Match.fromSnapshot(initial())
    match.input('blue', input(1, ['bomb'])); match.step()
    const first = match.snapshot(), b = first.bombs![0]
    expect(b.left).toBe(5); expect(b.level).toBe(1)
    match.input('blue', input(2, ['bomb'])); match.step()
    const second = match.snapshot()
    expect(second.bombs).toHaveLength(1)
    expect(second.bombs![0].x).toBe(b.x); expect(second.bombs![0].z).toBe(b.z)
    expect(second.bombs![0].left).toBeLessThan(b.left)
    expect(second.players[0].xs[0]).not.toBe(first.players[0].xs[0])
    for (let i = 0; i < 105; i++) match.step()
    expect(match.snapshot().bombs).toHaveLength(0)
    expect(match.snapshot().events.some(e => e.type === 'bombExpire')).toBe(true)
  })
  it('applies bomb damage only in host physics and never below minimum viable length', () => {
    const s = initial()
    s.players[1].xs = s.players[1].xs.map((_, i) => 6 + i * 1.3); s.players[1].angle = Math.PI
    const match = Match.fromSnapshot(s)
    match.input('blue', input(1, ['ghost', 'bomb'])); match.step()
    const result = match.snapshot(), target = result.players[1]
    expect(target.length).toBe(20 - bombDamage(1))
    expect(target.alive).toBe(true)
    expect(result.events.some(e => e.type === 'bombDetonate' && e.targetId === 'red' && e.damage === bombDamage(1))).toBe(true)
    expect(result.bombs).toHaveLength(0)
  })
  it('synchronizes shrink radius while preserving logical mass, score and body length', () => {
    const match = Match.fromSnapshot(initial())
    match.input('blue', input(1, ['shrink'])); match.step()
    const s = match.snapshot()
    expect(s.players[0].length).toBe(20); expect(s.players[0].score).toBe(0)
    const sim = new NetworkSim('blue'); sim.applyNetworkSnapshot(s)
    expect(sim.player.shrinkLeft).toBeGreaterThan(0)
    expect(sim.player.radius).toBeLessThan(.95)
    expect(sim.player.xs.length).toBe(20)
    match.input('blue', input(2, ['shrink'])); match.step()
    expect(match.snapshot().events.filter(e => e.type === 'ability')).toHaveLength(1)
  })
  it('authoritatively selects laser hits, consumes one shot per match and survives peer migration/respawn', () => {
    const match = Match.fromSnapshot(initial())
    match.input('blue', input(1, ['laser'])); match.step()
    const s = match.snapshot()
    expect(s.players[0].abilities!.laserUsed).toBe(true)
    expect(s.players[1].alive).toBe(false)
    expect(s.players[0].kills).toBe(1)
    expect(s.events.find(e => e.type === 'laserFire')).toMatchObject({ playerId: 'blue', targetId: 'red', tx: 40, tz: 30 })
    expect(isOnlineSnapshot(s)).toBe(true)
    const peer = PeerSimulation.restore(s)
    peer.input('blue', input(2, ['laser'])); peer.step()
    expect(peer.snapshot().events.filter(e => e.type === 'laserFire')).toHaveLength(1)
    expect(peer.snapshot().players[0].abilities!.laserUsed).toBe(true)
    for (let i = 0; i < 65; i++) peer.step()
    expect(peer.snapshot().players[1].alive).toBe(true)
    expect(peer.snapshot().players[0].abilities!.laserUsed).toBe(true)
  })
  it('ignores laser misses and ghosts/spawn-protected allies rather than spending a shot', () => {
    for (const protectedTarget of ['ghost', 'spawn', 'ally', 'outOfRange']) {
      const s = initial()
      if (protectedTarget === 'ghost') s.players[1].abilities!.ghostLeft = 5
      if (protectedTarget === 'spawn') s.players[1].spawnGrace = 1
      if (protectedTarget === 'ally') s.players[1].team = 'blue'
      if (protectedTarget === 'outOfRange') s.players[1].xs = s.players[1].xs.map(x => x + 90)
      const match = Match.fromSnapshot(s)
      match.input('blue', input(1, ['laser'])); match.step()
      expect(match.snapshot().players[0].abilities!.laserUsed).toBe(false)
    }
  })
  it('restores active timers/fixed bombs and renders remote glass/electric state without local simulation', () => {
    const match = Match.fromSnapshot(initial())
    match.input('blue', input(1, ['ghost', 'bomb'])); match.input('red', input(1, ['electric'])); match.step()
    const s = match.snapshot(), restored = PeerSimulation.restore(s).snapshot()
    expect(restored.players.map(p => p.abilities)).toEqual(s.players.map(p => p.abilities))
    expect(restored.bombs).toEqual(s.bombs)
    const sim = new NetworkSim('blue')
    expect(sim.applyNetworkSnapshot(s)).toHaveLength(3)
    expect(sim.player.ghostLeft).toBeGreaterThan(0)
    expect(sim.worms.find(w => !w.isPlayer)!.electricLeft).toBeGreaterThan(0)
    expect(sim.worms.find(w => !w.isPlayer)!.electricLevel).toBe(1)
    const frozen = JSON.stringify(sim.worms)
    sim.step(); expect(JSON.stringify(sim.worms)).toBe(frozen)
    expect(sim.applyNetworkSnapshot(s)).toEqual([])
  })
  it('rejects malformed snapshots/timers/damage and never trusts peer-reported upgraded levels', () => {
    const s = initial()
    expect(isOnlineSnapshot(s)).toBe(true)
    s.players[0].abilities!.levels.ghost = 10
    expect(isOnlineSnapshot(s)).toBe(false)
    s.players[0].abilities!.levels.ghost = 1; s.players[0].abilities!.electricLeft = Infinity
    expect(isOnlineSnapshot(s)).toBe(false)
    const damage = initial(); damage.events = [{ id: 1, tick: 0, type: 'electricHit', damage: 999 }]
    expect(isOnlineSnapshot(damage)).toBe(false)
    const bomb = initial(); bomb.bombs = [{ id: 1, ownerId: 'fake', x: 0, z: 0, level: 1, left: 5 }]
    expect(isOnlineSnapshot(bomb)).toBe(false)
  })
})
