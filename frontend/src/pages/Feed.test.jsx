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
import { getFeed } from '../api/posts'
import { getFriends } from '../api/friends'
import { getNotifications } from '../api/notifications'
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

beforeEach(() => vi.clearAllMocks())

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

  // --- friends/everyone toggle (#70) ---

  it('opens on the Friends scope and fetches it', async () => {
    getFeed.mockResolvedValue({ data: [post(1)] })
    renderFeed()
    await screen.findByText('Dish 1')
    // First load is the friends scope (the default 'home base').
    expect(getFeed).toHaveBeenCalledWith(undefined, 'friends')
    expect(screen.getByRole('tab', { name: /friends/i })).toHaveAttribute('aria-selected', 'true')
  })

  it('switching to Everyone refetches with the everyone scope', async () => {
    getFeed.mockResolvedValue({ data: [post(5)] })
    renderFeed()
    await screen.findByText('Dish 5')
    await userEvent.click(screen.getByRole('tab', { name: /everyone/i }))
    await waitFor(() => expect(getFeed).toHaveBeenCalledWith(undefined, 'everyone'))
    expect(screen.getByRole('tab', { name: /everyone/i })).toHaveAttribute('aria-selected', 'true')
  })

  it('paginates within the current scope', async () => {
    // A full page then a short page; the "load more" call must carry the everyone scope.
    getFeed.mockResolvedValue({ data: Array.from({ length: 30 }, (_, i) => post(100 - i)) })
    renderFeed()
    await screen.findByText('Dish 100')
    await userEvent.click(screen.getByRole('tab', { name: /everyone/i }))
    await waitFor(() => expect(getFeed).toHaveBeenCalledWith(undefined, 'everyone'))
    getFeed.mockResolvedValueOnce({ data: [post(1)] })
    await userEvent.click(await screen.findByRole('button', { name: /load more/i }))
    // The cursor call pages the everyone scope, using the last post's id.
    await waitFor(() => expect(getFeed).toHaveBeenCalledWith(71, 'everyone'))
  })

  it('the Everyone empty state is discovery-flavored, not the friends cold-start', async () => {
    getFeed.mockResolvedValue({ data: [] })
    renderFeed()
    // Friends empty first.
    expect(await screen.findByText(/nothing cooking yet/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /everyone/i }))
    // Everyone empty: no "share a meal / find friends" cold-start prompt IN THE BOX.
    // Scoped to the box on purpose — the masthead's permanent Friends button is a
    // different thing and must stay (see the #80 describe block below).
    await screen.findByText(/nothing public yet/i)
    expect(screen.queryByRole('button', { name: /share a meal/i })).toBeNull()
    // Global reach, not scoped to the box: the masthead's permanent Friends button is a
    // different thing and must stay, so the guard is "there is EXACTLY ONE" — that still
    // fails if a second find-friends prompt is added anywhere on this screen, and it
    // can't be silently defeated by wrapping the empty state in another div.
    expect(screen.getAllByRole('button', { name: /find friends/i })).toHaveLength(1)
  })

  it('drops a load-more page whose scope was switched away before it resolved', async () => {
    // The #70 race the reviewer caught: tap "Load more" in Friends, then switch to
    // Everyone before the page returns. The stale friends page must NOT be appended
    // (that would either crash on [...null] or mix friends posts under the Everyone tab).
    // Friends: a full page so "Load more" shows. Then a DEFERRED load-more response we
    // resolve only after the scope has flipped.
    const friendsPage = Array.from({ length: 30 }, (_, i) => post(100 - i))
    let releaseLoadMore
    const deferred = new Promise((resolve) => {
      releaseLoadMore = () => resolve({ data: [post(1, { dish_name: 'STALE friends post' })] })
    })
    getFeed.mockImplementation((beforeId, scope) => {
      if (beforeId === 71 && scope === 'friends') return deferred // the load-more call
      if (scope === 'everyone') return Promise.resolve({ data: [post(200, { dish_name: 'Everyone post' })] })
      return Promise.resolve({ data: friendsPage }) // initial friends load
    })
    renderFeed()
    await screen.findByText('Dish 100')
    // Fire load-more (stays pending), then switch to Everyone.
    await userEvent.click(screen.getByRole('button', { name: /load more/i }))
    await userEvent.click(screen.getByRole('tab', { name: /everyone/i }))
    await screen.findByText('Everyone post')
    // Now release the stale friends page; it must be discarded.
    releaseLoadMore()
    await new Promise((r) => setTimeout(r, 0)) // let the resolved promise flush
    expect(screen.queryByText('STALE friends post')).toBeNull()
    expect(screen.getByText('Everyone post')).toBeInTheDocument() // everyone view intact
  })

  it('hides the friends strip in the Everyone scope', async () => {
    getFeed.mockResolvedValue({ data: [post(1)] })
    getFriends.mockResolvedValue({
      data: [{ user_id: 42, first_name: 'Ana', last_name: 'R', photo_url: null }],
    })
    renderFeed()
    // Strip shows in friends scope.
    expect(await screen.findByRole('button', { name: /ana/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /everyone/i }))
    // Gone in everyone scope (discovery isn't about your circle).
    await waitFor(() => expect(getFeed).toHaveBeenCalledWith(undefined, 'everyone'))
    expect(screen.queryByRole('button', { name: /ana/i })).toBeNull()
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

  it('is there in the everyone scope too, where no empty-state button exists', async () => {
    getFeed.mockResolvedValue({ data: [] })
    renderFeed()
    await screen.findByText(/nothing cooking yet/i)
    await userEvent.click(screen.getByRole('tab', { name: /^everyone$/i }))
    // The everyone empty state deliberately has no find-friends prompt (it's a
    // discovery tab), so the masthead is the ONLY door here.
    await screen.findByText(/nothing public yet/i)
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

  it('no divider on the Everyone tab, where the mark is never advanced', async () => {
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
