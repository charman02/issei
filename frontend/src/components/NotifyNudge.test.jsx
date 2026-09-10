import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const push = vi.hoisted(() => ({
  pushAvailability: vi.fn(() => 'ready'),
  permissionState: vi.fn(() => 'default'),
  isSubscribedHere: vi.fn(async () => false),
  enable: vi.fn(async () => ({ ok: true })),
  primeVapidKey: vi.fn(async () => ({ public_key: 'k', configured: true })),
}))
vi.mock('../lib/push', () => push)

import NotifyNudge from './NotifyNudge'
import { setUser } from '../lib/currentUser'
import { loadPrefs } from '../lib/prefs'

const LINE = /get a nudge when your friends have been cooking/i

const signIn = () => setUser({ id: 1, first_name: 'Ana' })

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  push.pushAvailability.mockReturnValue('ready')
  push.permissionState.mockReturnValue('default')
  push.isSubscribedHere.mockResolvedValue(false)
  push.enable.mockResolvedValue({ ok: true })
})

describe('NotifyNudge (#89) — the one-time ask on Home', () => {
  it('shows for a signed-in user who could subscribe and has not been asked', async () => {
    signIn()
    render(<NotifyNudge />)
    expect(await screen.findByText(LINE)).toBeInTheDocument()
  })

  it('turns notifications on in one tap and then removes itself', async () => {
    // The whole reason it exists: the setting on the You page is three screens deep under two
    // other headings, and a notification setting nobody finds is a feature nobody has.
    signIn()
    const onDone = vi.fn()
    render(<NotifyNudge onDone={onDone} />)
    await screen.findByText(LINE)

    await userEvent.click(screen.getByRole('button', { name: /turn on notifications/i }))

    expect(push.enable).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText(LINE)).toBeNull())
    // Marked dismissed too, so a browser that later drops the subscription doesn't re-ask
    // someone who already said yes.
    expect(loadPrefs().notifyNudgeDismissed).toBe(true)
    expect(onDone).toHaveBeenCalled()
  })

  it('a refusal is explained in place, and the strip stays so it can be retried', async () => {
    signIn()
    push.enable.mockResolvedValue({ ok: false, reason: 'failed', message: "Couldn't turn on notifications." })
    render(<NotifyNudge />)
    await screen.findByText(LINE)

    await userEvent.click(screen.getByRole('button', { name: /turn on notifications/i }))

    expect(await screen.findByText(/couldn't turn on notifications/i)).toBeInTheDocument()
    expect(loadPrefs().notifyNudgeDismissed).toBeUndefined()
  })

  it('stays gone once dismissed', async () => {
    signIn()
    const { unmount } = render(<NotifyNudge />)
    await screen.findByText(LINE)
    await userEvent.click(screen.getByRole('button', { name: /not now/i }))
    unmount()

    render(<NotifyNudge />)
    await waitFor(() => expect(screen.queryByText(LINE)).toBeNull())
  })

  it('never appears after someone has already declined the browser prompt', async () => {
    // A person who said no has answered this question. Browsers also permanently block the prompt
    // after a denial, so the button could not work even if they changed their mind here.
    signIn()
    push.permissionState.mockReturnValue('denied')
    render(<NotifyNudge />)
    await waitFor(() => expect(screen.queryByText(LINE)).toBeNull())
  })

  it('DOES appear when permission was granted but nothing got subscribed', async () => {
    // The rescue case, and the reason the gate is 'denied' rather than 'not default'. Permission
    // granted with no subscription means something failed AFTER the prompt — the worker wasn't
    // active yet, or the POST didn't land. Hiding the strip there leaves someone permitted and
    // silent, with no visible way back, which is the exact failure it exists to prevent.
    signIn()
    push.permissionState.mockReturnValue('granted')
    push.isSubscribedHere.mockResolvedValue(false)
    render(<NotifyNudge />)
    expect(await screen.findByText(LINE)).toBeInTheDocument()
  })

  it('never appears once this device is already subscribed', async () => {
    signIn()
    push.isSubscribedHere.mockResolvedValue(true)
    render(<NotifyNudge />)
    await waitFor(() => expect(screen.queryByText(LINE)).toBeNull())
  })

  it('never appears on an iPhone in Safari — that instruction needs room, not a strip', async () => {
    // 'install-first' would make this a button that fails on tap. The You page says it properly.
    signIn()
    push.pushAvailability.mockReturnValue('install-first')
    render(<NotifyNudge />)
    await waitFor(() => expect(screen.queryByText(LINE)).toBeNull())
  })

  it('never appears for a signed-out reader', async () => {
    // /invite/:token is public — an anonymous reader has nothing to be notified about.
    render(<NotifyNudge />)
    await waitFor(() => expect(screen.queryByText(LINE)).toBeNull())
  })

  it('never says voice, audio, recording or listen', async () => {
    const BANNED = /record|recording|\bvoice\b|audio|in (their|your|his|her)( own)? words|listen/i
    signIn()
    render(<NotifyNudge />)
    await screen.findByText(LINE)
    expect(document.body.textContent).not.toMatch(BANNED)
  })
})
