import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../api/posts', () => ({
  getFeed: vi.fn(),
  markFeedSeen: vi.fn(() => Promise.resolve()),
}))
// Feed now renders the FriendsStrip (#75), which fetches the caller's friends. Mock it
// so these Feed tests don't hit the real axios client; default to no friends (the strip
// self-hides), and the strip test below overrides it.
vi.mock('../api/friends', () => ({
  getFriends: vi.fn(() => Promise.resolve({ data: [] })),
}))
// The masthead now reads the unread count for its bell badge (#79).
vi.mock('../api/notifications', () => ({
  getNotifications: vi.fn(() => Promise.resolve({ data: { notifications: [], unread_count: 0 } })),
}))
// Feed also renders NotifyNudge (#89). WITHOUT this mock, jsdom has no PushManager, so
// `pushAvailability()` answers 'unsupported' and the strip self-hides — meaning nobody would notice
// if <NotifyNudge /> were deleted from this page. Stubbed to the state the strip exists for:
// subscribable, nothing subscribed, permission not yet answered.
vi.mock('../lib/push', () => ({
  pushAvailability: () => 'ready',
  permissionState: () => 'default',
  isSubscribedHere: () => Promise.resolve(false),
  primeVapidKey: () => Promise.resolve({ public_key: 'k', configured: true }),
  enable: () => Promise.resolve({ ok: true }),
}))
import { getFeed } from '../api/posts'
import { getFriends } from '../api/friends'
import { getNotifications } from '../api/notifications'
import { clearUser, setUser } from '../lib/currentUser'
import Feed from './Feed'

const post = (id, over = {}) => ({
  id,
  user_id: 10 + id,
  author_first_name: 'Lola',
  author_last_name: 'Cook',
  photo_url: `https://img.test/${id}.jpg`,
  dish_name: `Dish ${id}`,
  description: null,
  recipe_id: null,
  created_at: '2026-08-18T12:00:00Z',
  ...over,
})

function renderFeed() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Feed />} />
        <Route path="/add/meal" element={<div>compose meal</div>} />
        <Route path="/friends" element={<div>friends page</div>} />
        <Route path="/notifications" element={<div>inbox page</div>} />
        <Route path="/u/:userId" element={<div>user profile</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  // Signed out by default, so the two one-time nudges (photo, notifications) stay out of every
  // other test's rendered output. The tests that want one sign in explicitly.
  clearUser()
})

