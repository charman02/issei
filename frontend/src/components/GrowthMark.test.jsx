import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import GrowthMark from './GrowthMark'

describe('GrowthMark', () => {
  it('renders the requested state with an accessible title', () => {
    const { container, getByTitle } = render(<GrowthMark state="sprout" />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-growth-state', 'sprout')
    expect(getByTitle(/sprout/i)).toBeInTheDocument()
  })
  it('falls back to seed for an unknown state', () => {
    const { container } = render(<GrowthMark state="bogus" />)
    expect(container.querySelector('svg')).toHaveAttribute('data-growth-state', 'seed')
  })
})
