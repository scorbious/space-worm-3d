#!/usr/bin/env node
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { WebSocketServer, WebSocket } from 'ws'
import { cleanRoomCode, newRoomCode, Room, PROTOCOL } from './room.mjs'
import { DT, TICK_HZ, SNAPSHOT_HZ } from './match.mjs'

/** Each instance owns its rooms/timers; import does not open a port (integration tests use port 0). */
export function createMultiplayerServer(options = {}) {
  const host = options.host ?? process.env.HOST ?? '127.0.0.1'
  const port = options.port ?? Number(process.env.PORT || 8787)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT')
  const allowedOrigins = new Set(options.allowedOrigins ?? (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean))
  const allowSmallMatch = process.env.NODE_ENV !== 'production' && (options.allowSmallMatch === true || process.env.DEV_ALLOW_SMALL_MATCH === '1')
  const rooms = new Map()
  const corsHeaders = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, accept' }
  const send = (socket, payload) => {
    if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount <= 256 * 1024) socket.send(JSON.stringify(payload))
  }
  const broadcast = (room, payload) => {
    for (const player of room.players.values()) if (player.socket) send(player.socket, payload)
    for (const observer of room.observers) send(observer, payload)
  }
  const announce = room => broadcast(room, room.state())
  const error = (socket, code) => send(socket, { type: 'error', protocol: PROTOCOL, code, message: code })
  const roomFor = code => {
    if (!rooms.has(code)) rooms.set(code, new Room(code, { allowSmallMatch, matchOptions: options.matchOptions }))
    return rooms.get(code)
  }
  const httpServer = createServer((request, response) => {
    let url
    try { url = new URL(request.url || '/', 'http://localhost') } catch { response.writeHead(400); response.end(); return }
    if (request.method === 'OPTIONS') { response.writeHead(204, corsHeaders); response.end(); return }
    if (url.pathname === '/healthz') {
      response.writeHead(200, { ...corsHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(JSON.stringify({ ok: true, protocol: PROTOCOL, rooms: rooms.size, clients: websocketServer.clients.size, uptime: process.uptime() }))
      return
    }
    if (url.pathname === '/api/room' && request.method === 'POST') {
      if (rooms.size >= 128) { response.writeHead(503); response.end('rooms full'); return }
      let code = newRoomCode()
      while (rooms.has(code)) code = newRoomCode()
      roomFor(code)
      response.writeHead(201, { ...corsHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(JSON.stringify({ room: code, protocol: PROTOCOL }))
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); response.end('Not found')
  })
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 4096 })
  httpServer.on('upgrade', (request, socket, head) => {
    let url
    try { url = new URL(request.url || '/', 'http://localhost') } catch { socket.destroy(); return }
    const origin = request.headers.origin
    let sameOrigin = false
    try { sameOrigin = Boolean(origin) && new URL(origin).host === request.headers.host } catch {}
    const code = cleanRoomCode(url.searchParams.get('room'))
    if (websocketServer.clients.size >= 128 || url.pathname !== '/ws' || !code ||
        (origin && !sameOrigin && !allowedOrigins.has(origin)) || (!rooms.has(code) && rooms.size >= 128)) { socket.destroy(); return }
    websocketServer.handleUpgrade(request, socket, head, ws => websocketServer.emit('connection', ws, url))
  })
  websocketServer.on('connection', (socket, url) => {
    // Reject v1 before reserving a seat. Never silently run the old lobby-only client.
    if (url.searchParams.get('protocol') !== PROTOCOL) {
      error(socket, 'protocol_mismatch'); socket.close(4002, 'Requires spaceworm-3v3-v2; refresh client'); return
    }
    const room = roomFor(cleanRoomCode(url.searchParams.get('room')))
    const desiredTeam = url.searchParams.get('team') === 'red' ? 'red' : 'blue'
    const resumeToken = String(url.searchParams.get('resume') || '').slice(0, 80)
    room.expireDisconnected()
    const canResume = [...room.players.values()].some(p => p.resumeToken === resumeToken)
    if (!canResume && room.observers.size >= 12 && (room.phase !== 'waiting' || room.seats[desiredTeam].every(Boolean))) { socket.close(1013, 'room full'); return }
    const player = room.claim(socket, desiredTeam, resumeToken)
    send(socket, {
      type: 'welcome', protocol: PROTOCOL, room: room.code, playerId: player?.id || '',
      team: player?.team || 'spectator', slot: player?.slot ?? -1, host: player?.id === room.hostId,
      resumeToken: player?.resumeToken || '', state: room.state(),
    })
    if (room.match) send(socket, room.match.snapshot(room.phase === 'ended' ? 'matchEnd' : 'match'))
    announce(room)
    socket.messageWindow = Date.now(); socket.messageCount = 0; socket.lastPong = Date.now()
    socket.on('pong', () => { socket.lastPong = Date.now() })
    socket.on('message', raw => {
      const now = Date.now()
      if (now - socket.messageWindow >= 1000) { socket.messageWindow = now; socket.messageCount = 0 }
      if (++socket.messageCount > 60) { socket.close(1008, 'message rate exceeded'); return }
      let message
      try { message = JSON.parse(raw.toString()) } catch { error(socket, 'invalid_message'); return }
      if (!message || typeof message !== 'object' || Array.isArray(message)) { error(socket, 'invalid_message'); return }
      if (message.protocol !== PROTOCOL) { error(socket, 'protocol_mismatch'); socket.close(4002, 'Requires v2'); return }
      const current = socket.player
      if (current && current.socket !== socket) return // Old resumed socket cannot mutate the new owner's seat.
      if (message.type === 'input') {
        if (!current || !room.match?.input(current.id, message, now)) error(socket, 'invalid_input')
        return // Inputs and ping must never broadcast lobby state or raw control packets.
      }
      if (message.type === 'ping') {
        if (!Number.isSafeInteger(message.t)) { error(socket, 'invalid_message'); return }
        send(socket, { type: 'pong', protocol: PROTOCOL, t: message.t }); return
      }
      if (message.type === 'hello') {
        room.setProfile(current, message.name, message.skin, message.color, message.headStyle)
      } else if (message.type === 'ready') {
        if (!room.setReady(current, message.value)) { error(socket, 'not_ready'); return }
      } else if (message.type === 'start') {
        if (!room.start(current)) { error(socket, 'not_ready_to_start'); return }
        announce(room); broadcast(room, room.match.snapshot()); return
      } else if (message.type === 'leave') {
        room.leave(socket); announce(room); socket.close(1000, 'left room'); return
      } else { error(socket, 'invalid_message'); return }
      announce(room)
    })
    socket.on('close', () => { room.release(socket); announce(room) })
    socket.on('error', () => { socket.terminate() })
  })

  let last = performance.now(), accumulator = 0
  const matchLoop = setInterval(() => {
    const now = performance.now()
    accumulator += Math.min(0.25, (now - last) / 1000); last = now
    while (accumulator >= DT) {
      accumulator -= DT
      for (const room of rooms.values()) if (room.phase === 'running' && room.match) {
        room.match.step()
        if (room.match.phase === 'ended') {
          room.phase = 'ended'; broadcast(room, room.match.snapshot('matchEnd')); announce(room)
        } else if (room.match.tick % (TICK_HZ / SNAPSHOT_HZ) === 0) broadcast(room, room.match.snapshot())
      }
    }
  }, 1000 / TICK_HZ)
  const maintenance = setInterval(() => {
    for (const socket of websocketServer.clients) {
      if (Date.now() - (socket.lastPong || 0) > 45_000) socket.terminate()
      else if (socket.readyState === WebSocket.OPEN) socket.ping()
    }
    for (const [code, room] of rooms) {
      const count = room.players.size
      if (room.expireDisconnected()) rooms.delete(code)
      else if (count !== room.players.size) announce(room)
    }
  }, 15_000)
  matchLoop.unref(); maintenance.unref()
  return {
    rooms, httpServer, websocketServer,
    listen: () => new Promise((resolve, reject) => {
      httpServer.once('error', reject)
      httpServer.listen(port, host, () => { httpServer.removeListener('error', reject); resolve(httpServer.address()) })
    }),
    close: async () => {
      clearInterval(matchLoop); clearInterval(maintenance)
      for (const socket of websocketServer.clients) socket.terminate()
      await new Promise(resolve => websocketServer.close(resolve))
      if (httpServer.listening) await new Promise(resolve => httpServer.close(resolve))
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createMultiplayerServer()
  const address = await server.listen()
  console.log(`Space Worm v2 multiplayer listening on http://${address.address}:${address.port}`)
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.close() })
}