describe('Feed (Home)', () => {
  it('renders friends’ posts newest-first as cards', async () => {
    getFeed.mockResolvedValue({ data: [post(3), post(2), post(1)] })
    renderFeed()
    expect(await screen.findByText('Dish 3')).toBeInTheDocument()
    expect(screen.getByText('Dish 2')).toBeInTheDocument()
    expect(screen.getByText('Dish 1')).toBeInTheDocument()
  })

  it('shows the onboarding empty state (share + find friends) when the feed is empty', async () => {
    getFeed.mockResolvedValue({ data: [] })
    renderFeed()
    expect(await screen.findByText(/nothing cooking yet/i)).toBeInTheDocument()
    // The two cold-start actions.
    await userEvent.click(screen.getByRole('button', { name: /share a meal/i }))
    expect(await screen.findByText('compose meal')).toBeInTheDocument()
  })

  it('empty state routes to friends', async () => {
    getFeed.mockResolvedValue({ data: [] })
    renderFeed()
    await userEvent.click(await screen.findByRole('button', { name: /find friends/i }))
    expect(await screen.findByText('friends page')).toBeInTheDocument()
  })

  it('does not offer "load more" when a short page comes back', async () => {
    getFeed.mockResolvedValue({ data: [post(1)] })
    renderFeed()
    await screen.findByText('Dish 1')
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull()
  })

  it('shows the friends strip (active order) above the feed, tapping through to a profile', async () => {
    getFeed.mockResolvedValue({ data: [post(1)] })
    getFriends.mockResolvedValue({
      data: [{ user_id: 42, first_name: 'Ana', last_name: 'R', photo_url: null }],
    })
    renderFeed()
    // The strip requests the activity ordering, not the friendship-recency default.
    await waitFor(() => expect(getFriends).toHaveBeenCalledWith('active'))
    await userEvent.click(await screen.findByRole('button', { name: /ana/i }))
    expect(await screen.findByText('user profile')).toBeInTheDocument()
  })

  // --- cold start (#94, replacing #70's toggle) ---
  //
  // The toggle is gone. Public posts now appear ONLY when nobody but you has posted anything
  // you can see, because a brand-new user's Home was otherwise empty — the worst screen in the
  // app, on the page they land on. `me` is unseeded in most tests here, so every fixture post
  // counts as somebody else's and the feed stays in friends mode; the cold-start tests below
  // set the id explicitly.

  it('asks for the friends feed, and only that, when friends have posted', async () => {
    getFeed.mockResolvedValue({ data: [post(2), post(1)] })
    renderFeed()
    await screen.findByText('Dish 2')
    expect(getFeed).toHaveBeenCalledTimes(1)
    expect(getFeed).toHaveBeenCalledWith(undefined, 'friends')
    // No toggle to find any more.
    expect(screen.queryByRole('tab', { name: /^everyone$/i })).toBeNull()
    expect(screen.queryByRole('tab', { name: /^friends$/i })).toBeNull()
  })

  it('falls through to public posts when nobody you know has posted', async () => {
    getFeed
      .mockResolvedValueOnce({ data: [] })                      // friends: nothing
      .mockResolvedValueOnce({ data: [post(7), post(6)] })      // public
    renderFeed()
    expect(await screen.findByText('Dish 7')).toBeInTheDocument()
    expect(getFeed).toHaveBeenNthCalledWith(1, undefined, 'friends')
    expect(getFeed).toHaveBeenNthCalledWith(2, undefined, 'everyone')
    // The band is LABELLED: without it a stranger's dish reads as somebody you know.
    expect(screen.getByText(/while you find your people/i)).toBeInTheDocument()
  })

  it('keeps YOUR OWN post above the strangers, rather than replacing it', async () => {
    // A 0-friend user who shares a meal must not watch it vanish from Home. Safe to show both
    // in one list precisely because cold start means there are no friends' posts to bury.
    localStorage.setItem('issei_user', JSON.stringify({ id: 42 }))
    getFeed
      .mockResolvedValueOnce({ data: [post(1, { user_id: 42, dish_name: 'My adobo' })] })
      .mockResolvedValueOnce({ data: [post(9, { dish_name: 'A stranger dish' })] })
    renderFeed()
    expect(await screen.findByText('My adobo')).toBeInTheDocument()
    expect(screen.getByText('A stranger dish')).toBeInTheDocument()
    expect(screen.getByText(/while you find your people/i)).toBeInTheDocument()
    localStorage.clear()
  })

  it('never advances the read-mark from the public fall-through', async () => {
    // The mark is measured against friends' post ids; advancing it from strangers' would
    // silently mark future friends' posts as already-read.
    const { markFeedSeen } = await import('../api/posts')
    getFeed
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [post(9)] })
    renderFeed()
    await screen.findByText('Dish 9')
    expect(markFeedSeen).not.toHaveBeenCalled()
  })

  it('shows the cold-start empty state only when there is nothing ANYWHERE', async () => {
    getFeed.mockResolvedValue({ data: [] }) // friends empty AND public empty
    renderFeed()
    expect(await screen.findByText(/nothing cooking yet/i)).toBeInTheDocument()
    // The two acts that fill a feed — the right nudge when the app itself is empty. TWO
    // find-friends buttons here: the masthead's permanent one plus the empty state's.
    expect(screen.getByRole('button', { name: /share a meal/i })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /find friends/i })).toHaveLength(2)
  })

  it('falls back to the empty state if the public fetch fails', async () => {
    getFeed
      .mockResolvedValueOnce({ data: [] })
      .mockRejectedValueOnce(new Error('offline'))
    renderFeed()
    // Not a spinner forever, and not a blank screen.
    expect(await screen.findByText(/nothing cooking yet/i)).toBeInTheDocument()
  })

  it('paginates the source it is actually showing', async () => {
    getFeed
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: Array.from({ length: 30 }, (_, i) => post(100 - i)) })
    renderFeed()
    await screen.findByText('Dish 100')
    getFeed.mockResolvedValueOnce({ data: [post(70)] })
    await userEvent.click(screen.getByRole('button', { name: /load more/i }))
    // Page 2 must come from the PUBLIC source, or a friends page would append under it.
    await waitFor(() => expect(getFeed).toHaveBeenLastCalledWith(71, 'everyone'))
  })

  it('shows the friends strip whether or not your circle has posted', async () => {
    // No longer gated on a scope. It self-hides with no friends, which is already right in
    // cold start, and someone WITH friends whose circle is quiet should still see them.
    const { getFriends } = await import('../api/friends')
    getFriends.mockResolvedValue({
      data: [{ user_id: 5, first_name: 'Ana', last_name: 'Cruz', photo_url: null }],
    })
    getFeed.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [post(9)] })
    renderFeed()
    await screen.findByText('Dish 9')
    expect(await screen.findByText('Ana')).toBeInTheDocument()
  })
})

