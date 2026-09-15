import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const push = vi.hoisted(() => ({
  pushAvailability: vi.fn(() => 'ready'),
  isSubscribedHere: vi.fn(async () => false),
  enable: vi.fn(async () => ({ ok: true })),
  disable: vi.fn(async () => ({ ok: true })),
  primeVapidKey: vi.fn(async () => ({ public_key: 'k', configured: true })),
}))
vi.mock('../lib/push', () => push)

const api = vi.hoisted(() => ({ patch: vi.fn() }))
vi.mock('../api/client', () => ({
  default: api,
  toUserMessage: (_e, fallback) => fallback,
}))

import NotificationSettings, { inQuietHours } from './NotificationSettings'
import { setUser } from '../lib/currentUser'

function signIn(over = {}) {
  setUser({
    id: 1,
    first_name: 'Ana',
    timezone: 'Asia/Manila',
    notify_hour: 18,
    notify_posts: 'daily',
    notify_people: true,
    quiet_from: 22,
    quiet_to: 8,
    ...over,
  })
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  push.pushAvailability.mockReturnValue('ready')
  push.isSubscribedHere.mockResolvedValue(false)
  push.enable.mockResolvedValue({ ok: true })
  push.disable.mockResolvedValue({ ok: true })
  // PATCH /auth/me echoes the updated user back, as the real route does.
  api.patch.mockImplementation(async (_url, body) => {
    const current = JSON.parse(localStorage.getItem('issei_user') || '{}')
    return { data: { ...current, ...body } }
  })
})

