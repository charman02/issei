import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../api/posts', () => ({
  getPost: vi.fn(),
  requestRecipe: vi.fn(),
  retractRequest: vi.fn(),
  deletePost: vi.fn(),
  updatePost: vi.fn(),
}))
vi.mock('../api/client', () => ({ default: {}, toUserMessage: (e, f) => f }))
import { getPost, requestRecipe, retractRequest, deletePost, updatePost } from '../api/posts'
import PostPage from './PostPage'

const postData = (over = {}) => ({
  id: 5,
  user_id: 42,
  author_first_name: 'Ana',
  author_last_name: 'Cruz',
  author_photo_url: null,
  photo_url: 'https://img.test/meal.jpg',
  dish_name: 'Sunday Adobo',
  description: 'slow-cooked all afternoon',
  recipe_id: null,
  visibility: 'public',
  created_at: '2026-08-20T12:00:00Z',
  ...over,
})

function renderPost(id = '5') {
  return render(
    <MemoryRouter initialEntries={[`/posts/${id}`]}>
      <Routes>
        <Route path="/posts/:id" element={<PostPage />} />
        <Route path="/recipes/:id" element={<div>recipe page</div>} />
        <Route path="/u/:userId" element={<div>author profile</div>} />
        <Route path="/browse" element={<div>browse page</div>} />
        <Route path="/my-recipes" element={<div>your kitchen</div>} />
        <Route path="/requests" element={<div>requests page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  localStorage.setItem('issei_user', JSON.stringify({ id: 1 })) // viewer is not the author
})

describe('PostPage (#71)', () => {
  it('renders the meal — photo, dish name, description, author', async () => {
    getPost.mockResolvedValue({ data: postData() })
    renderPost()
    expect(await screen.findByText('Sunday Adobo')).toBeInTheDocument()
    expect(screen.getByText(/slow-cooked all afternoon/i)).toBeInTheDocument()
    expect(screen.getByText('Ana Cruz')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /sunday adobo/i })).toHaveAttribute(
      'src',
      'https://img.test/meal.jpg',
    )
  })

  it('links through to the attached recipe when there is one', async () => {
    getPost.mockResolvedValue({ data: postData({ recipe_id: 9 }) })
    renderPost()
    await screen.findByText('Sunday Adobo')
    await userEvent.click(screen.getByRole('button', { name: /see the recipe/i }))
    expect(await screen.findByText('recipe page')).toBeInTheDocument()
  })

  it('shows no recipe link when the post has none', async () => {
    getPost.mockResolvedValue({ data: postData({ recipe_id: null }) })
    renderPost()
    await screen.findByText('Sunday Adobo')
    expect(screen.queryByRole('button', { name: /see the recipe/i })).toBeNull()
  })

  it('tapping the author opens their profile', async () => {
    getPost.mockResolvedValue({ data: postData() })
    renderPost()
    await userEvent.click(await screen.findByRole('button', { name: /ana cruz/i }))
    expect(await screen.findByText('author profile')).toBeInTheDocument()
  })

  it('shows a not-available message on a 404 (a post you may not see, or gone)', async () => {
    getPost.mockRejectedValue({ response: { status: 404 } })
    renderPost()
    expect(await screen.findByText(/isn.t available/i)).toBeInTheDocument()
  })
})

