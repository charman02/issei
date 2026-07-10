import { describe, it, expect } from 'vitest'
import { gardenBands } from './gardenBands'

// growth_stage present → stageForRecipe returns it verbatim (server-first).
const r = (id, stage) => ({ id, name: `r${id}`, growth_stage: stage })

describe('gardenBands', () => {
  it('groups recipes into tending / growing / thriving by stage', () => {
    const bands = gardenBands([
      r(1, 'seed'), r(2, 'tree'), r(3, 'sprout'), r(4, 'sapling'), r(5, 'seed'),
    ])
    expect(bands.map((b) => b.key)).toEqual(['tending', 'growing', 'thriving'])
    expect(bands[0].recipes.map((x) => x.id)).toEqual([1, 3, 5]) // seed + sprout, input order
    expect(bands[1].recipes.map((x) => x.id)).toEqual([4])       // sapling
    expect(bands[2].recipes.map((x) => x.id)).toEqual([2])       // tree
  })

  it('omits empty bands and preserves fixed order', () => {
    const bands = gardenBands([r(1, 'tree'), r(2, 'seed')])
    // no sapling → 'growing' band omitted; tending before thriving
    expect(bands.map((b) => b.key)).toEqual(['tending', 'thriving'])
  })

  it('returns an empty array for no recipes', () => {
    expect(gardenBands([])).toEqual([])
  })

  it('gives each band a human title and a warm blurb', () => {
    const [tending] = gardenBands([r(1, 'seed')])
    expect(tending.title).toBe('Needs tending')
    expect(typeof tending.blurb).toBe('string')
    expect(tending.blurb.length).toBeGreaterThan(0)
  })
})
