import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import client from '../api/client'
import RecipeForm from './RecipeForm'

// `get` is here for the ingredient-suggestion fetch. It defaults to a rejection
// so the whole suite runs on the shipped common list alone — which is also the
// assertion that a dead/slow endpoint never degrades the form.
//
// `toUserMessage` is the named export the form uses to phrase a failed upload.
// It has to be in the mock: without it the module proxy throws on property
// access, so an upload-failure test would blow up in the mock rather than
// exercise the error path it's testing. The stub returns the caller's fallback,
// which is what the real one does for an error carrying no server detail.
vi.mock('../api/client', () => ({
  default: { post: vi.fn(), get: vi.fn(() => Promise.reject(new Error('offline'))) },
  toUserMessage: vi.fn((_err, fallback) => fallback),
}))

// A JPEG the size validator accepts, for driving the file input.
function jpeg(name) {
  return new File(['x'], name, { type: 'image/jpeg' })
}

function pick(input, file) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
}

// Hands back a post() whose calls resolve only when you say so, so a test can
// land two uploads in whatever order it likes.
function deferredUploads() {
  const pending = []
  client.post.mockImplementation(
    () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
  )
  return pending
}

describe('RecipeForm slots', () => {
  it('renders a custom submit label and beforeSubmitSlot', () => {
    render(
      <RecipeForm
        mode="edit"
        submitLabel="Make it mine"
        beforeSubmitSlot={<div>slot-here</div>}
        onSubmit={() => {}}
      />,
    )
    expect(screen.getByText('slot-here')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /make it mine/i }),
    ).toBeInTheDocument()
  })

  it('falls back to the default label when submitLabel is not provided', () => {
    render(<RecipeForm mode="edit" onSubmit={() => {}} />)
    expect(
      screen.getByRole('button', { name: /save changes/i }),
    ).toBeInTheDocument()
  })

  it('uses the add-mode default label when no submitLabel and mode is add', () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    expect(
      screen.getByRole('button', { name: /save this recipe/i }),
    ).toBeInTheDocument()
  })
})

describe('RecipeForm voice-notes', () => {
  it('sends a per-step voice_note in the submitted payload', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<RecipeForm mode="add" onSubmit={onSubmit} />)

    fireEvent.change(screen.getByPlaceholderText('e.g. “Adobo”'), {
      target: { value: 'Adobo' },
    })
    fireEvent.change(screen.getAllByPlaceholderText('Describe this step…')[0], {
      target: { value: 'Brown the meat' },
    })
    fireEvent.change(
      screen.getAllByPlaceholderText('“don\'t rush the onions”')[0],
      { target: { value: "don't rush the onions" } },
    )

    fireEvent.click(screen.getByRole('button', { name: /save this recipe/i }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const payload = onSubmit.mock.calls[0][0]
    expect(payload.steps[0]).toMatchObject({
      content: 'Brown the meat',
      voice_note: "don't rush the onions",
    })
  })

  it('nulls an empty voice_note in the payload', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<RecipeForm mode="add" onSubmit={onSubmit} />)

    fireEvent.change(screen.getByPlaceholderText('e.g. “Adobo”'), {
      target: { value: 'Adobo' },
    })
    fireEvent.change(screen.getAllByPlaceholderText('Describe this step…')[0], {
      target: { value: 'Brown the meat' },
    })

    fireEvent.click(screen.getByRole('button', { name: /save this recipe/i }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const payload = onSubmit.mock.calls[0][0]
    expect(payload.steps[0].voice_note).toBeNull()
  })
})

describe('RecipeForm cover photo', () => {
  it('offers a keyboard-reachable file input in the empty state', () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    const input = screen.getByLabelText('Add a cover photo')
    expect(input).toHaveAttribute('type', 'file')
    // Regression guard: the input used to be `hidden` (display:none), which
    // drops it out of the tab order and made the photo step unreachable by
    // keyboard. It must stay visually-hidden-but-focusable instead.
    expect(input).toHaveClass('sr-only')
    expect(screen.getByText('Add a photo')).toBeInTheDocument()
  })

  it('shows the chosen cover with a remove control instead of the picker', () => {
    render(
      <RecipeForm
        mode="edit"
        initialValues={{ coverPhotoUrl: 'https://img.test/adobo.jpg' }}
        onSubmit={() => {}}
      />,
    )
    expect(screen.getByAltText('Recipe cover')).toHaveAttribute(
      'src',
      'https://img.test/adobo.jpg',
    )
    expect(
      screen.getByRole('button', { name: /remove photo/i }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Add a cover photo')).not.toBeInTheDocument()
  })
})

describe('RecipeForm cover photo — concurrent uploads', () => {
  beforeEach(() => {
    client.post.mockReset()
  })

  it('keeps the last pick when responses land out of order', async () => {
    const pending = deferredUploads()
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    const input = screen.getByLabelText('Add a cover photo')

    // Pick A, then pick B before A's upload has answered.
    pick(input, jpeg('a.jpg'))
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1))
    pick(input, jpeg('b.jpg'))
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(2))

    // B answers first, then A — A is the stale winner in the original bug.
    pending[1].resolve({ data: { url: 'https://img.test/b.jpg' } })
    await waitFor(() =>
      expect(screen.getByAltText('Recipe cover')).toHaveAttribute(
        'src',
        'https://img.test/b.jpg',
      ),
    )
    // act(async) flushes A's continuation, so the assertion below can't pass
    // merely by running before the stale response was processed.
    await act(async () => {
      pending[0].resolve({ data: { url: 'https://img.test/a.jpg' } })
    })

    // A must never overwrite B: the user's most recent choice is the cover.
    expect(screen.getByAltText('Recipe cover')).toHaveAttribute(
      'src',
      'https://img.test/b.jpg',
    )
  })

  it('keeps the picker usable while an upload is in flight', async () => {
    deferredUploads()
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    const input = screen.getByLabelText('Add a cover photo')

    pick(input, jpeg('a.jpg'))
    await waitFor(() => expect(screen.getByText('Uploading…')).toBeTruthy())
    // A slow connection must not trap the user behind a disabled input that
    // looks stuck — picking again has to remain possible.
    expect(input).not.toBeDisabled()
  })

  it('aborts the superseded request when a second photo is picked', async () => {
    deferredUploads()
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    const input = screen.getByLabelText('Add a cover photo')

    pick(input, jpeg('a.jpg'))
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1))
    pick(input, jpeg('b.jpg'))
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(2))

    expect(client.post.mock.calls[0][2].signal.aborted).toBe(true)
    expect(client.post.mock.calls[1][2].signal.aborted).toBe(false)
  })

  it('does not surface the superseded upload as an error', async () => {
    const pending = deferredUploads()
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    const input = screen.getByLabelText('Add a cover photo')

    pick(input, jpeg('a.jpg'))
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1))
    pick(input, jpeg('b.jpg'))
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(2))

    // The aborted first request rejects; that's expected, not a user failure.
    pending[0].reject(new Error('canceled'))
    pending[1].resolve({ data: { url: 'https://img.test/b.jpg' } })

    await waitFor(() =>
      expect(screen.getByAltText('Recipe cover')).toBeInTheDocument(),
    )
    expect(
      screen.queryByText(/photo upload failed/i),
    ).not.toBeInTheDocument()
  })

  it('replaces an existing cover with the newly uploaded photo', async () => {
    const pending = deferredUploads()
    render(
      <RecipeForm
        mode="edit"
        initialValues={{ coverPhotoUrl: 'https://img.test/old.jpg' }}
        onSubmit={() => {}}
      />,
    )

    // Removing the saved cover exposes the picker; the old URL stays in
    // Cloudinary by design (see removePhoto).
    fireEvent.click(screen.getByRole('button', { name: /remove photo/i }))
    pick(screen.getByLabelText('Add a cover photo'), jpeg('new.jpg'))
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1))
    pending[0].resolve({ data: { url: 'https://img.test/new.jpg' } })

    await waitFor(() =>
      expect(screen.getByAltText('Recipe cover')).toHaveAttribute(
        'src',
        'https://img.test/new.jpg',
      ),
    )
  })
})

