import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../api/lineage', () => ({ handoffRecipe: vi.fn(() => Promise.resolve({ data: { id: 1, state: 'pending' } })) }))
import { handoffRecipe } from '../api/lineage'
import HandoffInvite from './HandoffInvite'

beforeEach(() => handoffRecipe.mockClear())

describe('HandoffInvite', () => {
  it('sends the handoff and calls onSent', async () => {
    const onSent = vi.fn()
    render(<HandoffInvite recipeId={7} onSent={onSent} onSkip={() => {}} />)
    await userEvent.type(screen.getByPlaceholderText(/email/i), 'mom@example.com')
    await userEvent.type(screen.getByPlaceholderText(/add the part/i), 'your adobo')
    await userEvent.click(screen.getByRole('button', { name: /pass it on/i }))
    expect(handoffRecipe).toHaveBeenCalledWith(7, { to_email: 'mom@example.com', note: 'your adobo' })
    expect(onSent).toHaveBeenCalled()
  })
  it('calls onSkip', async () => {
    const onSkip = vi.fn()
    render(<HandoffInvite recipeId={7} onSent={() => {}} onSkip={onSkip} />)
    await userEvent.click(screen.getByRole('button', { name: /skip/i }))
    expect(onSkip).toHaveBeenCalled()
  })
})
