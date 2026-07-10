import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../api/client', () => ({ default: { get: vi.fn(() => Promise.resolve({ data: {
  id: 1, name: 'Adobo', user_id: 7, author_full_name: 'Yoko M.',
  visibility: 'private', parent_recipe_id: null,
  ingredients: [], ingredient_sections: [], steps: [], cook_count: 3, child_count: 0,
} })) } }))
vi.mock('../api/lineage', () => ({ cookRecipe: vi.fn(() => Promise.resolve({ data: { cook_count: 4 } })) }))
beforeEach(() => { localStorage.setItem('issei_user', JSON.stringify({ id: 7 })) })
import client from '../api/client'
import { cookRecipe } from '../api/lineage'
import RecipeDetail from './RecipeDetail'

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/recipes/1']}>
      <Routes>
        <Route path="/recipes/:id" element={<RecipeDetail />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('RecipeDetail cook action', () => {
  it('cooks and shows the growth beat', async () => {
    renderDetail()
    const btn = await screen.findByRole('button', { name: /cooked this/i })
    await userEvent.click(btn)
    expect(cookRecipe).toHaveBeenCalledWith('1', {})
    expect(await screen.findByText(/4 times/i)).toBeInTheDocument()
  })
})

describe('RecipeDetail visibility control', () => {
  it('shows the visibility control to the owner', async () => {
    renderDetail()
    // The owner sees the status pill (🔒 Private) rendered by VisibilityControl.
    expect(await screen.findByText(/^🔒 Private$/i)).toBeInTheDocument()
  })
})

describe('RecipeDetail living-recipe weavings', () => {
  it('shows a woven voice-note quote under its step', async () => {
    vi.mocked(client.get).mockResolvedValueOnce({ data: {
      id: 1, name: 'Adobo', user_id: 7, author_full_name: 'Yoko M.',
      visibility: 'private', parent_recipe_id: null,
      ingredients: [], ingredient_sections: [],
      steps: [{ id: 1, position: 0, content: 'Simmer the pork.', voice_note: 'until it smells like Sunday' }],
      cook_count: 3, child_count: 0,
    } })
    renderDetail()
    expect(await screen.findByText(/until it smells like Sunday/i)).toBeInTheDocument()
  })

  it('tags an imprecise ingredient as "their way"', async () => {
    vi.mocked(client.get).mockResolvedValueOnce({ data: {
      id: 1, name: 'Adobo', user_id: 7, author_full_name: 'Yoko M.',
      visibility: 'private', parent_recipe_id: null,
      ingredients: [{ id: 1, position: 0, name: 'soy sauce', quantity_text: 'a good splash', quantity_type: 'imprecise' }],
      ingredient_sections: [], steps: [], cook_count: 3, child_count: 0,
    } })
    renderDetail()
    expect(await screen.findByText('soy sauce')).toBeInTheDocument()
    expect(screen.getByText(/their way/i)).toBeInTheDocument()
  })

  it('does not tag a precise-only recipe', async () => {
    vi.mocked(client.get).mockResolvedValueOnce({ data: {
      id: 1, name: 'Adobo', user_id: 7, author_full_name: 'Yoko M.',
      visibility: 'private', parent_recipe_id: null,
      ingredients: [{ id: 1, position: 0, name: 'soy sauce', quantity_text: '2 tbsp', quantity_type: 'precise' }],
      ingredient_sections: [], steps: [], cook_count: 3, child_count: 0,
    } })
    renderDetail()
    expect(await screen.findByText('soy sauce')).toBeInTheDocument()
    expect(screen.queryByText(/their way/i)).not.toBeInTheDocument()
  })
})
