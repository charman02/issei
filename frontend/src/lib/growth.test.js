import { describe, it, expect } from 'vitest'
import { stageForRecipe, vitalityForRecipe } from './growth'

describe('growth lib', () => {
  it('prefers server growth_stage', () => {
    expect(stageForRecipe({ growth_stage: 'tree' })).toBe('tree')
  })
  it('prefers server growth_vitality', () => {
    expect(vitalityForRecipe({ growth_vitality: 'fruiting' })).toBe('fruiting')
  })
  it('falls back to client compute (seed when empty)', () => {
    expect(stageForRecipe({})).toBe('seed')
  })
  it('client fallback: a story alone → sprout', () => {
    expect(stageForRecipe({ story: 'Lola made it' })).toBe('sprout')
  })
  it('client fallback: heavy use, no soul → sapling (not tree)', () => {
    expect(stageForRecipe({ cook_count: 50 })).toBe('sapling')
  })
  it('client fallback vitality: many cooks → fruiting', () => {
    expect(vitalityForRecipe({ cook_count: 30 })).toBe('fruiting')
  })
})
