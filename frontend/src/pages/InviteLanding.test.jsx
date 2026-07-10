import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../api/lineage', () => ({
  getInvitePreview: vi.fn(() => Promise.resolve({ data: {
    recipe_id: 5, name: 'Lola’s Adobo', from_name: 'Yoko Matsuda',
    origin_attribution: 'Lola Remedios · Cebu', story: 'Every Sunday.',
    growth_stage: 'sprout', growth_vitality: 'bare', cover_photo_url: null,
  } })),
}))
import InviteLanding from './InviteLanding'

beforeEach(() => localStorage.clear())

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/invite/:token" element={<InviteLanding />} /></Routes>
    </MemoryRouter>
  )
}

describe('InviteLanding (soft wall)', () => {
  it('previews name, who-it-from, and story, then invites signup', async () => {
    renderAt('/invite/abc123')
    await waitFor(() => expect(screen.getByText('Lola’s Adobo')).toBeInTheDocument())
    expect(screen.getByText(/Yoko Matsuda/)).toBeInTheDocument()
    expect(screen.getByText(/Every Sunday\./)).toBeInTheDocument()
    // the gate: a link/button to sign up carrying the token
    const cta = screen.getByRole('link', { name: /sign up|join|keep this/i })
    expect(cta.getAttribute('href')).toContain('invite=abc123')
  })
})
