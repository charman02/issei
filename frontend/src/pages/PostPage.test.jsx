import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../api/posts', () => ({
  getPost: vi.fn(),
  requestRecipe: vi.fn(),
  retractRequest: vi.fn(),
  deletePost: vi.fn(),
  updatePost: vi.fn(),
  // #99 — attaching after publishing goes through fulfillPost (attaching IS answering); the
  // unlink direction is its own route.
  fulfillPost: vi.fn(),
  detachRecipe: vi.fn(),
}))
vi.mock('../api/client', () => ({ default: { get: vi.fn() }, toUserMessage: (e, f) => f }))
// `SafetyMenu` (#87 part two) reaches api/friends; mocked so the report path is observable and
// no real call is attempted.
vi.mock('../api/friends', () => ({
  reportUser: vi.fn(() => Promise.resolve({})),
  blockUser: vi.fn(() => Promise.resolve({})),
}))
// #106 — the photo-replace path. A controllable uploader: `upload()` records its options so a test
// can land a URL, an error or a busy flag at the exact moment it wants to. Mocked for the same
// reason RecipeForm.test.jsx mocks the framer — a real one is a modal only a human can dismiss,
// and what these tests are about is the DRAFT semantics around it.
const uploadCalls = []
const retireCalls = []
vi.mock('../lib/photoUpload', () => ({
  PHOTO_ACCEPT: 'image/jpeg',
  createUploader: () => ({
    upload: (opts) => {
      uploadCalls.push(opts)
      return Promise.resolve()
    },
    retire: (slot) => retireCalls.push(slot),
  }),
}))
vi.mock('../lib/usePhotoFramer', () => ({
  usePhotoFramer: () => ({
    frame: () => async (file) => file,
    framerProps: { file: null, shape: 'cover', onDone: () => {}, onCancel: () => {} },
    framing: false,
  }),
}))
import {
  getPost,
  requestRecipe,
  retractRequest,
  deletePost,
  updatePost,
  fulfillPost,
  detachRecipe,
} from '../api/posts'
import client from '../api/client'
import { reportUser } from '../api/friends'
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

