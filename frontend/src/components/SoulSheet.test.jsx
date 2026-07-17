import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import SoulSheet from './SoulSheet'

const recipe = {
  name: 'Adobo',
  story: 'Pour the vinegar, then walk away.',
  origin_attribution: 'Lola Remedios · Cebu',
  author_full_name: 'Lola Remedios',
  cook_count: 300,
  shared_with_count: 12,
  ingredients: [], ingredient_sections: [], steps: [
    { content: 'x', voice_note: "Don't crowd the pan.", position: 1 },
  ],
}

describe('SoulSheet', () => {
  it('is not visible when open is false', () => {
    const { container } = render(
      <SoulSheet open={false} panel={null} recipe={recipe} onClose={() => {}} />,
    )
    expect(container.querySelector('.sheet.open')).toBeFalsy()
  })
  it('fruit panel shows the real cooked + passed-on totals', () => {
    const { getByText } = render(
      <SoulSheet open panel={{ kind: 'fruit' }} recipe={recipe} onClose={() => {}} />,
    )
    expect(getByText(/300/)).toBeTruthy()
    expect(getByText(/12/)).toBeTruthy()
  })
  it('blossom panel shows the featured memory once (not duplicated in the list)', () => {
    const { getAllByText } = render(
      <SoulSheet open panel={{ kind: 'blossom', quoteIndex: 0 }} recipe={recipe} onClose={() => {}} />,
    )
    expect(getAllByText(/Pour the vinegar/).length).toBe(1)
  })
  it('calls onClose when the scrim is clicked', () => {
    const onClose = vi.fn()
    const { container } = render(
      <SoulSheet open panel={{ kind: 'base' }} recipe={recipe} onClose={onClose} />,
    )
    fireEvent.click(container.querySelector('.scrim'))
    expect(onClose).toHaveBeenCalled()
  })
})
