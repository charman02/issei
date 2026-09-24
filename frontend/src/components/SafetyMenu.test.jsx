import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const api = vi.hoisted(() => ({ blockUser: vi.fn(), reportUser: vi.fn() }))
vi.mock('../api/friends', () => api)
vi.mock('../api/client', () => ({
  default: {},
  toUserMessage: (_e, fallback) => fallback,
}))

import SafetyMenu from './SafetyMenu'

beforeEach(() => {
  api.blockUser.mockReset().mockResolvedValue({})
  api.reportUser.mockReset().mockResolvedValue({})
})

async function openMenu() {
  await userEvent.click(screen.getByRole('button', { name: /more options/i }))
}

// The safety menu, extracted from `UserProfile` in #87 part two so that reporting a post or a recipe
// reuses it rather than copying it. These tests cover the behaviour that is NEW in the extraction —
// what a `subject` changes and what it deliberately does not. `UserProfile.test.jsx` still owns the
// profile flow end to end, which is what proves the extraction was faithful.

describe('SafetyMenu — with no subject, it is the profile menu', () => {
  it('names the PERSON on both items, in escalation order', async () => {
    render(<SafetyMenu userId={2} personName="Ana" />)
    await openMenu()
    const items = screen.getAllByRole('button')
    // Report above Block: a report asks someone else to act, a block acts yourself and deletes a
    // friendship. Both name the person, so neither can be tapped without knowing who it lands on.
    expect(items[0]).toHaveAccessibleName('Report Ana')
    expect(items[1]).toHaveAccessibleName('Block Ana')
    expect(items[2]).toHaveAccessibleName('Never mind')
  })

  it('sends no subject', async () => {
    render(<SafetyMenu userId={2} personName="Ana" />)
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'Report Ana' }))
    await userEvent.click(screen.getByRole('button', { name: /send report/i }))
    expect(api.reportUser).toHaveBeenCalledWith(2, 'harassment', '', null)
  })
})

