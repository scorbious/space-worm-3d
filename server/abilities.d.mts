export const ABILITY_IDS: readonly string[]
export const ONLINE_LEVELS: Readonly<{ ghost: number; electric: number; bomb: number; shrink: number }>
export const LASER_RANGE: number
export const LASER_CONE: number
export function ghostDuration(level: number): number
export function ghostCooldown(level: number): number
export function electricDuration(level: number): number
export function electricDamage(level: number): number
export function electricCooldown(level: number): number
export function bombLifetime(level: number): number
export function bombDamage(level: number): number
export function bombLimit(level: number): number
export function bombCooldown(level: number): number
export function shrinkDuration(level: number): number
export function shrinkCooldown(level: number): number
export function shrinkScale(level: number): number
export function shrinkReductionPercent(level: number): number
