import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import assert from 'node:assert/strict'
// Run only through the local emulator command documented in docs/P2P.md.
const env = await initializeTestEnvironment({ projectId: 'demo-spaceworm-test', database: { host: '127.0.0.1', port: 19000,
  rules: readFileSync(new URL('../firebase.database.rules.json', import.meta.url), 'utf8') } })
let checks = 0
const ok = async p => { await assertSucceeds(p); checks++ }
const no = async p => { await assertFails(p); checks++ }
const a = env.authenticatedContext('owner-a').database(), b = env.authenticatedContext('owner-b').database()
const outsider = env.authenticatedContext('outsider').database(), unauth = env.unauthenticatedContext().database()
const root = 'rooms/ROOM1234', aid = 'p0000000000000001', bid = 'p0000000000000002'
const presence = (uid, id, creator) => ({ uid, peerId: id, team: creator ? 'blue' : 'red', creator, ready: false, joinedAt: Date.now(), seenAt: Date.now(),
  name: 'Test', skin: 'nebula', color: 'cyan', headStyle: 'cat' })
try {
  await env.clearDatabase()
  await no(unauth.ref(`${root}/presence/owner-a/${aid}`).set(presence('owner-a', aid, true)))
  await ok(a.ref(`${root}/presence/owner-a/${aid}`).onDisconnect().remove())
  await ok(a.ref(`${root}/presence/owner-a/${aid}`).set(presence('owner-a', aid, true)))
  let lease = { peerId: aid, uid: 'owner-a', epoch: 1, expiresAt: Date.now() + 8000, roomExpiresAt: Date.now() + 86400000, phase: 'waiting' }
  await ok(a.ref(`${root}/presence/_lease`).set(lease))
  await no(outsider.ref(`${root}/presence`).get())
  await no(a.ref('rooms').get())
  await no(a.ref('rooms/OTHER123/presence').get())
  await no(b.ref(`${root}/presence/owner-b/${bid}`).set(presence('owner-b', bid, true)))
  await ok(b.ref(`${root}/presence/owner-b/${bid}`).set(presence('owner-b', bid, false)))
  await ok(b.ref(`${root}/presence`).get())
  await no(b.ref(`${root}/presence/owner-a/${aid}/ready`).set(true))
  await no(a.ref(`${root}/presence/owner-a/${aid}/score`).set(999))
  await no(a.ref(`${root}/state`).set({ score: 999 }))
  await no(a.ref(`${root}/score`).set(999))
  await no(a.ref(`${root}/presence/owner-a/${aid}/joinedAt`).set(Date.now() - 100))
  await ok(a.ref(`${root}/presence/owner-a/${aid}/ready`).set(true))
  await ok(a.ref(`${root}/presence/_lease`).transaction(current => ({ ...current, expiresAt: Date.now() + 8000 })))
  await no(b.ref(`${root}/presence/_lease`).set({ ...lease, peerId: bid, uid: 'owner-b', epoch: 2 }))
  const sig = { id: 'c0000000000000001', from: aid, to: bid, fromUid: 'owner-a', toUid: 'owner-b', epoch: 1,
    createdAt: Date.now(), expiresAt: Date.now() + 60000, sdp: { type: 'offer', sdp: 'test' } }
  await ok(a.ref(`${root}/offers/${bid}/${aid}`).set(sig))
  await ok(b.ref(`${root}/offers/${bid}`).get())
  await no(outsider.ref(`${root}/offers/${bid}`).get())
  await no(b.ref(`${root}/offers/${bid}/${aid}`).set(sig))
  await no(a.ref(`${root}/offers/${bid}/${aid}`).set({ ...sig, score: 100 }))
  await ok(b.ref(`${root}/answers/${aid}/${bid}`).set({ ...sig, from: bid, to: aid, fromUid: 'owner-b', toUid: 'owner-a', sdp: { type: 'answer', sdp: 'test' } }))
  const candidate = { ...sig, candidate: { candidate: 'test ICE', sdpMid: '0', sdpMLineIndex: 0 } }; delete candidate.sdp
  await ok(a.ref(`${root}/candidates/${bid}/${aid}/one`).set(candidate))
  await no(b.ref(`${root}/candidates/${bid}/${aid}/one`).set(candidate))
  await ok(b.ref(`${root}/candidates/${bid}/${aid}`).remove())
  await ok(b.ref(`${root}/offers/${bid}/${aid}`).remove())
  await env.withSecurityRulesDisabled(async context => {
    await context.database().ref(`${root}/presence/_lease`).update({ expiresAt: Date.now() - 1 })
  })
  await ok(b.ref(`${root}/presence/_lease`).transaction(current => ({ ...current, peerId: bid, uid: 'owner-b', epoch: 2, expiresAt: Date.now() + 8000 })))
  await no(a.ref(`${root}/presence/_lease`).set({ ...lease, expiresAt: Date.now() + 8000 }))
  await ok(b.ref(`${root}/presence/_lease`).transaction(current => ({ ...current, phase: 'running', expiresAt: Date.now() + 8000 })))
  const migrated = (await b.ref(`${root}/presence/_lease`).get()).val()
  assert.equal(migrated.epoch, 2); assert.equal(migrated.peerId, bid)
  await ok(a.ref(`${root}/presence/owner-a/${aid}`).remove())
  await ok(b.ref(`${root}/presence/owner-b/${bid}`).remove())
  console.log(`Firebase emulator rules: ${checks} checks passed (no deployed project, no external network in tests).`)
} finally { await env.cleanup() }
