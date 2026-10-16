// End-to-end smoke test: builds must already exist in dist/ (`npm run build`).
// Serves dist/, boots Space Worm 3D in headless Chromium, plays both modes, dies/respawns, walks the
// menus in English and Chinese, checks touch controls, fails on any console error, writes ./shots/.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const port = 4300 + Math.floor(Math.random() * 500)
const url = `http://127.0.0.1:${port}/`
const out = process.env.SHOTS_DIR ?? 'shots'
mkdirSync(out, { recursive: true })

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: false })
let browser
const guard = setTimeout(() => fail('timed out'), 120_000)

function cleanup() {
  clearTimeout(guard)
  try { server.kill('SIGTERM') } catch {}
}
async function fail(msg) {
  console.error(`smoke: FAIL — ${msg}`)
  await browser?.close().catch(() => {})
  cleanup()
  process.exit(1)
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error('preview server did not start')
}

async function openGame(context, errors) {
  const page = await context.newPage()
  page.on('console', m => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', e => errors.push(String(e)))
  page.on('response', r => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url()}`))
  await page.goto(url)
  await page.waitForSelector('[data-screen="title"].is-active', { timeout: 30_000 })
  await page.waitForTimeout(900)
  return page
}

const state = page => page.evaluate(() => {
  const { game, ui, save } = window.__game
  const p = game.sim.player
  return { mode: game.mode, screen: ui.screen, simMode: game.sim.mode, alive: p.alive, x: p.xs[0], z: p.zs[0], len: p.xs.length, stardust: save.data.stardust, skin: save.data.skin }
})
// Keeps the test worm alive while it wanders (shield covers rim/asteroids, grace covers worms).
const protect = page => page.evaluate(() => {
  clearInterval(window.__protect)
  window.__protect = setInterval(() => { const p = window.__game.game.sim.player; if (p.alive) { p.spawnGrace = 999; p.shield = Math.max(p.shield, 30) } }, 100)
})
const unprotect = page => page.evaluate(() => clearInterval(window.__protect))

try {
  await waitForServer()
  // Prefer Playwright's bundled Chromium; fall back to an installed Google Chrome.
  const args = ['--ignore-gpu-blocklist']
  browser = await chromium.launch({ args }).catch(() => chromium.launch({ args, channel: 'chrome' }))
  const errors = []

  const en = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US' })
  const page = await openGame(en, errors)
  await page.screenshot({ path: `${out}/01-title-en.png` })

  // Free-for-all: steer with the mouse and keyboard, boost.
  await page.click('[data-action="play-ffa"]')
  await page.waitForSelector('[data-screen="hud"].is-active')
  await protect(page)
  const before = await state(page)
  let moved = 0
  for (let i = 0; i < 20; i += 1) {
    await page.mouse.move(640 + Math.cos(i / 4) * 260, 360 + Math.sin(i / 4) * 200)
    await page.waitForTimeout(60)
    const s = await state(page)
    moved = Math.max(moved, Math.hypot(s.x - before.x, s.z - before.z))
  }
  await page.keyboard.down('KeyA'); await page.waitForTimeout(400); await page.keyboard.up('KeyA')
  await page.keyboard.down('Space'); await page.waitForTimeout(400); await page.keyboard.up('Space')
  const after = await state(page)
  await page.screenshot({ path: `${out}/02-ffa.png` })
  if (after.mode !== 'playing' || !after.alive) throw new Error(`expected a living worm, got ${after.mode}`)
  if (moved < 5) throw new Error('worm did not move')
  if (!(await page.isVisible('canvas.minimap'))) throw new Error('minimap hidden')

  // Pause → Settings → Escape returns to Pause without resuming.
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-screen="pause"].is-active')
  await page.click('[data-screen="pause"] [data-action="settings"]')
  await page.waitForSelector('[data-screen="settings"].is-active')
  await page.check('[data-setting="reducedMotion"]')
  await page.screenshot({ path: `${out}/03-settings.png` })
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-screen="pause"].is-active')
  if ((await state(page)).mode !== 'paused') throw new Error('leaving Settings with Escape resumed the run')
  if (!(await page.evaluate(() => document.body.classList.contains('reduced-motion')))) throw new Error('reduced motion not applied')
  await page.click('[data-screen="pause"] [data-action="resume"]')

  // Death → results with earned stardust → respawn.
  await unprotect(page)
  await page.evaluate(() => { const { game } = window.__game; const p = game.sim.player; p.spawnGrace = 0; p.shield = 0; game.sim.kill(p, null, 'asteroid') })
  await page.waitForSelector('[data-screen="death"].is-active', { timeout: 10_000 })
  await page.screenshot({ path: `${out}/04-death.png` })
  const dead = await state(page)
  if (dead.stardust <= 0) throw new Error('no stardust earned for a life')
  await page.click('[data-screen="death"] [data-action="respawn"]')
  await page.waitForSelector('[data-screen="hud"].is-active')
  if (!(await state(page)).alive) throw new Error('respawn failed')

  // Skins: buy and equip with earned currency.
  await page.evaluate(() => window.__game.save.update({ stardust: 500 }))
  await page.click('[data-screen="hud"] [data-action="pause"]')
  await page.click('[data-screen="pause"] [data-action="quit"]')
  await page.waitForSelector('[data-screen="title"].is-active')
  await page.click('[data-screen="title"] [data-action="skins"]')
  await page.click('[data-skin="aurora"]')
  await page.click('[data-skin="aurora"]')
  const bought = await state(page)
  if (bought.skin !== 'aurora' || bought.stardust !== 380) throw new Error(`skin purchase failed: ${bought.skin} ${bought.stardust}`)
  await page.screenshot({ path: `${out}/05-skins.png` })
  await page.keyboard.press('Escape')

  // Team battle to the final whistle.
  await page.click('[data-action="play-team"]')
  await page.waitForSelector('[data-screen="hud"].is-active')
  await protect(page)
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${out}/06-team.png` })
  await page.evaluate(() => { window.__game.game.sim.matchLeft = 0.2 })
  await page.waitForSelector('[data-screen="match"].is-active', { timeout: 10_000 })
  await page.screenshot({ path: `${out}/07-match.png` })

  const zh = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'zh-CN' })
  const zhPage = await openGame(zh, errors)
  if (!(await zhPage.textContent('[data-action="play-ffa"]'))?.includes('自由混战')) throw new Error('Chinese UI not applied')
  await zhPage.screenshot({ path: `${out}/08-title-zh.png` })

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US' })
  const phonePage = await openGame(phone, errors)
  await phonePage.tap('[data-action="play-ffa"]')
  await phonePage.waitForSelector('[data-screen="hud"].is-active')
  await phonePage.waitForSelector('.touch.is-active .boost-btn', { state: 'visible' })
  await phonePage.screenshot({ path: `${out}/09-phone-hud.png` })

  if (errors.length) throw new Error(`console errors:\n${errors.join('\n')}`)
  await browser.close()
  cleanup()
  console.log(`smoke: OK — screenshots in ${out}/`)
} catch (err) {
  await fail(err instanceof Error ? err.message : String(err))
}
