import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { buildOriginPayload } from '../lib/originPayload'

vi.mock('../api/posts', () => ({
  fulfillPost: vi.fn(() => Promise.resolve({ data: {} })),
}))
vi.mock('../api/sharing', () => ({
  plantRecipe: vi.fn(() =>
    Promise.resolve({
      data: {
        id: 42,
        name: 'Congee',
        growth_stage: 'sprout',
        growth_vitality: 'bare',
      },
    }),
  ),
  // Unavailable by default, so every existing paste test exercises the LOCAL parser
  // fallback — which is the path that has to keep working when the model is down.
  parseRecipeWithAI: vi.fn(() => Promise.resolve({ data: { ai: false } })),
}))
// RecipeForm is heavy; stub it to immediately submit a minimal payload. The real
// form now OWNS the optional "Passed down from" field and builds the origin into
// its own payload, so the stub mirrors that: it seeds a source input from
// initialValues.sourceName and includes buildOriginPayload({ name }) on submit.
let lastProps = null
vi.mock('../components/RecipeForm', () => ({
  default: (props) => {
    lastProps = props
    const {
      onSubmit,
      onQuickSave,
      initialValues = {},
      intro = null,
      topSlot = null,
      beforeSubmitSlot = null,
    } = props
    return (
      <div>
        {topSlot}
        {intro}
        {beforeSubmitSlot}
        <label>
          Passed down from (optional)
          <input
            aria-label="Passed down from (optional)"
            defaultValue={initialValues.sourceName || ''}
          />
        </label>
        <button
          onClick={() => {
            const src = document.querySelector(
              'input[aria-label="Passed down from (optional)"]',
            ).value
            onSubmit({
              name: 'Congee',
              origin: buildOriginPayload({ name: src }),
              ingredients: [],
              steps: [],
              story: 'typed in the form',
            })
          }}
        >
          submit-form
        </button>
        {/* Mirrors the real form's contract: quick-save reports the LIVE cover, and the
            real button is hidden unless the form is otherwise empty. Two buttons so a test
            can drive both "cover as seeded" and "cover the user removed". */}
        {onQuickSave && (
          <>
            <button
              onClick={() =>
                onQuickSave('Congee', { coverPhotoUrl: initialValues.coverPhotoUrl || '' })
              }
            >
              quick-save
            </button>
            <button onClick={() => onQuickSave('Congee', { coverPhotoUrl: '' })}>
              quick-save-cover-removed
            </button>
          </>
        )}
      </div>
    )
  },
}))
// The save celebration is decorative; its reveal IS the terminal saved screen
// (checkmark + card + share). Stub it to expose the two actions as buttons so the
// page's wiring (view → recipe page, share → handoff) is testable without waiting
// on animation timers. Its own animation is covered in SaveCelebration.test.jsx.
vi.mock('../components/SaveCelebration', () => ({
  default: ({ recipe, onView, onShare }) => (
    <div>
      <p>celebration for {recipe?.name}</p>
      <button onClick={onView}>celebrate-view</button>
      <button onClick={onShare}>celebrate-share</button>
    </div>
  ),
}))
import { plantRecipe, parseRecipeWithAI } from '../api/sharing'
import { fulfillPost } from '../api/posts'
import PlantRecipe from './PlantRecipe'

beforeEach(() => {
  plantRecipe.mockClear()
  fulfillPost.mockClear()
  fulfillPost.mockResolvedValue({ data: {} })
  parseRecipeWithAI.mockClear()
  parseRecipeWithAI.mockResolvedValue({ data: { ai: false } })
  lastProps = null
})

function renderFlow(state) {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/add/recipe', state }]}>
      <Routes>
        <Route path="/add/recipe" element={<PlantRecipe />} />
        {/* Where a mid-post save must land. Echoes what it was handed. */}
        <Route path="/add/meal" element={<ComposerSpy />} />
        <Route path="/add" element={<div>add chooser</div>} />
        {/* Where answering an ask lands (#79). Echoes any state it was handed. */}
        <Route path="/requests" element={<RequestsSpy />} />
      </Routes>
    </MemoryRouter>,
  )
}

