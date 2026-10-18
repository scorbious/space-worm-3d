/**
 * All gameplay tuning in one place. Change numbers here before touching game code; tests read
 * the same values so rule changes stay covered.
 */
export const DEFAULT_CONFIG = {
  arena: {
    /** Radius of the circular arena in world units. Touching the rim is lethal. */
    radius: 128,
    /** AI worms in free-for-all (team mode always fields 6 vs 6). */
    bots: 11,
    food: 720,
    stardust: 26,
    pickups: 7,
    celestials: 15,
    asteroids: 16,
    gates: 5,
    wells: 4,
  },
  worm: {
    baseSpeed: 12,
    boostSpeed: 21,
    /** Radians per second at base size; larger worms turn a little slower. */
    turnRate: 3.8,
    /** Length spent per second while boosting. */
    boostCost: 3.2,
    startLength: 14,
    /** Boosting is unavailable below this length unless a free boost is active. */
    minBoostLength: 12,
    /** Segment spacing as a fraction of the worm radius. */
    spacing: 0.62,
  },
  team: {
    seconds: 240,
    respawn: 4,
  },
  competitive: {
    shortSeconds: 180,
    longSeconds: 300,
    maps: {
      sprint: { radius: 96, bots: 5, food: 420, stardust: 24, pickups: 6, celestials: 10, asteroids: 12, gates: 4, wells: 3 },
      exploration: { radius: 176, bots: 9, food: 820, stardust: 34, pickups: 9, celestials: 20, asteroids: 18, gates: 6, wells: 5 },
    },
  },
  pickups: {
    magnet: 10,
    shield: 25,
    freeBoost: 7,
    magnetRange: 13,
  },
  bite: {
    /** A head may bite through a rival body when it is at least this many times longer... */
    ratio: 1.15,
    /** ...and at least this many segments longer (keeps near-ties deadly both ways). */
    minLead: 3,
    /** The bitten worm always keeps its head plus this many segments in total. */
    minKeep: 4,
    /** Share of the severed plain segments' mass that spills as food. */
    spill: 0.5,
    /** Seconds the biter passes through its victim after a bite (no stump kill). */
    immunity: 0.45,
    /** Stardust paid to the player per bite. */
    shards: 1,
  },
  feast: {
    /** Seconds between bites before the feast combo resets. */
    comboWindow: 1.4,
    /** Chance that a naturally spawned mote is a rare prismatic Nova Mote. */
    novaChance: 0.012,
    novaMax: 4,
    novaValue: 10,
    /** Minimum length to wear the Bounty Crown, and stardust paid to whoever takes it. */
    crownMinLength: 30,
    crownBounty: 5,
  },
  camera: {
    height: 42,
    tilt: 0.42,
    fov: 52,
    follow: 6,
  },
} as const

// Gameplay always reads active values here. Source defaults remain immutable for
// Tweak Reset and Save with Manus; Apply never writes source or local storage.
type MutableConfig<T> = { -readonly [K in keyof T]: T[K] extends number ? number : T[K] extends object ? MutableConfig<T[K]> : T[K] }
export const CONFIG: MutableConfig<typeof DEFAULT_CONFIG> = structuredClone(DEFAULT_CONFIG)
