import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api/lineage', () => ({
  getSharedWithMe: vi.fn(() =>
    Promise.resolve({
      data: [
        {
          id: 9,
          name: 'Shared Adobo',
          author_full_name: 'Yoko M.',
          cook_count: 0,
          child_count: 0,
        },
      ],
    }),
  ),
}))
vi.mock('../components/RecipeCard', () => ({
  default: ({ recipe }) => <div>{recipe.name}</div>,
}))
import SharedWithMe from './SharedWithMe'

describe('SharedWithMe', () => {
  it('lists recipes shared with me', async () => {
    render(
      <MemoryRouter>
        <SharedWithMe />
      </MemoryRouter>,
    )
    expect(await screen.findByText('Shared Adobo')).toBeInTheDocument()
  })
})