describe('RecipeForm intro', () => {
  it('renders the intro node under the heading when provided', () => {
    render(
      <RecipeForm
        mode="add"
        intro={<p>splash-of-vinegar-framing</p>}
        onSubmit={() => {}}
      />,
    )
    expect(screen.getByText('splash-of-vinegar-framing')).toBeInTheDocument()
  })

  it('renders no intro by default (Edit/Remix reuse stays clean)', () => {
    render(<RecipeForm mode="edit" onSubmit={() => {}} />)
    expect(
      screen.queryByText('splash-of-vinegar-framing'),
    ).not.toBeInTheDocument()
  })
})

// The add flow's friction fixes. Each of these is a specific reported failure
// from user testing, not a hypothetical.
// The form now opens with ONE blank ingredient and ONE blank step (see STARTING_INGREDIENTS).
// Tests that need several rows to prove "every row has X" add them, rather than depending on
// the starting count — which is a product decision that has changed twice.
function addStep(n = 1) {
  for (let i = 0; i < n; i++) {
    fireEvent.click(screen.getByRole('button', { name: /\+ add step/i }))
  }
}
function addIngredient(n = 1) {
  for (let i = 0; i < n; i++) {
    fireEvent.click(screen.getByRole('button', { name: /\+ add ingredient/i }))
  }
}
// Bring an ADD form up to three rows of each, for the tests that prove "EVERY row has X".
// They used to lean on the starting count; that's a product decision and it has changed twice.
function growTo3() {
  addStep(2)
  addIngredient(2)
}