function renderPost(id = '5', state = undefined) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: `/posts/${id}`, state }]}>
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
  client.get.mockReset()
  fulfillPost.mockReset()
  detachRecipe.mockReset()
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

  it('shows the WHOLE description — a permalink is where you read it', async () => {
    // The other half of PostCard's clamp, and the reason the clamp is acceptable there: a feed
    // is scanned, so a long line is trimmed and the card opens; this page is the destination, so
    // nothing is trimmed. If someone ever adds a line-clamp here, tapping through from the feed
    // would stop being a way to read the rest and the truncation would have nowhere to resolve.
    const LONG = 'x'.repeat(500) // the schema ceiling for a post description
    getPost.mockResolvedValue({ data: postData({ description: LONG }) })
    renderPost()
    const line = await screen.findByText(LONG)
    expect(line.className).not.toMatch(/line-clamp/)
    expect(line.className).not.toMatch(/truncate/)
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

// #104 — the card's ⋯ names "Edit this meal" and "Delete", and both actions live HERE. Landing
// someone on the page and making them find the control again would defeat the point of naming it.
describe('PostPage opens straight into the control the card asked for (#104)', () => {
  it('opens the editor when arriving with open: "edit"', async () => {
    localStorage.setItem('issei_user', JSON.stringify({ id: 42 })) // the author
    getPost.mockResolvedValue({ data: postData() })

    renderPost('5', { open: 'edit' })

    // The edit form, not the read view's button.
    expect(await screen.findByDisplayValue('Sunday Adobo')).toBeInTheDocument()
  })

  it('opens the delete confirm when arriving with open: "delete"', async () => {
    localStorage.setItem('issei_user', JSON.stringify({ id: 42 }))
    getPost.mockResolvedValue({ data: postData() })

    renderPost('5', { open: 'delete' })

    expect(await screen.findByText(/delete this meal\?/i)).toBeInTheDocument()
    // Still TWO taps: arriving at the confirm is not confirming.
    expect(deletePost).not.toHaveBeenCalled()
  })

  it('ignores the hint for someone who is NOT the author', async () => {
    // The server is the authority on ownership, not the navigation. PATCH/DELETE are author-only, so
    // showing the form to anyone else would be the client claiming an edit is possible when it isn't.
    localStorage.setItem('issei_user', JSON.stringify({ id: 999 }))
    getPost.mockResolvedValue({ data: postData({ user_id: 42 }) })

    renderPost('5', { open: 'edit' })

    await screen.findByText('Sunday Adobo')
    expect(screen.queryByDisplayValue('Sunday Adobo')).toBeNull()
    expect(screen.queryByText(/delete this meal\?/i)).toBeNull()
  })

  it('opens nothing at all with no hint', async () => {
    localStorage.setItem('issei_user', JSON.stringify({ id: 42 }))
    getPost.mockResolvedValue({ data: postData() })

    renderPost('5')

    await screen.findByText('Sunday Adobo')
    expect(screen.queryByDisplayValue('Sunday Adobo')).toBeNull()
    expect(screen.queryByText(/delete this meal\?/i)).toBeNull()
  })
})

// ============================================================================
// #106 — REPLACING THE PHOTO. Reverses #98, which deliberately left the photo out of the edit
// form ("a different photo is a different meal, so re-shoot it as a new post"). The owner
// reversed it: that rule described what a post MEANS but answered the wrong question, because
// the common case is a photo that came out badly, and the only remedy on offer was
// delete-and-repost — which throws away the post's date, its place in every feed, and any recipe
// asks already sitting on it.
//
// The uploader and framer are mocked here for the same reason RecipeForm.test.jsx mocks them: a
// real framer is a modal only a human can dismiss, and these tests are about the DRAFT semantics
// around it, which is where the bugs would be.
// ============================================================================

const CLOUDINARY = 'https://res.cloudinary.com/demo/image/upload/v1/issei/new.jpg'
const A_FILE = () => new File(['x'], 'new.jpg', { type: 'image/jpeg' })

async function openEditor(over = {}) {
  localStorage.setItem('issei_user', JSON.stringify({ id: 42 }))
  getPost.mockResolvedValue({ data: postData(over) })
  renderPost()
  await screen.findByText('Sunday Adobo')
  await userEvent.click(screen.getByRole('button', { name: /edit this meal/i }))
}

describe('PostPage — replacing the photo (#106)', () => {
  beforeEach(() => {
    uploadCalls.length = 0
    retireCalls.length = 0
  })

  it('offers a way to change the photo, which #98 did not', async () => {
    await openEditor()
    expect(screen.getByLabelText('Replace the photo')).toBeInTheDocument()
    expect(screen.getByText(/change photo/i)).toBeInTheDocument()
  })

  it('offers NO way to remove it — a post with no photo is not a post', async () => {
    // `Post.photo_url` is nullable=False, and a post carries no ingredients or steps: the photo
    // IS the post. Deleting the post is how you have no photo, and Delete is already on this page.
    await openEditor()
    expect(screen.queryByRole('button', { name: /remove photo/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /delete photo/i })).toBeNull()
  })

  it('frames a replacement, at the same ratio as an original', async () => {
    // A second, simpler upload path here would be the one that drifts: a replacement must get
    // HEIC conversion and the #103 framing step exactly like the composer's pick.
    await openEditor()
    await userEvent.upload(screen.getByLabelText('Replace the photo'), A_FILE())
    expect(uploadCalls).toHaveLength(1)
    expect(uploadCalls[0].frame).toBeTypeOf('function')
    expect(uploadCalls[0].slot).toBe('post-edit')
  })

  it('a new photo lands in the DRAFT and is only sent on "Save changes"', async () => {
    await openEditor()
    await userEvent.upload(screen.getByLabelText('Replace the photo'), A_FILE())
    act(() => uploadCalls[0].onUrl(CLOUDINARY))

    await waitFor(() =>
      expect(screen.getByAltText('Your meal').getAttribute('src')).toBe(CLOUDINARY),
    )
    expect(updatePost).not.toHaveBeenCalled()

    updatePost.mockResolvedValue({ data: postData({ photo_url: CLOUDINARY }) })
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(updatePost).toHaveBeenCalledWith(5, expect.objectContaining({ photo_url: CLOUDINARY })),
    )
  })

  it('"Never mind" abandons the new photo AND retires the upload slot', async () => {
    // Retiring matters: an in-flight upload resolving after the draft is gone would write into
    // nothing, and on a slow link it could land while a SECOND edit is already open.
    await openEditor()
    await userEvent.upload(screen.getByLabelText('Replace the photo'), A_FILE())
    act(() => uploadCalls[0].onUrl(CLOUDINARY))
    await waitFor(() =>
      expect(screen.getByAltText('Your meal').getAttribute('src')).toBe(CLOUDINARY),
    )

    await userEvent.click(screen.getByRole('button', { name: /never mind/i }))

    expect(retireCalls).toContain('post-edit')
    expect(updatePost).not.toHaveBeenCalled()
  })

  it('sends photo_url as NULL when the photo was not touched', async () => {
    // The API reads null as "unchanged". Sending the existing URL would also work, but then a
    // caption fix would depend on the host rule passing for a photo the person never touched, and
    // a post whose stored URL predates that rule would become uneditable.
    await openEditor()
    const name = screen.getByLabelText(/what is it/i)
    await userEvent.clear(name)
    await userEvent.type(name, 'Renamed')
    updatePost.mockResolvedValue({ data: postData({ dish_name: 'Renamed' }) })

    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(updatePost).toHaveBeenCalled())
    expect(updatePost.mock.calls[0][1].photo_url).toBeNull()
  })

  it('cannot save mid-upload, so a post never saves with a half-replaced photo', async () => {
    await openEditor()
    await userEvent.upload(screen.getByLabelText('Replace the photo'), A_FILE())

    act(() => uploadCalls[0].onBusy(true))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled(),
    )

    act(() => uploadCalls[0].onBusy(false))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save changes/i })).not.toBeDisabled(),
    )
  })

  it('shows an upload failure without discarding the rest of the edit', async () => {
    await openEditor()
    const name = screen.getByLabelText(/what is it/i)
    await userEvent.clear(name)
    await userEvent.type(name, 'Kept typing')
    await userEvent.upload(screen.getByLabelText('Replace the photo'), A_FILE())

    act(() => uploadCalls[0].onError('That image is too large (max 10 MB).'))

    expect(await screen.findByText(/too large/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/what is it/i)).toHaveValue('Kept typing')
  })

  it('"Never mind" MID-UPLOAD leaves the editor saveable — the busy flag must not stick', async () => {
    // The ship gate found this. `retire()` bumps the slot's sequence, which makes `isCurrent()`
    // false, which makes the upload's own `finally` SKIP `onBusy(false)` — by design, so a
    // superseded pick can't stop a newer upload's spinner. The consequence was that backing out
    // during the multi-second upload left `uploadingPhoto` true for the rest of the session, and
    // the control that would have recovered it is the one it disables: "Save changes" reads
    // `uploadingPhoto`, so the editor became permanently unsaveable and the button read
    // "Uploading…" forever.
    await openEditor()
    await userEvent.upload(screen.getByLabelText('Replace the photo'), A_FILE())
    act(() => uploadCalls[0].onBusy(true))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled(),
    )

    await userEvent.click(screen.getByRole('button', { name: /never mind/i }))
    // Re-open: the editor must be usable again.
    await userEvent.click(screen.getByRole('button', { name: /edit this meal/i }))

    const save = screen.getByRole('button', { name: /save changes/i })
    expect(save).not.toBeDisabled()
    expect(save).toHaveTextContent(/save changes/i)
  })

  it('a non-author gets no photo control at all', async () => {
    localStorage.setItem('issei_user', JSON.stringify({ id: 999 }))
    getPost.mockResolvedValue({ data: postData() })
    renderPost()
    await screen.findByText('Sunday Adobo')

    expect(screen.queryByRole('button', { name: /edit this meal/i })).toBeNull()
    expect(screen.queryByLabelText('Replace the photo')).toBeNull()
  })
})

