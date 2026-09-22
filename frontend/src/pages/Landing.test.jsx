import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Landing from './Landing'

// The public landing page — the screen a REFERRED STRANGER lands on, and until #111 the app had no
// such screen at all: every public route but an invite link led to a sign-in form that never said
// what issei is.
//
// Rewritten with the page after owner review. The first version led with POSITIONING's one-liner,
// which describes the FOUNDING moment and therefore only the side where you RECEIVE — so these now
// pin that the summary covers BOTH sides, that the three features are the ones the product actually
// turns on, and that the page is colour-blocked rather than a wall of text. The POSITIONING guard
// stays, because a marketing surface is the likeliest place in the app for an overclaim.

const renderLanding = () =>
  render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  )

describe('Landing', () => {
  it('summarises BOTH sides of the product, not one use case', () => {
    // The owner's note: the first version described "someone cooked you something you'd never had
    // before" — true, the founding moment, and only half the app. A stranger has to learn that they
    // can SEE what friends cook AND get the recipe, in the first sentence.
    renderLanding()
    const h1 = screen.getByRole('heading', {
      name: /see what your friends are cooking today.*ask for the recipe/i,
    })
    expect(h1).toBeInTheDocument()
  })

  it('names the other side too — posting and writing, not just receiving', () => {
    // Without this the page reads as an app for consuming other people's recipes, and nobody would
    // know they could bring their own.
    renderLanding()
    expect(screen.getByText(/post your own/i)).toBeInTheDocument()
    expect(screen.getByText(/write down the one people keep asking you for/i)).toBeInTheDocument()
  })

  it('RESOLVES the hook into what actually arrives, in that order', () => {
    // POSITIONING §"The feed and the handoff: one product": the feed is the top of the funnel, the
    // handoff is the payload. The hook may lead, but the page must not stop there — otherwise it
    // sells a photo-sharing app and then hands someone a recipe app.
    const { container } = renderLanding()
    const text = container.textContent
    const hook = text.indexOf('See what your friends are cooking')
    const payload = text.indexOf('the dish the way they actually make it')
    expect(hook).toBeGreaterThanOrEqual(0)
    expect(payload).toBeGreaterThan(hook)
  })

  it('leads the features with ASKING, the verb the product turns on', () => {
    // The ask is issei's fourth first-class act (#79) and the only one no other recipe app has. It
    // goes first because it is what turns looking at a photo into having the recipe.
    renderLanding()
    const headings = screen
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(headings[0]).toMatch(/ask for any recipe/i)
  })

  it('highlights the three features the product is actually differentiated by', () => {
    renderLanding()
    // 1. the ask
    expect(screen.getAllByText(/ask for any recipe/i).length).toBeGreaterThan(0)
    // 2. a note on the step it belongs to
    // getAllBy: the <li> and its heading <p> both contain this text.
    expect(screen.getAllByText(/notes on the steps that matter/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/step it belongs to/i)).toBeInTheDocument()
    // 3. the measurements, kept verbatim — the claim the whole quantity model exists to keep
    expect(screen.getAllByText(/their measurements, kept/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/a good splash/i).length).toBeGreaterThan(0)
  })

  it('USES THE PALETTE — it is not a black-and-white wall of text', () => {
    // The owner's third note, and the most mechanical to pin: the first version rendered every block
    // as `bg-card`, on an app whose entire visual identity is saturated colour blocks. jsdom has no
    // layout engine so appearance cannot be asserted, but the CLASSES can — and a future edit that
    // flattens the page back to cream-on-cream fails here.
    const { container } = renderLanding()
    for (const tint of ['bg-peach', 'bg-saffron', 'bg-sage']) {
      expect(container.querySelector(`.${tint}`)).not.toBeNull()
    }
    // And the hero itself is a block, not a bare heading.
    expect(screen.getByRole('heading', { level: 1 }).closest('.sticker')).not.toBeNull()
  })

  it('stays SHORT — a stranger will not read an essay', () => {
    // A ceiling rather than a target, and deliberately generous: the point is that a future edit
    // cannot quietly grow this back into the wall of prose the owner rejected. The first version ran
    // past 1,100 characters of body copy.
    const { container } = renderLanding()
    const prose = container.textContent.replace(/\s+/g, ' ').trim()
    expect(prose.length).toBeLessThan(900)
  })

  it('offers signup as the primary act and sign-in as a labelled second door', () => {
    renderLanding()
    expect(screen.getByRole('link', { name: /open your kitchen/i })).toHaveAttribute(
      'href',
      '/login?tab=signup',
    )
    expect(screen.getByRole('link', { name: /^sign in$/i })).toHaveAttribute('href', '/login')
  })

  it('promises the no-account read, which is what makes the tap cheap', () => {
    // Not a marketing line — the capability-token model: GET /recipes/invite/{token} returns the
    // whole recipe unauthenticated.
    renderLanding()
    expect(screen.getByText(/opens with no account at all/i)).toBeInTheDocument()
  })

  it('glosses the name, because a referred person has never seen the word', () => {
    renderLanding()
    expect(screen.getByText(/一世/)).toBeInTheDocument()
    expect(screen.getByText(/first of a family to arrive somewhere new/i)).toBeInTheDocument()
  })

  it('does NOT claim a friend can reach ANY recipe of theirs', () => {
    // The owner's note asked for "access any of their recipes" and it is FALSE: `can_view` gives a
    // friend your `public` + `friends` recipes and never your `private` ones, and the recipe behind a
    // post arrives by ASKING. Overclaiming here would be a promise the app refuses on the next
    // screen — so the page sells the ask instead, which is true and is the better sell anyway.
    const { container } = renderLanding()
    const text = container.textContent
    expect(text).not.toMatch(/any of their recipes/i)
    expect(text).not.toMatch(/all (of )?their recipes/i)
    expect(text).not.toMatch(/every recipe/i)
  })

  it('makes no claim the product cannot back (POSITIONING)', () => {
    const { container } = renderLanding()
    const text = container.textContent
    const BANNED = [
      // "in their words" implies a recording that does not exist — the measurements are typed text.
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
      /\bcomment/i,
    ]
    for (const pattern of BANNED) {
      expect(text).not.toMatch(pattern)
    }
  })
})
