import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Landing from './Landing'

// The public landing page — the screen a REFERRED STRANGER lands on, and until #111 the app had no
// such screen at all: every public route but an invite link led to a sign-in form that never said
// what issei is.
//
// What these pin is mostly ORDER and RESTRAINT rather than presence. The hook has to come first
// (it is the only sentence a stranger can picture instantly) and it has to RESOLVE into the
// handoff, because POSITIONING.md's "The feed and the handoff: one product" is explicit that the
// feed is the top of the funnel and the handoff is the payload. A page that stopped at the feed
// would sell a photo app and then hand someone a recipe app.

const renderLanding = () =>
  render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  )

describe('Landing', () => {
  it('leads with the feed hook — the one thing a stranger can picture', () => {
    renderLanding()
    expect(
      screen.getByRole('heading', { name: /curious what your friends are cooking/i }),
    ).toBeInTheDocument()
  })

  it('RESOLVES the hook into the handoff, in that order', () => {
    // The order is the product. POSITIONING: presence -> the ask -> the handoff. If a future edit
    // drops the one-liner and leaves only the hook, this page starts promising a feed.
    const { container } = renderLanding()
    const text = container.textContent
    const hook = text.indexOf('Curious what your friends are cooking')
    const payload = text.indexOf('issei is how they send it to you')
    expect(hook).toBeGreaterThanOrEqual(0)
    expect(payload).toBeGreaterThan(hook)
  })

  it('names what actually arrives, which is the whole differentiator', () => {
    renderLanding()
    // Imprecise amounts preserved verbatim — the claim the entire quantity model exists to keep.
    expect(screen.getByText(/a good splash/i)).toBeInTheDocument()
    // A note on the step it belongs to.
    expect(screen.getByText(/step it belongs to/i)).toBeInTheDocument()
    // Read without an account — the capability-token promise, and the reason a cold arrival is
    // worth anything at all.
    expect(screen.getByText(/without making an account/i)).toBeInTheDocument()
  })

  it('offers signup as the primary act and sign-in as a labelled second door', () => {
    // This page is what an anonymous visitor to `/` now gets, so a returning user who simply typed
    // the address must not have to hunt for the way in — one tap, plainly labelled.
    renderLanding()
    const open = screen.getByRole('link', { name: /open your kitchen/i })
    expect(open).toHaveAttribute('href', '/login?tab=signup')
    expect(screen.getByRole('link', { name: /^sign in$/i })).toHaveAttribute(
      'href',
      '/login',
    )
  })

  it('uses the same verb as signup, so the button and the next screen agree', () => {
    // "Open your kitchen" is Login's own submit label. A landing CTA that renamed the act would
    // teach a word the very next screen does not use.
    renderLanding()
    expect(screen.getByRole('link', { name: /open your kitchen/i })).toBeInTheDocument()
  })

  it('glosses the name, because a referred person has never seen the word', () => {
    renderLanding()
    expect(screen.getByText(/一世/)).toBeInTheDocument()
    expect(screen.getByText(/first of a family to arrive somewhere new/i)).toBeInTheDocument()
  })

  it('makes no claim the product cannot back (POSITIONING)', () => {
    // The standing guard, applied to a brand-new user-facing surface — and a marketing page is the
    // MOST likely place for one of these to creep in, because the temptation is to oversell.
    const { container } = renderLanding()
    const text = container.textContent
    const BANNED = [
      /voice/i,
      /recording/i,
      /\baudio\b/i,
      /listen/i,
      /in (their|your|his|her)( own)? words/i,
      // no lineage / family tree
      /family tree/i,
      /lineage/i,
      /generation(s|al)\b/i,
      // the removed Remix model, reachable by wording alone
      /make it yours/i,
      /\bremix/i,
      // a recipient cannot edit, and no like button exists
      /\blike button/i,
      // nothing expires
      /expires?\b/i,
      // never promise the unbuilt
      /shopping list/i,
      /convert.{0,12}units/i,
    ]
    for (const pattern of BANNED) {
      expect(text).not.toMatch(pattern)
    }
  })

  it('does not promise a comment or a like, which do not exist', () => {
    const { container } = renderLanding()
    expect(container.textContent).not.toMatch(/comment/i)
  })
})
