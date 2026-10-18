import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/styles/main.css'), 'utf8')
const ui = readFileSync(resolve(process.cwd(), 'src/ui/ui.ts'), 'utf8')

describe('responsive game shell', () => {
  it('keeps screens and the WebGL surface on the dynamic viewport with safe-area support', () => {
    expect(css).toContain('min-height: 100dvh')
    expect(css).toContain('env(safe-area-inset-top, 0px)')
    expect(css).toContain('env(safe-area-inset-bottom, 0px)')
    expect(css).toContain('overflow-x: hidden')
    expect(css).toContain('overflow-y: auto')
    expect(css).toContain('--screen-max-height')
  })

  it('has explicit phone breakpoints and a short-landscape layout', () => {
    expect(css).toContain('@media (max-width: 768px)')
    expect(css).toContain('@media (max-width: 480px)')
    expect(css).toContain('@media (orientation: landscape) and (max-width: 768px)')
    expect(css).toContain('.settings-card .row select { width: 100%; min-width: 0;')
  })

  it('marks the title and settings screens for layout-specific styling', () => {
    expect(ui).toContain('class="screen title title-screen"')
    expect(ui).toContain('class="panel card settings-card"')
  })
})
