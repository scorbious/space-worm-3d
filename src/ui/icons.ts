import { assets } from '../engine/assets'

/** Painted icons (stage-0 assets) used where they exist; inline SVG covers the rest. */
const ART: Record<string, string> = {
  magnet: 'icon/magnet', shield: 'icon/shield', freeBoost: 'icon/boost', boost: 'icon/boost', stardust: 'icon/stardust', crown: 'icon/crown',
  moon: 'icon/moon', comet: 'icon/comet', planet: 'icon/planet', star: 'icon/star', pulsar: 'icon/pulsar',
}
/** Inline SVG icons (currentColor) so the UI needs no image requests. */
const svg = (body: string, vb = '0 0 24 24') => `<svg viewBox="${vb}" aria-hidden="true" focusable="false">${body}</svg>`

export const ICONS: Record<string, string> = {
  magnet: svg('<path d="M5 3h4v8a3 3 0 0 0 6 0V3h4v8a7 7 0 0 1-14 0z" fill="currentColor"/><path d="M5 3h4v3H5zM15 3h4v3h-4z" fill="#fff"/>'),
  shield: svg('<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z" fill="currentColor"/><path d="m8.5 12 2.5 2.5 4.5-5" stroke="#0b0820" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  freeBoost: svg('<path d="M13 2 4 14h6l-1 8 9-12h-6z" fill="currentColor"/>'),
  moon: svg('<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" fill="currentColor"/>'),
  comet: svg('<circle cx="16" cy="8" r="4.5" fill="currentColor"/><path d="M12.5 11.5 3 21M11 9 4 13M15 13l-4 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".6"/>'),
  planet: svg('<circle cx="12" cy="12" r="6" fill="currentColor"/><ellipse cx="12" cy="12" rx="11" ry="3.6" transform="rotate(-20 12 12)" fill="none" stroke="currentColor" stroke-width="1.6"/>'),
  star: svg('<path d="m12 2 2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2l-6.1 3.4 1.4-6.8L2.2 9.1l6.9-.8z" fill="currentColor"/>'),
  pulsar: svg('<circle cx="12" cy="12" r="3.5" fill="currentColor"/><path d="M12 1v6M12 17v6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".5"/>'),
  stardust: svg('<path d="M12 2 15 9l7 3-7 3-3 7-3-7-7-3 7-3z" fill="currentColor"/>'),
  skull: svg('<path d="M12 2a8 8 0 0 0-8 8c0 2.8 1.4 4.6 3 5.6V19a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3.4c1.6-1 3-2.8 3-5.6a8 8 0 0 0-8-8z" fill="currentColor"/><circle cx="9" cy="11" r="1.8" fill="#0b0820"/><circle cx="15" cy="11" r="1.8" fill="#0b0820"/>'),
  length: svg('<circle cx="5" cy="15" r="3" fill="currentColor" opacity=".55"/><circle cx="10" cy="12" r="3.4" fill="currentColor" opacity=".75"/><circle cx="16" cy="10" r="4.2" fill="currentColor"/>'),
  pause: svg('<rect x="6" y="4" width="4" height="16" rx="1.2" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1.2" fill="currentColor"/>'),
  trophy: svg('<path d="M7 3h10v3h3v2a5 5 0 0 1-5 5h-.3A5 5 0 0 1 13 15v3h3v3H8v-3h3v-3a5 5 0 0 1-1.7-2H9a5 5 0 0 1-5-5V6h3zm-1 5v0a3 3 0 0 0 1 2.2V8zm12 0v2.2A3 3 0 0 0 18 8z" fill="currentColor"/>'),
  gear: svg('<path d="M19.4 13a7.7 7.7 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.5h-4L10.6 6a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4L4.6 11a7.7 7.7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" fill="currentColor"/>'),
  palette: svg('<path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A5.6 5.6 0 0 0 22 9.8C22 5.5 17.5 2 12 2zM6.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" fill="currentColor"/>'),
  help: svg('<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M9.2 9a2.9 2.9 0 0 1 5.6 1c0 2-2.8 2.4-2.8 4" stroke="#0b0820" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="12" cy="17.5" r="1.2" fill="#0b0820"/>'),
  play: svg('<path d="M7 4v16l13-8z" fill="currentColor"/>'),
  team: svg('<circle cx="8" cy="8" r="3.2" fill="currentColor"/><circle cx="16" cy="8" r="3.2" fill="currentColor" opacity=".7"/><path d="M2 19c0-3.3 2.7-6 6-6s6 2.7 6 6zM12 19c.3-2 1.2-3.7 2.6-4.9A6 6 0 0 1 22 19z" fill="currentColor"/>'),
  asteroid: svg('<path d="M8 3 16 4l5 6-2 8-7 3-7-3-2-7z" fill="currentColor"/><circle cx="10" cy="10" r="1.8" fill="#0b0820" opacity=".5"/><circle cx="15" cy="15" r="1.3" fill="#0b0820" opacity=".5"/>'),
  gate: svg('<rect x="2" y="4" width="3" height="16" rx="1" fill="currentColor"/><rect x="19" y="4" width="3" height="16" rx="1" fill="currentColor"/><path d="M5 12h3l2-3 2 6 2-5 1.5 2H19" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/>'),
  well: svg('<path d="M12 12m-9 0a9 9 0 1 0 18 0M12 12a5 5 0 0 1 5-5M12 12a3 3 0 0 0-3 3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="12" cy="12" r="2" fill="currentColor"/>'),
  rim: svg('<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" fill="none" stroke-dasharray="3 2"/>'),
}

export const icon = (name: string): string => {
  const art = ART[name]
  if (art) return `<span class="ico ico-art ico-${name}"><img src="${assets.url(art)}" alt="" draggable="false" decoding="async"></span>`
  return `<span class="ico ico-${name}">${ICONS[name] ?? ''}</span>`
}
