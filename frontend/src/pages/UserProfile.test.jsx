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
  reportUser: vi.fn(() => Promise.resolve({})),
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
import { getUserProfile, requestFriend, blockUser, reportUser } from '../api/friends'
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
// Both safety acts now live behind a ⋯ at the bottom of the page. The menu is the point: a red
// "Block" button sitting in the open reads as the page SUGGESTING something about a person you
// were only looking at, and an unlabelled ⋯ is not the same thing as a faint control — it's a
// universally understood affordance, one tap from either option.
const openMenu = async () => {
  await userEvent.click(await screen.findByRole('button', { name: /more options for lola/i }))
}

describe('UserProfile — the safety menu', () => {
  it('shows only a ⋯ at rest — neither option is on the page', async () => {
    getUserProfile.mockResolvedValue({ data: profile() })
    renderAt()
    expect(
      await screen.findByRole('button', { name: /more options for lola/i }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^block lola$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^report lola$/i })).toBeNull()
    // The primary action on the page is still the social one.
    expect(screen.getByRole('button', { name: /add friend/i })).toBeInTheDocument()
  })

  it('opens to both options, each naming the person', async () => {
    getUserProfile.mockResolvedValue({ data: profile() })
    renderAt()
    await openMenu()
    // Named, so neither can be tapped without knowing who it lands on.
    expect(screen.getByRole('button', { name: /^report lola$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^block lola$/i })).toBeInTheDocument()
  })

  it('closes again without doing anything', async () => {
    getUserProfile.mockResolvedValue({ data: profile() })
    renderAt()
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: /never mind/i }))
    expect(
      await screen.findByRole('button', { name: /more options for lola/i }),
    ).toBeInTheDocument()
    expect(blockUser).not.toHaveBeenCalled()
    expect(reportUser).not.toHaveBeenCalled()
  })

  it('never offers any of it on your own profile', async () => {
    localStorage.setItem('issei_user', JSON.stringify({ id: 2 }))
    getUserProfile.mockResolvedValue({ data: profile({ user_id: 2 }) })
    renderAt('2')
    await screen.findByText(/Lola/)
    expect(screen.queryByRole('button', { name: /more options/i })).toBeNull()
    // And not just the ⋯ — neither option may exist anywhere on the page. Asserting only the
    // menu's absence would pass a regression that rendered a bare Block on your own profile.
    expect(screen.queryByRole('button', { name: /block/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /report/i })).toBeNull()
  })
})

describe('UserProfile — blocking', () => {
  it('asks first, and names every consequence before doing it', async () => {
    getUserProfile.mockResolvedValue({ data: profile({ friend_state: 'accepted' }) })
    renderAt()
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: /^block lola$/i }))
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

  it('backing out of the confirm does nothing at all', async () => {
    getUserProfile.mockResolvedValue({ data: profile() })
    renderAt()
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: /^block lola$/i }))
    await userEvent.click(screen.getByRole('button', { name: /never mind/i }))
    expect(blockUser).not.toHaveBeenCalled()
    expect(
      await screen.findByRole('button', { name: /more options for lola/i }),
    ).toBeInTheDocument()
  })

  it('blocks, then leaves — this profile is a 404 for us now', async () => {
    getUserProfile.mockResolvedValue({ data: profile() })
    renderAt()
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: /^block lola$/i }))
    await userEvent.click(screen.getByRole('button', { name: /block them/i }))
    await waitFor(() => expect(blockUser).toHaveBeenCalledWith(2))
    // Staying would render an error screen, so it navigates away.
    expect(await screen.findByText('friends page')).toBeInTheDocument()
  })

  it('stays put and explains when the block fails', async () => {
    getUserProfile.mockResolvedValue({ data: profile() })
    blockUser.mockRejectedValueOnce(new Error('offline'))
    renderAt()
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: /^block lola$/i }))
    await userEvent.click(screen.getByRole('button', { name: /block them/i }))
    expect(await screen.findByText(/couldn.t block them just now/i)).toBeInTheDocument()
    expect(screen.queryByText('friends page')).not.toBeInTheDocument()
  })
})

