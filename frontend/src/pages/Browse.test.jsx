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

// The Meals tab is GONE (#94, un-shipping #71). Browse is an INTENT surface — you arrive
// wanting a specific dish, and recipes are searchable that way; nobody searches for a photo of
// someone's dinner. Public posts moved to the cold-start Home feed, where serendipity belongs.
describe('Browse is recipes only (#94)', () => {
  it('shows recipes with no tabs to choose between', async () => {
    render(
      <MemoryRouter initialEntries={['/browse']}>
        <Routes>
          <Route path="/browse" element={<Browse />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Recently Added')).toBeInTheDocument()
    expect(screen.getAllByText('Adobo').length).toBeGreaterThan(0)
    expect(screen.queryByRole('tab', { name: /^meals$/i })).toBeNull()
    expect(screen.queryByRole('tab', { name: /^recipes$/i })).toBeNull()
    expect(screen.getByPlaceholderText(/search recipes/i)).toBeInTheDocument()
  })

  it('never fetches public posts', async () => {
    // The endpoint still exists and is still tested server-side; the client just stopped
    // calling it. A stray call would mean the tab crept back in some other form.
    render(
      <MemoryRouter initialEntries={['/browse']}>
        <Routes>
          <Route path="/browse" element={<Browse />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByText('Recently Added')
    expect(browsePosts).not.toHaveBeenCalled()
  })
})

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