describe('RecipeForm capture friction', () => {
  it('starts an ADD with ONE blank row of each, and still says one step per box', () => {
    // The form opens short on purpose (owner, 2026-09-08): three blank rows apiece made it
    // read as a chore before anything was typed.
    //
    // BUT the three rows were doing real work. A tester once typed their entire method into
    // step 1 and every ingredient into ingredient 1, because a single empty box gave no hint
    // they were meant to be separate entries — seeing the SHAPE was the fix. With one row
    // that hint now rests entirely on the copy, so the copy is what this pins. If that
    // instruction ever disappears, the original bug is back and nothing else would catch it.
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    expect(screen.getAllByPlaceholderText(/describe this step/i).length).toBe(1)
    expect(screen.getAllByPlaceholderText(/e\.g\. soy sauce/i).length).toBe(1)
    expect(screen.getByText(/one step per box/i)).toBeInTheDocument()
  })

  it('adds rows on demand, which is what carries the shorter default', () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    addStep()
    addIngredient()
    expect(screen.getAllByPlaceholderText(/describe this step/i).length).toBe(2)
    expect(screen.getAllByPlaceholderText(/e\.g\. soy sauce/i).length).toBe(2)
  })

  it('does NOT pad blank rows when editing an existing recipe', () => {
    // Editing must show exactly what's saved — inventing empty rows would read
    // as data the user didn't write.
    render(
      <RecipeForm
        mode="edit"
        initialValues={{
          steps: [{ content: 'Brown the chicken.', voice_note: '' }],
          ingredients: [{ name: 'soy sauce', quantity: '3 soup spoons' }],
        }}
        onSubmit={() => {}}
      />,
    )
    expect(screen.getAllByPlaceholderText(/describe this step/i).length).toBe(1)
    expect(screen.getAllByPlaceholderText(/e\.g\. soy sauce/i).length).toBe(1)
  })

  it('drops the blank padding rows from the payload', async () => {
    // Padding must cost nothing: three empty boxes must not become three empty
    // steps on the saved recipe.
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<RecipeForm mode="add" onSubmit={onSubmit} />)
    fireEvent.change(screen.getByPlaceholderText(/“Adobo”/i), {
      target: { value: 'Adobo' },
    })
    fireEvent.change(screen.getAllByPlaceholderText(/describe this step/i)[0], {
      target: { value: 'Brown the chicken.' },
    })
    fireEvent.change(screen.getAllByPlaceholderText(/e\.g\. soy sauce/i)[0], {
      target: { value: 'soy sauce' },
    })
    fireEvent.submit(screen.getByRole('button', { name: /save this recipe/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const payload = onSubmit.mock.calls[0][0]
    expect(payload.steps).toHaveLength(1)
    expect(payload.ingredients).toHaveLength(1)
    expect(payload.steps[0].position).toBe(1)
  })

  it('Enter in a step opens and focuses the next one', () => {
    // Testers found the TAPPING more tiring than the typing, so a whole list
    // should be enterable from the keyboard without reaching for "+ Add".
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    growTo3() // needs three rows to prove EVERY row; the default is now one
    const stepFields = screen.getAllByPlaceholderText(/describe this step/i)
    stepFields[0].focus()
    fireEvent.keyDown(stepFields[0], { key: 'Enter' })
    expect(screen.getAllByPlaceholderText(/describe this step/i)[1]).toHaveFocus()
  })

  it('Enter on the LAST step adds a new one', () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    const before = screen.getAllByPlaceholderText(/describe this step/i)
    fireEvent.keyDown(before[before.length - 1], { key: 'Enter' })
    expect(screen.getAllByPlaceholderText(/describe this step/i).length).toBe(
      before.length + 1,
    )
  })

  it('Shift+Enter in a step does NOT advance — a step can run long', () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    growTo3() // needs three rows to prove EVERY row; the default is now one
    const stepFields = screen.getAllByPlaceholderText(/describe this step/i)
    stepFields[0].focus()
    fireEvent.keyDown(stepFields[0], { key: 'Enter', shiftKey: true })
    expect(stepFields[0]).toHaveFocus()
    expect(screen.getAllByPlaceholderText(/describe this step/i).length).toBe(3)
  })

  it('Enter moves name → amount within an ingredient row, not to the next row', () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    const names = screen.getAllByPlaceholderText(/e\.g\. soy sauce/i)
    names[0].focus()
    fireEvent.keyDown(names[0], { key: 'Enter' })
    expect(
      screen.getAllByPlaceholderText(/1\/2 cup · a dash · to taste/i)[0],
    ).toHaveFocus()
  })

  it('Enter on an amount advances to the next ingredient', () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    growTo3() // needs three rows to prove EVERY row; the default is now one
    const amounts = screen.getAllByPlaceholderText(
      /1\/2 cup · a dash · to taste/i,
    )
    fireEvent.keyDown(amounts[0], { key: 'Enter' })
    expect(screen.getAllByPlaceholderText(/e\.g\. soy sauce/i)[1]).toHaveFocus()
  })
})

// Ingredient entry was the most-abandoned part of the flow across two rounds of
// testing: too much typing, too many taps per line. These pin the three fixes and,
// just as importantly, pin that none of them can get in the way.
describe('RecipeForm ingredient autosuggest', () => {
  const names = () => screen.getAllByPlaceholderText(/e\.g\. soy sauce/i)

  function type(el, value) {
    fireEvent.focus(el)
    fireEvent.change(el, { target: { value } })
  }

  it('keeps the name field labelled and reachable as a combobox', () => {
    // The suggestion list moved this input inside a wrapper component; the
    // persistent visible label has to still name it, and it must announce as a
    // combobox so a screen-reader user is told the list exists at all.
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    growTo3() // needs three rows to prove EVERY row; the default is now one
    // Scope to the ingredient name fields by their label: the source and cuisine
    // fields are also comboboxes now (SuggestField), so a bare combobox count would
    // include them. Three ingredient rows → three "Ingredient" comboboxes.
    const boxes = screen.getAllByLabelText('Ingredient')
    expect(boxes).toHaveLength(3)
    boxes.forEach((b) => expect(b).toHaveAttribute('role', 'combobox'))
    expect(boxes[0]).toHaveAttribute('aria-expanded', 'false')
  })

  it('suggests from the shipped common list with no network at all', async () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    type(names()[0], 'gochu')
    expect(await screen.findByRole('option', { name: 'gochugaru' })).toBeTruthy()
  })

  it("suggests the user's own past ingredients, ranked first", async () => {
    client.get.mockResolvedValueOnce({ data: { names: ['sopropo'] } })
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    type(names()[0], 'so')
    // Wait for the fetched word itself, not merely for "some option" — the
    // common list already answers "so" on the first render, so a bare
    // findAllByRole would assert against the pre-fetch strip and pass by luck.
    await screen.findByRole('option', { name: 'sopropo' })
    // Their kitchen predicts their next ingredient better than any list we ship.
    // Scope to the suggestion listbox — the Diet <select> also has <option>s.
    const strip = screen.getByRole('listbox')
    expect(within(strip).getAllByRole('option')[0]).toHaveTextContent('sopropo')
  })

  it('tapping a suggestion fills the name and lands on the amount', async () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    type(names()[0], 'gochu')
    fireEvent.click(await screen.findByRole('option', { name: 'gochujang' }))
    expect(names()[0]).toHaveValue('gochujang')
    // The saved tap: the caret is already where the user was heading next.
    expect(
      screen.getAllByPlaceholderText(/1\/2 cup · a dash · to taste/i)[0],
    ).toHaveFocus()
  })

  it('does not blur the input on pointer-down, so the keyboard stays up', async () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    type(names()[0], 'gochu')
    const option = await screen.findByRole('option', { name: 'gochugaru' })
    const ev = fireEvent.mouseDown(option)
    // fireEvent returns false when the handler called preventDefault.
    expect(ev).toBe(false)
  })

  it('drives the list from the keyboard: arrows highlight, Enter accepts', async () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    const input = names()[0]
    type(input, 'gochu')
    await screen.findByRole('option', { name: 'gochugaru' })
    // "gochu" matches more than one thing, so assert against the FIRST option
    // rather than a hardcoded word — otherwise this test pins list order.
    // Scope to the suggestion listbox — the Diet <select> also has <option>s.
    const strip = screen.getByRole('listbox')
    const first = within(strip).getAllByRole('option')[0].textContent
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(within(strip).getAllByRole('option')[0]).toHaveAttribute(
      'aria-selected',
      'true',
    )
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(names()[0]).toHaveValue(first)
  })

  it('Escape dismisses the list and it stays dismissed while typing', async () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    const input = names()[0]
    type(input, 'gochu')
    await screen.findByRole('option', { name: 'gochugaru' })
    fireEvent.keyDown(input, { key: 'Escape' })
    // Query the suggestion strip by its listbox role, not 'option' — the Diet
    // <select> also renders <option>s (role option), so a bare option query would
    // find those even when the ingredient strip is closed.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    // Someone whose ingredient isn't in any list dismissed it for a reason;
    // reopening on the next letter makes Escape worthless.
    fireEvent.change(input, { target: { value: 'gochuj' } })
    // Query the suggestion strip by its listbox role, not 'option' — the Diet
    // <select> also renders <option>s (role option), so a bare option query would
    // find those even when the ingredient strip is closed.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('never blocks a free-text name no list has heard of', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<RecipeForm mode="add" onSubmit={onSubmit} />)
    fireEvent.change(screen.getByPlaceholderText(/“Adobo”/i), {
      target: { value: 'Pinakbet' },
    })
    type(names()[0], 'kadyos')
    // Query the suggestion strip by its listbox role, not 'option' — the Diet
    // <select> also renders <option>s (role option), so a bare option query would
    // find those even when the ingredient strip is closed.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    fireEvent.submit(screen.getByRole('button', { name: /save this recipe/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0].ingredients[0].name).toBe('kadyos')
  })

  it('closes the strip once the name is complete, so nothing is pushed down', async () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    const input = names()[0]
    type(input, 'gochu')
    await screen.findByRole('option', { name: 'gochugaru' })
    fireEvent.change(input, { target: { value: 'gochugaru' } })
    // Query the suggestion strip by its listbox role, not 'option' — the Diet
    // <select> also renders <option>s (role option), so a bare option query would
    // find those even when the ingredient strip is closed.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('keeps Enter → amount working when nothing is highlighted', () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    const input = names()[0]
    type(input, 'gochu')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(
      screen.getAllByPlaceholderText(/1\/2 cup · a dash · to taste/i)[0],
    ).toHaveFocus()
  })
})

