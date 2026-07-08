import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api/lineage', () => ({ plantRecipe: vi.fn(() => Promise.resolve({ data: { id: 42, name: 'Congee' } })) }))
// RecipeForm is heavy; stub it to immediately submit a minimal payload. The
// stub echoes back initialValues.story (seeded from the doorway memory) so the
// test proves the form's story — not a separate override — is what's sent, and
// exposes initialValues so we can assert the mine-path seed is passed through.
let lastInitialValues = null
vi.mock('../components/RecipeForm', () => ({
  default: ({ onSubmit, initialValues = {} }) => {
    lastInitialValues = initialValues
    return (
      <button onClick={() => onSubmit({ name: 'Congee', ingredients: [], steps: [], story: initialValues.story || null })}>
        submit-form
      </button>
    )
  },
}))
import { plantRecipe } from '../api/lineage'
import PlantRecipe from './PlantRecipe'

beforeEach(() => {
  plantRecipe.mockClear()
  lastInitialValues = null
})

describe('PlantRecipe', () => {
  it('walks doorway → mine → form → planted, sending story not origin', async () => {
    render(<MemoryRouter><PlantRecipe /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: /a seed of your own/i }))
    await userEvent.type(screen.getByPlaceholderText(/what made this yours/i), 'I riffed on it for years')
    await userEvent.click(screen.getByRole('button', { name: /continue to the recipe/i }))

    // Mine path seeds RecipeForm's Story field with the doorway memory, so
    // there is a single, editable story input (no competing second field).
    expect(lastInitialValues).toEqual({ story: 'I riffed on it for years' })

    await userEvent.click(screen.getByRole('button', { name: /submit-form/i }))
    expect(plantRecipe).toHaveBeenCalled()
    const payload = plantRecipe.mock.calls[0][0]
    expect(payload.origin ?? null).toBeNull()
    // Story comes straight from the form payload (seeded from selfMemory),
    // with no silent override in handleFormSubmit.
    expect(payload.story).toBe('I riffed on it for years')
    expect(await screen.findByText(/is planted/i)).toBeInTheDocument()
  })

  it('mine path: an edited form story is authoritative (no doorway override)', async () => {
    render(<MemoryRouter><PlantRecipe /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: /a seed of your own/i }))
    await userEvent.type(screen.getByPlaceholderText(/what made this yours/i), 'seed memory')
    await userEvent.click(screen.getByRole('button', { name: /continue to the recipe/i }))

    // Simulate the user editing the pre-filled Story field in the real form:
    // the payload the form emits — not selfMemory — is what must be sent.
    lastInitialValues.story = 'a richer, edited story'
    await userEvent.click(screen.getByRole('button', { name: /submit-form/i }))

    const payload = plantRecipe.mock.calls[0][0]
    expect(payload.story).toBe('a richer, edited story')
    expect(payload.origin ?? null).toBeNull()
  })
})
