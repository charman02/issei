import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../api/friends', () => ({
  getUserProfile: vi.fn(),
  requestFriend: vi.fn(() => Promise.resolve({})),
  acceptFriend: vi.fn(() => Promise.resolve({})),
  removeFriend: vi.fn(() => Promise.resolve({})),
  getFriends: vi.fn(() => Promise.resolve({ data: [] })),
  getFriendRequests: vi.fn(() => Promise.resolve({ data: [] })),
  blockUser: vi.fn(() => Promise.resolve({})),
}))
vi.mock('../api/client', () => ({ default: {}, toUserMessage: (e, f) => f }))
// UserProfile now renders <ProfileContent>, which loads the person's recipes + posts.
// Default both to empty so the identity/friend-button tests don't need real data;
// individual tests override getUserRecipes to assert the grid.
vi.mock('../api/sharing', () => ({
  getUserRecipes: vi.fn(() => Promise.resolve({ data: [] })),
}))
vi.mock('../api/posts', () => ({
  getUserPosts: vi.fn(() => Promise.resolve({ data: [] })),
}))
import { getUserProfile, requestFriend, blockUser } from '../api/friends'
import { getUserRecipes } from '../api/sharing'
import UserProfile from './UserProfile'

function profile(over = {}) {
  return {
    user_id: 2,
    first_name: 'Lola',
    last_name: 'Remedios',
    friend_state: null,
    friend_can_accept: false,
    recipe_count: 3,
    post_count: 0,
    friend_count: 0,
    ...over,
  }
}

const renderAt = (userId = '2') =>
  render(
    <MemoryRouter initialEntries={[`/u/${userId}`]}>
      <Routes>
        <Route path="/u/:userId" element={<UserProfile />} />
        <Route path="/friends" element={<div>friends page</div>} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.setItem('issei_user', JSON.stringify({ id: 1, first_name: 'Me' }))
})
afterEach(() => localStorage.clear())

describe('UserProfile', () => {
  it('shows the name and the recipes/posts tabs', async () => {
    getUserProfile.mockResolvedValue({ data: profile() })
    renderAt()
    expect(await screen.findByText('Lola Remedios')).toBeInTheDocument()
    // The tabbed profile content replaced the old bare recipe-count line.
    expect(screen.getByRole('tab', { name: /recipes/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /posts/i })).toBeInTheDocument()
  })

  it('shows a recipes · posts · friends summary line', async () => {
    getUserProfile.mockResolvedValue({
      data: profile({ recipe_count: 12, post_count: 5, friend_count: 8 }),
    })
    renderAt()
    await screen.findByText('Lola Remedios')
    expect(
      screen.getByText(/12 recipes · 5 posts · 8 friends/i),
    ).toBeInTheDocument()
  })

  it('loads the person’s recipes into the grid', async () => {
    getUserProfile.mockResolvedValue({ data: profile() })
    getUserRecipes.mockResolvedValueOnce({
      data: [{ id: 7, name: 'Adobo', author_full_name: 'Lola Remedios' }],
    })
    renderAt()
    expect(await screen.findByText('Adobo')).toBeInTheDocument()
    expect(getUserRecipes).toHaveBeenCalledWith('2')
  })

  it('shows a warm nudge (no tabs) when a non-friend can see nothing', async () => {
    getUserProfile.mockResolvedValue({
      data: profile({ friend_state: null, recipe_count: 0, post_count: 0 }),
    })
    renderAt()
    expect(await screen.findByText(/nothing to see here yet/i)).toBeInTheDocument()
    expect(screen.getByText(/add lola as a friend/i)).toBeInTheDocument()
    // The nudge replaces the tabs entirely.
    expect(screen.queryByRole('tab', { name: /recipes/i })).toBeNull()
  })

  it('shows the tabs (not the nudge) for a friend even with nothing loaded', async () => {
    getUserProfile.mockResolvedValue({
      data: profile({ friend_state: 'accepted', recipe_count: 0, post_count: 0 }),
    })
    renderAt()
    await screen.findByText('Lola Remedios')
    expect(screen.getByRole('tab', { name: /recipes/i })).toBeInTheDocument()
    expect(screen.queryByText(/nothing to see here yet/i)).toBeNull()
  })

  it('offers "Add friend" when there is no relationship, and sends the request', async () => {
    getUserProfile.mockResolvedValue({ data: profile({ friend_state: null }) })
    renderAt('2')
    const add = await screen.findByRole('button', { name: /add friend/i })
    await userEvent.click(add)
    expect(requestFriend).toHaveBeenCalledWith(2)
  })

  it('shows "Requested" (disabled) for an outgoing pending request', async () => {
    getUserProfile.mockResolvedValue({
      data: profile({ friend_state: 'pending', friend_can_accept: false }),
    })
    renderAt()
    const btn = await screen.findByRole('button', { name: /requested/i })
    expect(btn).toBeDisabled()
  })

  it('offers to accept an incoming pending request', async () => {
    getUserProfile.mockResolvedValue({
      data: profile({ friend_state: 'pending', friend_can_accept: true }),
    })
    renderAt()
    expect(
      await screen.findByRole('button', { name: /accept friend request/i }),
    ).toBeInTheDocument()
  })

  it('shows "Friends ✓" when already friends', async () => {
    getUserProfile.mockResolvedValue({ data: profile({ friend_state: 'accepted' }) })
    renderAt()
    expect(await screen.findByRole('button', { name: /friends/i })).toBeInTheDocument()
  })

  it('shows no friend button on your own profile', async () => {
    getUserProfile.mockResolvedValue({ data: profile({ user_id: 1 }) })
    renderAt('1')
    await screen.findByText('Lola Remedios')
    expect(screen.queryByRole('button', { name: /add friend|friends|requested/i })).toBeNull()
  })
})