describe('SafetyMenu — with a subject (#87 part two)', () => {
  const meal = { userId: 7, personName: 'Ana', subject: { post_id: 41 }, subjectLabel: 'this meal' }

  it('the REPORT item names the thing; the BLOCK item still names the person', async () => {
    // The asymmetry is the decision. On a post page the thing in front of you is the meal, so
    // "Report Ana" would promise a different act than the one you tapped. But a block is never about
    // a post — "Block this meal" is nonsense — and naming the person there is also the honest
    // disclosure that the act reaches past the thing you were looking at.
    render(<SafetyMenu {...meal} />)
    await openMenu()
    expect(screen.getByRole('button', { name: 'Report this meal' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Block Ana' })).toBeInTheDocument()
  })

  it('carries the subject through to the API', async () => {
    render(<SafetyMenu {...meal} />)
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'Report this meal' }))
    await userEvent.selectOptions(screen.getByLabelText(/what.s wrong/i), 'inappropriate')
    await userEvent.type(screen.getByLabelText(/anything you want to add/i), 'not food')
    await userEvent.click(screen.getByRole('button', { name: /send report/i }))
    expect(api.reportUser).toHaveBeenCalledWith(7, 'inappropriate', 'not food', { post_id: 41 })
  })

  it('a recipe subject reads as a recipe', async () => {
    render(
      <SafetyMenu userId={7} personName="Ana" subject={{ recipe_id: 9 }} subjectLabel="this recipe" />,
    )
    await openMenu()
    expect(screen.getByRole('button', { name: 'Report this recipe' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Report this recipe' }))
    await userEvent.click(screen.getByRole('button', { name: /send report/i }))
    expect(api.reportUser).toHaveBeenCalledWith(7, 'harassment', '', { recipe_id: 9 })
  })

  it('the ⋯ is labelled for the SUBJECT, so a screen reader hears what it acts on', async () => {
    render(<SafetyMenu {...meal} />)
    expect(
      screen.getByRole('button', { name: 'More options for this meal' }),
    ).toBeInTheDocument()
  })
})

describe('SafetyMenu — the rules that travelled with the extraction', () => {
  it('"Never mind" closes the WHOLE menu rather than returning to it', async () => {
    // Backing out of "Block Ana?" into a menu that still offers Block leaves you one tap from what
    // you just declined.
    render(<SafetyMenu userId={2} personName="Ana" />)
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'Block Ana' }))
    await userEvent.click(screen.getByRole('button', { name: /never mind/i }))
    expect(screen.queryByRole('button', { name: 'Block Ana' })).toBeNull()
    expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument()
  })

  it('the block confirm names every consequence, not just "are you sure"', async () => {
    render(<SafetyMenu userId={2} personName="Ana" friendState="accepted" />)
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'Block Ana' }))
    expect(screen.getByText(/won.t see each other anywhere/i)).toBeInTheDocument()
    expect(screen.getByText(/removes them as a friend/i)).toBeInTheDocument()
    // The grant already given survives a block (#85) and the copy says so.
    expect(screen.getByText(/already sent them stays theirs/i)).toBeInTheDocument()
  })

  it('offers the block after a report, because that is usually the next thing wanted', async () => {
    render(<SafetyMenu {...{ userId: 7, personName: 'Ana', subject: { post_id: 41 }, subjectLabel: 'this meal' }} />)
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'Report this meal' }))
    await userEvent.click(screen.getByRole('button', { name: /send report/i }))
    expect(await screen.findByText(/we.ll take a look/i)).toBeInTheDocument()
    // And it tells the truth about what just happened: nothing visible changed.
    expect(screen.getByText(/hasn.t been told/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /block them too/i })).toBeInTheDocument()
  })

  it('clears the draft when you back out, so it cannot attach to a later reason', async () => {
    render(<SafetyMenu userId={2} personName="Ana" />)
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'Report Ana' }))
    await userEvent.type(screen.getByLabelText(/anything you want to add/i), 'about one thing')
    await userEvent.click(screen.getByRole('button', { name: /never mind/i }))
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'Report Ana' }))
    expect(screen.getByLabelText(/anything you want to add/i)).toHaveValue('')
  })

  it('a failed report says so and leaves the form open to retry', async () => {
    api.reportUser.mockRejectedValue(new Error('nope'))
    render(<SafetyMenu userId={2} personName="Ana" />)
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'Report Ana' }))
    await userEvent.click(screen.getByRole('button', { name: /send report/i }))
    expect(await screen.findByText(/couldn.t send that just now/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send report/i })).toBeInTheDocument()
  })

  it('at rest it is a cream ⋯, which suggests nothing about anyone', async () => {
    // It used to be a red "Block" chip in the open, which reads as the page proposing something
    // about a person you were only looking at.
    render(<SafetyMenu userId={2} personName="Ana" />)
    const dots = screen.getByRole('button', { name: /more options/i })
    expect(dots.className).toContain('bg-cream')
    expect(dots.className).not.toContain('bg-brick')
  })

  it('claims nothing about voice or audio', async () => {
    const { container } = render(<SafetyMenu userId={2} personName="Ana" />)
    await openMenu()
    const BANNED = /record|recording|\bvoice\b|audio|in (their|your|his|her)( own)? words|listen/i
    expect(container.textContent).not.toMatch(BANNED)
  })
})

