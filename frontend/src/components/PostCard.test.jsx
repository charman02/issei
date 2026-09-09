import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import PostCard from './PostCard'

vi.mock('../api/posts', () => ({
  requestRecipe: vi.fn(),
  retractRequest: vi.fn(),
}))
vi.mock('../api/client', () => ({
  default: {},
  toUserMessage: (err, fallback) => fallback,
}))
import { requestRecipe, retractRequest } from '../api/posts'


const post = (over = {}) => ({
  id: 1,
  user_id: 42,
  author_first_name: 'Lola',
  author_last_name: 'Cook',
  photo_url: 'https://img.test/x.jpg',
  dish_name: 'Adobo',
  description: null,
  recipe_id: null,
  created_at: '2026-08-18T12:00:00', // naive UTC, as the API serializes it
  ...over,
})

function renderCard(p) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<PostCard post={p} />} />
        <Route path="/u/:id" element={<div>profile page</div>} />
        <Route path="/recipes/:id" element={<div>recipe page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PostCard', () => {
  it('renders the dish, author, and photo — and no like button (never)', () => {
    renderCard(post({ dish_name: 'Sinigang' }))
    expect(screen.getByText('Sinigang')).toBeInTheDocument()
    expect(screen.getByText('Lola Cook')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Sinigang' })).toBeInTheDocument()
    // No like affordance anywhere — a deliberate product rule.
    expect(screen.queryByRole('button', { name: /like/i })).toBeNull()
  })

  it('shows an optional description when present, omits it otherwise', () => {
    const { rerender } = renderCard(post({ description: 'a weeknight batch' }))
    expect(screen.getByText('a weeknight batch')).toBeInTheDocument()
    rerender(
      <MemoryRouter>
        <PostCard post={post({ description: null })} />
      </MemoryRouter>,
    )
    expect(screen.queryByText('a weeknight batch')).toBeNull()
  })

  it('links to the recipe only when the post has one attached', async () => {
    const { rerender } = renderCard(post({ recipe_id: null }))
    expect(screen.queryByText(/see the recipe/i)).toBeNull()
    rerender(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<PostCard post={post({ recipe_id: 7 })} />} />
          <Route path="/recipes/:id" element={<div>recipe page</div>} />
        </Routes>
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('button', { name: /see the recipe/i }))
    expect(await screen.findByText('recipe page')).toBeInTheDocument()
  })

  it('opens the author profile when the name is tapped', async () => {
    renderCard(post())
    await userEvent.click(screen.getByRole('button', { name: /Lola Cook/i }))
    expect(await screen.findByText('profile page')).toBeInTheDocument()
  })

  // The bug this test locks down: created_at arrives WITHOUT a timezone, and JS
  // parses a zone-less ISO string as LOCAL time. Untreated, a post minutes old reads
  // as hours old (or "just now" for hours) depending on the viewer's offset. ago()
  // must treat the naive string as UTC. Pinning both the clock and the machine's
  // timezone would be ideal, but vitest can't relocate TZ mid-run — so assert the
  // property that survives ANY offset: a post 90s in the (UTC) past reads in minutes,
  // never "just now", which is what the pre-fix local-parse produced west of UTC.
  describe('relative time (ago)', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    // Freeze "now" to a fixed UTC instant so the deltas below are exact.
    const now = new Date('2026-08-18T12:00:00Z')

    it('reads "just now" under a minute', () => {
      vi.setSystemTime(now)
      renderCard(post({ created_at: '2026-08-18T11:59:30' })) // 30s ago, UTC
      expect(screen.getByText('just now')).toBeInTheDocument()
    })

    it('reads minutes for a few-minutes-old post (not "just now")', () => {
      vi.setSystemTime(now)
      renderCard(post({ created_at: '2026-08-18T11:45:00' })) // 15m ago, UTC
      expect(screen.getByText('15m')).toBeInTheDocument()
    })

    it('reads hours within a day', () => {
      vi.setSystemTime(now)
      renderCard(post({ created_at: '2026-08-18T09:00:00' })) // 3h ago, UTC
      expect(screen.getByText('3h')).toBeInTheDocument()
    })

    it('reads days within a week', () => {
      vi.setSystemTime(now)
      renderCard(post({ created_at: '2026-08-16T12:00:00' })) // 2d ago, UTC
      expect(screen.getByText('2d')).toBeInTheDocument()
    })

    it('already-zoned timestamps are respected, not double-shifted', () => {
      vi.setSystemTime(now)
      renderCard(post({ created_at: '2026-08-18T11:59:30Z' })) // explicit Z, 30s ago
      expect(screen.getByText('just now')).toBeInTheDocument()
    })
  })
})