// Blocking (#85). Deliberately two taps, and secondary without being faint: it's a safety control, it
// deletes the friendship, and it can't be undone from here — once blocked this profile 404s.
describe('UserProfile — blocking', () => {
  it('offers a small block chip, not a control competing with Add friend', async () => {
    getUserProfile.mockResolvedValue({ data: profile() })
    renderAt()
    const link = await screen.findByRole('button', { name: /^block$/i })
    expect(link).toBeInTheDocument()
    // The primary action stays the social one.
    expect(screen.getByRole('button', { name: /add friend/i })).toBeInTheDocument()
  })

  it('asks first, and names every consequence before doing it', async () => {
    getUserProfile.mockResolvedValue({ data: profile({ friend_state: 'accepted' }) })
    renderAt()
    await userEvent.click(await screen.findByRole('button', { name: /^block$/i }))
    // Not a bare "are you sure?" — it says what happens.
    expect(screen.getByText(/won.t see each other anywhere/i)).toBeInTheDocument()
    expect(screen.getByText(/can.t ask you for a\s+recipe/i)).toBeInTheDocument()
    expect(screen.getByText(/removes them as a friend/i)).toBeInTheDocument()
    expect(screen.getByText(/unblocking\s+later won.t bring that back/i)).toBeInTheDocument()
    // And the deliberate exception, stated so it isn't a surprise.
    expect(screen.getByText(/recipe you already sent them stays\s+theirs/i)).toBeInTheDocument()
    // Nothing has happened yet.
    expect(blockUser).not.toHaveBeenCalled()
  })

  it('backing out does nothing at all', async () => {
    getUserProfile.mockResolvedValue({ data: profile() })
    renderAt()
    await userEvent.click(await screen.findByRole('button', { name: /^block$/i }))
    await userEvent.click(screen.getByRole('button', { name: /never mind/i }))
    expect(blockUser).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: /^block$/i })).toBeInTheDocument()
  })

  it('blocks, then leaves — this profile is a 404 for us now', async () => {
    getUserProfile.mockResolvedValue({ data: profile() })
    renderAt()
    await userEvent.click(await screen.findByRole('button', { name: /^block$/i }))
    await userEvent.click(screen.getByRole('button', { name: /block them/i }))
    await waitFor(() => expect(blockUser).toHaveBeenCalledWith(2))
    // Staying would render an error screen, so it navigates away.
    expect(await screen.findByText('friends page')).toBeInTheDocument()
  })

  it('stays put and explains when the block fails', async () => {
    getUserProfile.mockResolvedValue({ data: profile() })
    blockUser.mockRejectedValueOnce(new Error('offline'))
    renderAt()
    await userEvent.click(await screen.findByRole('button', { name: /^block$/i }))
    await userEvent.click(screen.getByRole('button', { name: /block them/i }))
    expect(await screen.findByText(/couldn.t block them just now/i)).toBeInTheDocument()
    expect(screen.queryByText('friends page')).not.toBeInTheDocument()
  })

  it('never offers to block yourself', async () => {
    localStorage.setItem('issei_user', JSON.stringify({ id: 2 }))
    getUserProfile.mockResolvedValue({ data: profile({ user_id: 2 }) })
    renderAt('2')
    await screen.findByText(/Lola/)
    expect(screen.queryByRole('button', { name: /block/i })).not.toBeInTheDocument()
  })
})
