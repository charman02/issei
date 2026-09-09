import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import RecipeCard from './RecipeCard'

// The title/byline layout has now been changed twice — a fixed two-line title slot shipped in
// 80385fa so two cards' bylines stayed on the same line as each other, and the owner rejected it
// on sight: a one-line dish name got a blank line under it and then the name, which reads as a
// layout mistake rather than as alignment. Nothing pinned either version, which is how it flipped
// unnoticed. This pins the version that won.
describe('RecipeCard — the title/byline layout (settled twice, so: a test)', () => {
  const recipe = { id: 1, name: 'Adobo', origin_attribution: 'Lola' }

  it('does NOT reserve a second title line — the byline sits directly under the title', () => {
    render(<RecipeCard recipe={recipe} onClick={() => {}} />)
    const title = screen.getByText('Adobo')
    // A reserved slot is what put an empty line under a short name. The PHOTO stays level
    // regardless — it's in its own block above the text — which was the actual complaint.
    expect(title.className).not.toMatch(/min-h-/)
    // Two lines is still the ceiling: a third would push card heights visibly apart again.
    expect(title.className).toMatch(/line-clamp-2/)
  })

  it('keeps a very long source name to one line', () => {
    // A source name can be 120 characters (#100). It is a NAME, so one line + ellipsis rather
    // than the title's two-line clamp.
    render(
      <RecipeCard recipe={{ ...recipe, origin_attribution: 'L'.repeat(120) }} onClick={() => {}} />,
    )
    expect(screen.getByText('L'.repeat(120)).closest('p').className).toMatch(/truncate/)
  })
})

describe('RecipeCard', () => {
  it('renders the recipe name and a byline', () => {
    render(
      <RecipeCard
        recipe={{ id: 1, name: 'Adobo', author_full_name: 'Yoko M.' }}
        onClick={() => {}}
      />,
    )
    expect(screen.getByText('Adobo')).toBeInTheDocument()
    expect(screen.getByText('Yoko M.')).toBeInTheDocument()
  })

  it('shows "from {source}" when there is a recorded origin', () => {
    render(
      <RecipeCard
        recipe={{
          id: 1,
          name: 'Adobo',
          author_full_name: 'Yoko M.',
          origin_attribution: 'Lola Remedios · Cebu',
        }}
        onClick={() => {}}
      />,
    )
    expect(screen.getByText(/^from$/i)).toBeInTheDocument()
    expect(screen.getByText('Lola Remedios')).toBeInTheDocument()
  })

  // "kept by" was app jargon testers couldn't decode; with no recorded origin the
  // byline is now just the name, which reads as attribution on its own.
  it('falls back to the bare author name — no "kept by" verb — with no origin', () => {
    render(
      <RecipeCard
        recipe={{ id: 2, name: 'Fried Rice', author_full_name: 'Yoko M.' }}
        onClick={() => {}}
      />,
    )
    expect(screen.getByText('Yoko M.')).toBeInTheDocument()
    expect(screen.queryByText(/kept by/i)).not.toBeInTheDocument()
  })
})
