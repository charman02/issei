import { describe, it, expect } from 'vitest'
import { plantedBeatCopy } from './plantedBeat'

describe('plantedBeatCopy', () => {
  it('name-only recipe reads as a freshly-sown seed', () => {
    const copy = plantedBeatCopy({ name: 'Congee', growth_stage: 'seed' }, null)
    expect(copy.stage).toBe('seed')
    expect(copy.eyebrow).toBe('Seed sown')
    expect(copy.heading).toBe('Congee is planted.')
    // self-authored: no source name → generic "add a memory"
    expect(copy.body).toContain('add a memory')
    expect(copy.body).toContain('and watch it grow')
  })

  it('a recipe planted with soul is born a sprout', () => {
    const copy = plantedBeatCopy(
      { name: 'Lola’s Adobo', growth_stage: 'sprout' },
      'Lola',
    )
    expect(copy.stage).toBe('sprout')
    expect(copy.eyebrow).toBe('First sprout')
    // ancestor path: story act is personalized to the source
    expect(copy.body).toContain('add Lola’s story')
  })

  it('names the three growth-loop acts (cook, story, pass on)', () => {
    const copy = plantedBeatCopy(
      { name: 'Sinigang', growth_stage: 'seed' },
      null,
    )
    expect(copy.body).toContain('Cook it')
    expect(copy.body).toContain('pass it on')
  })

  it('falls back to computing the stage when the server did not send one', () => {
    // no growth_stage, no soul, no cooks → stageForRecipe returns 'seed'
    const copy = plantedBeatCopy({ name: 'Bare' }, null)
    expect(copy.stage).toBe('seed')
    expect(copy.eyebrow).toBe('Seed sown')
  })
})