// #80 follow-up, user-reported: "once there's a post on the home page the 'nothing
// cooking yet' box disappears, which means the 'find friends' button disappears" — and
// then the only route to Friends was You → Friends. So Home carries a PERMANENT one.
describe('Feed — the permanent route to Friends', () => {
  const findFriends = () => screen.getByRole('button', { name: /find friends/i })

  it('is in the masthead even when the feed is full', async () => {
    getFeed.mockResolvedValue({ data: [post(1)] })
    renderFeed()
    await screen.findByText('Dish 1')
    expect(findFriends()).toBeInTheDocument()
    await userEvent.click(findFriends())
    expect(await screen.findByText('friends page')).toBeInTheDocument()
  })

  it('is there in the cold-start feed too, where no empty-state button exists', async () => {
    // Public posts fill the screen, so the "find friends" button inside the empty-state box is
    // gone — and this is the user with NO friends, i.e. exactly who needs the door. The
    // masthead is the only one left.
    getFeed
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [post(9)] })
    renderFeed()
    await screen.findByText('Dish 9')
    // Exactly ONE left — the masthead's. The empty state's is gone with the empty state.
    expect(screen.getAllByRole('button', { name: /find friends/i })).toHaveLength(1)
    expect(findFriends()).toBeInTheDocument()
  })

  it('is there while the feed is still loading', async () => {
    getFeed.mockReturnValue(new Promise(() => {}))
    renderFeed()
    expect(findFriends()).toBeInTheDocument()
  })

  it('is the only find-friends door even once FriendsStrip renders', async () => {
    // Every other test in this block already runs with zero friends (the module mock
    // defaults to an empty list), so the uncovered case is the opposite one: friends
    // EXIST, the strip renders its avatars, and the masthead button must still be the
    // single unambiguous route to the Friends page rather than being crowded out.
    getFriends.mockResolvedValue({
      data: [
        {
          id: 1,
          user_id: 42,
          first_name: 'Lola',
          last_name: 'Cook',
          state: 'accepted',
          outgoing: false,
          created_at: '2026-08-18T00:00:00Z',
        },
      ],
    })
    getFeed.mockResolvedValue({ data: [post(1)] })
    renderFeed()
    await screen.findByText('Dish 1')
    expect(screen.getAllByRole('button', { name: /find friends/i })).toHaveLength(1)
    await userEvent.click(findFriends())
    expect(await screen.findByText('friends page')).toBeInTheDocument()
  })
})

