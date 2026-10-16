/**
 * Threat glyphs shared by the 3D badges (canvas Path2D) and the DOM UI (inline SVG), so the same
 * symbol means the same thing everywhere. Paths are in a 24×24 box. Shapes differ per class, so
 * meaning never depends on colour alone.
 */
export const THREAT_COLORS = {
  lethal: '#ff3b4e',
  warn: '#ffb020',
  slow: '#a066ff',
  off: '#6f7fa6',
  ally: '#5aa8ff',
  /** Gold = "you can eat it": celestials you can swallow, rivals you can bite. */
  edible: '#ffc53d',
} as const
export type ThreatTone = keyof typeof THREAT_COLORS
export type GlyphId = 'skull' | 'bolt' | 'spiral' | 'jaw' | 'shield' | 'rim' | 'star' | 'bite'

/** Badge frame: warning triangle for lethal classes, circle for "hinders" and allies. */
const FRAME: Record<GlyphId, 'tri' | 'circle'> = { skull: 'tri', bolt: 'tri', rim: 'tri', jaw: 'tri', spiral: 'circle', shield: 'circle', star: 'circle', bite: 'circle' }
const TRI = 'M12 2.2c.5 0 .9.3 1.2.7l9.6 16.6c.5.9-.1 2-1.2 2H2.4c-1 0-1.7-1.1-1.2-2L10.8 2.9c.3-.4.7-.7 1.2-.7z'
/** Glyph bodies (white). `fill-rule: evenodd` punches the eye sockets and other holes. */
const GLYPH: Record<GlyphId, { d: string; stroke?: boolean }> = {
  skull: { d: 'M12 8.1c-2.6 0-4.4 1.8-4.4 4.1 0 1.4.7 2.5 1.7 3.2v1.6c0 .4.3.7.7.7h4c.4 0 .7-.3.7-.7v-1.6c1-.7 1.7-1.8 1.7-3.2 0-2.3-1.8-4.1-4.4-4.1zM10.2 11.4a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 1 0 0-2.2zM13.8 11.4a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 1 0 0-2.2z' },
  bolt: { d: 'M13.3 7.2 8.6 14h3.1l-1 4.8 4.9-7.1h-3.2z' },
  rim: { d: 'M11 8.5h2l-.3 6.2h-1.4zM12 16a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 1 0 0-2.2z' },
  jaw: { d: 'M6.8 10.2c1.5-1.4 3.3-2 5.2-2s3.7.6 5.2 2l-1.5 5.6-1.3-2.6-1.2 3.3-1.2-3-1.2 3-1.2-3.3-1.3 2.6z' },
  spiral: { d: 'M12 12.6a.9.9 0 1 1 .9-.9 2.1 2.1 0 1 1-2.1-2.1 3.4 3.4 0 1 1-3.4 3.4 4.8 4.8 0 1 1 4.8 4.8', stroke: true },
  shield: { d: 'M12 5.6 17 7.5v3.7c0 3.1-2.1 5.9-5 6.9-2.9-1-5-3.8-5-6.9V7.5z' },
  star: { d: 'M12 5.2l1.9 4.5 4.9.4-3.7 3.2 1.1 4.8L12 15.6l-4.2 2.5 1.1-4.8-3.7-3.2 4.9-.4z' },
  bite: { d: 'M6.8 10.2c1.5-1.4 3.3-2 5.2-2s3.7.6 5.2 2l-1.5 5.6-1.3-2.6-1.2 3.3-1.2-3-1.2 3-1.2-3.3-1.3 2.6z' },
}
export const GLYPH_TONE: Record<GlyphId, ThreatTone> = { skull: 'lethal', bolt: 'lethal', rim: 'lethal', jaw: 'lethal', spiral: 'slow', shield: 'ally', star: 'edible', bite: 'edible' }

/** Inline SVG badge for the DOM UI (legend, hints, arrows, death tips). */
export function glyphSvg(id: GlyphId, tone: ThreatTone = GLYPH_TONE[id]): string {
  const c = THREAT_COLORS[tone]
  const g = GLYPH[id]
  const frame = FRAME[id] === 'tri'
    ? `<path d="${TRI}" fill="${c}" stroke="#0b0820" stroke-width="1.1"/>`
    : `<circle cx="12" cy="12" r="10.4" fill="${c}" stroke="#0b0820" stroke-width="1.1"/>`
  const body = g.stroke
    ? `<path d="${g.d}" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/>`
    : `<path d="${g.d}" fill="#fff" fill-rule="evenodd"/>`
  return `<svg class="glyph glyph-${id} tone-${tone}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${frame}${body}</svg>`
}

/**
 * Draw a world badge: dark disc, coloured frame, white glyph. `size` is the canvas edge in px.
 * Used by `threatMarks.ts` to build cached CanvasTextures.
 */
export function drawBadge(ctx: CanvasRenderingContext2D, id: GlyphId, tone: ThreatTone, size: number): void {
  const c = THREAT_COLORS[tone]
  ctx.clearRect(0, 0, size, size)
  ctx.save()
  // Backing disc keeps the badge legible over bright nebula and bodies.
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size * 0.47, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(10,6,24,0.78)'
  ctx.fill()
  ctx.lineWidth = size * 0.035
  ctx.strokeStyle = c
  ctx.globalAlpha = 0.9
  ctx.stroke()
  ctx.globalAlpha = 1
  const s = (size * 0.8) / 24
  ctx.translate(size * 0.1, size * 0.1 + (FRAME[id] === 'tri' ? -size * 0.01 : 0))
  ctx.scale(s, s)
  ctx.fillStyle = c
  if (FRAME[id] === 'tri') ctx.fill(new Path2D(TRI))
  else {
    ctx.beginPath()
    ctx.arc(12, 12, 9.2, 0, Math.PI * 2)
    ctx.fill()
  }
  const g = GLYPH[id]
  if (g.stroke) {
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 1.7
    ctx.lineCap = 'round'
    ctx.stroke(new Path2D(g.d))
  } else {
    ctx.fillStyle = '#fff'
    ctx.fill(new Path2D(g.d), 'evenodd')
  }
  ctx.restore()
}
