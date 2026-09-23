import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// Stub only the axios instance; keep the REAL toUserMessage, so the keep-failure tests
// exercise the actual error formatter (offline vs a router's own `detail`) instead of a
// stand-in that could drift from it.
vi.mock('../api/client', async () => ({
  default: { get: vi.fn() },
  toUserMessage: (await vi.importActual('../api/client')).toUserMessage,
}))
// #57: keeping a recipe that isn't yours.
// `SafetyMenu` (#87 part two) reaches api/friends, and RecipePage also asks it for the cook's
// first name — `RecipeResponse` carries no author name, and `origin_attribution` is the BYLINE
// (whoever the dish came from), which is frequently not the account holder.
vi.mock('../api/friends', () => ({
  reportUser: vi.fn(() => Promise.resolve({})),
  blockUser: vi.fn(() => Promise.resolve({})),
  getUserProfile: vi.fn(() => Promise.resolve({ data: { first_name: 'Ana' } })),
}))
vi.mock('../api/sharing', () => ({
  deleteRecipe: vi.fn(),
  keepRecipe: vi.fn(() => Promise.resolve({ data: {} })),
  unkeepRecipe: vi.fn(() => Promise.resolve({})),
}))
import client from '../api/client'
import { keepRecipe, unkeepRecipe } from '../api/sharing'
import userEvent from '@testing-library/user-event'

const recipe = {
  id: 1, user_id: 9, name: 'Adobo',
  story: 'Her Sunday dish.', origin_attribution: 'Lola Remedios · Cebu',
  author_full_name: 'Lola Remedios', cover_photo_url: null,
  ingredients: [{ id: 1, name: 'Soy sauce', quantity_text: '1/2 cup', position: 0 }],
  ingredient_sections: [], steps: [{ id: 1, content: 'Simmer.', position: 0 }],
}

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/recipes/1']}>
      <Routes>
        <Route path="/recipes/:id" element={<RecipePageDefault />} />
      </Routes>
    </MemoryRouter>,
  )
}
import { reportUser, getUserProfile } from '../api/friends'
import RecipePageDefault from './RecipePage'

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.setItem('issei_user', JSON.stringify({ id: 1 }))
  client.get.mockResolvedValue({ data: recipe })
  keepRecipe.mockResolvedValue({ data: {} })
  unkeepRecipe.mockResolvedValue({})
})

describe('RecipePage', () => {
  it('loads and renders the dish name and its readable body', async () => {
    renderAt()
    await waitFor(() => expect(screen.getByText('Adobo')).toBeTruthy())
    // The classic detail page shows the recipe body inline — ingredients + steps.
    expect(screen.getByText('Soy sauce')).toBeTruthy()
    expect(screen.getByText('Ingredients')).toBeTruthy()
    expect(screen.getByText('Simmer.')).toBeTruthy()
  })

  it('renders no plant/garden hero (kitchen look)', async () => {
    renderAt()
    await waitFor(() => screen.getByText('Adobo'))
    expect(document.querySelector('.plant')).toBeNull()
  })

  // "Pass it on" was undecodable and read as publishing; the owner action now
  // names its outcome.
  it('names the handoff action by what it produces, not "Pass it on"', async () => {
    localStorage.setItem('issei_user', JSON.stringify({ id: 9 })) // the owner
    renderAt()
    await waitFor(() => screen.getByText('Adobo'))
    expect(
      screen.getByRole('button', { name: /send this to someone/i }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/pass it on/i)).toBeNull()
  })

  // The owner surfaces used to be wrapped in explanatory italic sub-lines, which
  // made the page bottom read as prose with buttons embedded in it. The buttons
  // stand alone; the publish-fear reassurance lives on HandoffInvite, the next
  // screen, where it's actually load-bearing.
  it('leaves the owner buttons unwrapped by descriptor prose', async () => {
    localStorage.setItem('issei_user', JSON.stringify({ id: 9 })) // the owner
    renderAt()
    await waitFor(() => screen.getByRole('button', { name: /send this to someone/i }))
    expect(screen.getByRole('button', { name: /delete recipe/i })).toBeInTheDocument()
    expect(screen.queryByText(/doesn’t change who else can see it/i)).toBeNull()
    expect(screen.queryByText(/they get a link/i)).toBeNull()
    expect(screen.queryByText(/don’t have to go looking/i)).toBeNull()
  })
})

