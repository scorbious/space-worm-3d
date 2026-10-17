# Authoritative online multiplayer (v2)

The browser is now a **renderer and input device**, not a second game authority. FFA and local Team retain the existing `Sim` and save progression. Online uses `NetworkSim`: it hydrates server worms/food and interpolates positions through the existing Three.js View without calling local movement, bots, collision, eating or respawn rules. Online results deliberately do not grant local stardust or modify local records.

## Local development: two real clients

Node 22+ and pnpm 10 are recommended. Install with `pnpm install --frozen-lockfile`.

Terminal 1:

```bash
ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000 DEV_ALLOW_SMALL_MATCH=1 pnpm multiplayer:server
```

Terminal 2:

```bash
VITE_MULTIPLAYER_URL=ws://127.0.0.1:8787/ws pnpm dev
```

Open `http://127.0.0.1:3000` in two **separate browser contexts/profiles** (or normal + private browsing). Create Blue, open the Orange invitation link in the second context, ready both players, and let the host start. The HUD opens automatically and the same server arena appears on both clients. Two same-team tabs in one session can resume the same seat: use distinct contexts for separate players.

`DEV_ALLOW_SMALL_MATCH=1` enables at least one player **per team**, with every occupied seat connected and ready. It adds no bots and cannot bypass readiness. This flag is ignored under `NODE_ENV=production`. Without it, start requires the original six connected ready players (3v3). Invitations retain `match` and `team` query parameters and work on nested static-host base paths.

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `VITE_MULTIPLAYER_URL` | Actual browser WebSocket endpoint, ending in `/ws`; build-time Vite value | None |
| `HOST` (server) | Node listen address; use `0.0.0.0` behind an external reverse proxy | `127.0.0.1` |
| `PORT` (server) | Node HTTP/WebSocket port; `0` is useful for tests | `8787` |
| `ALLOWED_ORIGINS` | Comma-separated **exact** browser origins, including scheme and port, no trailing slash | Empty; same-origin accepted |
| `DEV_ALLOW_SMALL_MATCH` | Explicit development-only 1v1-or-larger smoke option | Off |
| `NODE_ENV` | Use `production` in production; disables small-match bypass | Unset |

The Vite frontend has its own `HOST`/`PORT` settings (default port 3000); start it in a separate terminal so Node's port does not overwrite the frontend's port. Bootstrap fallback is `public/multiplayer/bootstrap.json`, with `build: spaceworm-3v3-v2` and `signalingUrl` containing the real running server endpoint. The checked-in URL is intentionally empty, not fictitious. If neither source is configured, Arabic/English UI explains how to configure the server and local modes remain playable. HTTPS pages require **WSS**; plain WS is only for HTTP local development.

## Simulation and protocol