describe('NotificationSettings (#89)', () => {
  it('turning the device on subscribes; turning it off unsubscribes', async () => {
    signIn()
    render(<NotificationSettings />)
    const deviceSwitch = await screen.findByRole('switch', { name: /notify me on this device/i })
    await waitFor(() => expect(deviceSwitch).not.toBeDisabled())

    await userEvent.click(deviceSwitch)
    expect(push.enable).toHaveBeenCalled()
    await waitFor(() => expect(deviceSwitch).toHaveAttribute('aria-checked', 'true'))

    await userEvent.click(deviceSwitch)
    expect(push.disable).toHaveBeenCalled()
  })

  it('shows a failure as a sentence instead of silently staying off', async () => {
    signIn()
    push.enable.mockResolvedValue({
      ok: false,
      reason: 'denied',
      message: 'Notifications are blocked for issei in your browser settings.',
    })
    render(<NotificationSettings />)
    const deviceSwitch = await screen.findByRole('switch', { name: /notify me on this device/i })
    await waitFor(() => expect(deviceSwitch).not.toBeDisabled())

    await userEvent.click(deviceSwitch)

    expect(await screen.findByText(/blocked for issei in your browser settings/i)).toBeInTheDocument()
    expect(deviceSwitch).toHaveAttribute('aria-checked', 'false')
  })

  it('tells an iPhone in Safari to install first, and offers no device switch', async () => {
    // Not "unsupported": Safari on iOS grants push only to a home-screen install, so the honest
    // answer is an instruction. A switch here would fail every time it was tapped.
    push.pushAvailability.mockReturnValue('install-first')
    signIn()
    render(<NotificationSettings />)

    expect(await screen.findByText(/add issei to your home screen first/i)).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: /on this device/i })).toBeNull()
    // The person's own preferences are still reachable — they follow the account to the install.
    expect(screen.getByRole('radio', { name: /once a day/i })).toBeInTheDocument()
  })

  it('saves a preference to the SERVER, not to localStorage', async () => {
    // The scheduler reads `users`. A preference kept only in the browser would look correct on
    // this screen forever while someone who switched notifications off kept receiving them.
    signIn()
    render(<NotificationSettings />)
    const never = await screen.findByRole('radio', { name: /never/i })

    await userEvent.click(never)

    expect(api.patch).toHaveBeenCalledWith('/auth/me', { notify_posts: 'off' })
    await waitFor(() => expect(never).toHaveAttribute('aria-checked', 'true'))
  })

  it('offers three cadences, because the daily nudge and an instant push are alternatives', async () => {
    // Two independent switches were the obvious build and they double-deliver: the 18:00 nudge
    // summarises exactly the posts an instant push already announced, so both on = four
    // notifications for three posts. One control, three answers.
    signIn()
    render(<NotificationSettings />)
    const group = await screen.findByRole('radiogroup', { name: /when friends post/i })
    const options = within(group).getAllByRole('radio')
    expect(options).toHaveLength(3)
    expect(options.map((o) => o.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ])
  })

  it('choosing "right away" saves the instant cadence', async () => {
    signIn()
    render(<NotificationSettings />)
    await userEvent.click(await screen.findByRole('radio', { name: /right away/i }))
    expect(api.patch).toHaveBeenCalledWith('/auth/me', { notify_posts: 'instant' })
  })

  it('only the DAILY cadence shows a nudge time, since only it has an hour', async () => {
    signIn({ notify_posts: 'instant' })
    render(<NotificationSettings />)
    await screen.findByRole('radio', { name: /right away/i })
    expect(screen.queryByLabelText('Nudge me at')).toBeNull()
  })

  it('quiet hours stay reachable with the nudge off, because they govern every push', async () => {
    // They used to live inside the daily-nudge branch, which was true when the nudge was the only
    // thing that could arrive. Now an ask, an arrival and a friend's post all respect them — so
    // hiding them here would take away the only control over EVERY notification from someone who
    // just didn't want a daily nudge.
    signIn({ notify_posts: 'off' })
    render(<NotificationSettings />)
    expect(await screen.findByLabelText('Quiet hours start')).toBeInTheDocument()
    expect(screen.getByLabelText('Quiet hours end')).toBeInTheDocument()
  })

  it('a cached user from an older build still renders the right cadence', async () => {
    // `reconcile()` refreshes the identity cache once per app start, so a user object written by a
    // build that predates the rename has `notify_prompt` and no `notify_posts`. Without the
    // fallback the control would render "Never" for one page load — and a tap would then SAVE it.
    setUser({ id: 1, first_name: 'Ana', notify_hour: 18, notify_prompt: true })
    render(<NotificationSettings />)
    expect(await screen.findByRole('radio', { name: /once a day/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('turning on a device also turns the nudge back on — nobody grants permission for nothing', async () => {
    signIn({ notify_posts: 'off', notify_people: false })
    render(<NotificationSettings />)
    const deviceSwitch = await screen.findByRole('switch', { name: /notify me on this device/i })
    await waitFor(() => expect(deviceSwitch).not.toBeDisabled())

    await userEvent.click(deviceSwitch)

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/auth/me', { notify_posts: 'daily' }),
    )
  })

  it('does NOT override the cadence when the person still wants person-to-person pushes', async () => {
    // The rescue exists for a switch that would light up and deliver nothing. Someone with
    // `notify_people` on has something to receive, so choosing "never hear about friends' posts"
    // is a coherent setting and must not be silently undone by granting permission.
    signIn({ notify_posts: 'off', notify_people: true })
    render(<NotificationSettings />)
    const deviceSwitch = await screen.findByRole('switch', { name: /notify me on this device/i })
    await waitFor(() => expect(deviceSwitch).not.toBeDisabled())

    await userEvent.click(deviceSwitch)

    await waitFor(() => expect(push.enable).toHaveBeenCalled())
    expect(api.patch).not.toHaveBeenCalledWith('/auth/me', { notify_posts: 'daily' })
  })

  it('saves the hour as a NUMBER, which is what the scheduler compares', async () => {
    // A select's value is a string. `"9" < 18` is false in Python and a TypeError in the
    // comparison — either way the person is never due.
    signIn()
    render(<NotificationSettings />)
    const hour = await screen.findByLabelText('Nudge me at')

    await userEvent.selectOptions(hour, '9')

    expect(api.patch).toHaveBeenCalledWith('/auth/me', { notify_hour: 9 })
  })

  it('warns when the nudge time sits inside the quiet hours', async () => {
    // The server treats this as a coherent "not for now" rather than an error, so this line is the
    // only place a person can discover that their nudge will never arrive.
    signIn({ notify_hour: 23, quiet_from: 22, quiet_to: 8 })
    render(<NotificationSettings />)
    expect(await screen.findByText(/inside your quiet hours/i)).toBeInTheDocument()
  })

  it('does not warn for a nudge time outside them', async () => {
    signIn({ notify_hour: 18, quiet_from: 22, quiet_to: 8 })
    render(<NotificationSettings />)
    await screen.findByRole('radio', { name: /once a day/i })
    expect(screen.queryByText(/inside your quiet hours/i)).toBeNull()
  })

  it('does not warn about a nudge hour when there is no daily nudge to miss', async () => {
    // The warning is about a nudge that will never arrive. On "right away" there is no nudge hour
    // in play at all, so the line would be describing a setting the screen isn't even showing.
    signIn({ notify_posts: 'instant', notify_hour: 23, quiet_from: 22, quiet_to: 8 })
    render(<NotificationSettings />)
    await screen.findByRole('radio', { name: /right away/i })
    expect(screen.queryByText(/inside your quiet hours/i)).toBeNull()
  })

  it('NOW has a switch for notify_people, because something finally pushes it', async () => {
    // It was deliberately absent while `notify()` wrote an inbox row that nothing delivered — a
    // control that changes nothing is worse than a missing one, because switching it off reads as
    // a promise. `services/notify_push.py` is the consumer that earns it.
    signIn()
    render(<NotificationSettings />)
    const people = await screen.findByRole('switch', { name: /when someone reaches you/i })
    expect(people).toHaveAttribute('aria-checked', 'true')

    await userEvent.click(people)
    expect(api.patch).toHaveBeenCalledWith('/auth/me', { notify_people: false })
  })

  it('has exactly two switches and one radiogroup — no fourth control appears by accident', async () => {
    // Asserted as a COUNT because every previous version of this screen grew a control that
    // consulted nothing. Two switches (this device, people) and one cadence group is the whole set.
    signIn()
    render(<NotificationSettings />)
    await screen.findByRole('radio', { name: /once a day/i })
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(2)
    expect(switches[0]).toHaveAccessibleName(/notify me on this device/i)
    expect(switches[1]).toHaveAccessibleName(/when someone reaches you/i)
    expect(screen.getAllByRole('radiogroup')).toHaveLength(1)
  })

  it('deciding "off" here silences the Home nudge too', async () => {
    // Browser permission stays 'granted' after an unsubscribe, and NotifyNudge deliberately shows
    // for granted-but-unsubscribed (that's how a failure after the prompt gets a second chance).
    // Without recording the decision, choosing "no thanks" on this page would be met by a strip on
    // Home offering it again.
    signIn()
    push.isSubscribedHere.mockResolvedValue(true)
    render(<NotificationSettings />)
    const deviceSwitch = await screen.findByRole('switch', { name: /notify me on this device/i })
    await waitFor(() => expect(deviceSwitch).toHaveAttribute('aria-checked', 'true'))

    await userEvent.click(deviceSwitch)

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('issei_prefs')).notifyNudgeDismissed).toBe(true),
    )
  })

  it('says quiet hours are OFF when both bounds are the same hour', async () => {
    // One tap from the 10pm→8am default, and the server reads equal bounds as "no quiet hours" —
    // correctly. Left as the standard line, the screen would tell someone trying to silence the app
    // "nothing arrives inside these hours" about a window that isn't enforced.
    signIn({ quiet_from: 8, quiet_to: 8 })
    render(<NotificationSettings />)
    expect(await screen.findByText(/there are no quiet hours/i)).toBeInTheDocument()
    expect(screen.queryByText(/nothing arrives inside these hours/i)).toBeNull()
  })

  it('never says voice, audio, recording or listen', async () => {
    // POSITIONING: there is no audio anywhere in issei, and a notifications screen is exactly
    // where "listen" arrives by accident.
    const BANNED = /record|recording|\bvoice\b|audio|in (their|your|his|her)( own)? words|listen/i
    signIn()
    render(<NotificationSettings />)
    await screen.findByRole('radio', { name: /once a day/i })
    expect(document.body.textContent).not.toMatch(BANNED)
  })
})

describe('inQuietHours — mirrors app/services/push.in_quiet_hours', () => {
  it('handles a window that wraps midnight (the default, 22 → 8)', () => {
    // The obvious `from <= h <= to` is exactly backwards for 22 → 8: it matches nothing inside the
    // window and everything outside it.
    expect(inQuietHours(23, 22, 8)).toBe(true)
    expect(inQuietHours(3, 22, 8)).toBe(true)
    expect(inQuietHours(8, 22, 8)).toBe(false)
    expect(inQuietHours(18, 22, 8)).toBe(false)
  })

  it('handles an ordinary daytime window', () => {
    expect(inQuietHours(3, 1, 6)).toBe(true)
    expect(inQuietHours(6, 1, 6)).toBe(false)
  })

  it('reads equal bounds as NO quiet hours, not a 24-hour blackout', () => {
    // Someone setting both to the same number means "don't bother", and the destructive reading of
    // an ambiguous input is the wrong one.
    expect(inQuietHours(12, 9, 9)).toBe(false)
  })
})
