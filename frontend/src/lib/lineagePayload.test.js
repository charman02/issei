import { describe, it, expect } from 'vitest'
import { buildOriginPayload, buildRemixInitialValues } from './lineagePayload'

describe('buildOriginPayload', () => {
  it('returns null when no name (self-authored root)', () => {
    expect(buildOriginPayload({ name: '' })).toBeNull()
  })
  it('maps fields and nulls empties', () => {
    expect(buildOriginPayload({ name: 'Grandma Yoko', place: '', year: '1960s', memory: '' }))
      .toEqual({ name: 'Grandma Yoko', place: null, year: '1960s', memory: null })
  })
})

describe('buildRemixInitialValues', () => {
  const parent = {
    name: "Grandma's Adobo", servings: 4, cuisine: 'Filipino',
    source: 'Lola', notes: 'Use cane vinegar', story: 'Her Sunday dish',
    ingredients: [{ name: 'butter', quantity_text: '2 tbsp' }],
    steps: [{ content: 'Brown the meat', position: 1 }],
  }
  it('carries source and notes, drops story', () => {
    const v = buildRemixInitialValues(parent)
    expect(v.source).toBe('Lola')
    expect(v.notes).toBe('Use cane vinegar')
    expect(v.story).toBe('')
  })
  it('deep-copies ingredients/steps (edits do not mutate parent)', () => {
    const v = buildRemixInitialValues(parent)
    v.ingredients[0].name = 'lard'
    expect(parent.ingredients[0].name).toBe('butter')
  })
})
