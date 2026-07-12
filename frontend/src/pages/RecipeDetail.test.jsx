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

  it('does not offer remix ("make it mine") — remix is cut from v1', async () => {
    renderDetail()
    expect(await screen.findByRole('button', { name: /i cooked this/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /make it mine/i })).not.toBeInTheDocument()
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

  it('renders ingredient amounts in a bold, legible treatment (readability fix)', async () => {
    vi.mocked(client.get).mockResolvedValueOnce({ data: {
      id: 1, name: 'Adobo', user_id: 7, author_full_name: 'Yoko M.',
      visibility: 'private', parent_recipe_id: null,
      ingredients: [{ id: 1, position: 0, name: 'chicken thighs', quantity_text: '2 lbs', quantity_type: 'precise' }],
      ingredient_sections: [], steps: [], cook_count: 3, child_count: 0,
    } })
    renderDetail()
    const amount = await screen.findByText('2 lbs')
    // amount carries the shared bold amount class, not the old terra-semibold inline
    expect(amount.className).toMatch(/ingredient-amount/)
  })
})

describe('RecipeDetail warm-invitational empty state', () => {
  it('offers the owner a warm invitation when there is no story', async () => {
    // recipe owned by the current user (id 7), story absent
    localStorage.setItem('issei_user', JSON.stringify({ id: 7 }))
    vi.mocked(client.get).mockResolvedValueOnce({ data: {
      id: 1, name: 'Adobo', user_id: 7, author_full_name: 'Yoko M.',
      visibility: 'private', parent_recipe_id: null, story: null,
      ingredients: [], ingredient_sections: [], steps: [], cook_count: 3, child_count: 0,
    } })
    renderDetail()
    expect(await screen.findByText(/add a memory/i)).toBeInTheDocument()
  })

  it('does NOT show the invitation to a non-owner', async () => {
    // recipe.user_id (7) != current user (999); story absent
    localStorage.setItem('issei_user', JSON.stringify({ id: 999 }))
    vi.mocked(client.get).mockResolvedValueOnce({ data: {
      id: 1, name: 'Adobo', user_id: 7, author_full_name: 'Yoko M.',
      visibility: 'private', parent_recipe_id: null, story: null,
      ingredients: [], ingredient_sections: [], steps: [], cook_count: 3, child_count: 0,
    } })
    renderDetail()
    expect(await screen.findByText('Adobo')).toBeInTheDocument()
    expect(screen.queryByText(/add a memory/i)).not.toBeInTheDocument()
  })
})
