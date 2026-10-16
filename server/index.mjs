#!/usr/bin/env node
import { createServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { cleanRoomCode, newRoomCode, Room, PROTOCOL } from './room.mjs'

const HOST = process.env.HOST || '127.0.0.1'
const PORT = Number(process.env.PORT || 8787)
const MAX_ROOMS = 128
const MAX_CLIENTS = 128
const MAX_SPECTATORS = 12
const MAX_PAYLOAD = 4096
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean))
const rooms = new Map()
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) throw new Error('Invalid PORT')
const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, accept',
}

function send(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 64 * 1024) return
  socket.send(JSON.stringify(payload))
}

function roomFor(code) {
  if (!rooms.has(code)) rooms.set(code, new Room(code))
  return rooms.get(code)
}

function announce(room) {
  const payload = room.state()
  for (const player of room.players.values()) if (player.socket) send(player.socket, payload)
  for (const observer of room.observers) send(observer, payload)
}

function error(socket, code, message = code) {
  send(socket, { type: 'error', protocol: PROTOCOL, code, message })
}

const httpServer = createServer((request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders)
    response.end()
    return
  }
  if (url.pathname === '/healthz') {
    response.writeHead(200, { ...corsHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(JSON.stringify({ ok: true, protocol: PROTOCOL, rooms: rooms.size, clients: websocketServer.clients.size, uptime: process.uptime() }))
    return
  }
  if (url.pathname === '/api/room' && request.method === 'POST') {
    if (rooms.size >= MAX_ROOMS) { response.writeHead(503); response.end('rooms full'); return }
    let code = newRoomCode()
    while (rooms.has(code)) code = newRoomCode()
    roomFor(code)
    response.writeHead(201, { ...corsHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(JSON.stringify({ room: code, protocol: PROTOCOL }))
    return
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  response.end('Not found')
})

const websocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD })
httpServer.on('upgrade', (request, socket, head) => {
  let url
  try { url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`) } catch { socket.destroy(); return }
  const origin = request.headers.origin
  let sameOrigin = false
  try { sameOrigin = Boolean(origin) && new URL(origin).host === request.headers.host } catch {}
  if (websocketServer.clients.size >= MAX_CLIENTS || (origin && !sameOrigin && !allowedOrigins.has(origin))) { socket.destroy(); return }
  if (url.pathname !== '/ws') { socket.destroy(); return }
  const roomCode = cleanRoomCode(url.searchParams.get('room'))
  if (!roomCode || (!rooms.has(roomCode) && rooms.size >= MAX_ROOMS)) { socket.destroy(); return }
  websocketServer.handleUpgrade(request, socket, head, ws => {
    websocketServer.emit('connection', ws, url)
  })
})

websocketServer.on('connection', (socket, url) => {
  const room = roomFor(cleanRoomCode(url.searchParams.get('room')))
  const desiredTeam = url.searchParams.get('team') === 'red' ? 'red' : 'blue'
  const resumeToken = String(url.searchParams.get('resume') || '').slice(0, 80)
  if (room.observers.size >= MAX_SPECTATORS && room.seats[desiredTeam].every(Boolean)) {
    socket.close(1013, 'room full')
    return
  }
  const player = room.claim(socket, desiredTeam, resumeToken)
  send(socket, {
    type: 'welcome',
    protocol: PROTOCOL,
    room: room.code,
    team: player?.team || 'spectator',
    slot: player?.slot ?? -1,
    host: player?.id === room.hostId,
    resumeToken: player?.resumeToken || '',
    state: room.state(),
  })
  announce(room)

  socket.inputWindow = Date.now()
  socket.inputCount = 0
  socket.on('message', raw => {
    try {
      if (Date.now() - socket.inputWindow >= 1000) { socket.inputWindow = Date.now(); socket.inputCount = 0 }
      if (++socket.inputCount > 30) { socket.close(1008, 'message rate exceeded'); return }
      const message = JSON.parse(raw.toString())
      const current = socket.player
      if (message?.type === 'hello') {
        room.setProfile(current, message.name, message.skin)
      } else if (message?.type === 'ready') {
        if (!room.setReady(current, message.value)) error(socket, 'not_ready')
      } else if (message?.type === 'start') {
        if (!room.start(current)) error(socket, 'not_ready_to_start', 'Both teams need three connected ready players')
      } else if (message?.type === 'leave') {
        socket.close(1000, 'left room')
        return
      } else if (message?.type === 'ping') {
        send(socket, { type: 'pong', protocol: PROTOCOL, t: Number.isSafeInteger(message.t) ? message.t : 0 })
      } else {
        error(socket, 'invalid_message')
      }
      announce(room)
    } catch {
      error(socket, 'invalid_message')
    }
  })
  socket.on('close', () => { room.release(socket); announce(room) })
  socket.on('error', () => { room.release(socket); announce(room) })
})

setInterval(() => {
  for (const [code, room] of rooms) if (room.expireDisconnected()) rooms.delete(code)
}, 15_000).unref()

httpServer.listen(PORT, HOST, () => console.log(`Space Worm multiplayer listening on http://${HOST}:${PORT}`))