function RequestsSpy() {
  const { state } = useLocation()
  return (
    <div>
      <p>asks page</p>
      <p>delivery failed: {String(state?.deliveryFailed ?? 'no')}</p>
    </div>
  )
}

function ComposerSpy() {
  const { state } = useLocation()
  return (
    <div>
      <p>back at the composer</p>
      <p>draft: {JSON.stringify(state?.postDraft)}</p>
      <p>attached: {state?.attachRecipe ? state.attachRecipe.id : 'none'}</p>
    </div>
  )
}

const enterDoor = (name) => userEvent.click(screen.getByRole('button', { name }))

describe('PlantRecipe — lands straight on say/paste, with a type-it-in link', () => {
  it('opens directly on the say/paste screen (no transitional doorway)', () => {
    renderFlow()
    // The say/paste screen IS the entry now — no intermediate "Say it or paste it"
    // card to click through first.
    expect(screen.getByRole('heading', { name: /add it your way/i })).toBeInTheDocument()
    // The blank-form escape hatch is a quiet link at the bottom of this screen, not a
    // co-equal card and not a separate doorway.
    expect(
      screen.getByRole('button', { name: /rather fill in the form/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /fill it in yourself/i }),
    ).toBeNull()
  })

  it('the form door lands straight on the form', async () => {
    renderFlow()
    await enterDoor(/rather fill in the form/i)
    expect(
      screen.getByRole('button', { name: /submit-form/i }),
    ).toBeInTheDocument()
  })

  it('the source is asked on the form itself, not as its own step', async () => {
    // The doorway no longer forks on "inherited vs your own"; the form carries a
    // single optional "Passed down from" field.
    renderFlow()
    await enterDoor(/rather fill in the form/i)
    expect(
      screen.getByLabelText(/passed down from/i),
    ).toBeInTheDocument()
  })

  it('sends the origin when a source name is filled in', async () => {
    renderFlow()
    await enterDoor(/rather fill in the form/i)
    await userEvent.type(screen.getByLabelText(/passed down from/i), 'Lola')
    await userEvent.click(screen.getByRole('button', { name: /submit-form/i }))
    expect(plantRecipe.mock.calls[0][0].origin.name).toBe('Lola')
    // ONE story input: the dish's story comes from the form, never a separate field.
    expect(plantRecipe.mock.calls[0][0].story).toBe('typed in the form')
  })

  it('sends no origin when the source name is left blank', async () => {
    renderFlow()
    await enterDoor(/rather fill in the form/i)
    await userEvent.click(screen.getByRole('button', { name: /submit-form/i }))
    expect(plantRecipe.mock.calls[0][0].origin ?? null).toBeNull()
  })

  it('lands on the save celebration, carrying the saved recipe', async () => {
    // The celebration's reveal is the terminal saved screen now (checkmark + card
    // + share); the old text-only "Congee is saved." screen was replaced by it.
    renderFlow()
    await enterDoor(/rather fill in the form/i)
    expect(screen.getByText(/a splash of vinegar/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /submit-form/i }))

    expect(
      await screen.findByText(/celebration for Congee/i),
    ).toBeInTheDocument()
  })

  it('share from the celebration goes to the hand-off step', async () => {
    renderFlow()
    await enterDoor(/rather fill in the form/i)
    await userEvent.click(screen.getByRole('button', { name: /submit-form/i }))
    await userEvent.click(
      await screen.findByRole('button', { name: /celebrate-share/i }),
    )
    // The hand-off compose screen is now showing.
    expect(
      await screen.findByRole('button', { name: /get a link to send/i }),
    ).toBeInTheDocument()
  })

  it('back from the type-it-in form returns to the say/paste screen, not out of the flow', async () => {
    renderFlow()
    await enterDoor(/rather fill in the form/i)
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    // Back on the say/paste screen (its heading + the type-it-in link are present).
    expect(screen.getByRole('heading', { name: /add it your way/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /rather fill in the form/i }),
    ).toBeInTheDocument()
  })
})