- Protocol `spaceworm-3v3-v2`; query parameter `protocol` and all message packets must match. A v1/missing protocol gets `protocol_mismatch` and close 4002 **before** seat reservation.
- Server `Match.step()` is 20 Hz, snapshots 10 Hz. A server-owned accumulator bounds catch-up to 250 ms under overload, avoiding an unbounded spiral; severe overload can slow game time instead of skipping collision ticks.
- Four-minute rounds; radius 128, increasing by 8 each stage/minute up to stage 5. Seeded food starts at 420, replenishes deterministically, stays stationary until eaten. Worm length starts at 20, capped at 240, body spacing 1.3, collision radius 0.95, speed 12 or boost 22 units/s; turn rate 2.8 rad/s. Boost requires length >12, burns one segment per 0.5 seconds and expires after 0.5 seconds without fresh input.
- Rim, own body beyond the neck, enemy body and head collisions are server-resolved. Enemy head clashes kill both; teammates are non-colliding. Server respawns after three seconds with two seconds of spawn protection. Food earns 1 point (death drops 2); enemy elimination earns 50; cumulative scores survive death.
- `input`: only `{type, protocol, targetAngle, boost, seq}`. Angle must be finite within ±2π, boost boolean, monotonically increasing integer sequence; unknown fields (position, score, etc.) are rejected. No client worm state or score is accepted. Limits: 40 valid input attempts/player/s, 60 total messages/socket/s, 4096-byte incoming payload, bounded outbound buffering, 128 rooms/clients, 12 spectators/room.
- `hello` selects sanitized name/skin and allow-listed color/head style only while waiting; `ready` requires a boolean and a seat; `start` requires the host and ready seats; `leave` removes the seat immediately; `ping` echoes a safe-integer timestamp. Spectators cannot control, ready or start.
- `match`/`matchEnd` snapshots contain protocol, tick, monotonically increasing seq, phase, timeLeft, arena stage/radius, scores, players and food. Players contain id/team/slot/name/skin/color/headStyle/connected/alive/xs/zs/angle/length/boosting/score/kills plus inputSeq acknowledgment, generation, spawnGrace and respawnIn. There are no input targets, socket objects or resume secrets in broadcasts.
- Events have stable id/tick and a bounded recent history (128); clients deduplicate and suppress stale effects. Spawn, eat, death, stage and end FX are server-sourced. `matchEnd` includes the final winner and complete scoreboard. Reconnecting after the end receives the same final authoritative result.
- Disconnect reserves the same seat and worm for 60 seconds. The disconnected worm freezes and is non-colliding; match time still advances. A resume token held in sessionStorage restores the same id/team/body/score, with a fresh snapshot. Old sockets cannot alter or release the resumed seat. Heartbeats clean up dead transports. After grace, the seat/worm is removed; joining a running room without a valid token is spectator-only.
- Client sends intent at up to 20 Hz, measures ping every 2 seconds, retries transport with bounded exponential backoff for 60 seconds, validates snapshots before hydration, and interpolates about one snapshot behind. There is no prediction/rollback. Opening menus does not pause the online server; controls stop boosting while menus/hidden tabs are active.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm multiplayer:test
pnpm build
git diff --check
```

Node integration tests open the real HTTP/ws service on an ephemeral port, create a room, connect Blue/Orange, enforce ready/host start, reject score/position spoofing, send real input, compare authoritative snapshots, verify ping, disconnect/resume and complete the round. Additional room/simulation tests cover rate validation, determinism, collisions, grace, bounds and timer. No six-browser setup is needed for protocol tests.

## Production hosting and remaining MVP limits

**GitHub Pages serves only the frontend. It cannot run Node/ws or the fixed-tick loop.** Deploy a real persistent Node process behind a TLS/WebSocket-capable proxy, configure exact allowed frontend origins, then set the actual WSS endpoint and rebuild/redeploy the client. No production endpoint is deployed by this change.

A lightweight single-process service can fit **Manus WebDev Reserved Hosting** (1 vCPU / 512 MB; single persistent process), with integration into that project's backend and its real public URL; default stateless/multi-instance Autoscale is not appropriate for these in-memory rooms. Reserved is usage-billed; enable it only after reviewing resource needs and cost (up to about $37.50/month compute at full continuous allocation, less $10 monthly usage credit; egress extra). External persistent Node hosting is another option. Neither is automatically enabled here.

This is an in-memory private-room MVP: process restarts lose rooms and tokens; there is no account identity, durable/ranked leaderboard, automatic rematch, cross-instance room routing, spectators switching seats mid-match, delta/binary snapshots or latency compensation. The deliberately smaller online arena feature set includes worms, boost, food, team combat, stage growth and timer, **not** local celestial powers, hazards, crowns or traps. All existing local features remain local and intact. Freeze grace prevents connection-drop kills but is not a ranked anti-exploit policy. Load-test before production: full JSON food/body snapshots and collision scans consume CPU/bandwidth. Never treat client cosmetics, local tuning settings or client-reported score as authorization.
