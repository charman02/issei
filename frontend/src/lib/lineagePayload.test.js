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
    ingredients: [{ name: 'butter', quantity_text: '2 tbsp', position: 1 }],
    ingredient_sections: [
      { name: 'Sauce', position: 1, ingredients: [{ name: 'soy sauce', quantity_text: '1/4 cup', position: 2 }] },
    ],
    steps: [{ content: 'Brown the meat', voice_note: "don't rush the onions", position: 1 }],
  }
  it('carries source and notes, drops story', () => {
    const v = buildRemixInitialValues(parent)
    expect(v.source).toBe('Lola')
    expect(v.notes).toBe('Use cane vinegar')
    expect(v.story).toBe('')
  })
  it('maps quantity_text to the form\'s quantity field', () => {
    const v = buildRemixInitialValues(parent)
    expect(v.ingredients[0]).toEqual({ name: 'butter', quantity: '2 tbsp' })
  })
  it('flattens sectioned ingredients into the row list, ordered by position', () => {
    const v = buildRemixInitialValues(parent)
    expect(v.ingredients).toEqual([
      { name: 'butter', quantity: '2 tbsp' },
      { name: 'soy sauce', quantity: '1/4 cup' },
    ])
  })
  it('carries content + voice_note into the remix seed and deep-copies (edits do not mutate parent)', () => {
    const v = buildRemixInitialValues(parent)
    expect(v.steps[0]).toEqual({ content: 'Brown the meat', voice_note: "don't rush the onions" })
    v.ingredients[0].name = 'lard'
    expect(parent.ingredients[0].name).toBe('butter')
  })
})
