import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const api = vi.hoisted(() => ({
  handoffRecipe: vi.fn(),
  requestPassOn: vi.fn(),
}))
vi.mock('../api/sharing', () => api)
vi.mock('../api/client', () => ({
  default: {},
  toUserMessage: (_e, fallback) => fallback,
}))
const share = vi.hoisted(() => ({ shareOrCopy: vi.fn() }))
vi.mock('../lib/shareLink', () => share)

import PassItOn from './PassItOn'

beforeEach(() => {
  api.handoffRecipe.mockReset().mockResolvedValue({ data: { token: 'tok123' } })
  api.requestPassOn.mockReset().mockResolvedValue({})
  share.shareOrCopy.mockReset().mockResolvedValue('shared')
})

const base = { recipeId: 5, cookName: 'Lola', recipeName: 'Adobo' }

// PASS IT ON (#78) — the reader-side control on a recipe you did NOT write.
//
// The server decides and hands down one word; this component only draws it. The tests are organised
// by that word, because the whole risk here is drawing the wrong one.

describe('PassItOn — nothing to draw', () => {
  it('renders nothing at all when the state is absent (you own it)', () => {
    const { container } = render(<PassItOn {...base} state={null} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('PassItOn — allowed (a public recipe, or the cook said yes)', () => {
  it('offers the share straight away, with no asking', async () => {
    render(<PassItOn {...base} state="allowed" />)
    expect(screen.getByRole('button', { name: /pass it on/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ask/i })).toBeNull()
  })

  it('says whose recipe it stays, and that no account is needed', () => {
    // Two things a resharer could otherwise get wrong: that it becomes theirs (it does not — there
    // is one recipe, the cook's), and whether the link is worth sending at all.
    render(<PassItOn {...base} state="allowed" />)
    expect(screen.getByText(/no account needed/i)).toBeInTheDocument()
    expect(screen.getByText(/stays Lola’s recipe/i)).toBeInTheDocument()
  })

  it('sends the MESSAGE and the link, never a bare URL', async () => {
    render(<PassItOn {...base} state="allowed" />)
    await userEvent.click(screen.getByRole('button', { name: /pass it on/i }))
    await waitFor(() => expect(share.shareOrCopy).toHaveBeenCalled())
    const { text } = share.shareOrCopy.mock.calls[0][0]
    // The sentence is the point — a bare link arrives meaningless.
    expect(text).toMatch(/Adobo/)
    expect(text).toMatch(/\/invite\/tok123/)
    // ATTRIBUTION STAYS POINTED AT THE COOK, which #78's spec requires explicitly. Never "my
    // recipe" — it is not this sender's recipe, and that wording is how a re-share becomes a copy.
    expect(text).toMatch(/Lola’s/)
    expect(text).not.toMatch(/\bmy recipe\b/i)
  })

  it('a link-only handoff: no recipient is ever sent', async () => {
    // The server refuses a recipient from a non-owner (#105's `invite_permission` is checked
    // against the SENDER, so addressing a third party would be a channel straight past it). The
    // client must not send one either, or the feature 400s on every tap.
    render(<PassItOn {...base} state="allowed" />)
    await userEvent.click(screen.getByRole('button', { name: /pass it on/i }))
    await waitFor(() => expect(api.handoffRecipe).toHaveBeenCalledWith(5, {}))
  })

  it('confirms on a real share', async () => {
    render(<PassItOn {...base} state="allowed" />)
    await userEvent.click(screen.getByRole('button', { name: /pass it on/i }))
    expect(await screen.findByText(/sent ✓/i)).toBeInTheDocument()
  })

  it('says "copied" when there is no share sheet', async () => {
    share.shareOrCopy.mockResolvedValue('copied')
    render(<PassItOn {...base} state="allowed" />)
    await userEvent.click(screen.getByRole('button', { name: /pass it on/i }))
    expect(await screen.findByText(/link copied ✓/i)).toBeInTheDocument()
  })

  it('a CANCELLED share sheet confirms NOTHING', async () => {
    // The #102 lesson, which shipped wrong once: dismissing the sheet rejects with AbortError, and
    // flashing "Copied ✓" at someone who just decided not to send reads as "it went anyway".
    share.shareOrCopy.mockResolvedValue('cancelled')
    render(<PassItOn {...base} state="allowed" />)
    await userEvent.click(screen.getByRole('button', { name: /pass it on/i }))
    await waitFor(() => expect(share.shareOrCopy).toHaveBeenCalled())
    expect(screen.queryByText(/sent ✓|copied ✓/i)).toBeNull()
    // And the button is usable again rather than stuck.
    expect(screen.getByRole('button', { name: /pass it on/i })).toBeEnabled()
  })

  it('a total failure tells them where the link is instead of just "try again"', async () => {
    share.shareOrCopy.mockResolvedValue('failed')
    render(<PassItOn {...base} state="allowed" />)
    await userEvent.click(screen.getByRole('button', { name: /pass it on/i }))
    expect(await screen.findByText(/address bar/i)).toBeInTheDocument()
  })


  it('the button label is NOT sticky, so a SECOND person is still reachable', async () => {
    // A ship gate caught this: the label used to read `shared || 'Pass it on'`, so after one share
    // it said "Sent ✓" forever and the affordance for passing the same recipe to somebody else
    // disappeared. Passing one recipe to two people is the ordinary case, not the edge. The
    // confirmation moved to the caption, where it can be read without destroying the control.
    render(<PassItOn {...base} state="allowed" />)
    await userEvent.click(screen.getByRole('button', { name: /pass it on/i }))
    expect(await screen.findByText(/sent ✓/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^pass it on$/i })).toBeEnabled()
  })

  it('a failed handoff says so and leaves the button usable', async () => {
    api.handoffRecipe.mockRejectedValue(new Error('nope'))
    render(<PassItOn {...base} state="allowed" />)
    await userEvent.click(screen.getByRole('button', { name: /pass it on/i }))
    expect(await screen.findByText(/couldn’t make a link/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pass it on/i })).toBeEnabled()
  })
})

describe('PassItOn — ask (narrower than public, nobody has asked)', () => {
  it('offers the ask, naming the cook, and never offers the share', () => {
    render(<PassItOn {...base} state="ask" />)
    expect(
      screen.getByRole('button', { name: /ask Lola if you can pass it on/i }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^pass it on$/i })).toBeNull()
  })

  it('explains WHY there is a question at all', async () => {
    // Without this line the screen reads as the app being officious. With it, it reads as the
    // cook's recipe being the cook's to open up.
    render(<PassItOn {...base} state="ask" />)
    expect(screen.getByText(/they chose who can see this one/i)).toBeInTheDocument()
  })

  it('asking calls the API and flips to the waiting state', async () => {
    render(<PassItOn {...base} state="ask" />)
    await userEvent.click(screen.getByRole('button', { name: /ask Lola/i }))
    expect(api.requestPassOn).toHaveBeenCalledWith(5)
    expect(await screen.findByText(/asked Lola ✓/i)).toBeInTheDocument()
  })

  it('promises a notification only if they say YES, and never implies a deadline', async () => {
    render(<PassItOn {...base} state="ask" />)
    await userEvent.click(screen.getByRole('button', { name: /ask Lola/i }))
    const waiting = await screen.findByText(/if they say yes/i)
    expect(waiting).toBeInTheDocument()
    // No invented SLA. The app cannot make the cook answer and must not suggest it will.
    expect(waiting.textContent).not.toMatch(/within|hours|soon|shortly/i)
  })

  it('a failed ask says so and leaves the button usable', async () => {
    api.requestPassOn.mockRejectedValue(new Error('nope'))
    render(<PassItOn {...base} state="ask" />)
    await userEvent.click(screen.getByRole('button', { name: /ask Lola/i }))
    expect(await screen.findByText(/couldn’t send that just now/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ask Lola/i })).toBeEnabled()
  })

  it('NEVER says the cook declined, because `ask` is also what a decline looks like', async () => {
    // THE ONE PLACE THIS UI KNOWINGLY UNDER-REPORTS. A declined request comes back as `ask`: the
    // cook said no about a recipe carrying their own family's name, usually to a relative, and
    // "Lola declined" on that person's screen turns a quiet boundary into a social event. Same
    // discipline as a silent block (#85) and a report the reported person never hears about (#87).
    const { container } = render(<PassItOn {...base} state="ask" />)
    expect(container.textContent).not.toMatch(/declin|refus|said no|denied|rejected/i)
  })
})

describe('PassItOn — pending', () => {
  it('shows the waiting state with nothing to tap', () => {
    render(<PassItOn {...base} state="pending" />)
    expect(screen.getByText(/asked Lola ✓/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('PassItOn — the rules that hold in every state', () => {
  it('falls back to "the cook" when the name has not arrived', () => {
    // `RecipePage` FETCHES the cook's name and that fetch 404s across a block. This control must
    // still read — unlike `SafetyMenu`'s block item, nothing here acts ON the person, so a generic
    // noun is honest rather than dangerous.
    render(<PassItOn {...base} cookName="" state="ask" />)
    expect(
      screen.getByRole('button', { name: /ask the cook if you can pass it on/i }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/undefined|null/i)).toBeNull()
  })

  it('never calls it a copy, a save, a remix or making it yours', () => {
    // The three verbs stay distinct (POSITIONING). Passing a recipe on is not keeping it and it is
    // certainly not copying it — there is still exactly one recipe, the cook's.
    for (const state of ['allowed', 'ask', 'pending']) {
      const { container, unmount } = render(<PassItOn {...base} state={state} />)
      expect(container.textContent).not.toMatch(/\bcopy\b|\bremix\b|make it yours|\byour version\b/i)
      unmount()
    }
  })

  it('never implies a chain, ancestry or a hop count', () => {
    // NOT LINEAGE (#78's own spec, and the removed model this must not grow back into).
    for (const state of ['allowed', 'ask', 'pending']) {
      const { container, unmount } = render(<PassItOn {...base} state={state} />)
      expect(container.textContent).not.toMatch(
        /passed through|kitchens|ancestor|descend|lineage|family tree|generation/i,
      )
      unmount()
    }
  })

  it('claims nothing about voice or audio', () => {
    const BANNED = /record|recording|\bvoice\b|audio|in (their|your|his|her)( own)? words|listen/i
    for (const state of ['allowed', 'ask', 'pending']) {
      const { container, unmount } = render(<PassItOn {...base} state={state} />)
      expect(container.textContent).not.toMatch(BANNED)
      unmount()
    }
  })
})
