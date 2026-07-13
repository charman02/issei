import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RecipeForm from './RecipeForm'

vi.mock('../api/client', () => ({ default: { post: vi.fn() } }))

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
      screen.getByRole('button', { name: /keep this recipe/i }),
    ).toBeInTheDocument()
  })
})

describe('RecipeForm voice-notes', () => {
  it('sends a per-step voice_note in the submitted payload', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<RecipeForm mode="add" onSubmit={onSubmit} />)

    fireEvent.change(
      screen.getByPlaceholderText('Name the dish — e.g. “Adobo”'),
      {
        target: { value: 'Adobo' },
      },
    )
    fireEvent.change(screen.getByPlaceholderText('Describe this step…'), {
      target: { value: 'Brown the meat' },
    })
    fireEvent.change(
      screen.getByPlaceholderText(
        'Their words for this step (optional) — "don\'t rush the onions"',
      ),
      { target: { value: "don't rush the onions" } },
    )

    fireEvent.click(screen.getByRole('button', { name: /keep this recipe/i }))

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

    fireEvent.change(
      screen.getByPlaceholderText('Name the dish — e.g. “Adobo”'),
      {
        target: { value: 'Adobo' },
      },
    )
    fireEvent.change(screen.getByPlaceholderText('Describe this step…'), {
      target: { value: 'Brown the meat' },
    })

    fireEvent.click(screen.getByRole('button', { name: /keep this recipe/i }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const payload = onSubmit.mock.calls[0][0]
    expect(payload.steps[0].voice_note).toBeNull()
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