// The ask on the PERMALINK (#79). This page is where a stranger lands from Browse's Meals
// tab — the exact person with no other route to the cook — and the branch reviewer caught it
// having no ask at all, which is the dead end #71 was built to open.
describe('PostPage — asking for the recipe', () => {
  it('offers the ask when the viewer can’t read a recipe for the meal', async () => {
    getPost.mockResolvedValue({ data: postData({ recipe_id: null }) })
    renderPost()
    expect(
      await screen.findByRole('button', { name: /ask for the recipe/i }),
    ).toBeInTheDocument()
  })

  it('links to the recipe instead, once the viewer can read it', async () => {
    getPost.mockResolvedValue({ data: postData({ recipe_id: 12 }) })
    renderPost()
    expect(await screen.findByRole('button', { name: /see the recipe/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ask for the recipe/i })).not.toBeInTheDocument()
  })

  it('never offers it on your own meal', async () => {
    getPost.mockResolvedValue({ data: postData({ user_id: 1, recipe_id: null }) })
    renderPost()
    await screen.findByText('Sunday Adobo')
    expect(screen.queryByRole('button', { name: /ask for the recipe/i })).not.toBeInTheDocument()
  })

  it('asks, and shows the server’s answer', async () => {
    getPost.mockResolvedValue({ data: postData({ recipe_id: null }) })
    requestRecipe.mockResolvedValue({
      data: postData({ recipe_id: null, requested_by_me: true }),
    })
    renderPost()
    await userEvent.click(await screen.findByRole('button', { name: /ask for the recipe/i }))
    await waitFor(() => expect(requestRecipe).toHaveBeenCalledWith(5))
    expect(await screen.findByRole('button', { name: /asked ✓/i })).toBeInTheDocument()
  })

  it('seeds "Asked ✓" from the loaded post, so a reload tells the truth', async () => {
    getPost.mockResolvedValue({ data: postData({ recipe_id: null, requested_by_me: true }) })
    renderPost()
    expect(await screen.findByRole('button', { name: /asked ✓/i })).toBeInTheDocument()
  })

  it('takes it back on a second tap', async () => {
    getPost.mockResolvedValue({ data: postData({ recipe_id: null, requested_by_me: true }) })
    retractRequest.mockResolvedValue({
      data: postData({ recipe_id: null, requested_by_me: false }),
    })
    renderPost()
    await userEvent.click(await screen.findByRole('button', { name: /asked ✓/i }))
    await waitFor(() => expect(retractRequest).toHaveBeenCalledWith(5))
    expect(
      await screen.findByRole('button', { name: /ask for the recipe/i }),
    ).toBeInTheDocument()
  })

  it('puts the button back and explains when the ask fails', async () => {
    getPost.mockResolvedValue({ data: postData({ recipe_id: null }) })
    requestRecipe.mockRejectedValue(new Error('offline'))
    renderPost()
    await userEvent.click(await screen.findByRole('button', { name: /ask for the recipe/i }))
    expect(
      await screen.findByRole('button', { name: /ask for the recipe/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/couldn.t ask just now/i)).toBeInTheDocument()
  })

  it('never shows a request count to someone who is not the cook', async () => {
    getPost.mockResolvedValue({
      data: postData({ recipe_id: null, request_count: 7, requested_by_me: false }),
    })
    renderPost()
    await screen.findByText('Sunday Adobo')
    // The server sends null to non-authors; even if one ever leaked a number, the permalink
    // must not render it. POSITIONING invariant 4.
    expect(document.body.textContent).not.toMatch(/7 (people|person)/)
    expect(document.body.textContent).not.toMatch(/asked for this/i)
  })
})

// The cook's own controls on their own post. Both are author-gated, and both were missing
// entirely: the count only ever showed on the feed card, and nothing anywhere called
// deletePost even though the endpoint had shipped.
describe('PostPage — the cook on their own meal', () => {
  const mine = (over = {}) => postData({ user_id: 1, ...over }) // viewer id is 1

  it('shows the cook their own ask count, linking to /requests', async () => {
    getPost.mockResolvedValue({ data: mine({ request_count: 3 }) })
    renderPost()
    await screen.findByText('Sunday Adobo')
    await userEvent.click(screen.getByRole('button', { name: /3 people asked for this/i }))
    expect(await screen.findByText('requests page')).toBeInTheDocument()
  })

  it('says "1 person" rather than "1 people"', async () => {
    getPost.mockResolvedValue({ data: mine({ request_count: 1 }) })
    renderPost()
    expect(await screen.findByText(/1 person asked for this/i)).toBeInTheDocument()
  })

  it('shows nothing at zero — "0 people asked" is the discouraging line', async () => {
    getPost.mockResolvedValue({ data: mine({ request_count: 0 }) })
    renderPost()
    await screen.findByText('Sunday Adobo')
    expect(document.body.textContent).not.toMatch(/asked for this/i)
  })

  it('offers no ask button on your own post', async () => {
    getPost.mockResolvedValue({ data: mine({ recipe_id: null }) })
    renderPost()
    await screen.findByText('Sunday Adobo')
    expect(screen.queryByRole('button', { name: /ask for the recipe/i })).toBeNull()
  })

  it('deletes the post after a confirm, and lands back in your kitchen', async () => {
    getPost.mockResolvedValue({ data: mine() })
    deletePost.mockResolvedValue({})
    renderPost()
    await screen.findByText('Sunday Adobo')
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await userEvent.click(screen.getByRole('button', { name: /^delete it$/i }))
    await waitFor(() => expect(deletePost).toHaveBeenCalledWith(5))
    expect(await screen.findByText('your kitchen')).toBeInTheDocument()
  })

  it('never deletes on the first tap', async () => {
    getPost.mockResolvedValue({ data: mine() })
    renderPost()
    await screen.findByText('Sunday Adobo')
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(deletePost).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /keep it/i }))
    expect(deletePost).not.toHaveBeenCalled()
  })

  it('promises the attached recipe survives, because that is the scary misreading', async () => {
    getPost.mockResolvedValue({ data: mine({ recipe_id: 9, request_count: 2 }) })
    renderPost()
    await screen.findByText('Sunday Adobo')
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(screen.getByText(/recipe you attached stays/i)).toBeInTheDocument()
    // ...and it's honest about the asks it takes with it (RecipeRequest cascades).
    expect(screen.getByText(/stops waiting/i)).toBeInTheDocument()
  })

  it('does not mention asks or the recipe when there are none of either', async () => {
    getPost.mockResolvedValue({ data: mine({ recipe_id: null, request_count: 0 }) })
    renderPost()
    await screen.findByText('Sunday Adobo')
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(screen.queryByText(/stops waiting/i)).toBeNull()
    expect(screen.queryByText(/recipe you attached/i)).toBeNull()
  })

  it('says so when the delete fails, and keeps the post', async () => {
    getPost.mockResolvedValue({ data: mine() })
    deletePost.mockRejectedValue(new Error('nope'))
    renderPost()
    await screen.findByText('Sunday Adobo')
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await userEvent.click(screen.getByRole('button', { name: /^delete it$/i }))
    expect(await screen.findByText(/couldn.t delete this post/i)).toBeInTheDocument()
    expect(screen.getByText('Sunday Adobo')).toBeInTheDocument()
  })

  it('offers no delete on someone else\'s post', async () => {
    getPost.mockResolvedValue({ data: postData() }) // author 42, viewer 1
    renderPost()
    await screen.findByText('Sunday Adobo')
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull()
  })
})

