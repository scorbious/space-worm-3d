import { describe, expect, it } from 'vitest'
import {
  CAMPAIGN_STAGES, campaignDifficulty, campaignGoalComplete, campaignGoalProgress, completeCampaignStage,
  defaultCampaignProgress,
} from '../src/game/campaign'

describe('campaign progression', () => {
  it('defines six increasingly demanding stages with distinct objectives', () => {
    expect(CAMPAIGN_STAGES.length).toBeGreaterThanOrEqual(6)
    expect(new Set(CAMPAIGN_STAGES.map(stage => stage.goal)).size).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < CAMPAIGN_STAGES.length; i++) {
      expect(CAMPAIGN_STAGES[i].arenaRadius).toBeGreaterThan(CAMPAIGN_STAGES[i - 1].arenaRadius)
      expect(CAMPAIGN_STAGES[i].bots).toBeGreaterThanOrEqual(CAMPAIGN_STAGES[i - 1].bots)
      expect(CAMPAIGN_STAGES[i].reward).toBeGreaterThan(CAMPAIGN_STAGES[i - 1].reward)
      expect(campaignDifficulty(CAMPAIGN_STAGES[i])).toBeGreaterThan(campaignDifficulty(CAMPAIGN_STAGES[i - 1]))
    }
  })

  it('clamps objective progress and checks each goal using the right stat', () => {
    const length = CAMPAIGN_STAGES[0]
    expect(campaignGoalProgress(length, { length: 12, peak: 30, kills: 99, stars: 99, seconds: 99 })).toBe(30)
    expect(campaignGoalComplete(length, { length: 36, peak: 36, kills: 0, stars: 0, seconds: 0 })).toBe(true)
    const survival = CAMPAIGN_STAGES.find(stage => stage.goal === 'survival')!
    expect(campaignGoalComplete(survival, { length: 4, peak: 4, kills: 0, stars: 0, seconds: survival.target })).toBe(true)
  })

  it('opens only the next stage and pays a reward once', () => {
    const first = CAMPAIGN_STAGES[0]
    const stats = { length: first.target, peak: first.target, kills: 0, stars: 0, seconds: 20 }
    const result = completeCampaignStage(defaultCampaignProgress(), first, stats)
    expect(result.newlyCompleted).toBe(true)
    expect(result.data.completedStages).toEqual([1])
    expect(result.data.unlockedStage).toBe(2)
    expect(result.data.totalRewards).toBe(first.reward)
    const replay = completeCampaignStage(result.data, first, stats)
    expect(replay.newlyCompleted).toBe(false)
    expect(replay.data.totalRewards).toBe(first.reward)
  })
})