// The create-time visibility choice is the ONLY thing that can ever put a recipe
// in Browse, so these lock both directions: the public default, and opting down.
describe('PlantRecipe visibility', () => {
  async function reachTheForm() {
    renderFlow()
    await enterDoor(/rather fill in the form/i)
  }

  it('preselects "Friends only" for a private-profile author (the default)', async () => {
    // No issei_user in storage → profile treated as private → default "friends".
    await reachTheForm()
    expect(screen.getByText(/who can see this\?/i)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /friends only/i })).toBeChecked()
    expect(screen.getByRole('radio', { name: /everyone/i })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: /only me/i })).not.toBeChecked()
  })

  it('sends visibility friends without the user touching the choice', async () => {
    await reachTheForm()
    await userEvent.click(screen.getByRole('button', { name: /submit-form/i }))
    expect(plantRecipe.mock.calls[0][0].visibility).toBe('friends')
  })

  it('sends visibility public once the user opts up to "Everyone"', async () => {
    await reachTheForm()
    await userEvent.click(screen.getByRole('radio', { name: /everyone/i }))
    expect(screen.getByRole('radio', { name: /everyone/i })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: /submit-form/i }))
    expect(plantRecipe.mock.calls[0][0].visibility).toBe('public')
  })

  it('sends visibility private once the user opts down to "Only me"', async () => {
    await reachTheForm()
    await userEvent.click(screen.getByRole('radio', { name: /only me/i }))
    expect(screen.getByRole('radio', { name: /only me/i })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: /submit-form/i }))
    expect(plantRecipe.mock.calls[0][0].visibility).toBe('private')
  })
})

// PASTE — the second door. It exists because the form asks for many fields when only the
// dish name is required, and testers called capture "too effortful".
describe('PlantRecipe — pasting a whole recipe', () => {
  const PASTED = ['Adobo', '3 soup spoons soy sauce', 'Brown the chicken'].join('\n')
  const GUESSED = ['Adobo', '2 cups rice', 'Boil it'].join('\n')
  const HEADERED = [
    'Adobo',
    'Ingredients:',
    '2 cups rice',
    'Instructions:',
    'Boil it',
  ].join('\n')

  async function openPaste() {
    // The say/paste screen is the entry point now — no card to click first.
    renderFlow()
  }

  async function paste(text) {
    await openPaste()
    await userEvent.type(screen.getByRole('textbox'), text)
    await userEvent.click(screen.getByRole('button', { name: /sort this out/i }))
  }

  it('opens on say/paste, with the type-it-in link below it', async () => {
    renderFlow()
    const heading = screen.getByRole('heading', { name: /add it your way/i })
    const form = screen.getByRole('button', { name: /rather fill in the form/i })
    // 4 === Node.DOCUMENT_POSITION_FOLLOWING: the type-it-in link comes AFTER the
    // say/paste screen's heading.
    expect(heading.compareDocumentPosition(form) & 4).toBeTruthy()
  })

  it('lands on the form with the recipe already sorted', async () => {
    await paste(PASTED)
    expect(lastProps.initialValues.name).toBe('Adobo')
    expect(lastProps.initialValues.ingredients).toEqual([
      { name: 'soy sauce', quantity: '3 soup spoons' },
    ])
    expect(lastProps.initialValues.steps[0].content).toBe('Brown the chicken')
  })

  it('says how much it guessed, instead of presenting a guess as fact', async () => {
    await paste(GUESSED)
    expect(screen.getByText(/sorted 2 lines/i)).toBeInTheDocument()
    expect(screen.getByText(/nothing is saved yet/i)).toBeInTheDocument()
  })

  it('credits the author’s own headings rather than claiming a guess', async () => {
    await paste(HEADERED)
    expect(screen.getByText(/using your own headings/i)).toBeInTheDocument()
  })

  it('will not sort a single line — that is a name, not a recipe', async () => {
    await openPaste()
    await userEvent.type(screen.getByRole('textbox'), 'Adobo')
    expect(screen.getByRole('button', { name: /sort this out/i })).toBeDisabled()
    expect(plantRecipe).not.toHaveBeenCalled()
  })

  it('saves nothing until the form is submitted', async () => {
    await paste(GUESSED)
    expect(plantRecipe).not.toHaveBeenCalled()
  })

  it('goes back to the paste box from the form, keeping the text', async () => {
    await paste(GUESSED)
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.getByRole('textbox')).toHaveValue(GUESSED)
  })
})

