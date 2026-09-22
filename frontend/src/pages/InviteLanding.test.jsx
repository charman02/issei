import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const PREVIEW = {
  recipe_id: 5,
  name: 'Lola’s Adobo',
  from_name: 'Yoko Matsuda',
  origin_attribution: 'Lola Remedios · Cebu',
  story: 'Every Sunday.',
  growth_stage: 'sprout',
  growth_vitality: 'bare',
  cover_photo_url: null,
  description: 'A braise that tastes like her kitchen.',
  servings: 4,
  cuisine: 'Filipino',
  diet: null,
  prep_time_minutes: 45,
  ingredients: [
    {
      id: 1,
      name: 'chicken thighs',
      quantity_text: '2 lbs',
      quantity_type: 'precise',
      position: 1,
    },
    {
      id: 2,
      name: 'cane vinegar',
      quantity_text: 'a good splash',
      quantity_type: 'imprecise',
      position: 2,
    },
  ],
  ingredient_sections: [],
  steps: [
    {
      id: 1,
      content: 'Brown the chicken skin-side down.',
      position: 1,
      voice_note: 'Don’t crowd the pan or it steams.',
    },
    { id: 2, content: 'Add soy and vinegar, simmer.', position: 2 },
  ],
}

vi.mock('../api/sharing', () => ({
  getInvitePreview: vi.fn(() => Promise.resolve({ data: PREVIEW })),
}))
import { getInvitePreview } from '../api/sharing'
import InviteLanding from './InviteLanding'