describe('SafetyMenu — the block path, which had no test until a ship gate asked', () => {
  it('confirms for itself when the caller does NOT navigate away', async () => {
    // THE DEAD END THE GATE FOUND. The inline original never needed a success state, because on a
    // profile the success path always navigated. Once the component had callers that stay put,
    // blocking left "Blocking…" disabled forever, "Never mind" also disabled, no confirmation, and
    // the blocked person's content still on screen — the browser back button the only way out.
    render(<SafetyMenu userId={2} personName="Ana" />)
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'Block Ana' }))
    await userEvent.click(screen.getByRole('button', { name: /block them$/i }))

    expect(await screen.findByText(/won.t see each other anymore/i)).toBeInTheDocument()
    // It says what it did NOT do, too: the block is silent, per #85.
    expect(screen.getByText(/wasn.t told/i)).toBeInTheDocument()
    // And names the way back, since a block is the one act here with no visible undo on this screen.
    expect(screen.getByText(/You .+ Blocked/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /blocking/i })).toBeNull()
  })

  it('still calls onBlocked, for a caller whose page is now a 404', async () => {
    const onBlocked = vi.fn()
    render(<SafetyMenu userId={2} personName="Ana" onBlocked={onBlocked} />)
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'Block Ana' }))
    await userEvent.click(screen.getByRole('button', { name: /block them$/i }))
    await waitFor(() => expect(onBlocked).toHaveBeenCalled())
    expect(api.blockUser).toHaveBeenCalledWith(2)
  })

  it('a failed block says so and leaves BOTH controls usable', async () => {
    // The failure path is where a stuck disabled state does the most damage: the block did not
    // happen, so the person needs to be able to retry or back out.
    api.blockUser.mockRejectedValue(new Error('nope'))
    render(<SafetyMenu userId={2} personName="Ana" />)
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'Block Ana' }))
    await userEvent.click(screen.getByRole('button', { name: /block them$/i }))

    expect(await screen.findByText(/couldn.t block them just now/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /block them$/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /never mind/i })).toBeEnabled()
  })
})


describe('SafetyMenu — with a subject but NO person name (the block case)', () => {
  // WHY THIS EXISTS. `RecipePage` has to FETCH the cook's name, and the thing that actually makes
  // that fetch fail is a BLOCK: `GET /friends/profile/{id}` 404s across one, while an accepted
  // handoff grant SURVIVES a block (#85) — so the blocked cook's recipe is still open in front of
  // you. The first version hid the whole menu, which made them unreportable from the one surface a
  // block leaves open: the block becoming cover for the person who earned it, i.e. exactly what
  // `report_user`'s deliberately-absent block check exists to prevent, reintroduced one layer up.
  const nameless = { userId: 7, personName: '', subject: { recipe_id: 9 }, subjectLabel: 'this recipe' }

  it('still offers Report, because the report item names the THING', async () => {
    render(<SafetyMenu {...nameless} />)
    await openMenu()
    expect(screen.getByRole('button', { name: 'Report this recipe' })).toBeInTheDocument()
  })

  it('suppresses Block, because a block cannot be offered without naming who it lands on', async () => {
    // Not a nicety: "Block them" with no name is a tap whose target the person cannot see, and a
    // block deletes a friendship and cannot be undone from this screen. It stays recoverable —
    // /u/{id} has the full menu once the name resolves — while a report about content in front of
    // you right now does not.
    render(<SafetyMenu {...nameless} />)
    await openMenu()
    expect(screen.queryByRole('button', { name: /^Block/ })).toBeNull()
    expect(screen.getByRole('button', { name: /never mind/i })).toBeInTheDocument()
  })

  it('reports for real, with the subject, and names nobody in the confirmation', async () => {
    render(<SafetyMenu {...nameless} />)
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'Report this recipe' }))
    await userEvent.click(screen.getByRole('button', { name: /send report/i }))
    expect(api.reportUser).toHaveBeenCalledWith(7, 'harassment', '', { recipe_id: 9 })

    expect(await screen.findByText(/we.ll take a look/i)).toBeInTheDocument()
    // "They haven't been told" rather than "undefined hasn't been told".
    expect(screen.getByText(/They hasn.t been told|hasn.t been told/i)).toBeInTheDocument()
    expect(screen.queryByText(/undefined/i)).toBeNull()
    // And no "Block them too" offer, for the same reason the menu item is gone.
    expect(screen.queryByRole('button', { name: /block them too/i })).toBeNull()
  })

  it('a name restores the block item, so the suppression is about the name and nothing else', async () => {
    render(<SafetyMenu {...nameless} personName="Ana" />)
    await openMenu()
    expect(screen.getByRole('button', { name: 'Block Ana' })).toBeInTheDocument()
  })
})