describe('RecipeForm amount unit chips', () => {
  const amounts = () =>
    screen.getAllByPlaceholderText(/1\/2 cup · a dash · to taste/i)

  it('offers no chips until a number is typed', () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('offers real AND folk units once a number is typed', () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    fireEvent.change(amounts()[0], { target: { value: '3' } })
    expect(screen.getByRole('button', { name: 'tbsp' })).toBeInTheDocument()
    // Folk units sit in the same strip at the same size — that's how the form
    // teaches that an imprecise amount is a welcome answer.
    expect(screen.getByRole('button', { name: 'soup spoon' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'pinch' })).toBeInTheDocument()
  })

  it('groups the chips by name, not by colour alone', () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    fireEvent.change(amounts()[0], { target: { value: '3' } })
    expect(screen.getByRole('group', { name: 'Measurements' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Rough amounts' })).toBeInTheDocument()
  })

  it('tapping a folk chip writes the pluralized amount', () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    fireEvent.change(amounts()[0], { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'soup spoon' }))
    expect(amounts()[0]).toHaveValue('3 soup spoons')
  })

  it('sends a chip-built folk amount as imprecise, never mathified', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<RecipeForm mode="add" onSubmit={onSubmit} />)
    fireEvent.change(screen.getByPlaceholderText(/“Adobo”/i), {
      target: { value: 'Adobo' },
    })
    fireEvent.change(screen.getAllByPlaceholderText(/e\.g\. soy sauce/i)[0], {
      target: { value: 'soy sauce' },
    })
    fireEvent.change(amounts()[0], { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'soup spoon' }))
    fireEvent.submit(screen.getByRole('button', { name: /save this recipe/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0].ingredients[0]).toMatchObject({
      quantity_text: '3 soup spoons',
      quantity_type: 'imprecise',
    })
  })

  it('withdraws the chips once a unit is there', () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    fireEvent.change(amounts()[0], { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'cup' }))
    expect(amounts()[0]).toHaveValue('3 cups')
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('never overwrites a unit the user typed themselves', () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    fireEvent.change(amounts()[0], { target: { value: 'a good splash' } })
    // No strip at all in this state — the user's own words are the answer.
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    expect(amounts()[0]).toHaveValue('a good splash')
  })

  it('returns focus to the amount field after a chip is used', () => {
    // The strip unmounts on pick; a chip that held focus would drop it to <body>
    // and strand a keyboard user mid-row.
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    fireEvent.change(amounts()[0], { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'pinch' }))
    expect(amounts()[0]).toHaveFocus()
  })

  it('is one tab stop, not sixteen', () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    fireEvent.change(amounts()[0], { target: { value: '3' } })
    const chips = screen
      .getByRole('toolbar')
      .querySelectorAll('button')
    const tabbable = [...chips].filter((c) => c.tabIndex === 0)
    expect(chips.length).toBeGreaterThan(10)
    expect(tabbable).toHaveLength(1)
  })
})

