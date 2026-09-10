import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api/client', () => ({ default: { get: vi.fn() } }))
import client from '../api/client'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => mockNavigate,
  useParams: () => ({ id: '7' }),
}))

// HandoffInvite does real work (mints a link); this page's job is loading the recipe, gating on
// ownership and wiring the exits, so the child is stubbed to keep the two concerns apart.
vi.mock('../components/HandoffInvite', () => ({
  default: () => <div>INVITE STAGE</div>,
}))
import HandoffPage from './HandoffPage'

const recipe = (over = {}) => ({ id: 7, name: 'Adobo', user_id: 1, visibility: 'friends', ...over })

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/recipes/7/handoff']}>
      <HandoffPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  mockNavigate.mockClear()
  client.get.mockReset()
})

// The page had NO test file, which is how it came to offer a complete send screen to someone who
// could never send anything.
describe('HandoffPage is owner-only (#102)', () => {
  it('renders the send stage for the owner', async () => {
    localStorage.setItem('issei_user', JSON.stringify({ id: 1 }))
    client.get.mockResolvedValue({ data: recipe() })
    renderPage()

    expect(await screen.findByText('INVITE STAGE')).toBeInTheDocument()
    expect(screen.getByText('Adobo')).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('sends a NON-owner back to the recipe instead of a send screen that cannot work', async () => {
    // GET /recipes/{id} is can_view-gated, so a friend, a grantee or anyone at all on a public
    // recipe loads it fine — but handoff_recipe filters on user_id, so only the owner can mint a
    // link. Without this check they got the recipe's name in the header, "This won't put YOUR
    // recipe in Browse", a compose box, and a "Recipe not found" pill after writing a message.
    localStorage.setItem('issei_user', JSON.stringify({ id: 2 }))
    client.get.mockResolvedValue({ data: recipe({ user_id: 1 }) })
    renderPage()

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/recipes/7', { replace: true }),
    )
    expect(screen.queryByText('INVITE STAGE')).toBeNull()
  })

  it('compares ids as strings, since localStorage round-trips them loosely', async () => {
    localStorage.setItem('issei_user', JSON.stringify({ id: '1' }))
    client.get.mockResolvedValue({ data: recipe({ user_id: 1 }) })
    renderPage()

    expect(await screen.findByText('INVITE STAGE')).toBeInTheDocument()
  })

  it('shows the not-found state when the recipe cannot be loaded at all', async () => {
    localStorage.setItem('issei_user', JSON.stringify({ id: 1 }))
    client.get.mockRejectedValue(new Error('nope'))
    renderPage()

    expect(await screen.findByText(/recipe not found/i)).toBeInTheDocument()
  })
})
