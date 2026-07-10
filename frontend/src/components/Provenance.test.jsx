import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import Provenance from './Provenance'

describe('Provenance', () => {
  it('shows origin → keeper when there is a ghost ancestor', () => {
    const { container } = render(<Provenance recipe={{
      origin_attribution: 'Lola Remedios · Cebu · 1950s', author_full_name: 'Yoko Matsuda' }} />)
    const t = container.textContent
    expect(t).toContain('Lola Remedios')
    expect(t).toContain('Yoko Matsuda')
    expect(t).toContain('→')
  })
  it('shows just the keeper when there is no origin', () => {
    const { container } = render(<Provenance recipe={{ author_full_name: 'Yoko Matsuda' }} />)
    expect(container.textContent).toContain('Yoko Matsuda')
    expect(container.textContent).not.toContain('→')
  })
  it('renders nothing when there is neither', () => {
    const { container } = render(<Provenance recipe={{}} />)
    expect(container.firstChild).toBeNull()
  })
})
