import { describe, it, expect } from 'vitest'
import { HANDOFF_STARTERS, defaultStarterKey } from './handoffStarters'

describe('handoffStarters', () => {
  it('offers exactly two starters: fill-in and sharing', () => {
    expect(HANDOFF_STARTERS.map((s) => s.key)).toEqual(['fill', 'love'])
    expect(HANDOFF_STARTERS.find((s) => s.key === 'fill').note).toMatch(
      /part I/i,
    )
    expect(HANDOFF_STARTERS.find((s) => s.key === 'love').note).toMatch(
      /love this/i,
    )
  })

  it('auto-selects the fill-in starter when passing back to the source', () => {
    expect(defaultStarterKey('Lola')).toBe('fill')
  })

  it('selects nothing by default when there is no recorded source', () => {
    expect(defaultStarterKey(null)).toBeNull()
    expect(defaultStarterKey('')).toBeNull()
  })
})