// NAME-ONLY SAVE — the escape hatch for the failure testers described: one abandoned
// the form mid-way, and abandoning meant losing everything typed.
describe('PlantRecipe — keeping just the name', () => {
  it('saves with the dish name alone, then celebrates', async () => {
    renderFlow()
    await enterDoor(/rather fill in the form/i)
    await userEvent.click(screen.getByRole('button', { name: /^quick-save$/i }))
    expect(plantRecipe).toHaveBeenCalledWith({
      name: 'Congee',
      visibility: 'friends',
    })
    // Same celebration reveal as a full save — a name-only recipe is a smaller
    // recipe, not a different kind of thing.
    expect(
      await screen.findByText(/celebration for Congee/i),
    ).toBeInTheDocument()
  })
})

// THE LLM LAYER. The local parser cannot split run-on speech — one spoken sentence
// holding three ingredients — and that is exactly how a person tells you how they cook.
// The model goes first for that reason; the local parser stays as the floor.
describe('PlantRecipe — the model reads it first', () => {
  // A correctly-shaped paste, for the fallback cases: the local parser needs one item
  // per line, which is the requirement the model removes.
  const TIDY = ['Adobo', '2 cups rice', 'Boil it'].join('\n')

  const SPOKEN =
    'sinigang from my lola. you need tamarind, about a thumb of ginger, and some kangkong. boil the pork until tender, then add the tamarind.'

  const AI_ANSWER = {
    ai: true,
    name: 'Sinigang',
    source_name: 'Lola',
    description: 'Sour pork soup.',
    servings: '4',
    cuisine: 'Filipino',
    ingredients: [
      { name: 'tamarind', amount: '', quantity_type: 'unmeasured' },
      { name: 'ginger', amount: 'about a thumb', quantity_type: 'unmeasured' },
      { name: 'kangkong', amount: 'some', quantity_type: 'unmeasured' },
    ],
    steps: [
      { content: 'Boil the pork until tender', note: '' },
      { content: 'Add the tamarind', note: "don't overcook the greens" },
    ],
  }

  async function speak(text = SPOKEN) {
    // The say/paste screen is the entry point now — no card to click first.
    renderFlow()
    await userEvent.type(screen.getByRole('textbox'), text)
    await userEvent.click(screen.getByRole('button', { name: /sort this out/i }))
  }

  it('splits run-on speech the local parser cannot', async () => {
    parseRecipeWithAI.mockResolvedValue({ data: AI_ANSWER })
    await speak()
    await waitFor(() => expect(lastProps).not.toBeNull())
    expect(lastProps.initialValues.ingredients.map((i) => i.name)).toEqual([
      'tamarind',
      'ginger',
      'kangkong',
    ])
  })

  it('keeps an amount in the words it was said in', async () => {
    parseRecipeWithAI.mockResolvedValue({ data: AI_ANSWER })
    await speak()
    await waitFor(() => expect(lastProps).not.toBeNull())
    const ginger = lastProps.initialValues.ingredients.find((i) => i.name === 'ginger')
    expect(ginger.quantity).toBe('about a thumb')
  })

  it('puts a remark about a step into that step’s note', async () => {
    parseRecipeWithAI.mockResolvedValue({ data: AI_ANSWER })
    await speak()
    await waitFor(() => expect(lastProps).not.toBeNull())
    expect(lastProps.initialValues.steps[1]).toMatchObject({
      content: 'Add the tamarind',
      voice_note: "don't overcook the greens",
    })
  })

  it('fills the extras it heard, and seeds the source field with the person it came from', async () => {
    parseRecipeWithAI.mockResolvedValue({ data: AI_ANSWER })
    await speak()
    await waitFor(() => expect(lastProps).not.toBeNull())
    expect(lastProps.initialValues).toMatchObject({
      name: 'Sinigang',
      servings: '4',
      cuisine: 'Filipino',
      description: 'Sour pork soup.',
      sourceName: 'Lola',
    })
    // The seeded source name appears in the form's own field.
    expect(screen.getByDisplayValue('Lola')).toBeInTheDocument()
  })

  it('does not claim to have guessed when the model did the work', async () => {
    parseRecipeWithAI.mockResolvedValue({ data: AI_ANSWER })
    await speak()
    expect(await screen.findByText(/sorted out what you said/i)).toBeInTheDocument()
    expect(screen.queryByText(/as best we could/i)).toBeNull()
  })

  it('falls back to the local parser when the model is unavailable', async () => {
    parseRecipeWithAI.mockResolvedValue({ data: { ai: false } })
    await speak(TIDY)
    await waitFor(() => expect(lastProps).not.toBeNull())
    expect(lastProps.initialValues.name).toBe('Adobo')
    expect(screen.getByText(/as best we could/i)).toBeInTheDocument()
  })

  it('falls back silently when the request itself throws', async () => {
    parseRecipeWithAI.mockRejectedValue(new Error('offline'))
    await speak(TIDY)
    await waitFor(() => expect(lastProps).not.toBeNull())
    expect(lastProps.initialValues.name).toBe('Adobo')
    expect(document.querySelector('.error-pill')).toBeNull()
  })

  it('falls back when the model returns nothing usable', async () => {
    parseRecipeWithAI.mockResolvedValue({
      data: { ai: true, name: '', ingredients: [], steps: [] },
    })
    await speak(TIDY)
    await waitFor(() => expect(lastProps).not.toBeNull())
    expect(lastProps.initialValues.ingredients).toHaveLength(1)
  })

  it('still saves nothing until the form is submitted', async () => {
    parseRecipeWithAI.mockResolvedValue({ data: AI_ANSWER })
    await speak()
    await waitFor(() => expect(lastProps).not.toBeNull())
    expect(plantRecipe).not.toHaveBeenCalled()
  })
})

