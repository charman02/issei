import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => mockNavigate,
}))
// Account edits go through client.patch('/auth/me'); toUserMessage passes through
// the real formatter's behavior for the error test.
vi.mock('../api/client', () => ({
  default: { patch: vi.fn() },
  toUserMessage: (err, fallback) =>
    err?.response?.data?.detail || fallback,
}))
// The You page now loads its identity-box counts (own profile) + incoming request
// count. Default both to benign values; individual tests override as needed.
vi.mock('../api/friends', () => ({
  getUserProfile: vi.fn(() =>
    Promise.resolve({ data: { recipe_count: 0, post_count: 0, friend_count: 0 } }),
  ),
  getFriendRequests: vi.fn(() => Promise.resolve({ data: [] })),
  // Blocked-people list (#85) — benign default; the tests that care override it.
  getBlocks: vi.fn(() => Promise.resolve({ data: [] })),
  unblockUser: vi.fn(() => Promise.resolve({})),
}))
// The You page also totals pending recipe-asks across your posts (#79). Benign default;
// the tests below that care override it.
vi.mock('../api/posts', () => ({
  getIncomingRequests: vi.fn(() => Promise.resolve({ data: [] })),
}))
// Avatar upload (#33): stub the shared uploader so picking a photo synchronously yields
// a URL (the real one hits Cloudinary via axios).
// The You page now renders NotificationSettings (#89). In jsdom there is no PushManager, so
// without this the section shows its "this browser can't do notifications" branch and the switches
// never mount — nobody would notice if the section were removed from the page.
vi.mock('../lib/push', () => ({
  pushAvailability: () => 'ready',
  isSubscribedHere: () => Promise.resolve(false),
  primeVapidKey: () => Promise.resolve({ public_key: 'k', configured: true }),
  enable: () => Promise.resolve({ ok: true }),
  disable: () => Promise.resolve({ ok: true }),
}))
vi.mock('../lib/photoUpload', () => ({
  PHOTO_ACCEPT: 'image/*',
  createUploader: () => ({
    upload: ({ onUrl }) => onUrl('https://cdn.test/new-avatar.jpg'),
    retire: () => {},
  }),
}))
import client from '../api/client'
import { getUserProfile, getFriendRequests } from '../api/friends'
import Profile from './Profile'

// Covers the settings copy: round-2 testers read "Reduce motion" as jargon and
// "Cooking mode" as a name for a screen they hadn't met, so both toggles now say
// what changes. The stored pref keys are unchanged — this is a label pass, and
// these tests pin that the rename didn't quietly repoint the storage.
function renderProfile() {
  return render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  mockNavigate.mockClear()
  client.patch.mockReset()
  localStorage.setItem(
    'issei_user',
    JSON.stringify({
      id: 1,
      first_name: 'Yoko',
      last_name: 'M',
      email: 'yoko@example.com',
    }),
  )
})

describe('Profile settings copy', () => {
  it('describes the motion toggle in plain language, not "reduce motion"', () => {
    renderProfile()
    expect(screen.getByText('Turn off animations')).toBeInTheDocument()
    expect(
      screen.getByText(/appear right away instead of sliding or fading/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/reduce motion/i)).toBeNull()
  })

  it('names the steps-only preference the same way the recipe toggle does', () => {
    renderProfile()
    // Mirrors RecipeBody's toggle verbatim. "Just the steps" was retired because
    // it was a lie — that view shows the ingredients too — and this setting has to
    // be renamed in lockstep or it describes a button that no longer exists.
    expect(screen.getByText(/ingredients & steps/i)).toBeInTheDocument()
    expect(screen.queryByText(/just the steps/i)).toBeNull()
    expect(
      screen.getByText(/straight to ingredients and steps/i),
    ).toBeInTheDocument()
    // "Cooking mode" was the undecodable label; it must not survive anywhere.
    expect(screen.queryByText(/cooking mode/i)).toBeNull()
  })

  it('still persists under the original pref keys after the rename', async () => {
    renderProfile()
    await userEvent.click(
      screen.getByRole('switch', { name: /turn off animations/i }),
    )
    expect(JSON.parse(localStorage.getItem('issei_prefs'))).toEqual({
      reduceMotion: true,
    })
  })
})

