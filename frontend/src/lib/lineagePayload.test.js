import { describe, it, expect } from 'vitest'
import { buildOriginPayload } from './lineagePayload'

describe('buildOriginPayload', () => {
  it('returns null when no name (self-authored root)', () => {
    expect(buildOriginPayload({ name: '' })).toBeNull()
  })
  it('maps fields and nulls empties', () => {
    expect(
      buildOriginPayload({
        name: 'Grandma Yoko',
        place: '',
        year: '1960s',
        memory: '',
      }),
    ).toEqual({
      name: 'Grandma Yoko',
      place: null,
      year: '1960s',
      memory: null,
    })
  })
})