// #81 — entered mid-post from the meal composer. The composer hands its draft over in
// router state; this flow must give it back rather than stranding a half-written post.
describe('PlantRecipe — entered from the meal composer', () => {
  const postDraft = {
    photo_url: 'https://img.test/meal.jpg',
    dish_name: 'Sunday adobo',
    description: 'the good one',
    visibility: 'public',
  }

  it('returns to the composer with the saved recipe instead of celebrating', async () => {
    renderFlow({ postDraft })
    await enterDoor(/rather fill in the form/i)
    await userEvent.click(screen.getByRole('button', { name: 'submit-form' }))

    expect(await screen.findByText(/back at the composer/i)).toBeInTheDocument()
    expect(screen.getByText(/attached: 42/)).toBeInTheDocument()
    expect(JSON.parse(screen.getByText(/^draft:/).textContent.replace('draft: ', '')))
      .toEqual(postDraft)
    // The celebration would claim the act is done while the post still isn't shared.
    expect(screen.queryByText(/celebration for/i)).not.toBeInTheDocument()
  })

  it('still celebrates when NOT entered from a post', async () => {
    renderFlow()
    await enterDoor(/rather fill in the form/i)
    await userEvent.click(screen.getByRole('button', { name: 'submit-form' }))
    expect(await screen.findByText(/celebration for congee/i)).toBeInTheDocument()
  })

  it('reassures you on the ENTRY screen that the meal is still waiting', async () => {
    // Caught by running it: the note was only on the blank form, but the screen you
    // actually land on after tapping "Write one" is say/paste — so the one worry the
    // feature creates ("did I just lose my post?") went unanswered.
    renderFlow({ postDraft })
    expect(screen.getByText(/your meal is still waiting/i)).toBeInTheDocument()
  })

  it('says nothing about a meal when entered standalone', async () => {
    renderFlow()
    expect(screen.queryByText(/your meal is still waiting/i)).not.toBeInTheDocument()
  })

  it("inherits the post's photo as the recipe cover", async () => {
    renderFlow({ postDraft })
    await enterDoor(/rather fill in the form/i)
    // You just uploaded a picture of this exact dish; asking for it twice is the friction.
    expect(lastProps.initialValues.coverPhotoUrl).toBe('https://img.test/meal.jpg')
  })

  it('sends the cover the FORM reports on a name-only quick save', async () => {
    renderFlow({ postDraft })
    await enterDoor(/rather fill in the form/i)
    await userEvent.click(screen.getByRole('button', { name: /^quick-save$/i }))
    await waitFor(() =>
      expect(plantRecipe).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Congee',
          cover_photo_url: 'https://img.test/meal.jpg',
        }),
      ),
    )
    expect(await screen.findByText(/attached: 42/)).toBeInTheDocument()
  })

  it('does NOT resurrect a cover the user removed in the form', async () => {
    // The defect this replaced: quick-save read the post draft directly instead of the
    // form's live value, so clearing the inherited cover and taking the name-only shortcut
    // saved the recipe with the exact photo that had just been removed.
    renderFlow({ postDraft })
    await enterDoor(/rather fill in the form/i)
    await userEvent.click(screen.getByRole('button', { name: /^quick-save-cover-removed$/i }))
    await waitFor(() => expect(plantRecipe).toHaveBeenCalled())
    expect(plantRecipe.mock.calls[0][0]).not.toHaveProperty('cover_photo_url')
  })

  it("starts from the post's visibility rather than the profile default", async () => {
    // The profile is private here (no issei_user in localStorage → 'private'), so without
    // the seed this would be 'friends'. Same dish, same moment, same audience intent —
    // and it's still stored literally, not linked to the post.
    renderFlow({ postDraft })
    await enterDoor(/rather fill in the form/i)
    await userEvent.click(screen.getByRole('button', { name: 'submit-form' }))
    await waitFor(() =>
      expect(plantRecipe).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'public' }),
      ),
    )
  })

  it('backing out returns to the composer with the draft, not to the add chooser', async () => {
    renderFlow({ postDraft })
    // From the say/paste entry screen, back exits the flow — which mid-post means the
    // post, not /add. Losing the draft here is the exact failure this task removes.
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(await screen.findByText(/back at the composer/i)).toBeInTheDocument()
    expect(JSON.parse(screen.getByText(/^draft:/).textContent.replace('draft: ', '')))
      .toEqual(postDraft)
    expect(screen.getByText(/attached: none/)).toBeInTheDocument()
  })

  it('still exits to the add chooser when standalone', async () => {
    renderFlow()
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(await screen.findByText(/add chooser/i)).toBeInTheDocument()
  })

  it("seeds the recipe with ALL THREE things the post already knows", async () => {
    // docs/SOCIAL_FEED_DESIGN.md's "zero re-entry": name, description and photo→cover. Only
    // the photo was wired at first, so someone who'd just typed "Sunday adobo / the good one"
    // was asked for both again one screen later.
    renderFlow({ postDraft })
    await enterDoor(/rather fill in the form/i)
    expect(lastProps.initialValues).toMatchObject({
      name: 'Sunday adobo',
      description: 'the good one',
      coverPhotoUrl: 'https://img.test/meal.jpg',
    })
  })

  it('lets a parse win over the post fields, without blanking what it did not find', async () => {
    // A parse is a deliberate re-read of the recipe, so its values take precedence — but
    // `undefined` from the parser must not overwrite a real draft value.
    renderFlow({ postDraft })
    const RECIPE_TEXT = [
      'Congee',
      '',
      'Ingredients',
      '1 cup rice',
      '',
      'Steps',
      'Simmer it slowly for an hour',
    ].join('\n')
    await userEvent.type(screen.getByRole('textbox'), RECIPE_TEXT)
    await userEvent.click(screen.getByRole('button', { name: /sort this out/i }))
    await waitFor(() => expect(lastProps).not.toBeNull())
    // The parser named the dish, so that wins...
    expect(lastProps.initialValues.name).toBe('Congee')
    // ...but it found no description, and the post's must survive.
    expect(lastProps.initialValues.description).toBe('the good one')
    expect(lastProps.initialValues.coverPhotoUrl).toBe('https://img.test/meal.jpg')
  })

  it('hands back an already-attached recipe when you back out', async () => {
    // Reachable by browser-back into this flow after a completed round trip. Rebuilding the
    // draft without it silently dropped the attachment and the composer showed the doors again.
    renderFlow({ postDraft, attachRecipe: { id: 7, name: 'Earlier one' } })
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(await screen.findByText(/back at the composer/i)).toBeInTheDocument()
    expect(screen.getByText(/attached: 7/)).toBeInTheDocument()
  })
})