// The inbox door (#79). issei's first notification surface, so the badge is also the first
// unread indicator anywhere — and it must not become an always-on scoreboard.
describe('Feed — the inbox bell', () => {
  it('is always there, and opens the inbox', async () => {
    getFeed.mockResolvedValue({ data: [post(1)] })
    renderFeed()
    await screen.findByText('Dish 1')
    await userEvent.click(screen.getByRole('button', { name: /what's new/i }))
    expect(await screen.findByText('inbox page')).toBeInTheDocument()
  })

  it('shows no badge when there is nothing unread', async () => {
    getNotifications.mockResolvedValue({ data: { notifications: [], unread_count: 0 } })
    getFeed.mockResolvedValue({ data: [] })
    renderFeed()
    await screen.findByText(/nothing cooking yet/i)
    // A permanent "0" is exactly the empty scoreboard this app avoids elsewhere.
    expect(screen.getByRole('button', { name: /^what's new$/i })).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('shows the count when there is, and caps it at 9+', async () => {
    getNotifications.mockResolvedValue({ data: { notifications: [], unread_count: 12 } })
    getFeed.mockResolvedValue({ data: [] })
    renderFeed()
    expect(await screen.findByText('9+')).toBeInTheDocument()
    // The accessible name carries the real number for a screen reader.
    expect(screen.getByRole('button', { name: /12 unread/i })).toBeInTheDocument()
  })

  it('a failed count is silent rather than breaking the masthead', async () => {
    getNotifications.mockRejectedValue(new Error('offline'))
    getFeed.mockResolvedValue({ data: [post(1)] })
    renderFeed()
    expect(await screen.findByText('Dish 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /what's new/i })).toBeInTheDocument()
  })
})

// The feed read-mark (#97). The invariant that matters most here is the one that could rot into
// a bug: the divider marks a BOUNDARY, it does not remove anything.
describe('Feed — the caught-up divider (#97)', () => {
  it('draws the line after the last new post, keeping the older ones on screen', async () => {
    getFeed.mockResolvedValue({
      data: [post(3, { is_new: true }), post(2, { is_new: true }), post(1, { is_new: false })],
    })
    renderFeed()
    expect(await screen.findByText(/you.re all caught up/i)).toBeInTheDocument()
    // Nothing is hidden: every post is still rendered, the old one included.
    expect(screen.getByText('Dish 3')).toBeInTheDocument()
    expect(screen.getByText('Dish 2')).toBeInTheDocument()
    expect(screen.getByText('Dish 1')).toBeInTheDocument()
  })

  it('says nothing when there is no boundary to mark', async () => {
    // All read: a permanent "all caught up" banner on every open stops meaning anything.
    getFeed.mockResolvedValue({ data: [post(2, { is_new: false }), post(1, { is_new: false })] })
    renderFeed()
    expect(await screen.findByText('Dish 2')).toBeInTheDocument()
    expect(screen.queryByText(/you.re all caught up/i)).toBeNull()
  })

  it('says nothing when EVERYTHING is new either', async () => {
    // A first-ever visit has no "where you got to" — the line would be at the bottom of the
    // list, marking nothing.
    getFeed.mockResolvedValue({ data: [post(2, { is_new: true }), post(1, { is_new: true })] })
    renderFeed()
    expect(await screen.findByText('Dish 2')).toBeInTheDocument()
    expect(screen.queryByText(/you.re all caught up/i)).toBeNull()
  })

  it('marks the feed read through the NEWEST post it received', async () => {
    const { markFeedSeen } = await import('../api/posts')
    getFeed.mockResolvedValue({ data: [post(9), post(8)] })
    renderFeed()
    await screen.findByText('Dish 9')
    // The newest id, not now() — so a post arriving while this is on screen stays new.
    await waitFor(() => expect(markFeedSeen).toHaveBeenCalledWith(9))
  })

  it('a rejected mark never blanks the feed', async () => {
    const { markFeedSeen } = await import('../api/posts')
    markFeedSeen.mockRejectedValueOnce(new Error('offline'))
    getFeed.mockResolvedValue({ data: [post(1)] })
    renderFeed()
    expect(await screen.findByText('Dish 1')).toBeInTheDocument()
  })

  it('a mark that throws SYNCHRONOUSLY never blanks the feed either', async () => {
    // This is the one that pins the guard. A rejected promise is handled by the .catch on the
    // call itself, so the previous test passes even with the try/catch deleted. A SYNCHRONOUS
    // throw is different: it escapes into the feed's own .then, gets caught by the outer
    // .catch, and is read as "the fetch failed" — running setPosts([]) after setPosts(res.data)
    // and blanking a list that had already arrived. Bookkeeping must not be able to hide content.
    const { markFeedSeen } = await import('../api/posts')
    markFeedSeen.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    getFeed.mockResolvedValue({ data: [post(1)] })
    renderFeed()
    expect(await screen.findByText('Dish 1')).toBeInTheDocument()
  })

  it('no divider where is_new is null (the server omits it off the friends feed)', async () => {
    // The server sends is_new: null for that scope, so there is nothing to draw a line from —
    // otherwise it would freeze in one place forever in a tab nobody catches up on.
    getFeed.mockResolvedValue({
      data: [post(2, { is_new: null }), post(1, { is_new: null })],
    })
    renderFeed()
    await screen.findByText('Dish 2')
    expect(screen.queryByText(/you.re all caught up/i)).toBeNull()
  })

  it('draws ONE divider even when your own post sits among new ones', async () => {
    // `is_new` is not monotonic: your own post is never new to you. A per-row boundary check
    // drew a SECOND line above it, claiming you were caught up on unread content. The boundary
    // is computed once from the array instead.
    getFeed.mockResolvedValue({
      data: [
        post(8, { is_new: true }),
        post(7, { is_new: false }), // yours
        post(6, { is_new: true }),
        post(5, { is_new: false }),
      ],
    })
    renderFeed()
    await screen.findByText('Dish 8')
    expect(screen.getAllByText(/you.re all caught up/i)).toHaveLength(1)
  })
})

describe('Feed carries the notifications nudge (#89)', () => {
  it('offers it on Home, which is the only place most people will find it', async () => {
    // The setting itself lives three screens deep on the You page, under two other headings. This
    // strip is the difference between a notification feature people have and one they don't — and
    // being reachable is the whole point, so the wiring is worth a test of its own.
    // The strip needs a signed-in user — an anonymous invite reader has nothing to be notified
    // about — and it reads that through the shared identity store, not from props.
    setUser({ id: 1, first_name: 'Ana', photo_url: 'https://img.test/me.jpg' })
    getFeed.mockResolvedValue({ data: [] })
    renderFeed()
    expect(
      await screen.findByText(/get a nudge when your friends have been cooking/i),
    ).toBeInTheDocument()
  })
})
