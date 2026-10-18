import type { Worm } from './sim'

export type CampaignGoalKind = 'length' | 'stars' | 'kills' | 'survival'
export type CampaignStageId = 1 | 2 | 3 | 4 | 5 | 6

export type CampaignStage = {
  id: CampaignStageId
  goal: CampaignGoalKind
  target: number
  reward: number
  arenaRadius: number
  startLength: number
  speed: number
  food: number
  stardust: number
  pickups: number
  celestials: number
  asteroids: number
  gates: number
  wells: number
  bots: number
  botAggression: number
  botSkill: number
}

/** Six authored missions. Each row deliberately tightens at least two pressure knobs. */
export const CAMPAIGN_STAGES: readonly CampaignStage[] = [
  { id: 1, goal: 'length', target: 36, reward: 45, arenaRadius: 96, startLength: 12, speed: 0.96, food: 620, stardust: 22, pickups: 6, celestials: 10, asteroids: 8, gates: 2, wells: 2, bots: 5, botAggression: 0.26, botSkill: 0.6 },
  { id: 2, goal: 'stars', target: 8, reward: 60, arenaRadius: 106, startLength: 14, speed: 1, food: 650, stardust: 20, pickups: 6, celestials: 12, asteroids: 11, gates: 3, wells: 3, bots: 7, botAggression: 0.38, botSkill: 0.67 },
  { id: 3, goal: 'kills', target: 3, reward: 80, arenaRadius: 116, startLength: 16, speed: 1.04, food: 700, stardust: 20, pickups: 7, celestials: 13, asteroids: 14, gates: 4, wells: 3, bots: 9, botAggression: 0.5, botSkill: 0.73 },
  { id: 4, goal: 'survival', target: 75, reward: 105, arenaRadius: 126, startLength: 18, speed: 1.07, food: 720, stardust: 18, pickups: 7, celestials: 14, asteroids: 17, gates: 5, wells: 4, bots: 10, botAggression: 0.6, botSkill: 0.79 },
  { id: 5, goal: 'kills', target: 7, reward: 135, arenaRadius: 136, startLength: 20, speed: 1.1, food: 740, stardust: 18, pickups: 8, celestials: 15, asteroids: 20, gates: 6, wells: 5, bots: 11, botAggression: 0.72, botSkill: 0.85 },
  { id: 6, goal: 'length', target: 180, reward: 180, arenaRadius: 146, startLength: 22, speed: 1.13, food: 760, stardust: 16, pickups: 8, celestials: 16, asteroids: 23, gates: 7, wells: 6, bots: 12, botAggression: 0.84, botSkill: 0.92 },
] as const

export type CampaignStats = { length: number; peak: number; kills: number; stars: number; seconds: number }

export function campaignStage(id: number): CampaignStage | undefined {
  return CAMPAIGN_STAGES.find(stage => stage.id === id)
}

export function campaignGoalProgress(stage: CampaignStage, stats: CampaignStats): number {
  const value = stage.goal === 'length' ? stats.peak : stage.goal === 'stars' ? stats.stars : stage.goal === 'kills' ? stats.kills : stats.seconds
  return Math.max(0, Math.min(stage.target, value))
}

export function campaignGoalComplete(stage: CampaignStage, stats: CampaignStats): boolean {
  return campaignGoalProgress(stage, stats) >= stage.target
}

export function campaignDifficulty(stage: CampaignStage): number {
  return stage.id / CAMPAIGN_STAGES.length
}

export function campaignStatsFromWorm(worm: Pick<Worm, 'xs' | 'peak' | 'kills' | 'stars' | 'born'>, time: number): CampaignStats {
  return { length: worm.xs.length, peak: worm.peak, kills: worm.kills, stars: worm.stars, seconds: Math.max(0, time - worm.born) }
}

export type CampaignProgressData = {
  version: 1
  unlockedStage: number
  completedStages: number[]
  bestScores: Record<string, number>
  totalRewards: number
}

export function defaultCampaignProgress(): CampaignProgressData {
  return { version: 1, unlockedStage: 1, completedStages: [], bestScores: {}, totalRewards: 0 }
}

export function completeCampaignStage(data: CampaignProgressData, stage: CampaignStage, stats: CampaignStats): { data: CampaignProgressData; newlyCompleted: boolean; unlockedStage: number } {
  const completed = new Set(data.completedStages.filter(id => campaignStage(id)))
  const newlyCompleted = !completed.has(stage.id)
  completed.add(stage.id)
  const key = String(stage.id)
  const score = Math.max(stats.peak, stats.kills * 20, stats.stars * 10, Math.floor(stats.seconds))
  const bestScores = { ...data.bestScores, [key]: Math.max(0, data.bestScores[key] ?? 0, score) }
  const unlockedStage = Math.min(CAMPAIGN_STAGES.length, Math.max(data.unlockedStage, stage.id + 1))
  return {
    data: { version: 1, unlockedStage, completedStages: [...completed].sort((a, b) => a - b), bestScores, totalRewards: data.totalRewards + (newlyCompleted ? stage.reward : 0) },
    newlyCompleted,
    unlockedStage,
  }
}
