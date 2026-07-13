import { describe, it, expect } from 'vitest'
import { sourceNameOf } from './sourceName'

describe('sourceNameOf', () => {
  it('returns the leading name segment of origin_attribution', () => {
    expect(
      sourceNameOf({ origin_attribution: 'Lola Remedios · Cebu · 1950s' }),
    ).toBe('Lola Remedios')
  })
  it('handles a bare name with no separators', () => {
    expect(sourceNameOf({ origin_attribution: 'Mom' })).toBe('Mom')
  })
  it('returns null when there is no origin', () => {
    expect(sourceNameOf({ origin_attribution: null })).toBeNull()
    expect(sourceNameOf({})).toBeNull()
  })
})
