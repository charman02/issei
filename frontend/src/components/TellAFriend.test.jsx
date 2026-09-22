import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TellAFriend from './TellAFriend'
import { referralShareText } from '../lib/referralMessage'

// The share action, and specifically the FOUR outcomes of handing text to the operating system.
// Three of them were bugs shipped once in `HandoffInvite` (#102), which is why the logic now lives
// in `lib/shareLink` and why this file re-pins them at the component boundary: the lib being right
// does not stop a caller from mapping its outcomes to the wrong confirmation.

const originalShare = navigator.share
const originalClipboard = navigator.clipboard

function stubShare(impl) {
  Object.defineProperty(navigator, 'share', { value: impl, configurable: true, writable: true })
}
function stubClipboard(impl) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: impl },
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  vi.useRealTimers()
})

afterEach(() => {
  Object.defineProperty(navigator, 'share', {
    value: originalShare,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(navigator, 'clipboard', {
    value: originalClipboard,
    configurable: true,
    writable: true,
  })
})

describe('TellAFriend', () => {
  it('sends the MESSAGE AND THE LINK together, never a bare URL', async () => {
    // The sentence is the entire reason this is not just a link: it is what tells a stranger what
    // they have been sent. `HandoffInvite`'s clipboard path used to drop it, so the sentence the
    // compose screen existed to write never left the app for any browser without a share sheet.
    const share = vi.fn().mockResolvedValue(undefined)
    stubShare(share)
    render(<TellAFriend />)
    fireEvent.click(screen.getByRole('button', { name: /tell a friend/i }))

    await waitFor(() => expect(share).toHaveBeenCalled())
    const { text } = share.mock.calls[0][0]
    expect(text).toBe(referralShareText())
    expect(text).toContain('https://issei.app')
    expect(text).toContain('Curious what your friends are cooking')
  })

  it('confirms after a real share', async () => {
    stubShare(vi.fn().mockResolvedValue(undefined))
    render(<TellAFriend />)
    fireEvent.click(screen.getByRole('button', { name: /tell a friend/i }))
    expect(await screen.findByRole('button', { name: /sent ✓/i })).toBeInTheDocument()
  })

  it('SAYS NOTHING when the share sheet is dismissed', async () => {
    // A cancelled sheet is not a failure. Confirming here would tell someone who had just decided
    // NOT to send that it went — and it must not silently fall through to the clipboard either,
    // which is how #102 flashed "Copied ✓" at exactly that person.
    const err = new Error('cancelled')
    err.name = 'AbortError'
    stubShare(vi.fn().mockRejectedValue(err))
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)

    render(<TellAFriend />)
    fireEvent.click(screen.getByRole('button', { name: /tell a friend/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /tell a friend/i })).toBeInTheDocument())
    expect(screen.queryByText(/copied/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/sent/i)).not.toBeInTheDocument()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to the clipboard when there is NO share sheet at all', async () => {
    // Every desktop Firefox. The confirmation names the MESSAGE, not the link, because that is what
    // was actually taken.
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true, writable: true })
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)

    render(<TellAFriend />)
    fireEvent.click(screen.getByRole('button', { name: /tell a friend/i }))

    expect(await screen.findByRole('button', { name: /message copied ✓/i })).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith(referralShareText())
  })

  it('falls back to the clipboard on a REAL share rejection, unlike a cancellation', async () => {
    // Safari rejects with NotAllowedError outside a user gesture. That one is a genuine failure and
    // the clipboard is the right answer — the distinction from AbortError is the whole point.
    const err = new Error('not allowed')
    err.name = 'NotAllowedError'
    stubShare(vi.fn().mockRejectedValue(err))
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)

    render(<TellAFriend />)
    fireEvent.click(screen.getByRole('button', { name: /tell a friend/i }))

    expect(await screen.findByRole('button', { name: /message copied ✓/i })).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith(referralShareText())
  })

  it('offers the bare address when even the clipboard refuses', async () => {
    // The last resort has to leave them something they can act on, so it names the URL in words.
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true, writable: true })
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')))

    render(<TellAFriend />)
    fireEvent.click(screen.getByRole('button', { name: /tell a friend/i }))

    expect(await screen.findByText(/issei\.app/)).toBeInTheDocument()
  })

  it('tells the sender what the recipient will see', async () => {
    // A share button that hides its own payload gets opened once to check and never again.
    render(<TellAFriend />)
    expect(screen.getByText(/the link opens with what it is/i)).toBeInTheDocument()
  })

  it('makes no claim the product cannot back (POSITIONING)', () => {
    const { container } = render(<TellAFriend />)
    const text = container.textContent + referralShareText()
    for (const pattern of [
      /voice/i,
      /recording/i,
      /\baudio\b/i,
      /listen/i,
      /in (their|your|his|her)( own)? words/i,
      /family tree/i,
      /lineage/i,
      /make it yours/i,
      /\bremix/i,
      /expires?\b/i,
    ]) {
      expect(text).not.toMatch(pattern)
    }
  })
})
