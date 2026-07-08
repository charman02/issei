import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../api/client', () => ({ default: { get: vi.fn(() => Promise.resolve({ data: { id: 1, name: 'Adobo', author_full_name: 'Yoko M.', ingredients: [], steps: [], source: 'Lola', notes: 'cane vinegar' } })) } }))
vi.mock('../api/lineage', () => ({ remixRecipe: vi.fn(() => Promise.resolve({ data: { id: 99 } })) }))
vi.mock('../components/RecipeForm', () => ({
  // Stub emits an EDITED name alongside ingredients/steps, so the test proves the
  // remixer's scalar edits are forwarded (not silently dropped).
  default: ({ onSubmit, initialValues }) => (
    <div>
      <span>notes:{initialValues.notes}</span>
      <button onClick={() => onSubmit({ name: 'My Adobo', notes: 'less salt', ingredients: [{ name: 'lard', position: 1 }], steps: [] })}>submit-form</button>
    </div>
  ),
}))
import { remixRecipe } from '../api/lineage'
import RemixRecipe from './RemixRecipe'

beforeEach(() => remixRecipe.mockClear())

describe('RemixRecipe', () => {
  it('seeds notes from parent, forwards edited scalars, and remixes with the prompt answer', async () => {
    render(
      <MemoryRouter initialEntries={['/recipes/1/remix']}>
        <Routes><Route path="/recipes/:id/remix" element={<RemixRecipe />} /><Route path="/recipes/:id" element={<div>child page</div>} /></Routes>
      </MemoryRouter>
    )
    expect(await screen.findByText(/notes:cane vinegar/)).toBeInTheDocument()
    expect(screen.getByText(/branching from Yoko M\./i)).toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText(/what makes yours yours/i), 'Mom used lard')
    await userEvent.click(screen.getByRole('button', { name: /submit-form/i }))
    expect(remixRecipe).toHaveBeenCalledTimes(1)
    const [calledId, body] = remixRecipe.mock.calls[0]
    expect(calledId).toBe('1')
    // edited scalars forwarded (not dropped) + prompt answer + ingredients
    expect(body.name).toBe('My Adobo')
    expect(body.notes).toBe('less salt')
    expect(body.prompt_answer).toBe('Mom used lard')
    expect(body.ingredients).toEqual([{ name: 'lard', position: 1 }])
  })
})
