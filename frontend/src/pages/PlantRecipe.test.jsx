import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api/lineage', () => ({ plantRecipe: vi.fn(() => Promise.resolve({ data: { id: 42, name: 'Congee' } })) }))
// RecipeForm is heavy; stub it to immediately submit a minimal payload.
vi.mock('../components/RecipeForm', () => ({
  default: ({ onSubmit }) => (
    <button onClick={() => onSubmit({ name: 'Congee', ingredients: [], steps: [] })}>submit-form</button>
  ),
}))
import { plantRecipe } from '../api/lineage'
import PlantRecipe from './PlantRecipe'

beforeEach(() => plantRecipe.mockClear())

describe('PlantRecipe', () => {
  it('walks doorway → mine → form → planted, sending story not origin', async () => {
    render(<MemoryRouter><PlantRecipe /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: /a seed of your own/i }))
    await userEvent.type(screen.getByPlaceholderText(/what made this yours/i), 'I riffed on it for years')
    await userEvent.click(screen.getByRole('button', { name: /continue to the recipe/i }))
    await userEvent.click(screen.getByRole('button', { name: /submit-form/i }))
    expect(plantRecipe).toHaveBeenCalled()
    const payload = plantRecipe.mock.calls[0][0]
    expect(payload.origin ?? null).toBeNull()
    expect(payload.story).toBe('I riffed on it for years')
    expect(await screen.findByText(/is planted/i)).toBeInTheDocument()
  })
})
