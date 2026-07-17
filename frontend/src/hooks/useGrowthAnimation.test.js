import { describe, it, expect } from 'vitest'
import { decideGrowth, STAGE_LADDER } from './useGrowthAnimation'

describe('decideGrowth', () => {
  it('returns grow when the stage advances', () => {
    expect(decideGrowth('sprout', 'sapling')).toBe('grow')
    expect(decideGrowth('seed', 'tree')).toBe('grow')
  })
  it('returns bloom when the stage is unchanged', () => {
    expect(decideGrowth('tree', 'tree')).toBe('bloom')
  })
  it('returns bloom when the stage did not advance (defensive: never regress)', () => {
    expect(decideGrowth('tree', 'sapling')).toBe('bloom')
  })
  it('treats an unknown/missing prev as bloom-safe when next is not later', () => {
    expect(decideGrowth(undefined, 'seed')).toBe('bloom')
  })
  it('exposes the four-stage ladder in order', () => {
    expect(STAGE_LADDER).toEqual(['seed', 'sprout', 'sapling', 'tree'])
  })
})
