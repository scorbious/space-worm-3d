import test from 'node:test'
import assert from 'node:assert/strict'
import { Room, TEAM_SIZE, PROTOCOL } from './room.mjs'

function fakeSocket() {
  return { close() {}, player: null }
}

test('room seats three players per team and reports both sides', () => {
  const room = new Room('ABC123')
  const blue = Array.from({ length: TEAM_SIZE }, () => room.claim(fakeSocket(), 'blue', ''))
  const red = Array.from({ length: TEAM_SIZE }, () => room.claim(fakeSocket(), 'red', ''))
  assert.equal(blue.filter(Boolean).length, 3)
  assert.equal(red.filter(Boolean).length, 3)
  assert.equal(room.state().teams.blue.filter(Boolean).length, 3)
  assert.equal(room.state().teams.red.filter(Boolean).length, 3)
  assert.equal(room.state().readyToStart, false)
})

test('room requires all six ready players before start', () => {
  const room = new Room('READY7')
  const sockets = [...Array(3)].map(() => fakeSocket()).concat([...Array(3)].map(() => fakeSocket()))
  const players = sockets.map((socket, index) => room.claim(socket, index < 3 ? 'blue' : 'red', ''))
  players.forEach(player => room.setReady(player, true))
  assert.equal(room.isReadyToStart(), true)
  assert.equal(room.start(players[0]), true)
  assert.equal(room.state().phase, 'running')
})

test('full team becomes spectator and cannot mutate room', () => {
  const room = new Room('FULL77')
  for (let i = 0; i < TEAM_SIZE; i++) room.claim(fakeSocket(), 'blue', '')
  const observer = fakeSocket()
  assert.equal(room.claim(observer, 'blue', ''), null)
  assert.equal(room.state().spectators, 1)
  assert.equal(room.setReady(observer.player, true), false)
})

test('resume token restores a disconnected seat without changing team', () => {
  const room = new Room('RESUME')
  const firstSocket = fakeSocket()
  const player = room.claim(firstSocket, 'red', '')
  room.release(firstSocket)
  const resumedSocket = fakeSocket()
  const resumed = room.claim(resumedSocket, 'red', player.resumeToken)
  assert.equal(resumed.id, player.id)
  assert.equal(resumed.team, 'red')
  assert.equal(room.state().teams.red[0].connected, true)
  assert.equal(room.state().protocol, PROTOCOL)
})

test('development start still requires both teams and all occupied seats ready', () => {
  const room = new Room('SMALL7', { allowSmallMatch: true })
  const blue = room.claim(fakeSocket(), 'blue', '')
  room.setReady(blue, true)
  assert.equal(room.start(blue), false)
  const red = room.claim(fakeSocket(), 'red', '')
  assert.equal(room.setReady(red, 'true'), false)
  room.setReady(red, true)
  assert.equal(room.start(red), false)
  assert.equal(room.start(blue), true)
  assert.equal(room.match.players.size, 2)
  assert.equal(room.claim(fakeSocket(), 'blue', ''), null)
  assert.equal(room.setReady(blue, false), false)
})

test('resuming elsewhere cannot let a stale close release the current seat or match worm', () => {
  const room = new Room('STALE7', { allowSmallMatch: true })
  const old = fakeSocket(), current = fakeSocket()
  const blue = room.claim(old, 'blue', ''), red = room.claim(fakeSocket(), 'red', '')
  room.setReady(blue, true); room.setReady(red, true); room.start(blue)
  room.claim(current, 'red', blue.resumeToken)
  room.release(old)
  assert.equal(blue.socket, current)
  assert.equal(room.match.players.get(blue.id).connected, true)
  assert.equal(blue.team, 'blue')
  const state = JSON.stringify(room.state())
  assert.equal(state.includes(blue.resumeToken), false)
})

test('explicit leave removes the seat immediately, grace expiry removes a disconnected worm', () => {
  const room = new Room('LEAVE7', { allowSmallMatch: true })
  const a = fakeSocket(), b = fakeSocket()
  const blue = room.claim(a, 'blue', ''), red = room.claim(b, 'red', '')
  room.setReady(blue, true); room.setReady(red, true); room.start(blue)
  room.leave(a)
  assert.equal(room.players.has(blue.id), false); assert.equal(room.match.players.has(blue.id), false)
  assert.equal(room.hostId, red.id)
  room.release(b); room.expireDisconnected(Date.now() + 61000)
  assert.equal(room.players.size, 0); assert.equal(room.match.players.size, 0)
})
