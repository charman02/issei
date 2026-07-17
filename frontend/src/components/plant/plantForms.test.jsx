import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { FORMS, PlantDefs, SOUL_ACCENTS, PLANT_VIEWBOX } from './plantForms'

function wrap(node) {
  return render(
    <svg viewBox={PLANT_VIEWBOX} data-testid="s">{node}</svg>,
  )
}

describe('plantForms', () => {
  it('exposes all four stage forms', () => {
    expect(Object.keys(FORMS).sort()).toEqual(['sapling', 'seed', 'sprout', 'tree'])
  })
  it('the tree form carries cascade part tags (trunk, branches, canopy)', () => {
    const { container } = wrap(FORMS.tree)
    expect(container.querySelector('.gTrunk')).toBeTruthy()
    expect(container.querySelector('.gBranchL')).toBeTruthy()
    expect(container.querySelector('.gBranchR')).toBeTruthy()
    expect(container.querySelector('.gCanopy')).toBeTruthy()
  })
  it('the sprout form carries stem + two leaves', () => {
    const { container } = wrap(FORMS.sprout)
    expect(container.querySelector('.gStem')).toBeTruthy()
    expect(container.querySelectorAll('.gLeafL, .gLeafR').length).toBe(2)
  })
  it('renders defs without crashing', () => {
    const { container } = wrap(<PlantDefs />)
    expect(container.querySelector('defs')).toBeTruthy()
  })
  it('soul accents include tappable blossoms and fruit', () => {
    const { container } = wrap(<g>{SOUL_ACCENTS}</g>)
    expect(container.querySelectorAll('[data-part="blossom"]').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('[data-part="fruit"]').length).toBeGreaterThan(0)
  })
})