// The inline "Done — next ingredient" button was removed: it duplicated the
// "+ Add ingredient" button below, and Enter on the amount field already banks
// the row and opens the next one (covered by "Enter on an amount advances to the
// next ingredient" above). No inline confirm remains to test.

// An optional technique photo per step. Two things have to hold at once: it must
// be genuinely available (the feature exists because prose can't carry "fold it
// like this"), and it must not add weight to a steps section that already renders
// three rows and that one tester abandoned as too effortful.
describe('RecipeForm step photos', () => {
  beforeEach(() => {
    client.post.mockReset()
  })

  const stepPickers = () =>
    screen.getAllByLabelText(/add a photo of step \d+/i)

  it('offers a photo picker on every step, keyboard-reachable', () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    growTo3() // needs three rows to prove EVERY row; the default is now one
    const pickers = stepPickers()
    expect(pickers).toHaveLength(3)
    pickers.forEach((p) => {
      expect(p).toHaveAttribute('type', 'file')
      // Same regression guard as the cover: `hidden` (display:none) would drop
      // the input out of the tab order and make the photo unreachable by keyboard.
      expect(p).toHaveClass('sr-only')
    })
  })

  // The weight constraint, pinned. A dropzone per row would triple the visual
  // weight of the steps section for a field most steps will never use.
  it('rests as ONE quiet optional line, not a photo box per row', () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    // Small terra text, the same "optional extra" weight the form already uses
    // for "+ Add step" — not a bordered, shadowed sticker target like the cover.
    const line = screen.getAllByText('Add a photo of this step')[0]
    const affordance = line.closest('label')
    expect(affordance.className).toContain('text-terra')
    expect(affordance.className).toMatch(/text-\[12\.5px\]/)
    expect(affordance.className).not.toMatch(/shadow-\[0_/)
    expect(affordance.className).not.toContain('sticker')
    // And no thumbnail frame occupying space before a photo exists.
    expect(screen.queryByAltText(/photo for step/i)).toBeNull()
  })

  it('grows into a thumbnail with a remove control only once a photo exists', () => {
    render(
      <RecipeForm
        mode="edit"
        initialValues={{
          steps: [{ content: 'Pleat it.', photo_url: 'https://img.test/fold.jpg' }],
        }}
        onSubmit={() => {}}
      />,
    )
    expect(screen.getByAltText('Photo for step 1')).toHaveAttribute(
      'src',
      'https://img.test/fold.jpg',
    )
    expect(
      screen.getByRole('button', { name: /remove photo for step 1/i }),
    ).toBeInTheDocument()
    // The picker line withdraws — a row shows one state, never both.
    expect(screen.queryByLabelText(/add a photo of step 1/i)).toBeNull()
  })

  it('sends a step photo_url in the payload, and null when there is none', async () => {
    const pending = deferredUploads()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<RecipeForm mode="add" onSubmit={onSubmit} />)
    growTo3() // needs three rows to prove EVERY row; the default is now one

    fireEvent.change(screen.getByPlaceholderText('e.g. “Adobo”'), {
      target: { value: 'Dumplings' },
    })
    const contents = screen.getAllByPlaceholderText('Describe this step…')
    fireEvent.change(contents[0], { target: { value: 'Pleat the wrapper.' } })
    fireEvent.change(contents[1], { target: { value: 'Steam for 8 minutes.' } })

    pick(stepPickers()[0], jpeg('fold.jpg'))
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1))
    pending[0].resolve({ data: { url: 'https://img.test/fold.jpg' } })
    await waitFor(() =>
      expect(screen.getByAltText('Photo for step 1')).toBeInTheDocument(),
    )

    fireEvent.submit(screen.getByRole('button', { name: /save this recipe/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const { steps } = onSubmit.mock.calls[0][0]
    expect(steps[0]).toMatchObject({
      content: 'Pleat the wrapper.',
      photo_url: 'https://img.test/fold.jpg',
    })
    expect(steps[1].photo_url).toBeNull()
    // Client-side row identity must not leak into the API payload.
    expect(steps[0]).not.toHaveProperty('uid')
  })

  it('carries an existing step photo through an edit round-trip untouched', async () => {
    // PATCH replaces every step, so dropping photo_url here would erase a saved
    // photo on any plain text edit.
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <RecipeForm
        mode="edit"
        initialValues={{
          name: 'Dumplings',
          steps: [{ content: 'Pleat it.', photo_url: 'https://img.test/fold.jpg' }],
        }}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.submit(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0].steps[0].photo_url).toBe(
      'https://img.test/fold.jpg',
    )
  })

  it('removing a step photo clears only that step’s photo', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <RecipeForm
        mode="edit"
        initialValues={{
          name: 'Dumplings',
          steps: [
            { content: 'Pleat it.', photo_url: 'https://img.test/a.jpg' },
            { content: 'Steam it.', photo_url: 'https://img.test/b.jpg' },
          ],
        }}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: /remove photo for step 1/i }),
    )
    fireEvent.submit(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const { steps } = onSubmit.mock.calls[0][0]
    expect(steps[0].photo_url).toBeNull()
    expect(steps[1].photo_url).toBe('https://img.test/b.jpg')
  })
})

