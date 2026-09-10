import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// `toUserMessage` stays REAL — the expired-link message it produces is the whole point of the
// test below, and mocking it would let a blank error back in while the suite stayed green.
vi.mock('../api/client', async () => ({
  ...(await vi.importActual('../api/client')),
  default: { post: vi.fn() },
}))
import client from '../api/client'
import ResetPassword from './ResetPassword'

function renderAt(search) {
  return render(
    <MemoryRouter initialEntries={[`/reset-password${search}`]}>
      <ResetPassword />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  client.post.mockReset()
})

// THE PAGE HAD NO TESTS AT ALL, and it is the one screen in the app reached from an email — which
// means it is routinely opened in a mail client's in-app browser with no history, where the
// browser's Back button is not the escape hatch it appears to be. Every state needs a way out.
describe('ResetPassword always offers a way out (found on prod, 2026-09-10)', () => {
  it('offers both exits when the link carries no token', async () => {
    // The state a prod check caught: the copy said "request a new one from the sign-in page" while
    // the page contained zero links and zero buttons, so the only way onward was editing the URL.
    renderAt('')

    expect(screen.getByRole('link', { name: /send me a new link/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute(
      'href',
      '/login',
    )
  })

  it('offers them on the form too, BEFORE anything has failed', async () => {
    // The expensive case. A token lives one hour, so someone opening the emailed link later has a
    // truthy token and gets the form — they only learn it is dead after typing a password twice.
    renderAt('?token=whatever')

    expect(screen.getByPlaceholderText('New password')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /send me a new link/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to sign in/i })).toBeInTheDocument()
  })

  it('still offers them after the server rejects an expired token', async () => {
    client.post.mockRejectedValue({ response: { status: 400, data: {} } })
    renderAt('?token=stale')

    fireEvent.change(screen.getByPlaceholderText('New password'), {
      target: { value: 'pw123456' },
    })
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), {
      target: { value: 'pw123456' },
    })
    fireEvent.submit(screen.getByPlaceholderText('New password').closest('form'))

    // The person most locked out is the one who must not be stranded.
    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /send me a new link/i })).toBeInTheDocument()
  })

  it('leads with the exit that actually solves the problem', async () => {
    // "Send me a new link" before "Back to sign in": on a page that just refused a reset link, the
    // second one only helps someone who has remembered their password after all.
    renderAt('')
    const links = screen.getAllByRole('link').map((a) => a.textContent)
    expect(links[0]).toMatch(/send me a new link/i)
  })

  it('never tells someone their link "expired" when it merely has no token', async () => {
    // Two different facts. A missing token is a truncated URL — nothing expired, and saying so
    // sends someone hunting for a newer email that may not exist. (POSITIONING: nothing in issei
    // expires, and the one thing that does — a reset token — must not have its word borrowed for
    // an unrelated failure.)
    renderAt('')
    expect(screen.queryByText(/expired/i)).toBeNull()
    expect(screen.getByText(/isn’t complete/i)).toBeInTheDocument()
  })
})
