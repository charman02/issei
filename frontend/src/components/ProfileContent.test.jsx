import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api/sharing', () => ({ getUserRecipes: vi.fn() }))
vi.mock('../api/posts', () => ({ getUserPosts: vi.fn() }))
import { getUserRecipes } from '../api/sharing'
import { getUserPosts } from '../api/posts'
import ProfileContent from './ProfileContent'

const post = (id) => ({
  id,
  user_id: 2,
  author_first_name: 'Lola',
  author_last_name: 'R',
  photo_url: `https://img.test/${id}.jpg`,
  dish_name: `Dish ${id}`,
  created_at: '2026-08-20T12:00:00Z',
})

function renderContent() {
  return render(
    <MemoryRouter>
      <ProfileContent userId="2" />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  getUserRecipes.mockResolvedValue({ data: [{ id: 7, name: 'Adobo' }] })
  getUserPosts.mockResolvedValue({ data: [post(1)] })
})

describe('ProfileContent', () => {
  it('loads recipes on the default tab and shows them', async () => {
    renderContent()
    expect(await screen.findByText('Adobo')).toBeInTheDocument()
    expect(getUserRecipes).toHaveBeenCalledWith('2')
    // Posts aren't fetched until their tab is opened (lazy).
    expect(getUserPosts).not.toHaveBeenCalled()
  })

  it('lazy-loads posts only when the Posts tab is opened', async () => {
    renderContent()
    await screen.findByText('Adobo')
    await userEvent.click(screen.getByRole('tab', { name: /posts/i }))
    expect(await screen.findByText('Dish 1')).toBeInTheDocument()
    expect(getUserPosts).toHaveBeenCalledWith('2')
  })

  it('shows an empty message when a tab has nothing', async () => {
    getUserRecipes.mockResolvedValue({ data: [] })
    renderContent()
    expect(await screen.findByText(/no recipes to see yet/i)).toBeInTheDocument()
  })

  it('degrades to empty (no crash) if a fetch fails', async () => {
    getUserRecipes.mockRejectedValue(new Error('boom'))
    renderContent()
    expect(await screen.findByText(/no recipes to see yet/i)).toBeInTheDocument()
  })
})

// A profile is a first impression, not an archive: six items, then a button. Every one of
// these was invisible to the suite above, whose fixtures are a single recipe and a single
// post — so slice(0, 6) and the button could have been deleted with all four tests passing.
describe('ProfileContent — the six-item preview', () => {
  const recipes = (n) =>
    Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Recipe ${i + 1}` }))

  it('shows only six of nine recipes until you ask for the rest', async () => {
    getUserRecipes.mockResolvedValue({ data: recipes(9) })
    renderContent()
    expect(await screen.findByText('Recipe 6')).toBeInTheDocument()
    expect(screen.queryByText('Recipe 7')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Show all 9 recipes' }))
    expect(screen.getByText('Recipe 9')).toBeInTheDocument()
    // The button retires once it has nothing left to reveal.
    expect(screen.queryByRole('button', { name: /show all/i })).toBeNull()
  })

  it('shows no button when nothing is hidden', async () => {
    // Exactly at the cap, which is the boundary a `>=` would get wrong: six items are all
    // visible, so a "Show all 6" that reveals nothing would be a lie the user taps.
    getUserRecipes.mockResolvedValue({ data: recipes(6) })
    renderContent()
    await screen.findByText('Recipe 6')
    expect(screen.queryByRole('button', { name: /show all/i })).toBeNull()
  })

  it('counts posts, not recipes, and names them correctly', async () => {
    getUserRecipes.mockResolvedValue({ data: [] })
    getUserPosts.mockResolvedValue({ data: Array.from({ length: 8 }, (_, i) => post(i + 1)) })
    renderContent()
    await screen.findByText(/no recipes to see yet/i)
    await userEvent.click(screen.getByRole('tab', { name: /posts/i }))
    expect(await screen.findByRole('button', { name: 'Show all 8 posts' })).toBeInTheDocument()
    expect(screen.queryByText('Dish 7')).toBeNull()
  })

  it('collapses again on a tab switch', async () => {
    getUserRecipes.mockResolvedValue({ data: recipes(9) })
    getUserPosts.mockResolvedValue({ data: Array.from({ length: 8 }, (_, i) => post(i + 1)) })
    renderContent()
    await userEvent.click(await screen.findByRole('button', { name: /show all 9/i }))
    expect(screen.getByText('Recipe 9')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: /posts/i }))
    await screen.findByText('Dish 1')
    // Expanded-ness belongs to the view you expanded, not to the component.
    expect(screen.queryByText('Dish 7')).toBeNull()

    await userEvent.click(screen.getByRole('tab', { name: /recipes/i }))
    expect(await screen.findByText('Recipe 6')).toBeInTheDocument()
    expect(screen.queryByText('Recipe 7')).toBeNull()
  })

  it('collapses when you open a DIFFERENT person’s profile', async () => {
    // The risk the code comment names: "expanded" leaking between people. Same mounted
    // component, new userId — React Router reuses the element on a param-only change.
    getUserRecipes.mockResolvedValue({ data: recipes(9) })
    const { rerender } = render(
      <MemoryRouter>
        <ProfileContent userId="2" />
      </MemoryRouter>,
    )
    await userEvent.click(await screen.findByRole('button', { name: /show all 9/i }))
    expect(screen.getByText('Recipe 9')).toBeInTheDocument()

    getUserRecipes.mockResolvedValue({ data: recipes(9) })
    rerender(
      <MemoryRouter>
        <ProfileContent userId="3" />
      </MemoryRouter>,
    )
    expect(await screen.findByText('Recipe 6')).toBeInTheDocument()
    expect(screen.queryByText('Recipe 7')).toBeNull()
    expect(getUserRecipes).toHaveBeenCalledWith('3')
  })
})
