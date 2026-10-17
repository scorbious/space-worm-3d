import test from 'node:test'
import assert from 'node:assert/strict'
import { WebSocket } from 'ws'
import { createMultiplayerServer } from './index.mjs'
import { PROTOCOL } from './room.mjs'

function peer(url) {
  const socket = new WebSocket(url), inbox = [], waiters = []
  socket.on('message', raw => {
    const message = JSON.parse(raw.toString()); inbox.push(message)
    for (const waiter of [...waiters]) if (waiter.predicate(message)) { clearTimeout(waiter.timer); waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(message) }
  })
  socket.on('error', () => {})
  return {
    socket, inbox,
    send: packet => socket.send(JSON.stringify({ protocol: PROTOCOL, ...packet })),
    wait: (predicate, timeout = 5000) => new Promise((resolve, reject) => {
      const existing = inbox.find(predicate)
      if (existing) { resolve(existing); return }
      const waiter = { predicate, resolve, timer: setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error('Timed out waiting for packet')) }, timeout) }
      waiters.push(waiter)
    }),
  }
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

test('real v2 clients create/join/start, receive authoritative state, resume and complete the round', { timeout: 12000 }, async t => {
  const server = createMultiplayerServer({ host: '127.0.0.1', port: 0, allowSmallMatch: true, matchOptions: { seconds: 3, foodCount: 40 } })
  const address = await server.listen()
  t.after(() => server.close())
  const base = `http://127.0.0.1:${address.port}`
  const response = await fetch(`${base}/api/room`, { method: 'POST' })
  assert.equal(response.status, 201)
  const created = await response.json(); assert.equal(created.protocol, PROTOCOL)
  const url = team => `ws://127.0.0.1:${address.port}/ws?room=${created.room}&team=${team}&protocol=${PROTOCOL}`
  const blue = peer(url('blue')), red = peer(url('red'))
  const bw = await blue.wait(m => m.type === 'welcome'), rw = await red.wait(m => m.type === 'welcome')
  assert.equal(bw.host, true); assert.equal(rw.team, 'red')
  blue.send({ type: 'hello', name: 'Blue Pilot', skin: 'nebula', color: 'cyan', headStyle: 'cat' })
  blue.send({ type: 'ready', value: true }); red.send({ type: 'ready', value: true })
  await blue.wait(m => m.type === 'state' && m.readyToStart)
  red.send({ type: 'start' }); await red.wait(m => m.type === 'error' && m.code === 'not_ready_to_start')
  blue.send({ type: 'start' })
  const first = await blue.wait(m => m.type === 'match' && m.tick === 0)
  const other = await red.wait(m => m.type === 'match' && m.tick === 0)
  assert.deepEqual(first, other)
  assert.equal(first.players.length, 2); assert.equal(first.food.length, 40)
  const player = first.players.find(p => p.id === bw.playerId)
  assert.equal(player.name, 'Blue Pilot'); assert.equal(player.headStyle, 'cat')
  blue.send({ type: 'input', targetAngle: 0.6, boost: true, seq: 10, score: 999999, xs: [0] })
  await blue.wait(m => m.type === 'error' && m.code === 'invalid_input')
  blue.send({ type: 'input', targetAngle: 0.6, boost: true, seq: 11 })
  const after = await blue.wait(m => m.type === 'match' && m.tick >= 2 && m.players.some(p => p.id === player.id && p.inputSeq === 11))
  const moved = after.players.find(p => p.id === player.id)
  assert.ok(Math.hypot(moved.xs[0] - player.xs[0], moved.zs[0] - player.zs[0]) > 0.3)
  assert.ok(Math.hypot(moved.xs[0] - player.xs[0], moved.zs[0] - player.zs[0]) <= after.tick * 1.101)
  assert.ok(moved.score < 999999); assert.equal(moved.boosting, true)
  assert.equal(after.protocol, PROTOCOL); assert.ok(after.timeLeft < 3)
  for (const forbidden of ['targetAngle', 'resumeToken', 'socket', 'inputWindow']) assert.equal(JSON.stringify(after).includes(forbidden), false)
  blue.send({ type: 'ping', t: 123 }); await blue.wait(m => m.type === 'pong' && m.t === 123)
  blue.socket.terminate()
  const disconnected = await red.wait(m => m.type === 'match' && m.players.some(p => p.id === player.id && !p.connected))
  await delay(120)
  const restored = peer(`${url('blue')}&resume=${bw.resumeToken}`)
  const welcome = await restored.wait(m => m.type === 'welcome')
  assert.equal(welcome.playerId, player.id); assert.equal(welcome.team, 'blue')
  const resumed = await restored.wait(m => m.type === 'match')
  const preserved = resumed.players.find(p => p.id === player.id), frozen = disconnected.players.find(p => p.id === player.id)
  assert.deepEqual(preserved.xs, frozen.xs); assert.equal(preserved.score, frozen.score); assert.equal(preserved.generation, frozen.generation)
  restored.send({ type: 'input', targetAngle: -0.5, boost: false, seq: 12 })
  const end = await restored.wait(m => m.type === 'matchEnd')
  assert.equal(end.phase, 'ended'); assert.equal(end.timeLeft, 0); assert.ok(['blue', 'red', 'draw'].includes(end.winner))
  const score = server.rooms.get(created.room).match.scores.blue
  restored.send({ type: 'input', targetAngle: 0, boost: false, seq: 13 })
  await restored.wait(m => m.type === 'error' && m.code === 'invalid_input')
  assert.equal(server.rooms.get(created.room).match.scores.blue, score)
  restored.send({ type: 'leave' }); await delay(30)
  assert.equal(server.rooms.get(created.room).players.has(player.id), false)
})

test('legacy protocol is clearly rejected before claiming a seat; rooms and spectators are isolated', { timeout: 5000 }, async t => {
  const server = createMultiplayerServer({ host: '127.0.0.1', port: 0 })
  const address = await server.listen(); t.after(() => server.close())
  const base = `ws://127.0.0.1:${address.port}/ws`
  const legacy = peer(`${base}?room=OLD777&protocol=spaceworm-3v3-v1`)
  const error = await legacy.wait(m => m.type === 'error')
  assert.equal(error.code, 'protocol_mismatch'); assert.equal(server.rooms.size, 0)
  const a = peer(`${base}?room=ROOMAA&protocol=${PROTOCOL}`), b = peer(`${base}?room=ROOMBB&protocol=${PROTOCOL}`)
  await a.wait(m => m.type === 'welcome'); await b.wait(m => m.type === 'welcome')
  a.send({ type: 'hello', name: 'Only room A' }); await a.wait(m => m.type === 'state' && m.teams.blue[0]?.name === 'Only room A')
  assert.equal(b.inbox.some(m => JSON.stringify(m).includes('Only room A')), false)
  for (let i = 0; i < 2; i++) await peer(`${base}?room=ROOMAA&protocol=${PROTOCOL}`).wait(m => m.type === 'welcome')
  const spectator = peer(`${base}?room=ROOMAA&protocol=${PROTOCOL}`)
  assert.equal((await spectator.wait(m => m.type === 'welcome')).team, 'spectator')
  spectator.send({ type: 'ready', value: true }); await spectator.wait(m => m.type === 'error' && m.code === 'not_ready')
  assert.equal(server.rooms.get('ROOMAA').scores.blue, 0)
})