// Editing a meal you posted, and the date it was posted — both were missing.
describe('PostPage — editing your own meal', () => {
  const mine = (over = {}) => postData({ user_id: 1, ...over })

  it('shows WHEN it was posted, on the right DAY', async () => {
    // A permalink is where you come to know, so the date is absolute rather than "3d ago".
    //
    // The fixture is deliberately NAIVE (no 'Z'), which is exactly how the API serializes
    // created_at. This test can only assert what the runtime PRINTS, and that depends on its
    // timezone — in UTC (i.e. CI) a bare parse and a UTC parse agree exactly, so no fixture
    // here can catch the wrong-day bug. `utils/time.test.js` pins that contract in absolute
    // milliseconds instead, which is true in every zone. This one checks the wiring: that the
    // date renders at all, from the right helper, in the author's own view.
    getPost.mockResolvedValue({ data: mine({ created_at: '2026-08-20T23:30:00' }) })
    renderPost()
    // Locale-independent: toLocaleDateString orders the parts by the runtime's locale
    // ("20 Aug 2026" here, "Aug 20, 2026" in a US-default test runner), so assert the PARTS
    // rather than an ordering the browser is entitled to choose.
    const line = await screen.findByText(/Aug/)
    expect(line).toBeInTheDocument()
    expect(line.textContent).toMatch(/2026/)
    // 20, not 21 (a naive parse east of UTC) and not 19 (bare parse to the west).
    expect(line.textContent).toMatch(/\b20\b/)
  })

  it('renders nothing rather than "Invalid Date" for a broken timestamp', async () => {
    getPost.mockResolvedValue({ data: mine({ created_at: 'not-a-date' }) })
    renderPost()
    await screen.findByText('Sunday Adobo')
    expect(screen.queryByText(/invalid date/i)).toBeNull()
  })

  it('offers edit and delete as buttons, not underlined text', async () => {
    getPost.mockResolvedValue({ data: mine() })
    renderPost()
    await screen.findByText('Sunday Adobo')
    expect(screen.getByRole('button', { name: /edit this meal/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument()
  })

  it('saves an edit and shows the updated meal', async () => {
    getPost.mockResolvedValue({ data: mine({ description: 'first go' }) })
    updatePost.mockResolvedValue({
      data: mine({ dish_name: 'Chicken adobo', description: 'second go' }),
    })
    renderPost()
    await screen.findByText('Sunday Adobo')
    await userEvent.click(screen.getByRole('button', { name: /edit this meal/i }))

    const name = screen.getByLabelText(/what is it\?/i)
    await userEvent.clear(name)
    await userEvent.type(name, 'Chicken adobo')
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(updatePost).toHaveBeenCalledWith(5, expect.objectContaining({
      dish_name: 'Chicken adobo',
    })))
    expect(await screen.findByText('Chicken adobo')).toBeInTheDocument()
  })

  it('sends the description even when unchanged, so clearing one works', async () => {
    // The API reads null as "leave it alone", so a diff would silently fail to clear a
    // description. The client sends the whole editable set instead.
    getPost.mockResolvedValue({ data: mine({ description: 'a line' }) })
    updatePost.mockResolvedValue({ data: mine({ description: null }) })
    renderPost()
    await screen.findByText('Sunday Adobo')
    await userEvent.click(screen.getByRole('button', { name: /edit this meal/i }))
    await userEvent.clear(screen.getByLabelText(/anything to add/i))
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(updatePost).toHaveBeenCalledWith(5, expect.objectContaining({ description: '' })),
    )
  })

  it('will not save a blank dish name', async () => {
    getPost.mockResolvedValue({ data: mine() })
    renderPost()
    await screen.findByText('Sunday Adobo')
    await userEvent.click(screen.getByRole('button', { name: /edit this meal/i }))
    await userEvent.clear(screen.getByLabelText(/what is it\?/i))
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
  })

  it('says so when the save fails, and keeps your draft', async () => {
    getPost.mockResolvedValue({ data: mine() })
    updatePost.mockRejectedValue(new Error('offline'))
    renderPost()
    await screen.findByText('Sunday Adobo')
    await userEvent.click(screen.getByRole('button', { name: /edit this meal/i }))
    const name = screen.getByLabelText(/what is it\?/i)
    await userEvent.clear(name)
    await userEvent.type(name, 'Renamed')
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    expect(await screen.findByText(/couldn.t save your changes/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/what is it\?/i)).toHaveValue('Renamed')
  })

  it('never mind discards the draft', async () => {
    getPost.mockResolvedValue({ data: mine() })
    renderPost()
    await screen.findByText('Sunday Adobo')
    await userEvent.click(screen.getByRole('button', { name: /edit this meal/i }))
    await userEvent.type(screen.getByLabelText(/what is it\?/i), 'zzz')
    await userEvent.click(screen.getByRole('button', { name: /never mind/i }))
    expect(updatePost).not.toHaveBeenCalled()
    // Reopening starts from the POST again, not from the abandoned draft.
    await userEvent.click(screen.getByRole('button', { name: /edit this meal/i }))
    expect(screen.getByLabelText(/what is it\?/i)).toHaveValue('Sunday Adobo')
  })

  it("offers no edit control on someone else's meal", async () => {
    getPost.mockResolvedValue({ data: postData() }) // author 42, viewer 1
    renderPost()
    await screen.findByText('Sunday Adobo')
    expect(screen.queryByRole('button', { name: /edit this meal/i })).toBeNull()
  })
})
