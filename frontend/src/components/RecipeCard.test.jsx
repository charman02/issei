import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import RecipeCard from './RecipeCard'

vi.mock('./CoverImage', () => ({ default: () => <div data-testid="cover" /> }))

describe('RecipeCard plant', () => {
  it('renders the recipe growth stage from server fields', () => {
    const recipe = { id: 1, name: 'Adobo', growth_stage: 'sapling', growth_vitality: 'blooming' }
    const { container } = render(<RecipeCard recipe={recipe} onClick={() => {}} />)
    expect(container.querySelector('svg[data-stage="sapling"]')).toBeInTheDocument()
  })
})
