import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// Browse loads public recipes via client.get('/recipes/browse') and public posts via
// browsePosts(). Mock both; recipes default to one so the page renders past its loader.
vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(() =>
      Promise.resolve({
        data: [
          {
            id: 1,
            name: 'Adobo',
            cuisine: 'Filipino',
            diet: '',
            prep_time_minutes: 20,
            created_at: '2026-08-01T00:00:00Z',
            origin_attribution: 'Lola',
          },
        ],
      }),
    ),
  },
}))
vi.mock('../api/posts', () => ({ browsePosts: vi.fn() }))
import { browsePosts } from '../api/posts'
import Browse from './Browse'

const post = (id, dish) => ({
  id,
  user_id: 10 + id,
  author_first_name: 'Ana',
  author_last_name: 'Cruz',
  author_photo_url: null,
  photo_url: `https://img.test/${id}.jpg`,
  dish_name: dish,
  description: null,
  recipe_id: null,
  visibility: 'public',
  created_at: '2026-08-18T12:00:00Z',
})

function renderBrowse() {
  return render(
    <MemoryRouter initialEntries={['/browse']}>
      <Routes>
        <Route path="/browse" element={<Browse />} />
        <Route path="/posts/:id" element={<div>post page</div>} />
        <Route path="/recipes/:id" element={<div>recipe page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  localStorage.setItem('issei_user', JSON.stringify({ id: 1 }))
})

describe('Browse — Recipes | Meals tabs (#71)', () => {
  it('opens on Recipes and shows the recipe view, not posts', async () => {
    browsePosts.mockResolvedValue({ data: [] })
    renderBrowse()
    expect(await screen.findByRole('tab', { name: /recipes/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // The cuisine/diet/ready-in filters are recipe-only.
    expect(screen.getByText(/all cuisines/i)).toBeInTheDocument()
    // Posts aren't fetched until Meals is opened.
    expect(browsePosts).not.toHaveBeenCalled()
  })

  it('switching to Meals lazy-loads public posts and hides the recipe filters', async () => {
    browsePosts.mockResolvedValue({ data: [post(1, 'Sunday Adobo')] })
    renderBrowse()
    await screen.findByRole('tab', { name: /meals/i })
    await userEvent.click(screen.getByRole('tab', { name: /meals/i }))
    await waitFor(() => expect(browsePosts).toHaveBeenCalled())
    expect(await screen.findByText('Sunday Adobo')).toBeInTheDocument()
    // Recipe filters gone on the Meals tab.
    expect(screen.queryByText(/all cuisines/i)).toBeNull()
  })

  it('tapping a meal opens its post page', async () => {
    browsePosts.mockResolvedValue({ data: [post(7, 'Sinigang')] })
    renderBrowse()
    await userEvent.click(await screen.findByRole('tab', { name: /meals/i }))
    await screen.findByText('Sinigang')
    await userEvent.click(screen.getByRole('button', { name: /open sinigang/i }))
    expect(await screen.findByText('post page')).toBeInTheDocument()
  })

  it('searches meals by dish name on the Meals tab', async () => {
    browsePosts.mockResolvedValue({
      data: [post(1, 'Chicken Adobo'), post(2, 'Pork Sinigang')],
    })
    renderBrowse()
    await userEvent.click(await screen.findByRole('tab', { name: /meals/i }))
    await screen.findByText('Chicken Adobo')
    await userEvent.type(screen.getByPlaceholderText(/search meals/i), 'adobo')
    expect(screen.getByText('Chicken Adobo')).toBeInTheDocument()
    expect(screen.queryByText('Pork Sinigang')).toBeNull()
  })

  it('shows a meals empty state when nobody has shared a public meal', async () => {
    browsePosts.mockResolvedValue({ data: [] })
    renderBrowse()
    await userEvent.click(await screen.findByRole('tab', { name: /meals/i }))
    expect(await screen.findByText(/no meals shared yet/i)).toBeInTheDocument()
  })
})

// The section ORDER is a product decision, not an accident of how buildSections was written —
// it used to be the exact reverse, with Recently Added last. Pinned so a refactor can't quietly
// bury the only row that changes between visits.
describe('Browse — section order', () => {
  it('leads with Recently Added, then Quick & Easy, then cuisines', async () => {
    const client = (await import('../api/client')).default
    client.get.mockResolvedValue({
      data: [
        {
          id: 1, name: 'Adobo', cuisine: 'Filipino', diet: '',
          prep_time_minutes: 20, created_at: '2026-08-01T00:00:00Z',
          origin_attribution: 'Lola',
        },
      ],
    })
    render(
      <MemoryRouter initialEntries={['/browse']}>
        <Routes>
          <Route path="/browse" element={<Browse />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByText('Recently Added')
    // Read the headings in DOM order — the assertion is about sequence, not presence.
    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent.trim())
    expect(headings[0]).toBe('Recently Added')
    expect(headings[1]).toBe('Quick & Easy')
    // This recipe is Filipino and under 30 min, so it appears in all three — the cuisine row
    // is present but must come last.
    expect(headings[2]).toBe('Filipino')
  })
})
