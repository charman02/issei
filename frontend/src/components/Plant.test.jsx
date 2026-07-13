import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import Plant from './Plant'

describe('Plant', () => {
  it('renders the requested stage + vitality as data attrs', () => {
    const { container } = render(<Plant stage="tree" vitality="fruiting" />)
    const svg = container.querySelector('svg')
    expect(svg.getAttribute('data-stage')).toBe('tree')
    expect(svg.getAttribute('data-vitality')).toBe('fruiting')
  })
  it('a bare seed renders no fruit/blossom accents', () => {
    const { container } = render(<Plant stage="seed" vitality="bare" />)
    expect(container.querySelectorAll('[data-accent]').length).toBe(0)
  })
  it('a fruiting tree renders fruit accents', () => {
    const { container } = render(<Plant stage="tree" vitality="fruiting" />)
    expect(
      container.querySelectorAll('[data-accent="fruit"]').length,
    ).toBeGreaterThan(0)
  })
  it('seed ignores vitality (no accents even if fruiting passed)', () => {
    const { container } = render(<Plant stage="seed" vitality="fruiting" />)
    expect(container.querySelectorAll('[data-accent]').length).toBe(0)
  })
})
