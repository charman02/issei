import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
    notify_prompt_me: true,
    notify_prompt_every_days: 1,
    notify_friend_posts: true,
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
    expect(
      screen.getByRole('switch', { name: /remind me to share a meal/i }),
    ).toBeInTheDocument()
  })

  it('saves a preference to the SERVER, not to localStorage', async () => {
    // The scheduler reads `users`. A preference kept only in the browser would look correct on
    // this screen forever while someone who switched notifications off kept receiving them.
    signIn()
    render(<NotificationSettings />)
    const promptSwitch = await screen.findByRole('switch', {
      name: /remind me to share a meal/i,
    })

    await userEvent.click(promptSwitch)

    expect(api.patch).toHaveBeenCalledWith('/auth/me', { notify_prompt_me: false })
    await waitFor(() => expect(promptSwitch).toHaveAttribute('aria-checked', 'false'))
  })

  it('the prompt and the friend-post switch are INDEPENDENT', async () => {
    // This screen shipped a three-value cadence one day earlier, on the reasoning that a per-post
    // push and a daily digest are alternatives. True of a digest — but the daily line is now a
    // prompt to share a meal, which is about YOU, so the two are different notifications about
    // different subjects and neither may silence the other.
    signIn()
    render(<NotificationSettings />)
    const promptSwitch = await screen.findByRole('switch', {
      name: /remind me to share a meal/i,
    })
    const friendSwitch = screen.getByRole('switch', { name: /when a friend shares a meal/i })

    await userEvent.click(friendSwitch)

    expect(api.patch).toHaveBeenCalledWith('/auth/me', { notify_friend_posts: false })
    await waitFor(() => expect(friendSwitch).toHaveAttribute('aria-checked', 'false'))
    expect(promptSwitch).toHaveAttribute('aria-checked', 'true')
  })

  it('hearing about friends is ON by default, not something to go and find', async () => {
    signIn()
    render(<NotificationSettings />)
    expect(
      await screen.findByRole('switch', { name: /when a friend shares a meal/i }),
    ).toHaveAttribute('aria-checked', 'true')
  })

  it('only the PROMPT has an hour and a frequency, and both hide when it is off', async () => {
    signIn({ notify_prompt_me: false })
    render(<NotificationSettings />)
    await screen.findByRole('switch', { name: /remind me to share a meal/i })
    expect(screen.queryByLabelText('Remind me at')).toBeNull()
    expect(screen.queryByLabelText('How often')).toBeNull()
  })

  it('offers three frequencies and saves the gap as a NUMBER', async () => {
    // The column is a minimum gap in local days, and 1 is the behaviour that already shipped — the
    // at-most-once-a-day rule is this rule at its floor. A select's value is a string, and the
    // server compares it arithmetically, so sending "7" instead of 7 would be a 422 at best.
    signIn()
    render(<NotificationSettings />)
    const freq = await screen.findByLabelText('How often')
    expect(
      Array.from(freq.options).map((o) => [Number(o.value), o.textContent]),
    ).toEqual([
      [1, 'Every day'],
      [3, 'A few days a week'],
      [7, 'Once a week'],
    ])
    expect(Number(freq.value)).toBe(1)

    await userEvent.selectOptions(freq, '7')
    expect(api.patch).toHaveBeenCalledWith('/auth/me', { notify_prompt_every_days: 7 })
  })

  it('the frequency hint changes, because "every day" and "once a week" promise different things', async () => {
    // On daily the honest line is "every evening you haven't shared a meal". On a longer gap the
    // person needs to know BOTH rules apply — the gap AND the already-posted suppression — or a
    // quiet week with one meal in it looks like the setting failing.
    signIn({ notify_prompt_every_days: 7 })
    render(<NotificationSettings />)
    await screen.findByLabelText('How often')
    expect(screen.getByText(/since the last reminder/i)).toBeInTheDocument()
    expect(screen.queryByText(/every evening you haven/i)).toBeNull()
  })

  it('the nudge toggle does NOT state a cadence, because the control below sets it', async () => {
    // THE BUG THIS TEST EXISTS FOR. The hint read "Once a day, at the time below — a nudge to put
    // up a photo of what you cooked." That was true until #109 put a "How often" control 40 lines
    // beneath it, and then someone who chose "Once a week" read this card top to bottom as:
    //   "Remind me to share a meal — ONCE A DAY, at the time below"
    //   "How often — Once a week"
    // Two statements about one behaviour, contradicting each other, three rows apart, on the screen
    // that OWNS the setting. Found by the ship gate, and it was the un-pinned twin of the false
    // Welcome sentence the same branch fixed — that one had a test asserting it, this one had none.
    //
    // Same class as PhotoFramer's "Pinch or use the slider to zoom" (#103): copy stating a
    // behaviour the app no longer has. So the hint now points AT the two controls instead of
    // pre-empting one of them.
    signIn({ notify_prompt_every_days: 7 })
    render(<NotificationSettings />)
    await screen.findByRole('switch', { name: /remind me to share a meal/i })
    // Swept over the whole section, not one element: the point is that the contradiction cannot
    // appear ANYWHERE beside a control that says "Once a week". ("Every day" and "Once a week" are
    // the option labels and are deliberately a different string.)
    expect(document.body.textContent).not.toMatch(/once a day/i)
    expect(screen.getByText(/at the time and how often you set below/i)).toBeInTheDocument()
  })

  it('the unsupported-browser line does not promise an inbox it cannot fill', async () => {
    // It said "Everything still shows up in your inbox when you open issei", which is false twice:
    // the daily nudge writes no `Notification` row at all, and the friend-post push deliberately
    // writes none either (the feed's #97 `is_new` mark is its persistent half). The identical
    // sentence was removed from `Welcome.jsx` in the same branch; this copy shipped one component
    // over in the same deploy and the ship gate caught it. Naming what DOES land is true.
    push.pushAvailability.mockReturnValue('unsupported')
    signIn()
    render(<NotificationSettings />)
    expect(await screen.findByText(/asks and arrivals still wait for you/i)).toBeInTheDocument()
    expect(screen.queryByText(/everything still shows up/i)).toBeNull()
  })

  it('a cached user from before the frequency column existed defaults to daily', async () => {
    // Same fallback shape as the hour beside it, and the same value the column defaults to — so the
    // control cannot render a blank or a zero for one page load and then save it.
    signIn({ notify_prompt_every_days: undefined })
    render(<NotificationSettings />)
    expect(Number((await screen.findByLabelText('How often')).value)).toBe(1)
  })

  it('quiet hours stay reachable with the prompt off, because they govern every push', async () => {
    // They used to live inside the daily-nudge branch, which was true when the nudge was the only
    // thing that could arrive. Now an ask, an arrival and a friend's post all respect them — so
    // hiding them here would take away the only control over EVERY notification from someone who
    // just didn't want a reminder.
    signIn({ notify_prompt_me: false })
    render(<NotificationSettings />)
    expect(await screen.findByLabelText('Quiet hours start')).toBeInTheDocument()
    expect(screen.getByLabelText('Quiet hours end')).toBeInTheDocument()
  })

  it('a cached user from EITHER older build still renders the switches correctly', async () => {
    // `reconcile()` refreshes the identity cache once per app start, so a cached user can predate
    // this rename by one build (`notify_posts`) or two (`notify_prompt`). Without the fallback
    // chain these render as OFF for one page load — and a tap would then SAVE that.
    setUser({ id: 1, first_name: 'Ana', notify_hour: 18, notify_posts: 'instant' })
    render(<NotificationSettings />)
    expect(
      await screen.findByRole('switch', { name: /remind me to share a meal/i }),
    ).toHaveAttribute('aria-checked', 'true')
    expect(
      screen.getByRole('switch', { name: /when a friend shares a meal/i }),
    ).toHaveAttribute('aria-checked', 'true')
  })

  it('a two-generations-old cached user reading notify_prompt renders BOTH switches right', async () => {
    // THE BUG THIS CAUGHT, and it needed both assertions: `friendPostsOf` returned a bare `true`
    // for this cache generation while both migrations map `notify_prompt: false` to
    // `notify_friend_posts = FALSE`. So the friend switch rendered ON against a server saying OFF —
    // the inverse of the failure this fallback chain exists to prevent — and it also defeated
    // `toggleDevice`'s rescue, which fires only when every preference is off, leaving someone
    // subscribed to nothing. Asserting only the prompt switch (as the first version did) missed it.
    setUser({ id: 1, first_name: 'Ana', notify_hour: 18, notify_prompt: false })
    render(<NotificationSettings />)
    expect(
      await screen.findByRole('switch', { name: /remind me to share a meal/i }),
    ).toHaveAttribute('aria-checked', 'false')
    expect(
      screen.getByRole('switch', { name: /when a friend shares a meal/i }),
    ).toHaveAttribute('aria-checked', 'false')
  })

  it('and the device rescue then fires for that person, because everything IS off', async () => {
    // The second-order consequence of the fallback bug: with the friend switch wrongly reading ON,
    // the rescue's "is anything switched on?" test said yes and the person granted permission to
    // receive nothing at all.
    setUser({
      id: 1,
      first_name: 'Ana',
      notify_hour: 18,
      notify_prompt: false,
      notify_people: false,
    })
    render(<NotificationSettings />)
    const deviceSwitch = await screen.findByRole('switch', { name: /notify me on this device/i })
    await waitFor(() => expect(deviceSwitch).not.toBeDisabled())

    await userEvent.click(deviceSwitch)

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/auth/me', { notify_prompt_me: true }),
    )
  })

  it('turning on a device rescues someone who would receive nothing at all', async () => {
    signIn({ notify_prompt_me: false, notify_friend_posts: false, notify_people: false })
    render(<NotificationSettings />)
    const deviceSwitch = await screen.findByRole('switch', { name: /notify me on this device/i })
    await waitFor(() => expect(deviceSwitch).not.toBeDisabled())

    await userEvent.click(deviceSwitch)

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/auth/me', { notify_prompt_me: true }),
    )
  })

  it('does NOT override a coherent choice when something is still switched on', async () => {
    // The rescue exists for a switch that would light up and deliver nothing. Someone with any
    // other switch on has something to receive, so declining the reminder is a real setting and
    // must not be silently undone by granting permission.
    signIn({ notify_prompt_me: false, notify_friend_posts: false, notify_people: true })
    render(<NotificationSettings />)
    const deviceSwitch = await screen.findByRole('switch', { name: /notify me on this device/i })
    await waitFor(() => expect(deviceSwitch).not.toBeDisabled())

    await userEvent.click(deviceSwitch)

    await waitFor(() => expect(push.enable).toHaveBeenCalled())
    expect(api.patch).not.toHaveBeenCalledWith('/auth/me', { notify_prompt_me: true })
  })

  it('saves the hour as a NUMBER, which is what the scheduler compares', async () => {
    // A select's value is a string. `"9" < 18` is false in Python and a TypeError in the
    // comparison — either way the person is never due.
    signIn()
    render(<NotificationSettings />)
    const hour = await screen.findByLabelText('Remind me at')

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
    await screen.findByRole('switch', { name: /remind me to share a meal/i })
    expect(screen.queryByText(/inside your quiet hours/i)).toBeNull()
  })

  it('does not warn about an hour when there is no reminder to miss', async () => {
    // The warning is about a reminder that will never arrive. With the reminder off there is no
    // hour in play, so the line would describe a setting the screen isn't even showing.
    signIn({ notify_prompt_me: false, notify_hour: 23, quiet_from: 22, quiet_to: 8 })
    render(<NotificationSettings />)
    await screen.findByRole('switch', { name: /remind me to share a meal/i })
    expect(screen.queryByText(/inside your quiet hours/i)).toBeNull()
  })

  it('has a switch for notify_people, because something finally pushes it', async () => {
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

  it('has exactly four switches, in subject order, and no fifth appears by accident', async () => {
    // Asserted as a COUNT and an ORDER, because every previous version of this screen either grew a
    // control that consulted nothing or modelled two unrelated things as one. The order is the
    // argument: the device, then the app asking YOU, then news about THEM, then things addressed to
    // you. Any fifth control needs a consumer and a reason to be a separate kind.
    signIn()
    render(<NotificationSettings />)
    await screen.findByRole('switch', { name: /remind me to share a meal/i })
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(4)
    expect(switches[0]).toHaveAccessibleName(/notify me on this device/i)
    expect(switches[1]).toHaveAccessibleName(/remind me to share a meal/i)
    expect(switches[2]).toHaveAccessibleName(/when a friend shares a meal/i)
    expect(switches[3]).toHaveAccessibleName(/when someone reaches you/i)
    expect(screen.queryAllByRole('radiogroup')).toHaveLength(0)
    // Four selects: the reminder's hour and frequency, and the two quiet-hour bounds. Counted for
    // the same reason as the switches — every previous version of this screen grew a control that
    // consulted nothing.
    expect(screen.getAllByRole('combobox')).toHaveLength(4)
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
    await screen.findByRole('switch', { name: /remind me to share a meal/i })
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
