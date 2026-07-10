import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import Wordmark from './Wordmark'

describe('Wordmark', () => {
  it('renders the handwritten issei mark (no period)', () => {
    const { container } = render(<Wordmark />)
    const el = container.firstChild
    expect(el.textContent).toBe('issei')
    expect(el.className).toContain('font-hand')
  })
  it('muted variant still renders issei', () => {
    const { container } = render(<Wordmark muted />)
    expect(container.firstChild.textContent).toBe('issei')
    expect(container.firstChild.className).toContain('font-hand')
  })
})
