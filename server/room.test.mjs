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
