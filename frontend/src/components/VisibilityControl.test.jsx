import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../api/lineage', () => ({
  setVisibility: vi.fn(() =>
    Promise.resolve({ data: { visibility: 'public' } }),
  ),
}))
import { setVisibility } from '../api/lineage'
import VisibilityControl from './VisibilityControl'

beforeEach(() => setVisibility.mockClear())

describe('VisibilityControl', () => {
  it('root private → publishes on toggle (no descendants, no confirm)', async () => {
    const onChange = vi.fn()
    render(
      <VisibilityControl
        recipe={{
          id: 5,
          parent_recipe_id: null,
          visibility: 'private',
          child_count: 0,
        }}
        onChange={onChange}
      />,
    )
    expect(screen.getByText(/private/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /make public/i }))
    expect(setVisibility).toHaveBeenCalledWith(5, 'public')
    expect(onChange).toHaveBeenCalledWith('public')
  })

  it('root with descendants shows a confirm before publishing', async () => {
    render(
      <VisibilityControl
        recipe={{
          id: 6,
          parent_recipe_id: null,
          visibility: 'private',
          child_count: 3,
        }}
        onChange={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /make public/i }))
    // confirm surfaces the ripple; not yet sent
    expect(screen.getByText(/3 versions/i)).toBeInTheDocument()
    expect(setVisibility).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /^publish$/i }))
    expect(setVisibility).toHaveBeenCalledWith(6, 'public')
  })

  it('confirm pluralizes a single descendant correctly (1 version)', async () => {
    render(
      <VisibilityControl
        recipe={{
          id: 8,
          parent_recipe_id: null,
          visibility: 'private',
          child_count: 1,
        }}
        onChange={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /make public/i }))
    expect(screen.getByText(/\b1 version\b/i)).toBeInTheDocument()
    expect(screen.queryByText(/1 versions/i)).toBeNull()
  })

  it('public root shows a reversibility advisory note', () => {
    render(
      <VisibilityControl
        recipe={{
          id: 9,
          parent_recipe_id: null,
          visibility: 'public',
          child_count: 2,
        }}
        onChange={() => {}}
      />,
    )
    expect(
      screen.getByText(/versions already kept stay with their owners/i),
    ).toBeInTheDocument()
  })

  it('branch shows inherited status, no toggle', () => {
    render(
      <VisibilityControl
        recipe={{ id: 7, parent_recipe_id: 5, visibility: 'public' }}
        onChange={() => {}}
      />,
    )
    expect(screen.getByText(/inherited from the original/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows "Shared with N" when a private root has accepted grants', () => {
    render(
      <VisibilityControl
        recipe={{
          id: 1,
          parent_recipe_id: null,
          visibility: 'private',
          child_count: 0,
          shared_with_count: 2,
        }}
        onChange={() => {}}
      />,
    )
    expect(screen.getByText(/shared with 2/i)).toBeInTheDocument()
  })
})