// The cover's race guard protected ONE upload. With N steps the guard has to be
// per-slot, or picking a photo for step 3 aborts and discards step 1's in-flight
// upload — a regression the single-counter version would introduce silently.
describe('RecipeForm step photos — per-step upload isolation', () => {
  beforeEach(() => {
    client.post.mockReset()
  })

  const stepPickers = () => screen.getAllByLabelText(/add a photo of step \d+/i)

  it('uploads for different steps run in parallel — neither aborts the other', async () => {
    deferredUploads()
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    growTo3() // needs three rows to prove EVERY row; the default is now one

    pick(stepPickers()[0], jpeg('one.jpg'))
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1))
    pick(stepPickers()[1], jpeg('two.jpg'))
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(2))

    // A single global ticket would have cancelled step 1's request here.
    expect(client.post.mock.calls[0][2].signal.aborted).toBe(false)
    expect(client.post.mock.calls[1][2].signal.aborted).toBe(false)
  })

  it('lands each photo on the step it was picked for, whatever the order', async () => {
    const pending = deferredUploads()
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    growTo3() // needs three rows to prove EVERY row; the default is now one

    pick(stepPickers()[0], jpeg('one.jpg'))
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1))
    pick(stepPickers()[1], jpeg('two.jpg'))
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(2))

    // Step 2 answers first; step 1's slower upload must still find its own row.
    pending[1].resolve({ data: { url: 'https://img.test/two.jpg' } })
    await act(async () => {
      pending[0].resolve({ data: { url: 'https://img.test/one.jpg' } })
    })

    expect(screen.getByAltText('Photo for step 1')).toHaveAttribute(
      'src',
      'https://img.test/one.jpg',
    )
    expect(screen.getByAltText('Photo for step 2')).toHaveAttribute(
      'src',
      'https://img.test/two.jpg',
    )
  })

  it('a re-pick of the SAME step still supersedes the one before it', async () => {
    // Per-slot isolation must not lose the original guarantee within a slot.
    const pending = deferredUploads()
    render(<RecipeForm mode="add" onSubmit={() => {}} />)

    pick(stepPickers()[0], jpeg('a.jpg'))
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1))
    pick(stepPickers()[0], jpeg('b.jpg'))
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(2))
    expect(client.post.mock.calls[0][2].signal.aborted).toBe(true)

    pending[1].resolve({ data: { url: 'https://img.test/b.jpg' } })
    await waitFor(() =>
      expect(screen.getByAltText('Photo for step 1')).toHaveAttribute(
        'src',
        'https://img.test/b.jpg',
      ),
    )
    await act(async () => {
      pending[0].resolve({ data: { url: 'https://img.test/a.jpg' } })
    })
    expect(screen.getByAltText('Photo for step 1')).toHaveAttribute(
      'src',
      'https://img.test/b.jpg',
    )
  })

  it('a step upload does not abort or disturb the cover upload', async () => {
    deferredUploads()
    render(<RecipeForm mode="add" onSubmit={() => {}} />)

    pick(screen.getByLabelText('Add a cover photo'), jpeg('cover.jpg'))
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1))
    pick(stepPickers()[0], jpeg('step.jpg'))
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(2))

    expect(client.post.mock.calls[0][2].signal.aborted).toBe(false)
    // The cover's own busy state is still running, not cleared by the step's
    // pick. Scoped to the cover's own target — "Uploading…" now legitimately
    // appears on the step too, so a bare text query would be ambiguous.
    const coverTarget = screen
      .getByLabelText('Add a cover photo')
      .closest('label')
    expect(coverTarget).toHaveAttribute('aria-busy', 'true')
    expect(coverTarget).toHaveTextContent('Uploading…')
  })

  it('shows progress and failure only on the step that was picked', async () => {
    const pending = deferredUploads()
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    growTo3() // needs three rows to prove EVERY row; the default is now one

    pick(stepPickers()[0], jpeg('one.jpg'))
    await waitFor(() =>
      expect(screen.getAllByText('Uploading…')).toHaveLength(1),
    )
    // Rows 2 and 3 still rest at the quiet default.
    expect(screen.getAllByText('Add a photo of this step')).toHaveLength(2)

    pending[0].reject(new Error('boom'))
    await waitFor(() =>
      expect(screen.getAllByText(/photo upload failed/i)).toHaveLength(1),
    )
  })

  it('a photo still in flight cannot land on a step that was deleted', async () => {
    const pending = deferredUploads()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<RecipeForm mode="add" onSubmit={onSubmit} />)
    growTo3() // needs three rows to prove EVERY row; the default is now one

    const contents = screen.getAllByPlaceholderText('Describe this step…')
    fireEvent.change(contents[0], { target: { value: 'Pleat it.' } })
    fireEvent.change(contents[1], { target: { value: 'Steam it.' } })

    pick(stepPickers()[0], jpeg('one.jpg'))
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1))
    // Delete step 1 while its photo is still uploading. Step 2 shifts up into
    // index 0 — an index-keyed upload would drop step 1's photo onto it.
    fireEvent.click(screen.getByRole('button', { name: /remove step 1/i }))
    await act(async () => {
      pending[0].resolve({ data: { url: 'https://img.test/one.jpg' } })
    })

    expect(screen.queryByAltText(/photo for step/i)).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('e.g. “Adobo”'), {
      target: { value: 'Dumplings' },
    })
    fireEvent.submit(screen.getByRole('button', { name: /save this recipe/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const { steps } = onSubmit.mock.calls[0][0]
    expect(steps[0].content).toBe('Steam it.')
    expect(steps[0].photo_url).toBeNull()
  })
})

