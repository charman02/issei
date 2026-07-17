import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import LivingPlant from './LivingPlant'

describe('LivingPlant', () => {
  it('renders the requested stage form', () => {
    const { container } = render(<LivingPlant stage="tree" vitality="fruiting" />)
    expect(container.querySelector('.plant').getAttribute('data-stage')).toBe('tree')
  })
  it('a bare seed shows no active soul accents', () => {
    const { container } = render(<LivingPlant stage="seed" vitality="bare" />)
    expect(container.querySelectorAll('.blossom.on, .fruit.on').length).toBe(0)
  })
  it('a fruiting tree activates tree soul accents', () => {
    const { container } = render(<LivingPlant stage="tree" vitality="fruiting" />)
    expect(container.querySelectorAll('.soulTree.on').length).toBeGreaterThan(0)
  })
  it('tapping a blossom calls onPartTap with the part + quote index', () => {
    const onPartTap = vi.fn()
    const { container } = render(
      <LivingPlant stage="tree" vitality="fruiting" onPartTap={onPartTap} />,
    )
    const blossom = container.querySelector('[data-part="blossom"]')
    fireEvent.click(blossom)
    expect(onPartTap).toHaveBeenCalledWith('blossom', expect.any(Number))
  })
})