// Answering an ask (#79). Entered from /requests with BOTH a postDraft (so the recipe form
// is pre-seeded, exactly as #81 does) and a fulfillPostId (the post to deliver to).
describe('PlantRecipe — answering a recipe request', () => {
  const postDraft = {
    photo_url: 'https://img.test/meal.jpg',
    dish_name: 'Sinigang',
    description: 'the sour one',
    visibility: 'friends',
  }
  const fromRequests = { postDraft, fulfillPostId: 5 }

  it('delivers to everyone who asked, then returns to the asks page', async () => {
    renderFlow(fromRequests)
    await enterDoor(/rather fill in the form/i)
    await userEvent.click(screen.getByRole('button', { name: 'submit-form' }))
    await waitFor(() => expect(fulfillPost).toHaveBeenCalledWith(5, 42))
    expect(await screen.findByText('asks page')).toBeInTheDocument()
    // NOT the celebration: the act being finished is the delivery, not a solo save.
    expect(screen.queryByText(/celebration for/i)).not.toBeInTheDocument()
  })

  it('says on the entry screen that saving SENDS it, not that a meal is waiting', async () => {
    // The meal is already shared here, and saving returns to /requests — so the mid-post
    // reassurance ("your meal is still waiting… brings you back to it") is false twice over.
    renderFlow(fromRequests)
    expect(screen.getByText(/saving sends this to everyone who asked/i)).toBeInTheDocument()
    expect(screen.queryByText(/your meal is still waiting/i)).not.toBeInTheDocument()
  })

  it('keeps the mid-post wording when it really IS a mid-post draft', async () => {
    renderFlow({ postDraft })
    expect(screen.getByText(/your meal is still waiting/i)).toBeInTheDocument()
    expect(screen.queryByText(/sends this to everyone/i)).not.toBeInTheDocument()
  })

  it('backing out returns to the asks page, never to a pre-filled new post', async () => {
    // The trap: this draft describes a meal that is ALREADY published. Handing it to the
    // composer would pre-fill a new post with the same photo, name and description — one
    // tap from a duplicate.
    renderFlow(fromRequests)
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(await screen.findByText('asks page')).toBeInTheDocument()
    expect(screen.queryByText(/back at the composer/i)).not.toBeInTheDocument()
  })

  it('tells the cook when the recipe saved but delivery did not', async () => {
    // Swallowing is right for the RECIPE (it exists; this must not read as data loss) but
    // silence was worse: an unchanged list reads as "the save didn't take", and the obvious
    // recovery is to write the whole recipe a second time.
    fulfillPost.mockRejectedValueOnce(new Error('offline'))
    renderFlow(fromRequests)
    await enterDoor(/rather fill in the form/i)
    await userEvent.click(screen.getByRole('button', { name: 'submit-form' }))
    expect(await screen.findByText('asks page')).toBeInTheDocument()
    expect(screen.getByText(/delivery failed: Congee/)).toBeInTheDocument()
  })

  it('reports nothing when delivery worked', async () => {
    renderFlow(fromRequests)
    await enterDoor(/rather fill in the form/i)
    await userEvent.click(screen.getByRole('button', { name: 'submit-form' }))
    expect(await screen.findByText('delivery failed: no')).toBeInTheDocument()
  })
})