// ============================================================================================
// #99 — ATTACHING A RECIPE AFTER THE POST IS PUBLISHED, and unlinking it.
//
// The gap: a recipe could only reach a post at CREATE time (the composer, or writing one mid-post
// per #81) or via fulfill, which needs somebody to have asked. A cook who posted the meal on
// Tuesday and wrote the recipe on Thursday had no way to connect them.
//
// The backend already allowed it — `post.recipe_id` is set outside fulfill's pending loop — so what
// these tests are really about is the SURFACE and the honesty of its copy.
// ============================================================================================

describe('PostPage — attach a recipe after publishing (#99)', () => {
  const MY_RECIPES = [
    { id: 7, name: 'Adobo', cover_photo_url: null, origin_attribution: null },
    { id: 8, name: 'Sinigang', cover_photo_url: null, origin_attribution: null },
  ]

  async function openAsAuthor(over = {}) {
    localStorage.setItem('issei_user', JSON.stringify({ id: 42 }))
    getPost.mockResolvedValue({ data: postData(over) })
    // RecipePicker fetches the caller's own recipes through client.get('/recipes').
    client.get.mockResolvedValue({ data: MY_RECIPES })
    renderPost()
    await screen.findByText('Sunday Adobo')
  }

  it('offers "Attach a recipe" on your own post that has none', async () => {
    await openAsAuthor({ recipe_id: null })
    expect(screen.getByRole('button', { name: /attach a recipe/i })).toBeInTheDocument()
  })

  it('does NOT offer it on someone else’s post', async () => {
    localStorage.setItem('issei_user', JSON.stringify({ id: 999 }))
    getPost.mockResolvedValue({ data: postData({ recipe_id: null }) })
    renderPost()
    await screen.findByText('Sunday Adobo')

    expect(screen.queryByRole('button', { name: /attach a recipe/i })).toBeNull()
    // They get the ask instead — the one action a non-author has.
    expect(screen.getByRole('button', { name: /ask for the recipe/i })).toBeInTheDocument()
  })

  it('attaches through fulfillPost, which is the same act as answering', async () => {
    // One endpoint on purpose. A separate "attach quietly" route would recreate the #98 loose end:
    // asks left pending under an already-attached recipe.
    await openAsAuthor({ recipe_id: null })
    fulfillPost.mockResolvedValue({ data: postData({ recipe_id: 7 }) })

    await userEvent.click(screen.getByRole('button', { name: /attach a recipe/i }))
    await userEvent.click(await screen.findByText('Adobo'))

    await waitFor(() => expect(fulfillPost).toHaveBeenCalledWith(5, 7))
    expect(await screen.findByRole('button', { name: /see the recipe/i })).toBeInTheDocument()
  })

  it('WARNS that attaching also sends it to whoever asked — before the tap', async () => {
    // The cook is about to answer people. Saying so afterwards would be telling them what they
    // already did.
    await openAsAuthor({ recipe_id: null, request_count: 3 })
    expect(screen.getByText(/also sends it to the 3 people who asked/i)).toBeInTheDocument()
  })

  it('says it in the singular for one person', async () => {
    await openAsAuthor({ recipe_id: null, request_count: 1 })
    expect(screen.getByText(/also sends it to the 1 person who asked/i)).toBeInTheDocument()
  })

  it('says nothing about asks when nobody has asked', async () => {
    // Same discipline as the count itself: never render a zero on someone's own meal.
    await openAsAuthor({ recipe_id: null, request_count: 0 })
    expect(screen.queryByText(/also sends it/i)).toBeNull()
  })

  it('offers Change and Unlink once a recipe is attached', async () => {
    await openAsAuthor({ recipe_id: 7 })
    expect(screen.getByRole('button', { name: /change recipe/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^unlink$/i })).toBeInTheDocument()
    // And the reader-facing link is still there — the controls are additions, not replacements.
    expect(screen.getByRole('button', { name: /see the recipe/i })).toBeInTheDocument()
  })

  it('unlinks through detachRecipe and drops the link', async () => {
    await openAsAuthor({ recipe_id: 7 })
    detachRecipe.mockResolvedValue({ data: postData({ recipe_id: null }) })

    await userEvent.click(screen.getByRole('button', { name: /^unlink$/i }))

    await waitFor(() => expect(detachRecipe).toHaveBeenCalledWith(5))
    expect(await screen.findByRole('button', { name: /attach a recipe/i })).toBeInTheDocument()
  })

  it('surfaces a failure instead of silently doing nothing', async () => {
    await openAsAuthor({ recipe_id: 7 })
    detachRecipe.mockRejectedValue(new Error('nope'))

    await userEvent.click(screen.getByRole('button', { name: /^unlink$/i }))

    // This file's toUserMessage stub returns the FALLBACK, so the assertion is on the copy the
    // page itself chose — which is the part worth pinning anyway.
    expect(await screen.findByText(/couldn.{0,3}t unlink that/i)).toBeInTheDocument()
    // The recipe is still shown as attached, because the server still has it.
    expect(screen.getByRole('button', { name: /see the recipe/i })).toBeInTheDocument()
  })

  it('never calls "unlink" a delete — the recipe is not going anywhere', async () => {
    // The scariest possible misreading on this page, and the reason DELETE lives in its own
    // confirm: a cook must not think unlinking removes the recipe from their kitchen.
    await openAsAuthor({ recipe_id: 7 })
    const label = screen.getByRole('button', { name: /^unlink$/i }).textContent
    expect(label).not.toMatch(/delete|remove|discard/i)
  })

  it('hides the attach controls while the EDIT FORM is open', async () => {
    // One consequential decision at a time; the same rule the edit/delete pair already follows.
    await openAsAuthor({ recipe_id: null })
    await userEvent.click(screen.getByRole('button', { name: /edit this meal/i }))

    expect(screen.queryByRole('button', { name: /attach a recipe/i })).toBeNull()
  })

  it('hides them while the DELETE CONFIRM is open too', async () => {
    // The other half of the same guard, and the more consequential panel to leave an attach button
    // beside. It was unasserted: the first version of the test above named the delete confirm and
    // only clicked Edit, so deleting `!confirmingDelete` from the render gate failed nothing.
    await openAsAuthor({ recipe_id: null })
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))

    expect(screen.queryByRole('button', { name: /attach a recipe/i })).toBeNull()
  })

  it('WARNS on the "Change recipe" path too, where a pending ask can coexist with a link', async () => {
    // The gate caught this: the caption was gated on `!post.recipe_id`, which assumed a linked
    // recipe and a pending ask are mutually exclusive. They are not. `request_recipe` deliberately
    // allows an ask when a recipe IS linked but the asker can't read it — a private recipe on a
    // public meal — so the author lands on "Change recipe" with people waiting, and tapping it
    // mints grants and notifies them. Suppressing the warning there hid the one act it exists for.
    await openAsAuthor({ recipe_id: 7, request_count: 2 })

    expect(screen.getByRole('button', { name: /change recipe/i })).toBeInTheDocument()
    expect(screen.getByText(/also sends it to the 2 people who asked/i)).toBeInTheDocument()
  })

  it('the busy label lands on the button that was pressed, not its neighbour', async () => {
    // One shared flag put "Working…" on Unlink while an attach from "Change recipe" ran — feedback
    // for one act appearing on the destructive-sounding control beside it.
    await openAsAuthor({ recipe_id: 7 })
    let release
    fulfillPost.mockReturnValue(new Promise((r) => { release = r }))

    await userEvent.click(screen.getByRole('button', { name: /change recipe/i }))
    await userEvent.click(await screen.findByText('Adobo'))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /working/i })).toBeInTheDocument(),
    )
    // Unlink is disabled but still READS "Unlink" — it is not the thing in progress.
    expect(screen.getByRole('button', { name: /^unlink$/i })).toBeDisabled()
    release({ data: postData({ recipe_id: 8 }) })
  })

  it('Edit and Delete are unavailable mid-attach, so a stale response cannot overwrite an edit', async () => {
    // attach/detach end in an unconditional setPost(data); a fulfill response is a snapshot from
    // BEFORE an edit, so an edit saved while one is outstanding would be silently reverted.
    await openAsAuthor({ recipe_id: null })
    let release
    fulfillPost.mockReturnValue(new Promise((r) => { release = r }))

    await userEvent.click(screen.getByRole('button', { name: /attach a recipe/i }))
    await userEvent.click(await screen.findByText('Adobo'))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /edit this meal/i })).toBeDisabled(),
    )
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeDisabled()
    release({ data: postData({ recipe_id: 7 }) })
  })
})

