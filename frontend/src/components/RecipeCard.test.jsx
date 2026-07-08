import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import RecipeCard from './RecipeCard'

vi.mock('./CoverImage', () => ({ default: () => <div data-testid="cover" /> }))

describe('RecipeCard growth badge', () => {
  it('shows a sapling badge when the recipe has children', () => {
    const recipe = { id: 1, name: 'Adobo', cook_count: 2, child_count: 1 }
    const { container } = render(<RecipeCard recipe={recipe} onClick={() => {}} />)
    expect(container.querySelector('[data-growth-state="sapling"]')).toBeInTheDocument()
  })
})
