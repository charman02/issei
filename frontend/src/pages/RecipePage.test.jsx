import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../api/client', () => ({
  default: { get: vi.fn() },
}))
import client from '../api/client'

const recipe = {
  id: 1, user_id: 9, name: 'Adobo',
  growth_stage: 'tree', growth_vitality: 'fruiting',
  cook_count: 300, shared_with_count: 12,
  story: 'Her Sunday dish.', origin_attribution: 'Lola Remedios · Cebu',
  author_full_name: 'Lola Remedios', cover_photo_url: null,
  ingredients: [], ingredient_sections: [], steps: [],
}

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/recipes/1']}>
      <Routes>
        <Route path="/recipes/:id" element={<RecipePageDefault />} />
        {/* marker route so we can assert navigation to the full recipe page */}
        <Route path="/recipes/:id/full" element={<div>FULL RECIPE PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}
import RecipePageDefault from './RecipePage'

beforeEach(() => {
  localStorage.setItem('issei_user', JSON.stringify({ id: 1 }))
  client.get.mockResolvedValue({ data: recipe })
})

describe('RecipePage', () => {
  it('loads and renders the dish name + the living plant hero', async () => {
    renderAt()
    await waitFor(() => expect(screen.getByText('Adobo')).toBeTruthy())
    expect(document.querySelector('.plant')).toBeTruthy()
  })
  it('navigates to the full recipe page when "View recipe" is tapped', async () => {
    renderAt()
    await waitFor(() => screen.getByText('Adobo'))
    fireEvent.click(screen.getByText(/view recipe/i))
    await waitFor(() =>
      expect(screen.getByText('FULL RECIPE PAGE')).toBeTruthy(),
    )
  })
})