// #57 — keeping a recipe you did not write. A bookmark: it stays the cook's recipe, so
// there is no edit and no pass-it-on here, only "keep" and "kept".
describe('RecipePage — keeping someone else’s recipe (#57)', () => {
  it('offers Keep to a non-owner who can read it', async () => {
    renderAt() // cached user id 1, recipe owned by 9
    await waitFor(() => screen.getByText('Adobo'))
    const btn = screen.getByRole('button', { name: /keep this recipe/i })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    // The promise is explicit about what keeping does and does not do.
    expect(screen.getByText(/it stays their recipe/i)).toBeInTheDocument()
  })

  it('does NOT offer Keep on your own recipe — it is already in your kitchen', async () => {
    localStorage.setItem('issei_user', JSON.stringify({ id: 9 })) // the owner
    renderAt()
    await waitFor(() => screen.getByText('Adobo'))
    expect(screen.queryByRole('button', { name: /keep this recipe/i })).toBeNull()
  })

  it('keeping calls the API and flips to Kept', async () => {
    renderAt()
    await waitFor(() => screen.getByText('Adobo'))
    await userEvent.click(screen.getByRole('button', { name: /keep this recipe/i }))
    expect(keepRecipe).toHaveBeenCalledWith('1')
    const kept = await screen.findByRole('button', { name: /kept/i })
    expect(kept).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/in your kitchen, under Kept/i)).toBeInTheDocument()
  })

  it('starts as Kept when the server says the caller already keeps it', async () => {
    client.get.mockResolvedValue({ data: { ...recipe, kept_by_me: true } })
    renderAt()
    const kept = await screen.findByRole('button', { name: /kept/i })
    expect(kept).toHaveAttribute('aria-pressed', 'true')
  })

  it('un-keeping calls the API and flips back', async () => {
    client.get.mockResolvedValue({ data: { ...recipe, kept_by_me: true } })
    renderAt()
    await userEvent.click(await screen.findByRole('button', { name: /kept/i }))
    expect(unkeepRecipe).toHaveBeenCalledWith('1')
    expect(await screen.findByRole('button', { name: /keep this recipe/i })).toBeInTheDocument()
  })

  it('a keep that 404s says the recipe is gone, not "try again"', async () => {
    // The cook made it private while the page was open. Retrying can never succeed, so
    // the message must not invite one — and it comes through toUserMessage.
    keepRecipe.mockRejectedValue({ response: { status: 404, data: {} } })
    renderAt()
    await waitFor(() => screen.getByText('Adobo'))
    await userEvent.click(screen.getByRole('button', { name: /keep this recipe/i }))
    expect(await screen.findByText(/isn’t available any more/i)).toBeInTheDocument()
    expect(screen.queryByText(/please try again/i)).toBeNull()
    // Still an INLINE error — a failed bookmark must not swap in the not-found page.
    expect(screen.getByText('Adobo')).toBeInTheDocument()
  })

  it('a keep that fails with no response reports the connection, inline', async () => {
    keepRecipe.mockRejectedValue(new Error('network down'))
    renderAt()
    await waitFor(() => screen.getByText('Adobo'))
    await userEvent.click(screen.getByRole('button', { name: /keep this recipe/i }))
    // toUserMessage's offline branch — telling someone on a dead connection that
    // something went wrong with their keep would point at the wrong thing.
    expect(await screen.findByText(/couldn't reach issei/i)).toBeInTheDocument()
    expect(screen.getByText('Adobo')).toBeInTheDocument()
  })

  it('surfaces the router’s own message when it sends one', async () => {
    keepRecipe.mockRejectedValue({
      response: { status: 400, data: { detail: 'This one is already yours — it’s in your recipes.' } },
    })
    renderAt()
    await waitFor(() => screen.getByText('Adobo'))
    await userEvent.click(screen.getByRole('button', { name: /keep this recipe/i }))
    expect(await screen.findByText(/already yours/i)).toBeInTheDocument()
  })

  it('never offers a keeper an edit or a pass-it-on', async () => {
    renderAt()
    await waitFor(() => screen.getByText('Adobo'))
    expect(screen.queryByRole('button', { name: /edit recipe/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /send this to someone/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /delete recipe/i })).toBeNull()
  })
})