// Dictation on the long-text fields. Typing was the most tedious part of the app
// across both rounds of testing and one tester abandoned the add flow partway
// through it, so the fields needing whole sentences get a mic. The unit-level
// behaviour lives in DictateButton.test.jsx; these pin WHICH fields have one and
// that nothing here claims audio the product doesn't have.
describe('RecipeForm dictation', () => {
  // jsdom has no Web Speech API, so a fake constructor goes on `window` — that's
  // what the seam in lib/speech.js is for. Every assertion below therefore also
  // depends on the seam reading `window` lazily rather than at import.
  class FakeRecognition {
    start() {}
    stop() {}
    abort() {}
  }

  function supported() {
    window.SpeechRecognition = FakeRecognition
  }

  afterEach(() => {
    delete window.SpeechRecognition
  })

  it('offers a mic on every text field: the dish, the story, and each step field', () => {
    supported()
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    growTo3() // needs three rows to prove EVERY row; the default is now one
    expect(
      screen.getByRole('button', { name: 'Dictate the dish name' }),
    ).toBeInTheDocument()
    // The detail fields gained mics too — every text field can be spoken now.
    expect(
      screen.getByRole('button', { name: 'Dictate who this came from' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Dictate the cuisine' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Dictate the description' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Dictate the story' }),
    ).toBeInTheDocument()
    // Three starting step rows, each with a step mic and a note mic.
    expect(screen.getAllByRole('button', { name: /^Dictate step \d+$/ })).toHaveLength(3)
    expect(
      screen.getAllByRole('button', { name: /^Dictate the note on step \d+$/ }),
    ).toHaveLength(3)
  })

  it('offers a mic on the ingredient name and amount in every row', () => {
    // Every text field can be spoken, ingredient rows included: the name and the
    // amount each carry a mic alongside their autosuggest / unit-chip helpers.
    supported()
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    growTo3() // needs three rows to prove EVERY row; the default is now one
    const rows = document.querySelectorAll('[data-ingredient-row]')
    expect(rows).toHaveLength(3)
    for (let i = 0; i < rows.length; i++) {
      // aria-pressed is the mic's own signature; two per row = one for the name,
      // one for the amount, scoped to this row's subtree.
      expect(rows[i].querySelectorAll('button[aria-pressed]')).toHaveLength(2)
    }
    expect(
      screen.getAllByRole('button', { name: /^Dictate ingredient \d+$/ }),
    ).toHaveLength(3)
    expect(
      screen.getAllByRole('button', { name: /^Dictate the amount for ingredient \d+$/ }),
    ).toHaveLength(3)
  })

  it('renders no mic at all in a browser without support', () => {
    // Firefox. Not a disabled control, not an error — the form is simply the form
    // it was before, and typing is unaffected.
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    expect(screen.queryByRole('button', { name: /dictate/i })).not.toBeInTheDocument()
  })

  it('keeps the visible labels attached to the fields the mics sit in', () => {
    // The mic forced these out of their <label> wrappers (a label around the
    // button and its status line would fold "Dictating…" into the input's own
    // accessible name), so htmlFor has to carry what nesting used to.
    supported()
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    growTo3() // needs three rows to prove EVERY row; the default is now one
    expect(screen.getByLabelText('Dish name')).toHaveAttribute(
      'placeholder',
      'e.g. “Adobo”',
    )
    expect(screen.getAllByLabelText('What to do')).toHaveLength(3)
    expect(
      screen.getAllByLabelText('A note on this step (optional)'),
    ).toHaveLength(3)
    // No source named → the self-authored story prompt.
    expect(
      screen.getByLabelText(/what makes it yours \(optional\)/i),
    ).toHaveAttribute('placeholder', 'I started making this the winter I moved out…')
  })

  it('does not submit the form when a mic is tapped', () => {
    // These sit inside the recipe <form>; a default-type button would save a
    // half-written recipe on the first tap.
    supported()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<RecipeForm mode="add" onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dictate the story' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('advances focus field to field as each dictation finishes', () => {
    // The point of the whole feature: speak a field, pause, and the cursor is
    // already on the next one — a recipe fillable with a mic tap between fields
    // and no tapping into them. A driveable recognizer replaces the no-op fake.
    class Driveable {
      static instances = []
      constructor() {
        Driveable.instances.push(this)
      }
      start() {}
      stop() {}
      abort() {}
      emit(final) {
        act(() =>
          this.onresult({
            resultIndex: 0,
            results: [Object.assign([{ transcript: final }], { isFinal: true })],
          }),
        )
      }
      finish() {
        act(() => this.onend())
      }
    }
    window.SpeechRecognition = Driveable
    const latest = () => Driveable.instances[Driveable.instances.length - 1]
    const speakInto = (field) => {
      fireEvent.click(field)
      latest().emit('spoken')
      latest().finish()
    }

    render(<RecipeForm mode="add" onSubmit={() => {}} />)

    // Dish name → source.
    speakInto(screen.getByRole('button', { name: 'Dictate the dish name' }))
    expect(screen.getByLabelText('Passed down from (optional)')).toHaveFocus()

    // Source → cuisine (Servings, being numeric, is skipped in the voice chain).
    speakInto(screen.getByRole('button', { name: 'Dictate who this came from' }))
    expect(screen.getByLabelText('Cuisine')).toHaveFocus()

    // Cuisine → description → story.
    speakInto(screen.getByRole('button', { name: 'Dictate the cuisine' }))
    expect(screen.getByLabelText('Description')).toHaveFocus()
    speakInto(screen.getByRole('button', { name: 'Dictate the description' }))
    // The self-authored story prompt (no source named at this point... but we did
    // dictate "spoken" into source, so the inherited prompt is showing).
    expect(screen.getByLabelText(/story \(optional\)/i)).toHaveFocus()

    // Story → the first ingredient's name.
    speakInto(screen.getByRole('button', { name: 'Dictate the story' }))
    expect(screen.getAllByLabelText('Ingredient')[0]).toHaveFocus()

    // Ingredient name → its amount.
    speakInto(screen.getByRole('button', { name: 'Dictate ingredient 1' }))
    expect(
      screen.getAllByPlaceholderText(/1\/2 cup · a dash · to taste/i)[0],
    ).toHaveFocus()
  })

  it('a stray mic tap that captures nothing does not move the cursor', () => {
    // The gate, at the form level: focus must not lurch to the next field when a
    // session ends empty. Start on the dish name and confirm it stays there.
    class Driveable {
      static instances = []
      constructor() {
        Driveable.instances.push(this)
      }
      start() {}
      stop() {}
      abort() {}
      finish() {
        act(() => this.onend())
      }
    }
    window.SpeechRecognition = Driveable
    const latest = () => Driveable.instances[Driveable.instances.length - 1]

    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    const nameMic = screen.getByRole('button', { name: 'Dictate the dish name' })
    fireEvent.click(nameMic)
    latest().finish()
    expect(screen.getByLabelText('Passed down from (optional)')).not.toHaveFocus()
  })

  it('claims no recording anywhere on the form, in either mic state', () => {
    // POSITIONING.md bans copy implying audio outright, and a mic button is the
    // most tempting place in the app to reintroduce it. This is the assertion that
    // stops a future change from doing so.
    supported()
    const { container } = render(<RecipeForm mode="add" onSubmit={() => {}} />)
    const banned = /record|recording|\bvoice\b|audio|in their own words|listen/i
    const visibleAndNamed = () => {
      const attrs = ['aria-label', 'title', 'alt', 'placeholder']
      const named = [...container.querySelectorAll('*')].flatMap((el) =>
        attrs.map((a) => el.getAttribute(a) || ''),
      )
      return [container.textContent || '', ...named].join(' ')
    }
    expect(visibleAndNamed()).not.toMatch(banned)
    fireEvent.click(screen.getByRole('button', { name: 'Dictate step 1' }))
    expect(screen.getByText('Dictating…')).toBeInTheDocument()
    expect(visibleAndNamed()).not.toMatch(banned)
  })
})

describe('RecipeForm story prompt', () => {
  // The story prompt now follows the optional "Passed down from" field rather than
  // a doorway-chosen prop: name someone and it asks about them; leave it blank and
  // the recipe is the user's own.
  const sourceField = () => screen.getByPlaceholderText(/lola remedios/i)

  it('starts self-authored — no "who taught you" when no source is named', () => {
    // Asking a self-authored cook who taught them is the kind of thing that makes
    // the app feel like it isn't listening — testers noticed.
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    expect(screen.getByText(/what makes it yours \(optional\)/i)).toBeInTheDocument()
    expect(screen.queryByText(/who taught you/i)).not.toBeInTheDocument()
  })

  it('asks about the person once a source name is filled in', () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    fireEvent.change(sourceField(), { target: { value: 'Lola' } })
    expect(screen.getByText(/their story \(optional\)/i)).toBeInTheDocument()
    expect(screen.getByText(/who taught you/i)).toBeInTheDocument()
  })

  it('seeds the source field (and the inherited prompt) from initialValues', () => {
    // A paste that detected a source pre-fills the field, so the prompt arrives
    // already in the inherited variant.
    render(
      <RecipeForm
        mode="add"
        initialValues={{ sourceName: 'Lola' }}
        onSubmit={() => {}}
      />,
    )
    expect(sourceField()).toHaveValue('Lola')
    expect(screen.getByText(/their story \(optional\)/i)).toBeInTheDocument()
  })

  it('marks the story optional so nobody stalls on it', () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    expect(screen.getByText(/what makes it yours \(optional\)/i)).toBeInTheDocument()
  })
})