// The ask (#79) — the app's premise as a mechanic, sitting deliberately where a like button
// would have gone. There isn't one, and there is no public tally either.
describe('PostCard — asking for the recipe', () => {
  const ME = { id: 1, first_name: 'Me' }
  const setMe = () => localStorage.setItem('issei_user', JSON.stringify(ME))

  const somebodyElses = (over = {}) => ({
    id: 5,
    user_id: 99,
    author_first_name: 'Lola',
    author_last_name: 'Cook',
    author_photo_url: null,
    photo_url: 'https://img.test/a.jpg',
    dish_name: 'Sinigang',
    description: null,
    recipe_id: null,
    requested_by_me: false,
    request_count: null,
    created_at: '2026-09-04T10:00:00Z',
    ...over,
  })

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('offers the ask on someone else’s post with no readable recipe', () => {
    setMe()
    renderCard(somebodyElses())
    expect(screen.getByRole('button', { name: /ask for the recipe/i })).toBeInTheDocument()
  })

  it('renders from recipe_id ALONE, so a hidden recipe is indistinguishable', () => {
    // The privacy property, stated as the thing that actually makes it true: the card branches
    // on `recipe_id` and nothing else, so it cannot tell "never written" from "written but
    // private" — the API nulls the field in both cases. (The previous version of this test
    // compared two identical objects and could not fail; this asserts the mechanism.)
    setMe()
    renderCard(somebodyElses({ recipe_id: null }))
    const ask = screen.getByRole('button', { name: /ask for the recipe/i })
    expect(ask).toBeInTheDocument()
    // Nothing anywhere hints that a recipe might exist.
    expect(document.body.textContent).not.toMatch(/private|hidden|not shared|withheld/i)
  })

  it('links to the recipe instead of asking, once you can read it', () => {
    setMe()
    renderCard(somebodyElses({ recipe_id: 12 }))
    expect(screen.getByRole('button', { name: /see the recipe/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ask for the recipe/i })).not.toBeInTheDocument()
  })

  it('never offers you the ask on your OWN post', () => {
    setMe()
    renderCard(somebodyElses({ user_id: ME.id }))
    expect(screen.queryByRole('button', { name: /ask for the recipe/i })).not.toBeInTheDocument()
  })

  it('asks, and reflects the server’s answer', async () => {
    setMe()
    requestRecipe.mockResolvedValue({ data: somebodyElses({ requested_by_me: true }) })
    renderCard(somebodyElses())
    await userEvent.click(screen.getByRole('button', { name: /ask for the recipe/i }))
    await waitFor(() => expect(requestRecipe).toHaveBeenCalledWith(5))
    expect(await screen.findByRole('button', { name: /asked ✓/i })).toBeInTheDocument()
  })

  it('taps again to take it back', async () => {
    setMe()
    retractRequest.mockResolvedValue({ data: somebodyElses({ requested_by_me: false }) })
    renderCard(somebodyElses({ requested_by_me: true }))
    await userEvent.click(screen.getByRole('button', { name: /asked ✓/i }))
    await waitFor(() => expect(retractRequest).toHaveBeenCalledWith(5))
    expect(await screen.findByRole('button', { name: /ask for the recipe/i })).toBeInTheDocument()
  })

  it('puts the button back and says so when the ask fails', async () => {
    setMe()
    requestRecipe.mockRejectedValue(new Error('offline'))
    renderCard(somebodyElses())
    await userEvent.click(screen.getByRole('button', { name: /ask for the recipe/i }))
    // Never leave an optimistic lie on screen.
    expect(await screen.findByRole('button', { name: /ask for the recipe/i })).toBeInTheDocument()
    expect(screen.getByText(/couldn.t ask just now/i)).toBeInTheDocument()
  })

  it('shows the count to the COOK only, and never as a zero', () => {
    setMe()
    // The cook's own post, with asks: a private nudge.
    const { unmount } = renderCard(somebodyElses({ user_id: ME.id, request_count: 3 }))
    expect(screen.getByText(/3 people asked for this/i)).toBeInTheDocument()
    unmount()
    // The cook's own post with none: nothing at all — no "0 asked".
    const second = renderCard(somebodyElses({ user_id: ME.id, request_count: 0 }))
    expect(screen.queryByText(/asked for this/i)).not.toBeInTheDocument()
    second.unmount()
    // A viewer is handed null, so there is nothing it could print.
    renderCard(somebodyElses({ request_count: null, requested_by_me: true }))
    expect(screen.queryByText(/asked for this/i)).not.toBeInTheDocument()
  })

  it('reads "1 person", not "1 people"', () => {
    setMe()
    renderCard(somebodyElses({ user_id: ME.id, request_count: 1 }))
    expect(screen.getByText(/1 person asked for this/i)).toBeInTheDocument()
  })

  it('still has no like button', () => {
    setMe()
    renderCard(somebodyElses())
    expect(document.body.textContent).not.toMatch(/\blike\b|\bheart\b|favourite|favorite/i)
  })
})

// A feed is SCANNED; a permalink is READ. Neither of these was clamped, and with a
// 500-character description (the schema ceiling) one post shoved the next person's photo clean
// off the screen — so the cost of someone writing at length was paid by everyone below them.
describe('PostCard — long text on a card', () => {
  const LONG = 'x'.repeat(500)

  it('clamps the description rather than letting it run the length of the card', () => {
    renderCard(post({ description: LONG }))
    const line = screen.getByText(LONG)
    // The full text IS in the DOM — clamping is visual, so the text stays selectable and
    // searchable and nothing is silently truncated server-side.
    expect(line).toBeInTheDocument()
    expect(line.className).toMatch(/line-clamp-3/)
  })

  it('clamps a very long dish name to two lines', () => {
    const NAME = 'y'.repeat(120) // the schema ceiling for a dish name
    renderCard(post({ dish_name: NAME }))
    expect(screen.getByText(NAME).className).toMatch(/line-clamp-2/)
  })

  it('makes the text itself the way to read the rest, when the card can open', () => {
    // Rather than a "more" link, which would put a second control beside the card's one
    // deliberate action. Tapping what you were already reading opens the post.
    const onOpen = vi.fn()
    render(
      <MemoryRouter>
        <PostCard post={post({ description: LONG })} onOpen={onOpen} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByText(LONG))
    expect(onOpen).toHaveBeenCalled()
  })

  it('still renders the text when there is nowhere to open (no onOpen)', () => {
    // The non-tappable branch has to keep the same clamps; a card with no onOpen is a
    // display-only card, not a broken one.
    renderCard(post({ description: LONG }))
    expect(screen.getByText(LONG)).toBeInTheDocument()
    expect(screen.getByText('Adobo').className).toMatch(/line-clamp-2/)
  })
})