// The cook's keeper count (#96). The count is the cook's alone and hidden at zero; there is no
// keeper list anywhere, for anyone.
describe('RecipePage — how many people keep this (#96)', () => {
  // recipe.user_id is 9; the shared beforeEach signs in as id 1 (a non-owner).
  const renderOwn = (over) => {
    localStorage.setItem('issei_user', JSON.stringify({ id: 9 }))
    client.get.mockResolvedValue({ data: { ...recipe, ...over } })
    return renderAt()
  }
  const renderOther = (over) => {
    client.get.mockResolvedValue({ data: { ...recipe, ...over } })
    return renderAt()
  }

  it('tells the cook, on their own recipe', async () => {
    renderOwn({ keeper_count: 3 })
    expect(await screen.findByText(/3 people keep this in their kitchen/i)).toBeInTheDocument()
  })

  it('says "1 person", not "1 people"', async () => {
    renderOwn({ keeper_count: 1 })
    expect(await screen.findByText(/1 person keeps this in their kitchen/i)).toBeInTheDocument()
  })

  it('shows nothing at zero — the default state of every recipe ever written', async () => {
    // "0 people keep this" under your own recipe is the discouraging line the private count
    // exists to avoid.
    renderOwn({ keeper_count: 0 })
    await screen.findByText('Adobo')
    expect(screen.queryByText(/keep this in their kitchen/i)).toBeNull()
  })

  it('says nothing to a viewer who is not the cook', async () => {
    // The API sends null, never a number, to anyone else — so there is nothing to render even
    // if this branch were reached.
    renderOther({ keeper_count: null })
    await screen.findByText('Adobo')
    expect(screen.queryByText(/keep this in their kitchen/i)).toBeNull()
  })
})

describe('RecipePage — reporting the recipe (#87 part two)', () => {
  // recipe.user_id is 9; the shared beforeEach signs in as id 1 (a non-owner).
  it('offers the safety menu to a non-owner, labelled for the RECIPE', async () => {
    renderAt()
    const dots = await screen.findByRole('button', { name: /more options for this recipe/i })
    await userEvent.click(dots)
    expect(screen.getByRole('button', { name: 'Report this recipe' })).toBeInTheDocument()
    // The cook is named on the block, from the fetched profile — not from `origin_attribution`,
    // which is the byline and often somebody else entirely.
    expect(screen.getByRole('button', { name: 'Block Ana' })).toBeInTheDocument()
  })

  it('sends the recipe id with the report', async () => {
    renderAt()
    await userEvent.click(await screen.findByRole('button', { name: /more options/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Report this recipe' }))
    await userEvent.click(screen.getByRole('button', { name: /send report/i }))
    await waitFor(() =>
      expect(reportUser).toHaveBeenCalledWith(9, 'harassment', '', { recipe_id: 1 }),
    )
  })

  it('NEVER offers it on your own recipe, and makes no profile call', async () => {
    localStorage.setItem('issei_user', JSON.stringify({ id: 9 })) // the owner
    renderAt()
    await screen.findByText('Adobo')
    expect(screen.queryByRole('button', { name: /more options/i })).toBeNull()
    expect(getUserProfile).not.toHaveBeenCalled()
  })

  it('stays hidden if the cook’s name never arrives', async () => {
    // A safety control that named the wrong person — or nobody — would break the locked rule that
    // both items name who they land on. The profile is one tap away with the same menu on it.
    getUserProfile.mockRejectedValueOnce(new Error('offline'))
    renderAt()
    await screen.findByText('Adobo')
    expect(screen.queryByRole('button', { name: /more options/i })).toBeNull()
  })
})
