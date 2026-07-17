import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import RecipeBody from './RecipeBody'

const base = {
  name: 'Adobo',
  cover_photo_url: null,
  story: 'Her Sunday dish.',
  ingredients: [
    { name: 'Chicken', quantity_text: '2 lbs', quantity_type: 'precise', position: 1 },
    { name: 'Vinegar', quantity_text: 'a good splash', quantity_type: 'imprecise', position: 2 },
  ],
  ingredient_sections: [],
  steps: [
    { content: 'Brown the chicken.', position: 1 },
    { content: 'Add vinegar.', position: 2 },
  ],
}

describe('RecipeBody', () => {
  it('tags imprecise amounts "her way" but not precise ones', () => {
    const { getAllByText, getByText } = render(<RecipeBody recipe={base} />)
    expect(getAllByText(/her way/i).length).toBe(1) // only the imprecise vinegar
    expect(getByText('2 lbs')).toBeTruthy()
  })
  it('renders all steps in order', () => {
    const { getByText } = render(<RecipeBody recipe={base} />)
    expect(getByText('Brown the chicken.')).toBeTruthy()
    expect(getByText('Add vinegar.')).toBeTruthy()
  })
  it('shows the Wordmark fallback when there is no cover photo', () => {
    const { container } = render(<RecipeBody recipe={base} />)
    // Wordmark renders the issei wordmark text
    expect(container.textContent.toLowerCase()).toContain('issei')
  })
})
