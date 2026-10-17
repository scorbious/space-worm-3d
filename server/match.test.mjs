import test from 'node:test'
import assert from 'node:assert/strict'
import { Match, PROTOCOL, validateInput, START_LENGTH } from './match.mjs'
const seats = () => ['blue', 'red'].map((team, slot) => ({ id: team, team, slot: 0, name: team, skin: 'nebula', socket: {} }))
const make = options => new Match(seats(), { seed: 123, foodCount: 0, ...options })
const input = (seq = 1, angle = 0, boost = false) => ({ type: 'input', protocol: PROTOCOL, seq, targetAngle: angle, boost })
const ticks = (match, n) => { for (let i = 0; i < n; i++) match.step() }
function place(w, x, z, angle = 0) {
  w.xs = Array.from({ length: w.length }, (_, i) => x - Math.cos(angle) * i * 1.3)
  w.zs = Array.from({ length: w.length }, (_, i) => z - Math.sin(angle) * i * 1.3)
  w.angle = w.targetAngle = angle; w.invulnerableUntil = 0
}

test('seeded simulation and replenished food are deterministic', () => {
  const a = make({ foodCount: 100 }), b = make({ foodCount: 100 })
  ticks(a, 80); ticks(b, 80)
  assert.deepEqual(a.snapshot(), b.snapshot())
  assert.equal(a.food.length, 100)
  assert.ok(a.food.every(f => Math.hypot(f.x, f.z) <= a.arenaRadius))
})

test('input validation rejects spoofed position/score, bad types, versions and sequence', () => {
  const match = make()
  for (const invalid of [null, [], {}, { ...input(), score: 1e9 }, { ...input(), xs: [0] }, { ...input(), seq: 1.5 },
    { ...input(), seq: -1 }, { ...input(), targetAngle: NaN }, { ...input(), targetAngle: Infinity },
    { ...input(), targetAngle: 100 }, { ...input(), boost: 'true' }, { ...input(), protocol: 'spaceworm-3v3-v1' }]) {
    assert.equal(validateInput(invalid), false)
    assert.equal(match.input('blue', invalid), false)
  }
  assert.equal(match.input('unknown', input()), false)
  assert.equal(match.input('blue', input()), true)
  assert.equal(match.input('blue', input()), false)
  assert.equal(match.players.get('blue').score, 0)
  const publicState = JSON.stringify(match.snapshot())
  for (const privateKey of ['targetAngle', 'inputWindow', 'boostCost', 'resumeToken', 'socket']) assert.equal(publicState.includes(privateKey), false)
})

test('controls are rate-limited and turn/speed bounded; boost expires on stale input', () => {
  const match = make(), w = match.players.get('blue')
  for (let i = 0; i < 40; i++) assert.equal(match.input('blue', input(i, Math.PI, true), 1000), true)
  assert.equal(match.input('blue', input(40), 1000), false)
  const x = w.xs[0], z = w.zs[0], a = w.angle
  match.step()
  assert.ok(Math.abs(w.angle - a) <= 0.141)
  assert.ok(Math.hypot(w.xs[0] - x, w.zs[0] - z) <= 1.101)
  ticks(match, 10)
  assert.equal(w.boosting, false)
  assert.equal(match.input('blue', input(41), 2001), true)
})

test('only server eating changes mass and score, food is removed for all clients', () => {
  const match = make(), w = match.players.get('blue')
  place(w, 0, 30)
  match.addFood(0.6, 30)
  match.step()
  assert.equal(w.score, 1); assert.equal(match.scores.blue, 1)
  assert.equal(w.length, START_LENGTH + 1); assert.equal(match.food.length, 0)
  assert.ok(match.snapshot().events.some(e => e.type === 'eat' && e.playerId === 'blue'))
})

test('rim kills and server respawns after three seconds without resetting score', () => {
  const match = make(), w = match.players.get('blue')
  place(w, 127.8, 0); w.score = 10
  match.step(); assert.equal(w.alive, false)
  assert.equal(match.events.at(-1).cause, 'rim')
  ticks(match, 59); assert.equal(w.alive, false)
  match.step(); assert.equal(w.alive, true); assert.equal(w.generation, 2); assert.equal(w.score, 10)
})

test('enemy head collision is simultaneous, body collision awards killer score, allies are safe', () => {
  let match = make(), blue = match.players.get('blue'), red = match.players.get('red')
  place(blue, -1, 0); place(red, 1, 0, Math.PI)
  match.step(); assert.equal(blue.alive, false); assert.equal(red.alive, false)
  assert.equal(blue.kills, 1); assert.equal(red.kills, 1)
  match = make(); blue = match.players.get('blue'); red = match.players.get('red')
  place(blue, 0, 0); place(red, 12, 1.1)
  match.step(); assert.equal(blue.alive, false); assert.equal(red.kills, 1); assert.equal(match.scores.red, 50)
  match = make(); blue = match.players.get('blue'); red = match.players.get('red')
  red.team = 'blue'; place(blue, -1, 0); place(red, 1, 0, Math.PI)
  match.step(); assert.equal(blue.alive, true); assert.equal(red.alive, true)
})

test('own body is lethal beyond the neck and spawn protection excludes collisions', () => {
  const match = make(), w = match.players.get('blue')
  place(w, 0, 30)
  w.xs.splice(0, 9, 0, -1.3, -2.6, -2.6, -1.3, 0, 1.3, 1.3, 0.6)
  w.zs.splice(0, 9, 30, 30, 30, 31.3, 31.3, 31.3, 31.3, 30, 30)
  match.step(); assert.equal(w.alive, false); assert.equal(match.events.at(-1).cause, 'self')
  const protectedMatch = make(), p = protectedMatch.players.get('blue'), r = protectedMatch.players.get('red')
  place(p, -1, 0); place(r, 1, 0, Math.PI); p.invulnerableUntil = 40
  protectedMatch.step(); assert.equal(p.alive, true); assert.equal(r.alive, true)
})

test('disconnect grace preserves full worm state, forbids inputs and resumes without respawn', () => {
  const match = make(), w = match.players.get('blue')
  w.score = 12; match.setConnected(w.id, false)
  const body = [...w.xs], generation = w.generation
  ticks(match, 30)
  assert.deepEqual(w.xs, body); assert.equal(w.score, 12)
  assert.equal(match.input(w.id, input()), false)
  match.setConnected(w.id, true); match.step()
  assert.equal(w.generation, generation); assert.notDeepEqual(w.xs, body)
})

test('stage/radius and timer advance at fixed ticks; final score is immutable', () => {
  const match = make({ seconds: 61 })
  ticks(match, 1200)
  assert.equal(match.stage, 2); assert.equal(match.arenaRadius, 136)
  assert.equal(match.timeLeft, 1)
  ticks(match, 20); assert.equal(match.phase, 'ended')
  const end = match.snapshot('matchEnd')
  assert.equal(end.winner, match.winner()); assert.equal(end.timeLeft, 0)
  const tick = match.tick; match.step(); assert.equal(match.tick, tick)
  assert.equal(match.input('blue', input()), false)
})