describe('PostPage — reporting the meal (#87 part two)', () => {
  // Guideline 1.2 wants a way to report objectionable CONTENT as well as the people posting it, and a
  // photo of someone's dinner is the highest-risk content this app carries. The control is on the
  // PAGE and not the card, per #104: a consequential control two taps from a scrolling feed is a
  // mis-tap, which is why `PostCard`'s own ⋯ only navigates.
  it('offers the safety menu to a non-author, labelled for the MEAL', async () => {
    getPost.mockResolvedValue({ data: postData() })
    renderPost()
    const dots = await screen.findByRole('button', { name: /more options for this meal/i })
    await userEvent.click(dots)
    expect(screen.getByRole('button', { name: 'Report this meal' })).toBeInTheDocument()
    // The block still names the person — a block is never about a post, and saying so discloses
    // that the act reaches past the thing you were looking at.
    expect(screen.getByRole('button', { name: 'Block Ana' })).toBeInTheDocument()
  })

  it('sends the post id with the report', async () => {
    getPost.mockResolvedValue({ data: postData() })
    renderPost()
    await userEvent.click(await screen.findByRole('button', { name: /more options/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Report this meal' }))
    await userEvent.click(screen.getByRole('button', { name: /send report/i }))
    await waitFor(() =>
      expect(reportUser).toHaveBeenCalledWith(42, 'harassment', '', { post_id: 5 }),
    )
  })

  it('NEVER offers it on your own meal', async () => {
    // Ownership as answered by the SERVER (`res.data.user_id`), the same source the edit and delete
    // controls use — not the navigation state, which a back-then-forward can replay.
    getPost.mockResolvedValue({ data: postData({ user_id: 1 }) })
    renderPost()
    await screen.findByText('Sunday Adobo')
    expect(screen.queryByRole('button', { name: /more options/i })).toBeNull()
  })
})