describe('Profile visibility toggle (profile-visibility model)', () => {
  it('reflects a private profile and names the friends-only consequence', () => {
    renderProfile() // seeded user has no profile_visibility → treated as private
    const toggle = screen.getByRole('switch', { name: /public profile/i })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/only your friends see your recipes and posts/i)).toBeInTheDocument()
  })

  it('reflects a public profile when the cached user is public', () => {
    localStorage.setItem(
      'issei_user',
      JSON.stringify({ id: 1, first_name: 'Yoko', last_name: 'M', email: 'y@e.com', profile_visibility: 'public' }),
    )
    renderProfile()
    expect(screen.getByRole('switch', { name: /public profile/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('turning the profile ON opens the choice dialog instead of flipping immediately', async () => {
    renderProfile()
    await userEvent.click(screen.getByRole('switch', { name: /public profile/i }))
    // No PATCH yet — the user must first choose what happens to "Only me" items.
    expect(client.patch).not.toHaveBeenCalled()
    expect(screen.getByText(/make your profile public\?/i)).toBeInTheDocument()
  })

  it('"Leave my existing ones as they are" flips the profile only', async () => {
    client.patch.mockResolvedValueOnce({ data: { profile_visibility: 'public' } })
    renderProfile()
    await userEvent.click(screen.getByRole('switch', { name: /public profile/i }))
    await userEvent.click(screen.getByRole('button', { name: /leave my existing ones/i }))
    expect(client.patch).toHaveBeenCalledWith('/auth/me', { profile_visibility: 'public' })
    expect(JSON.parse(localStorage.getItem('issei_user')).profile_visibility).toBe('public')
  })

  it('"Make everything public" sweeps all items to public alongside the flip', async () => {
    client.patch.mockResolvedValueOnce({ data: { profile_visibility: 'public' } })
    renderProfile()
    await userEvent.click(screen.getByRole('switch', { name: /public profile/i }))
    await userEvent.click(screen.getByRole('button', { name: /make everything public/i }))
    expect(client.patch).toHaveBeenCalledWith('/auth/me', {
      profile_visibility: 'public',
      apply_visibility_to_all: 'public',
    })
  })

  it('turning the profile OFF opens a confirm with a "make everything friends-only" sweep', async () => {
    localStorage.setItem(
      'issei_user',
      JSON.stringify({ id: 1, first_name: 'Yoko', last_name: 'M', email: 'y@e.com', profile_visibility: 'public' }),
    )
    client.patch.mockResolvedValueOnce({ data: { profile_visibility: 'private' } })
    renderProfile()
    await userEvent.click(screen.getByRole('switch', { name: /public profile/i }))
    // Both directions confirm (a sweep is offered each way); no immediate PATCH.
    expect(client.patch).not.toHaveBeenCalled()
    expect(screen.getByText(/make your profile private\?/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /make everything friends-only/i }))
    expect(client.patch).toHaveBeenCalledWith('/auth/me', {
      profile_visibility: 'private',
      apply_visibility_to_all: 'friends',
    })
  })
})

describe('Profile identity-box counts (#74)', () => {
  it('shows recipes/posts/friends counts from the profile fetch', async () => {
    getUserProfile.mockResolvedValueOnce({
      data: { recipe_count: 12, post_count: 5, friend_count: 8 },
    })
    renderProfile()
    // Counts fetched with the user's OWN id.
    expect(getUserProfile).toHaveBeenCalledWith(1)
    expect(await screen.findByText('12')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /recipes/i })).toBeInTheDocument()
  })

  it('recipes/posts counts deep-link into the Kitchen (posts via ?tab=posts)', async () => {
    getUserProfile.mockResolvedValueOnce({
      data: { recipe_count: 3, post_count: 2, friend_count: 1 },
    })
    renderProfile()
    await screen.findByText('3')
    await userEvent.click(screen.getByRole('button', { name: /posts/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/my-recipes?tab=posts')
    await userEvent.click(screen.getByRole('button', { name: /friends/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/friends')
  })

  it('shows the friend-requests button only when there are pending requests', async () => {
    getFriendRequests.mockResolvedValueOnce({ data: [{ id: 1 }, { id: 2 }] })
    renderProfile()
    const btn = await screen.findByRole('button', { name: /2 friend requests/i })
    await userEvent.click(btn)
    expect(mockNavigate).toHaveBeenCalledWith('/friends')
  })

  it('hides the friend-requests button when there are none', async () => {
    getFriendRequests.mockResolvedValueOnce({ data: [] })
    renderProfile()
    await screen.findByText('Settings') // let effects settle
    expect(screen.queryByRole('button', { name: /friend request/i })).toBeNull()
  })

  it('nudges a photo-less user to add one, dismissibly (#77)', async () => {
    // Seeded user has no photo_url and no dismissal, so the nudge is shown.
    renderProfile()
    expect(
      screen.getByText(/add a photo so friends recognize you/i),
    ).toBeInTheDocument()
    // Dismiss it — it disappears and the choice persists in the prefs bag so it
    // stays gone across reloads (not a per-session state).
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(
      screen.queryByText(/add a photo so friends recognize you/i),
    ).toBeNull()
    expect(JSON.parse(localStorage.getItem('issei_prefs')).photoNudgeDismissed).toBe(true)
  })

  it('does not nudge once dismissed, nor when a photo is already set (#77)', async () => {
    // Already dismissed → no nudge even though there's still no photo.
    localStorage.setItem('issei_prefs', JSON.stringify({ photoNudgeDismissed: true }))
    const { unmount } = renderProfile()
    expect(
      screen.queryByText(/add a photo so friends recognize you/i),
    ).toBeNull()
    unmount()

    // Fresh prefs but a photo already set → also no nudge (the fix is already done).
    localStorage.setItem('issei_prefs', '{}')
    localStorage.setItem(
      'issei_user',
      JSON.stringify({ id: 1, first_name: 'Yoko', email: 'y@e.com', photo_url: 'https://res.cloudinary.com/issei/avatars/x.jpg' }),
    )
    renderProfile()
    expect(
      screen.queryByText(/add a photo so friends recognize you/i),
    ).toBeNull()
  })

  it('picking a profile photo uploads it and saves via PATCH /auth/me', async () => {
    client.patch.mockResolvedValueOnce({ data: { photo_url: 'https://cdn.test/new-avatar.jpg' } })
    renderProfile()
    const input = screen.getByLabelText(/change your profile photo/i)
    // Define files + fire change directly (the stubbed uploader reads onUrl, not the
    // real file), matching PostComposer's test pattern.
    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'me.jpg', { type: 'image/jpeg' })],
      configurable: true,
    })
    fireEvent.change(input)
    // The stubbed uploader yields a URL synchronously; the handler PATCHes it.
    await waitFor(() =>
      expect(client.patch).toHaveBeenCalledWith('/auth/me', {
        photo_url: 'https://cdn.test/new-avatar.jpg',
      }),
    )
    // Cached user updated so the avatar shows everywhere without a reload.
    expect(JSON.parse(localStorage.getItem('issei_user')).photo_url).toBe(
      'https://cdn.test/new-avatar.jpg',
    )
  })
})

describe('Profile feedback entry point', () => {
  it('opens the in-app form rather than leaving for an external one', async () => {
    // The launch shipped an <a> to a Google Form. Leaving the app is where most
    // testers stopped, so this is now an in-app route.
    renderProfile()
    await userEvent.click(screen.getByRole('button', { name: /send feedback/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/feedback', {
      state: { from: '/profile' },
    })
  })

  it('passes the originating screen so a report says where it came from', async () => {
    // Handed over explicitly rather than sniffed, so it can only ever be a route
    // the person navigated to themselves — which is what the form discloses.
    renderProfile()
    await userEvent.click(screen.getByRole('button', { name: /send feedback/i }))
    expect(mockNavigate.mock.calls[0][1].state.from).toBe('/profile')
  })

  it('no longer renders an external feedback link', () => {
    // Guards the removal of VITE_FEEDBACK_URL. A leftover outbound link would
    // split reports between a spreadsheet and the database, and a stale env var on
    // the deploy host would silently keep sending people out of the app.
    // queryAll, not getAll: the removal means there is no anchor left to find at
    // all, and getAllByRole throws on zero matches rather than returning [].
    const { container } = renderProfile()
    const outbound = [...container.querySelectorAll('a[href]')].map((a) =>
      a.getAttribute('href'),
    )
    expect(outbound.filter((h) => /forms\.gle|tally|https?:/i.test(h))).toEqual([])
    // And specifically not an <a> wearing the feedback label.
    expect(screen.queryByRole('link', { name: /send feedback/i })).toBeNull()
  })

  it('always offers the feedback entry point, with no env var to configure', () => {
    // The old button hid itself unless VITE_FEEDBACK_URL was set, so an unset var
    // meant no way to report anything at all. An in-app route can't point at
    // nothing, so it is unconditional.
    renderProfile()
    expect(
      screen.getByRole('button', { name: /send feedback/i }),
    ).toBeInTheDocument()
  })
})

describe('Profile account editing', () => {
  it('replaces the old "Soon" placeholders with working editors', () => {
    renderProfile()
    // The three rows exist as real controls now, not disabled "Soon" badges.
    expect(screen.getByRole('button', { name: /edit name/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /change email/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /change password/i }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/^soon$/i)).toBeNull()
  })

  it('saves a new name via PATCH /auth/me and refreshes the cached user', async () => {
    client.patch.mockResolvedValue({
      data: { first_name: 'Yoko', last_name: 'Ono', email: 'yoko@example.com' },
    })
    renderProfile()
    await userEvent.click(screen.getByRole('button', { name: /edit name/i }))
    const last = screen.getByLabelText('Last name')
    await userEvent.clear(last)
    await userEvent.type(last, 'Ono')
    await userEvent.click(screen.getByRole('button', { name: /save name/i }))

    expect(client.patch).toHaveBeenCalledWith('/auth/me', {
      first_name: 'Yoko',
      last_name: 'Ono',
    })
    // localStorage now reflects the server's response.
    expect(JSON.parse(localStorage.getItem('issei_user')).last_name).toBe('Ono')
    expect(await screen.findByText(/your name is updated/i)).toBeInTheDocument()
  })

  it('sends the current password when changing email', async () => {
    client.patch.mockResolvedValue({
      data: { first_name: 'Yoko', last_name: 'M', email: 'new@example.com' },
    })
    renderProfile()
    await userEvent.click(screen.getByRole('button', { name: /change email/i }))
    const email = screen.getByLabelText('New email')
    await userEvent.clear(email)
    await userEvent.type(email, 'new@example.com')
    await userEvent.type(screen.getByLabelText('Current password'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /save email/i }))

    expect(client.patch).toHaveBeenCalledWith('/auth/me', {
      email: 'new@example.com',
      current_password: 'password123',
    })
    expect(JSON.parse(localStorage.getItem('issei_user')).email).toBe(
      'new@example.com',
    )
  })

  it('surfaces the server error (e.g. wrong current password) without crashing', async () => {
    client.patch.mockRejectedValue({
      response: { data: { detail: "Your current password isn't right." } },
    })
    renderProfile()
    await userEvent.click(screen.getByRole('button', { name: /change password/i }))
    await userEvent.type(screen.getByLabelText('Current password'), 'wrong')
    await userEvent.type(
      screen.getByLabelText('New password'),
      'a-new-password',
    )
    await userEvent.click(screen.getByRole('button', { name: /save password/i }))
    expect(
      await screen.findByText(/current password isn.t right/i),
    ).toBeInTheDocument()
  })
})

// The asked-for total (#79). Deliberately NOT the bell's unread badge: reading a
// notification clears that, but the ask is still an obligation waiting on the cook.
describe('You page — recipe asks waiting on you', () => {
  it('shows the total across all your posts, and routes to the asks page', async () => {
    const { getIncomingRequests } = await import('../api/posts')
    getIncomingRequests.mockResolvedValue({
      data: [
        { post: { id: 1 }, requesters: [{ user_id: 7 }, { user_id: 8 }] },
        { post: { id: 2 }, requesters: [{ user_id: 9 }] },
      ],
    })
    renderProfile()
    const btn = await screen.findByRole('button', { name: /3 people asked for a recipe/i })
    await userEvent.click(btn)
    expect(mockNavigate).toHaveBeenCalledWith('/requests')
  })

  it('reads "1 person", not "1 people"', async () => {
    const { getIncomingRequests } = await import('../api/posts')
    getIncomingRequests.mockResolvedValue({
      data: [{ post: { id: 1 }, requesters: [{ user_id: 7 }] }],
    })
    renderProfile()
    expect(
      await screen.findByRole('button', { name: /1 person asked for a recipe/i }),
    ).toBeInTheDocument()
  })

  it('shows nothing at all when nobody has asked', async () => {
    const { getIncomingRequests } = await import('../api/posts')
    getIncomingRequests.mockResolvedValue({ data: [] })
    renderProfile()
    await waitFor(() => expect(getIncomingRequests).toHaveBeenCalled())
    // No zero-state button — an empty obligation is not worth a row.
    expect(screen.queryByText(/asked for a recipe/i)).not.toBeInTheDocument()
  })
})

// Blocked people (#85). This list is the ONLY route back — once blocked, their profile 404s
// for you, so the unblock control cannot live where the block control does.
describe('You page — blocked people', () => {
  const blocked = [
    { user_id: 7, first_name: 'Ana', last_name: 'Cruz', photo_url: null, created_at: 'x' },
  ]

  it('lists who you blocked, and unblocks them', async () => {
    const { getBlocks, unblockUser } = await import('../api/friends')
    getBlocks.mockResolvedValue({ data: blocked })
    renderProfile()
    expect(await screen.findByText('Ana Cruz')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^unblock$/i }))
    await waitFor(() => expect(unblockUser).toHaveBeenCalledWith(7))
    // Removed from the list without a refetch.
    await waitFor(() => expect(screen.queryByText('Ana Cruz')).not.toBeInTheDocument())
  })

  it('says plainly that unblocking is not re-friending', async () => {
    const { getBlocks } = await import('../api/friends')
    getBlocks.mockResolvedValue({ data: blocked })
    renderProfile()
    expect(
      await screen.findByText(/doesn.t make you friends again/i),
    ).toBeInTheDocument()
  })

  it('shows nothing at all when you have blocked nobody', async () => {
    const { getBlocks } = await import('../api/friends')
    getBlocks.mockResolvedValue({ data: [] })
    renderProfile()
    await waitFor(() => expect(getBlocks).toHaveBeenCalled())
    // An empty "Blocked (0)" row is a permanent reminder of a thing that isn't happening.
    expect(screen.queryByText(/^blocked$/i)).not.toBeInTheDocument()
  })

  // A failed unblock used to be silent: the promise rejected inside an async handler, the row
  // stayed put, the label flipped back to "Unblock" and the user was told nothing. The block
  // half of this same feature routes its failure through toUserMessage; so must this half.
  it('says so when the unblock fails, and keeps the person listed', async () => {
    const { getBlocks, unblockUser } = await import('../api/friends')
    getBlocks.mockResolvedValue({ data: blocked })
    unblockUser.mockRejectedValueOnce(new Error('nope'))
    renderProfile()
    expect(await screen.findByText('Ana Cruz')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^unblock$/i }))
    expect(await screen.findByText(/couldn.t unblock them/i)).toBeInTheDocument()
    // Still there, so they can try again — this list is the only route back.
    expect(screen.getByText('Ana Cruz')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^unblock$/i })).toBeEnabled()
  })

  // Worse than a failed unblock: if the LIST fails to load, an empty result is
  // indistinguishable from "you've blocked nobody", and there is no other route back.
  it('says so when the blocked list itself fails to load', async () => {
    const { getBlocks } = await import('../api/friends')
    getBlocks.mockRejectedValueOnce(new Error('offline'))
    renderProfile()
    expect(await screen.findByText(/couldn.t load your blocked list/i)).toBeInTheDocument()
  })
})

describe('You page carries the notification settings (#89)', () => {
  it('renders the Notifications section with its own switches', async () => {
    // Its own section ABOVE Settings, deliberately: Settings holds display preferences, while these
    // decide whether the app may interrupt someone's day.
    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: /notify me on this device/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /daily nudge/i })).toBeInTheDocument()
  })
})