// ============================================================================================
// #105 — THE CONSUMER SIDE of `default_recipe_visibility`. TESTING.md's own rule for a new setting
// says it needs a test that exercises the CONSUMER, not just the round trip — and the first pass
// shipped the rule while covering only the settings page that WRITES the value. The ship gate
// caught the doc asserting a test that did not exist. This is that test.
//
// What makes it worth having rather than ceremonial: the reader is a three-branch fallback chain
// (post draft → the setting → the pre-#105 profile derivation), and the middle branch is the new
// one. A regression in it is silent — the form still renders, with the wrong audience pre-selected.
// ============================================================================================

describe('PlantRecipe — the create form starts on the author’s stated default (#105)', () => {
  async function reachTheFormAs(cachedUser) {
    if (cachedUser) localStorage.setItem('issei_user', JSON.stringify(cachedUser))
    renderFlow()
    await enterDoor(/rather fill in the form/i)
  }

  it.each([
    ['public', /everyone/i],
    ['friends', /friends only/i],
    ['private', /only me/i],
  ])('pre-selects %s from default_recipe_visibility', async (setting, label) => {
    await reachTheFormAs({ id: 1, default_recipe_visibility: setting })
    expect(screen.getByRole('radio', { name: label })).toBeChecked()
  })

  it('the SETTING beats the old profile derivation when both are present', async () => {
    // A public profile used to force "Everyone". Someone who explicitly said "only me" must get
    // that — otherwise the setting is decorative for exactly the people who changed it.
    await reachTheFormAs({
      id: 1,
      profile_visibility: 'public',
      default_recipe_visibility: 'private',
    })
    expect(screen.getByRole('radio', { name: /only me/i })).toBeChecked()
    expect(screen.getByRole('radio', { name: /everyone/i })).not.toBeChecked()
  })

  it('falls back to the PRE-#105 derivation for a cached user written before the field existed', async () => {
    // Someone whose localStorage predates #105 should get what they got yesterday, not a silent
    // change of audience on their next recipe.
    await reachTheFormAs({ id: 1, profile_visibility: 'public' })
    expect(screen.getByRole('radio', { name: /everyone/i })).toBeChecked()
  })

  it('still SENDS what the form is showing, not the setting it came from', async () => {
    // The value is stored LITERALLY (#68). This is the assertion that would catch someone
    // "simplifying" the form into reading the setting again at submit time.
    await reachTheFormAs({ id: 1, default_recipe_visibility: 'public' })
    await userEvent.click(screen.getByRole('radio', { name: /only me/i }))
    await userEvent.click(screen.getByRole('button', { name: /submit-form/i }))

    await waitFor(() => expect(plantRecipe).toHaveBeenCalled())
    expect(plantRecipe.mock.calls[0][0].visibility).toBe('private')
  })
})
