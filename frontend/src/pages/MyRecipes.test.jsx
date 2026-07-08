import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../api/client', () => ({ default: { get: vi.fn(() => Promise.resolve({ data: [] })) } }))
vi.mock('../components/RecipeCard', () => ({ default: ({ recipe }) => <div>{recipe.name}</div> }))
import MyRecipes from './MyRecipes'

describe('MyRecipes', () => {
  it('renders the kitchen header', () => {
    render(<MemoryRouter><MyRecipes /></MemoryRouter>)
    expect(screen.getByText('Your Kitchen')).toBeInTheDocument()
  })

  it('offers a "shared with you" entry that navigates to /shared', async () => {
    render(
      <MemoryRouter initialEntries={['/kitchen']}>
        <Routes>
          <Route path="/kitchen" element={<MyRecipes />} />
          <Route path="/shared" element={<div>shared page</div>} />
        </Routes>
      </MemoryRouter>
    )
    const link = screen.getByRole('button', { name: /shared with you/i })
    expect(link).toBeInTheDocument()
    await userEvent.click(link)
    expect(await screen.findByText('shared page')).toBeInTheDocument()
  })
})
