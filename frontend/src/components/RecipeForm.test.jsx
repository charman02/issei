import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import RecipeForm from './RecipeForm'

vi.mock('../api/client', () => ({ default: { post: vi.fn() } }))

describe('RecipeForm slots', () => {
  it('renders a custom submit label and beforeSubmitSlot', () => {
    render(<RecipeForm mode="edit" submitLabel="Make it mine" beforeSubmitSlot={<div>slot-here</div>} onSubmit={() => {}} />)
    expect(screen.getByText('slot-here')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /make it mine/i })).toBeInTheDocument()
  })

  it('falls back to the default label when submitLabel is not provided', () => {
    render(<RecipeForm mode="edit" onSubmit={() => {}} />)
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
  })

  it('uses the add-mode default label when no submitLabel and mode is add', () => {
    render(<RecipeForm mode="add" onSubmit={() => {}} />)
    expect(screen.getByRole('button', { name: /keep this recipe/i })).toBeInTheDocument()
  })
})