// The fourth argument is the SUBJECT (#87 part two): the post or recipe a report is about. It is
// `null` on a profile, where the thing in front of you IS the person. `SafetyMenu.test.jsx` covers
// the cases where it is set.
describe('UserProfile — reporting (#87)', () => {
  const openReport = async () => {
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: /^report lola$/i }))
  }

  it('says where the report goes, and that it is not a block', async () => {
    getUserProfile.mockResolvedValue({ data: profile() })
    renderAt()
    await openReport()
    // The two things someone actually wonders, answered before they send it.
    expect(screen.getByText(/goes to us, not to them/i)).toBeInTheDocument()
    expect(screen.getByText(/doesn.t hide either of you from the other/i)).toBeInTheDocument()
  })

  it('sends a reason with no note — a reason alone is a valid report', async () => {
    getUserProfile.mockResolvedValue({ data: profile() })
    renderAt()
    await openReport()
    await userEvent.click(screen.getByRole('button', { name: /send report/i }))
    await waitFor(() => expect(reportUser).toHaveBeenCalledWith(2, 'harassment', '', null))
  })

  it('sends the chosen reason and what you typed', async () => {
    getUserProfile.mockResolvedValue({ data: profile() })
    renderAt()
    await openReport()
    await userEvent.selectOptions(screen.getByLabelText(/what.s wrong/i), 'spam')
    await userEvent.type(screen.getByLabelText(/anything you want to add/i), 'same link 40 times')
    await userEvent.click(screen.getByRole('button', { name: /send report/i }))
    await waitFor(() =>
      expect(reportUser).toHaveBeenCalledWith(2, 'spam', 'same link 40 times', null),
    )
  })

  it('confirms afterwards that the person was NOT told', async () => {
    getUserProfile.mockResolvedValue({ data: profile() })
    renderAt()
    await openReport()
    await userEvent.click(screen.getByRole('button', { name: /send report/i }))
    expect(await screen.findByText(/we.ll take a look/i)).toBeInTheDocument()
    // The reassurance that matters: reporting is silent, and nothing about your account moved.
    expect(screen.getByText(/hasn.t been told/i)).toBeInTheDocument()
  })

  it('offers the block as the obvious next step, without doing it', async () => {
    getUserProfile.mockResolvedValue({ data: profile() })
    renderAt()
    await openReport()
    await userEvent.click(screen.getByRole('button', { name: /send report/i }))
    await userEvent.click(await screen.findByRole('button', { name: /block them too/i }))
    // It opens the confirm; it does not block on one tap.
    expect(screen.getByText(/won.t see each other anywhere/i)).toBeInTheDocument()
    expect(blockUser).not.toHaveBeenCalled()
  })

  it('keeps what you typed when sending fails', async () => {
    getUserProfile.mockResolvedValue({ data: profile() })
    reportUser.mockRejectedValueOnce(new Error('offline'))
    renderAt()
    await openReport()
    await userEvent.type(screen.getByLabelText(/anything you want to add/i), 'it happened twice')
    await userEvent.click(screen.getByRole('button', { name: /send report/i }))
    expect(await screen.findByText(/couldn.t send that just now/i)).toBeInTheDocument()
    // Retyping an account of something upsetting is the last thing to ask of someone.
    expect(screen.getByLabelText(/anything you want to add/i)).toHaveValue('it happened twice')
  })

  it('backing out of the report does nothing', async () => {
    getUserProfile.mockResolvedValue({ data: profile() })
    renderAt()
    await openReport()
    await userEvent.click(screen.getByRole('button', { name: /never mind/i }))
    expect(reportUser).not.toHaveBeenCalled()
    expect(
      await screen.findByRole('button', { name: /more options for lola/i }),
    ).toBeInTheDocument()
  })

  it('never says the reported person will hear about it', async () => {
    // A report that announces itself is an escalation trigger. The copy must never imply one.
    getUserProfile.mockResolvedValue({ data: profile() })
    renderAt()
    await openReport()
    await userEvent.click(screen.getByRole('button', { name: /send report/i }))
    await screen.findByText(/we.ll take a look/i)
    expect(document.body.textContent).not.toMatch(/they.ll be notified|we.ll tell them|has been told/i)
  })
})

// This file had no BANNED assertion at all, which is how "in your own words" reached the report
// form: the phrase POSITIONING forbids was spelled with "their" in all four guards, so a "your"
// variant slipped every one of them. The regex is widened now; this adds the missing surface.
describe('UserProfile — the phrase guard (POSITIONING)', () => {
  const BANNED = /record|recording|\bvoice\b|audio|in (their|your|his|her)( own)? words|listen/i

  it('never claims a recording, on any state of the safety menu', async () => {
    getUserProfile.mockResolvedValue({ data: profile() })
    renderAt()
    await screen.findByText(/Lola/)
    expect(document.body.textContent).not.toMatch(BANNED)

    await userEvent.click(screen.getByRole('button', { name: /more options for lola/i }))
    expect(document.body.textContent).not.toMatch(BANNED)

    await userEvent.click(screen.getByRole('button', { name: /^report lola$/i }))
    expect(document.body.textContent).not.toMatch(BANNED)
    // Placeholders aren't in textContent, so check them explicitly — that is exactly where the
    // phrase was hiding.
    for (const el of document.querySelectorAll('[placeholder]')) {
      expect(el.getAttribute('placeholder')).not.toMatch(BANNED)
    }

    await userEvent.click(screen.getByRole('button', { name: /send report/i }))
    await screen.findByText(/we.ll take a look/i)
    expect(document.body.textContent).not.toMatch(BANNED)
  })
})
