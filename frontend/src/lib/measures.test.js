import { describe, it, expect } from 'vitest'
import { isImprecise, impreciseLabel } from './measures'

describe('measures', () => {
  it('imprecise amounts are flagged', () => {
    expect(isImprecise({ quantity_type: 'imprecise' })).toBe(true)
    expect(isImprecise({ quantity_type: 'unmeasured' })).toBe(true)
  })
  it('precise amounts are not', () => {
    expect(isImprecise({ quantity_type: 'precise' })).toBe(false)
    expect(isImprecise({})).toBe(false)
  })
  it('the tag reads warm, not clinical', () => {
    expect(impreciseLabel()).toBe('their way')
  })
})