beforeEach(() => {
  localStorage.clear()
  getInvitePreview.mockClear()
  getInvitePreview.mockResolvedValue({ data: PREVIEW })
})

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/invite/:token" element={<InviteLanding />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('InviteLanding', () => {
  it('leads with who passed it and the story', async () => {
    renderAt('/invite/abc123')
    await waitFor(() =>
      expect(screen.getByText('Lola’s Adobo')).toBeInTheDocument(),
    )
    expect(screen.getByText(/Yoko Matsuda/)).toBeInTheDocument()
    expect(screen.getByText(/Every Sunday\./)).toBeInTheDocument()
  })

  it('offers a signup CTA carrying the invite token', async () => {
    renderAt('/invite/abc123')
    await waitFor(() =>
      expect(screen.getByText('Lola’s Adobo')).toBeInTheDocument(),
    )
    const cta = screen.getByRole('link', { name: /sign up|join|keep this/i })
    expect(cta.getAttribute('href')).toContain('invite=abc123')
  })

  it('lets the recipient READ the whole recipe with no account', async () => {
    // The bridge: they have never had the dish and want to cook it. No gate.
    renderAt('/invite/abc123')
    await waitFor(() =>
      expect(screen.getByText('chicken thighs')).toBeInTheDocument(),
    )
    expect(screen.getByText('2 lbs')).toBeInTheDocument()
    expect(screen.getByText('cane vinegar')).toBeInTheDocument()
    expect(screen.getByText('Brown the chicken skin-side down.')).toBeInTheDocument()
    expect(screen.getByText('Add soy and vinegar, simmer.')).toBeInTheDocument()
    // the per-step remark — the thing a novice cooking blind needs most
    expect(screen.getByText(/crowd the pan/)).toBeInTheDocument()
    // servings + description
    expect(screen.getByText(/serves 4/i)).toBeInTheDocument()
    expect(screen.getByText(/tastes like her kitchen/)).toBeInTheDocument()
  })

  it('keeps imprecise amounts verbatim, badged as theirs', async () => {
    renderAt('/invite/abc123')
    await waitFor(() =>
      expect(screen.getByText('a good splash')).toBeInTheDocument(),
    )
    expect(screen.getAllByText(/their way/i).length).toBe(1)
  })

  it('orients a cold arrival with the sender, the dish, and the wordmark — and no explainer prose', async () => {
    // This is often someone's very first contact with issei: an unfamiliar link
    // in a text message. Two facts orient them — who sent it and what it is —
    // plus the wordmark for "where am I". The page used to also explain itself
    // above the recipe; that prose is what made the top feel scrunched, and the
    // header now states the handoff instead of describing it.
    renderAt('/invite/abc123')
    await waitFor(() =>
      expect(screen.getByText('Lola’s Adobo')).toBeInTheDocument(),
    )
    expect(screen.getByText(/passed you/i)).toBeInTheDocument()
    // The dish is the page's headline, not the wordmark or the sender.
    const dish = screen.getByRole('heading', { level: 1 })
    expect(dish.textContent).toBe('Lola’s Adobo')
    // The wordmark sits above the dish as its own line. Matched on the <p> tag
    // because CoverImage's no-photo fallback renders an `issei.` mark too, and
    // on full textContent because the terra period is a nested <span>.
    const wordmark = screen.getAllByText(
      (_, el) => el?.tagName === 'SPAN' && el.textContent === 'issei.',
    )[0]
    expect(wordmark).toBeTruthy()
    expect(
      wordmark.compareDocumentPosition(dish) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      screen.queryByText(/the whole recipe, the way they make it/i),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/nothing to sign up for/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/just scroll/i)).not.toBeInTheDocument()
  })

  it('glosses "issei" at the BOTTOM, after the recipe has made the case', async () => {
    renderAt('/invite/abc123')
    await waitFor(() =>
      expect(screen.getByText(/一世 · issei/)).toBeInTheDocument(),
    )
    expect(
      screen.getByText(/first of a family to arrive somewhere new/i),
    ).toBeInTheDocument()
  })

  it('promises only what a granted account actually gets', async () => {
    // Editing requires ownership (PATCH /recipes/{id} filters on user_id), so
    // the old "add the parts only you know" would break at the first tap.
    renderAt('/invite/abc123')
    await waitFor(() =>
      expect(screen.getByText(/don.t lose this one/i)).toBeInTheDocument(),
    )
    expect(
      screen.getByText(/keeps this recipe in your kitchen/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/add the parts only you know/i),
    ).not.toBeInTheDocument()
    // from_name is the SENDER (Yoko), not whose recipe this is (Lola) — so the
    // ask must not attach a name to the recipe.
    expect(screen.queryByText(/Yoko Matsuda’s recipe/i)).not.toBeInTheDocument()
  })

  it('makes no claim about voice or audio', async () => {
    // THE WIDE FORM, matching the other guards. This page is the app's highest-traffic first
    // impression — the one screen a stranger who has never heard of issei actually reads — and its
    // guard was the weakest of the thirteen: it omitted `voice` entirely and the whole
    // "in their/your own words" family, which is the phrase that has come back twice.
    const BANNED =
      /record|recording|\bvoice\b|audio|in (their|your|his|her)( own)? words|listen/i
    renderAt('/invite/abc123')
    await waitFor(() =>
      expect(screen.getByText('Lola’s Adobo')).toBeInTheDocument(),
    )
    // Over the whole rendered screen, not a text query — a claim in a heading or an aria-label is
    // just as false as one in a paragraph.
    expect(document.body.textContent).not.toMatch(BANNED)
  })

  it('says the link is dead ONLY when the server says so (404)', async () => {
    getInvitePreview.mockRejectedValueOnce({ response: { status: 404 } })
    renderAt('/invite/nope')
    await waitFor(() =>
      expect(screen.getByText(/no longer/i)).toBeInTheDocument(),
    )
    // no false hope of retrying something that genuinely doesn't exist
    expect(
      screen.queryByRole('button', { name: /try again/i }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /issei/i })).toBeInTheDocument()
  })

  it('offers a RETRY when the request never reached the server', async () => {
    // No `response` = the request died in transit: offline, DNS, CORS, timeout.
    // Telling this recipient their link expired is a lie that costs them the
    // recipe — they have no account and no way to ask the sender about it.
    getInvitePreview.mockRejectedValueOnce({ request: {} })
    renderAt('/invite/abc123')
    await waitFor(() =>
      expect(screen.getByText(/couldn't reach issei/i)).toBeInTheDocument(),
    )
    expect(screen.queryByText(/expired/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('names the WAIT on a 429, and offers no retry that could not work', async () => {
    // Rate limiting (2026-09-21). Before this branch existed a 429 fell through to the generic
    // "Something went wrong opening this recipe" WITH a Try again button — and that button fails
    // identically for up to fifteen minutes, because the limiter deliberately does not count a
    // refused call and so does not free a slot early. Tap, fail, tap, fail, conclude the sender's
    // link is broken: exactly the outcome `describeFailure`'s own comment exists to prevent, on the
    // one page whose visitor has no account and no support path.
    //
    // The server names the wait in `detail`; this asserts the page SHOWS it rather than replacing it
    // with a generic sentence. Login, ForgotPassword and ResetPassword already got this for free via
    // `toUserMessage`; this page has its own handler, which is how it missed out.
    getInvitePreview.mockRejectedValueOnce({
      response: { status: 429, data: { detail: 'Too many attempts. Try again in 12 minutes.' } },
    })
    renderAt('/invite/abc123')
    await waitFor(() =>
      expect(screen.getByText(/try again in 12 minutes/i)).toBeInTheDocument(),
    )
    // Must NOT read as a dead link — the link is fine, the network it arrived on is busy.
    expect(screen.queryByText(/no longer/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/expired/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
    // And no button, because the wait IS the answer.
    expect(
      screen.queryByRole('button', { name: /try again/i }),
    ).not.toBeInTheDocument()
  })

  it('offers a RETRY when the server is up but broken (5xx)', async () => {
    getInvitePreview.mockRejectedValueOnce({ response: { status: 503 } })
    renderAt('/invite/abc123')
    await waitFor(() =>
      expect(screen.getByText(/having trouble/i)).toBeInTheDocument(),
    )
    expect(screen.queryByText(/expired/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('recovers the recipe when the retry succeeds', async () => {
    getInvitePreview.mockRejectedValueOnce({ request: {} })
    renderAt('/invite/abc123')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument(),
    )
    getInvitePreview.mockResolvedValueOnce({ data: PREVIEW })
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() =>
      expect(screen.getByText('chicken thighs')).toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
  })
})