describe('RecipeForm attribution is not silently dropped', () => {
  const sourceField = () => screen.getByPlaceholderText(/lola remedios/i)

  it('hides the name-only shortcut once a source is typed', () => {
    // The "just keep the name" shortcut posts name+visibility only — no origin.
    // A typed byline is real content, so the shortcut must step aside (the full
    // save, which carries the origin, is used instead). Otherwise "from Lola"
    // would vanish on the one path built to avoid losing typed data.
    render(<RecipeForm mode="add" onQuickSave={() => {}} onSubmit={() => {}} />)
    fireEvent.change(screen.getByLabelText('Dish name'), {
      target: { value: 'Adobo' },
    })
    expect(screen.getByText(/just save the name for now/i)).toBeInTheDocument()
    fireEvent.change(sourceField(), { target: { value: 'Lola' } })
    expect(screen.queryByText(/just save the name for now/i)).not.toBeInTheDocument()
  })

  it('carries a stored place/year through when only the name is edited', async () => {
    // The form shows only the name, but a recipe may carry place/year from the
    // older multi-field door. Editing the name must rebuild the byline WITH the
    // unshown place/year, not flatten it to just the name.
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <RecipeForm
        mode="edit"
        initialValues={{
          name: 'Adobo',
          sourceName: 'Tita Bing',
          sourceParts: { name: 'Tita Bing', place: 'Manila', year: '1985' },
        }}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.change(sourceField(), { target: { value: 'Tita Bea' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const origin = onSubmit.mock.calls[0][0].origin
    expect(origin).toMatchObject({ name: 'Tita Bea', place: 'Manila', year: '1985' })
  })

  it('omits origin entirely when the source name is untouched on edit', async () => {
    // A scalar-only edit shouldn't send origin at all, so the stored byline
    // (place/year included) is left exactly as it was.
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <RecipeForm
        mode="edit"
        initialValues={{
          name: 'Adobo',
          sourceName: 'Tita Bing',
          sourceParts: { name: 'Tita Bing', place: 'Manila', year: '1985' },
        }}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.change(screen.getByLabelText('Dish name'), {
      target: { value: 'Chicken Adobo' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect('origin' in onSubmit.mock.calls[0][0]).toBe(false)
  })

  it('carries diet and prep_time through an edit round-trip untouched', async () => {
    // Regression: the form ALWAYS sends prep_time_minutes + diet, so an edit that
    // doesn't see the saved values back would null them (silent data loss). Seeded
    // from initialValues, a scalar-only edit must resend them unchanged. (EditRecipe
    // is responsible for seeding them from the fetched recipe — see its initialValues.)
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <RecipeForm
        mode="edit"
        initialValues={{
          name: 'Adobo',
          prep_time_minutes: 45,
          diet: 'Vegetarian',
        }}
        onSubmit={onSubmit}
      />,
    )
    // Edit something unrelated, then save.
    fireEvent.change(screen.getByLabelText('Dish name'), {
      target: { value: 'Chicken Adobo' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const payload = onSubmit.mock.calls[0][0]
    expect(payload.prep_time_minutes).toBe(45)
    expect(payload.diet).toBe('Vegetarian')
  })
})
