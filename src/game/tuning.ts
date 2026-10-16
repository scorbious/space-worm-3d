import { CONFIG, DEFAULT_CONFIG } from './config'

type Mode = 'LIVE' | 'NEXT_RUN'
type Boundary = 'run'
type Control = { id: string; type: 'number'; category: string; label: string; description: string; unit: string;
  default: number; min: number; max: number; step: number; applyMode: Mode; integrity: 'COSMETIC' | 'GAMEPLAY' }
type Binding = { control: Control; boundary?: Boundary; read(): number; write(value: number): void }

const bindings: Binding[] = []
const CATEGORY: Record<string, string> = { worm: 'Movement', camera: 'Camera', arena: 'Arena', pickups: 'Power-ups' }

function number<S extends keyof typeof CONFIG>(section: S, key: keyof typeof CONFIG[S] & string,
  label: string, min: number, max: number, step: number, unit: string, boundary?: Boundary): void {
  const values = CONFIG[section] as Record<string, number>
  const defaults = DEFAULT_CONFIG[section] as Record<string, number>
  bindings.push({ control: Object.freeze({ id: `${section}.${key}`, type: 'number', category: CATEGORY[section] ?? 'Game',
    label, description: boundary === 'run' ? 'Applies when the next match starts.' : 'Updates this preview immediately.',
    unit, default: defaults[key], min, max, step,
    applyMode: boundary === 'run' ? 'NEXT_RUN' : 'LIVE',
    integrity: section === 'camera' ? 'COSMETIC' : 'GAMEPLAY' }), boundary,
    read: () => values[key], write: value => { values[key] = value } })
}

number('worm', 'baseSpeed', 'Cruise speed', 6, 20, 0.5, 'u/s')
number('worm', 'boostSpeed', 'Boost speed', 10, 34, 0.5, 'u/s')
number('worm', 'turnRate', 'Turn rate', 1.5, 7, 0.1, 'rad/s')
number('worm', 'boostCost', 'Boost cost', 0, 8, 0.1, 'len/s')
number('pickups', 'magnet', 'Magnet duration', 3, 20, 0.5, 's')
number('pickups', 'freeBoost', 'Free boost duration', 2, 15, 0.5, 's')
number('camera', 'height', 'Camera height', 24, 80, 1, 'u')
number('camera', 'tilt', 'Camera tilt', 0, 1, 0.02, '')
number('camera', 'fov', 'Field of view', 35, 80, 1, '°')
number('arena', 'bots', 'AI worms (free-for-all)', 3, 16, 1, '', 'run')

const byId = new Map(bindings.map(binding => [binding.control.id, binding]))
let requested = Object.fromEntries(bindings.map(({ control }) => [control.id, control.default]))
const valid = (values: Record<string, number>) => values['worm.baseSpeed'] < values['worm.boostSpeed']
let unranked = false
const gameplayModified = () => bindings.some(binding => binding.control.integrity === 'GAMEPLAY' && binding.read() !== binding.control.default)

export const tuning = {
  get unranked(): boolean { return unranked },
  controls: Object.freeze(bindings.map(binding => binding.control)),
  read() {
    return { requested: { ...requested }, active: Object.fromEntries(bindings.map(binding => [binding.control.id, binding.read()])) }
  },
  apply(patch: unknown): void {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid patch')
    const entries = Object.entries(patch)
    if (entries.length > bindings.length) throw new Error('Invalid patch')
    for (const [id, value] of entries) {
      const control = byId.get(id)?.control
      if (!control || typeof value !== 'number' || !Number.isFinite(value) || value < control.min || value > control.max) throw new Error('Invalid value')
      const steps = (value - control.min) / control.step
      if (value !== control.default && Math.abs(steps - Math.round(steps)) > 1e-7) throw new Error('Invalid increment')
    }
    const candidate = { ...requested, ...patch } as Record<string, number>
    const nextActive = this.read().active
    for (const [id, value] of entries) if (byId.get(id)!.control.applyMode === 'LIVE') nextActive[id] = value
    if (!valid(candidate) || !valid(nextActive)) throw new Error('Cruise speed must stay below boost speed')
    requested = candidate
    for (const [id, value] of entries) {
      const binding = byId.get(id)!
      if (binding.control.applyMode === 'LIVE') binding.write(value)
    }
    unranked ||= gameplayModified()
  },
  activate(boundary: Boundary): void {
    for (const binding of bindings) if (binding.boundary === boundary) binding.write(requested[binding.control.id])
    // Reset only at a new run; resetting values mid-run cannot restore eligibility.
    unranked = gameplayModified()
  },
}
