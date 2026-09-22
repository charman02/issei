import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Landing from './Landing'

// The public landing page — what a REFERRED STRANGER lands on. Until #111 the app had no such screen:
// every public route but an invite link led to a sign-in form that never said what issei is.
//
// Rewritten twice with the page. What these pin is that it SHOWS the product rather than describing
// it, because that is the lesson this project already paid for once: `RecipeGlimpse` exists because
// "two rounds of user testing still asked 'what's the point of this app?'" while reading a text
// explanation. A future edit that turns the samples back into bullet points fails here.

const renderLanding = () =>
  render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  )

// The page's OWN copy — everything a stranger has to READ — excluding the two sample cards, which are
// looked at rather than read. Measuring `container.textContent` would count the sample recipe's
// ingredient names against the prose budget and reward deleting the demonstration.
const proseOf = (container) =>
  [...container.querySelectorAll('h1, p')]
    .filter((el) => !el.closest('figure'))
    .map((el) => el.textContent)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

describe('Landing', () => {
  it('summarises BOTH sides of the product, not one use case', () => {
    // The first version led with POSITIONING's one-liner — the FOUNDING moment, and so only the side
    // where you RECEIVE. A stranger has to learn in the first sentence that they can SEE what friends
    // cook AND get the recipe.
    renderLanding()
    expect(
      screen.getByRole('heading', {
        name: /see what your friends are cooking today.*ask for the recipe/i,
      }),
    ).toBeInTheDocument()
  })

  it('SHOWS the mechanic instead of asserting it', () => {
    // The round-2 fix. This page used to claim three features in prose; two of those claims described
    // exactly what `RecipeGlimpse` already renders. Now the middle of the page is a sample meal with
    // an ask, and the recipe that arrives — post, ask, receive, as a picture.
    const { container } = renderLanding()
    // Two sample cards, both <figure> (MealGlimpse + RecipeGlimpse).
    expect(container.querySelectorAll('figure')).toHaveLength(2)
    // The ASK is visible ON THE SAMPLE CARD, which is the act the whole product turns on and the one
    // thing no other recipe app has. Scoped to the figure because the headline says "ask for the
    // recipe" too — and that duplication is the point: the h1 promises it, the card shows it.
    const [meal] = container.querySelectorAll('figure')
    expect(meal.textContent).toMatch(/ask for the recipe/i)
    // ...and it is NOT an interactive control: a button here is a dead end for someone with no
    // account, and a screen reader announcing one that does nothing is worse than silence.
    expect(meal.querySelector('button')).toBeNull()
    expect(meal.querySelector('a')).toBeNull()
    // And the cause/effect line that joins the two.
    expect(screen.getByText(/you ask\. they answer/i)).toBeInTheDocument()
  })

  it('shows the two things that are actually different, rather than claiming them', () => {
    // Both come from `RecipeGlimpse`, which is the point: the measurements pill and the step note are
    // on screen, so the page needs no sentence asserting them.
    renderLanding()
    expect(screen.getByText(/3 soup spoons/i)).toBeInTheDocument()
    expect(screen.getByText(/their way/i)).toBeInTheDocument()
    expect(screen.getByText(/a note on this step/i)).toBeInTheDocument()
  })

  it('names the other side too — posting and writing, not just receiving', () => {
    renderLanding()
    expect(screen.getByText(/post your own/i)).toBeInTheDocument()
    expect(
      screen.getByText(/write down the one people keep asking you for/i),
    ).toBeInTheDocument()
  })

  it('USES THE PALETTE — it is not a black-and-white wall of text', () => {
    // jsdom has no layout engine so appearance cannot be asserted, but the classes can. A future edit
    // that flattens this back to cream-on-cream fails here.
    const { container } = renderLanding()
    expect(container.querySelector('.bg-peach')).not.toBeNull()
    // The TITLE is bare, though — owner's call, and the reason is compositional: a heading inside a
    // sticker competes with the two sample cards, which are the things that should carry the colour.
    expect(screen.getByRole('heading', { level: 1 }).closest('.sticker')).toBeNull()
  })

  it('asks a stranger to READ very little — the samples carry the pitch', () => {
    // The owner's standing note, twice: too much text. A ceiling on the page's own copy, generous
    // enough not to be fussy and tight enough that the prose cannot creep back — the first version
    // ran past 1,100 characters, the second ~900, and showing rather than telling cut it again.
    const { container } = renderLanding()
    expect(proseOf(container).length).toBeLessThan(560)
  })

  it('uses AT MOST ONE em dash in the whole rendered page', () => {
    // A house rule, owner's call: two or more em dashes is a tell that the copy was generated rather
    // than written, and this is the one surface whose entire job is to sound like a person
    // recommending something. The page had three — the title, the cause-and-effect caption, and
    // `IsseiMeaning`'s gloss. Both of the page's own are gone (the title takes a comma, the caption
    // became three beats), leaving the shared gloss: it is one source for the word across this page,
    // Login and InviteLanding, so rewriting it here would edit two other screens.
    //
    // Counted on the RENDERED text, not the source, because that is what a visitor sees — and because
    // the file's own explanatory comments are full of them and must not count.
    const { container } = renderLanding()
    const emDashes = (container.textContent.match(/—/g) || []).length
    expect(emDashes).toBeLessThanOrEqual(1)
  })

  it('offers signup as the primary act and sign-in as a labelled second door', () => {
    renderLanding()
    expect(screen.getByRole('link', { name: /open your kitchen/i })).toHaveAttribute(
      'href',
      '/login?tab=signup',
    )
    expect(screen.getByRole('link', { name: /^sign in$/i })).toHaveAttribute('href', '/login')
  })

  it('does NOT explain the no-account read here', () => {
    // Removed on owner review, and the reasoning is a rule rather than a preference: this page's one
    // problem was text volume, and that line answers a question this visitor has not asked. They were
    // REFERRED, not sent a recipe, so there is no link in their hand for the promise to be about —
    // and someone who does receive one finds out by opening it. The claim still lives where it earns
    // its place, on the unfurl card (`services/invite_og.py`).
    const { container } = renderLanding()
    expect(container.textContent).not.toMatch(/no account/i)
  })

  it('THE SAMPLE MEAL AND THE SAMPLE RECIPE ARE THE SAME DISH', () => {
    // Not cosmetic — the sequence breaks without it. The page says "you ask, they answer, and this is
    // what arrives"; if the meal is Ana's Sinigang and what arrives is Auntie Ling's pork belly, the
    // demonstration shows a different dish from a different person arriving, which teaches the
    // opposite of the mechanic. Caught on review of the first version.
    const { container } = renderLanding()
    const [meal, recipe] = container.querySelectorAll('figure')
    expect(meal.textContent).toMatch(/Auntie Ling/)
    expect(recipe.textContent).toMatch(/Auntie Ling/)
    expect(meal.textContent).toMatch(/Braised pork belly/)
    expect(recipe.textContent).toMatch(/Braised pork belly/)
  })

  it('glosses the name, because a referred person has never seen the word', () => {
    renderLanding()
    expect(screen.getByText(/一世/)).toBeInTheDocument()
    expect(screen.getByText(/first of a family to arrive somewhere new/i)).toBeInTheDocument()
  })

  it('does NOT claim a friend can reach ANY recipe of theirs', () => {
    // A review asked for "access any of their recipes" and it is FALSE: `can_view` withholds `private`
    // recipes, and the recipe behind a post arrives by ASKING. Overclaiming here would be a promise
    // the app refuses one screen later.
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
      /family tree/i,
      /lineage/i,
      /generation(s|al)\b/i,
      /make it yours/i,
      /\bremix/i,
      /\blike button/i,
      /expires?\b/i,
      /shopping list/i,
      /convert.{0,12}units/i,
      /\bcomment/i,
    ]
    for (const pattern of BANNED) {
      expect(text).not.toMatch(pattern)
    }
  })
})
