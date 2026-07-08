import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../api/lineage', () => ({ setVisibility: vi.fn(() => Promise.resolve({ data: { visibility: 'public' } })) }))
import { setVisibility } from '../api/lineage'
import VisibilityControl from './VisibilityControl'

beforeEach(() => setVisibility.mockClear())

describe('VisibilityControl', () => {
  it('root private → publishes on toggle (no descendants, no confirm)', async () => {
    const onChange = vi.fn()
    render(<VisibilityControl recipe={{ id: 5, parent_recipe_id: null, visibility: 'private', child_count: 0 }} onChange={onChange} />)
    expect(screen.getByText(/private/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /make public/i }))
    expect(setVisibility).toHaveBeenCalledWith(5, 'public')
    expect(onChange).toHaveBeenCalledWith('public')
  })

  it('root with descendants shows a confirm before publishing', async () => {
    render(<VisibilityControl recipe={{ id: 6, parent_recipe_id: null, visibility: 'private', child_count: 3 }} onChange={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /make public/i }))
    // confirm surfaces the ripple; not yet sent
    expect(screen.getByText(/3 versions/i)).toBeInTheDocument()
    expect(setVisibility).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /^publish$/i }))
    expect(setVisibility).toHaveBeenCalledWith(6, 'public')
  })

  it('branch shows inherited status, no toggle', () => {
    render(<VisibilityControl recipe={{ id: 7, parent_recipe_id: 5, visibility: 'public' }} onChange={() => {}} />)
    expect(screen.getByText(/inherited from the original/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
