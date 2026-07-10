import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import RecipeCard from './RecipeCard'

describe('RecipeCard', () => {
  it('renders the recipe name and a byline', () => {
    render(<RecipeCard recipe={{ id: 1, name: 'Adobo', author_full_name: 'Yoko M.', growth_stage: 'tree' }} onClick={() => {}} />)
    expect(screen.getByText('Adobo')).toBeInTheDocument()
    expect(screen.getByText(/kept by Yoko M\./i)).toBeInTheDocument()
  })

  it('renders the growth plant at a legible size (>= 34px)', () => {
    render(<RecipeCard recipe={{ id: 1, name: 'Adobo', growth_stage: 'sapling', growth_vitality: 'blooming' }} onClick={() => {}} />)
    // Plant renders an <svg role="img"> with an accessible name "<vitality> <stage>"
    const svg = screen.getByRole('img', { name: /blooming sapling/i })
    expect(Number(svg.getAttribute('width'))).toBeGreaterThanOrEqual(34)
  })
})
