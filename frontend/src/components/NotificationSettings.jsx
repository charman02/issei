import { useEffect, useState } from 'react'
import client, { toUserMessage } from '../api/client'
import { patchUser, useCurrentUser } from '../lib/currentUser'
import { setPref } from '../lib/prefs'
import {
  disable,
  enable,
  isSubscribedHere,
  primeVapidKey,
  pushAvailability,
} from '../lib/push'
import Toggle from './Toggle'

// NOTIFICATION SETTINGS (#89), on the You page.
//
// TWO KINDS OF SETTING, and keeping them visibly separate is the design:
//
//   "On this phone" is a SUBSCRIPTION — one row in `push_subscriptions` per browser per device.
//   It lives in the browser, and only the browser knows whether it's still valid.
//
//   Everything below it is a PREFERENCE on `users` — it follows the person to every device they
//   install on. That split is why "notifications on, zero devices" is a legitimate state: it
//   describes someone who hasn't installed the app anywhere yet, and it's the state every account
//   is in right now.
//
// `notify_people` NOW HAS A SWITCH, and the reason it didn't before is the reason it does now:
// person-to-person pushes weren't wired, so a control for them would have changed nothing —
// worse than a missing one, because switching it off reads as a promise. `notify()` now reaches
// `services/notify_push.py`, so the column has a consumer and the switch has a job.
//
// "WHEN FRIENDS POST" IS A CADENCE, NOT A TOGGLE, and that is the one non-obvious thing on this
// screen. There are two ways to hear that a friend cooked — as it happens, or once a day — and
// they are ALTERNATIVES: the daily nudge says "3 friends posted since you last looked", which
// summarises exactly the posts an instant push already announced. Two independent switches (the
// obvious build) deliver four notifications for three posts. So one control, three answers, and
// `prompt.is_due` tests `notify_posts == "daily"` to make the exclusivity real.
//
// QUIET HOURS ARE NOT GATED ON THE CADENCE. They used to sit inside the daily-nudge branch, which
// was true when the nudge was the only thing that could arrive — now every person-to-person push
// respects them too, so hiding them behind "Once a day" would take away the only control over
// EVERY notification from someone who just didn't want the nudge.

// The clock hours, as a person writes them. Not `toLocaleTimeString`: the hour here is a bare
// integer in the USER'S OWN zone (the server compares it against their local clock), so running
// it through a locale formatter would invite a timezone conversion that must not happen.
function hourLabel(h) {
  const suffix = h < 12 ? 'am' : 'pm'
  const twelve = h % 12 === 0 ? 12 : h % 12
  return `${twelve}:00 ${suffix}`
}

const HOURS = Array.from({ length: 24 }, (_, h) => h)

// The three answers to "when do you want to hear that friends posted". Ordered loudest-first, so
// the list reads as a dial being turned down rather than a set of unrelated options.
const CADENCES = [
  {
    value: 'instant',
    title: 'Right away',
    detail: 'A notification each time a friend shares a meal.',
  },
  {
    value: 'daily',
    title: 'Once a day',
    detail: 'One nudge at the time below, if your friends have been cooking.',
  },
  { value: 'off', title: 'Never', detail: 'Nothing about friends’ meals.' },
]

// MIRRORS `app/services/push.in_quiet_hours` — keep the two in step, like the folk-unit lists.
// Only used to warn about a self-defeating combination; the server is the authority on whether a
// notification actually goes out.
export function inQuietHours(hour, from, to) {
  if (from === to) return false // equal bounds mean "no quiet hours", not a 24-hour blackout
  if (from < to) return from <= hour && hour < to
  return hour >= from || hour < to // wraps midnight: 22 → 8
}

// Shared by the render body and by `toggleDevice`, which runs before either is computed.
function cadenceOf(user) {
  return user.notify_posts ?? (user.notify_prompt === false ? 'off' : 'daily')
}

function Row({ label, hint, children }) {
  return (
    <div className="border-t-2 border-line first:border-t-0 py-2.5">
      <div className="flex items-center justify-between gap-4">
        <span className="block font-display font-bold text-[14px] text-ink">{label}</span>
        {children}
      </div>
      {hint && (
        <p className="font-display italic text-[12px] text-ink-soft mt-0.5 leading-snug">
          {hint}
        </p>
      )}
    </div>
  )
}

export default function NotificationSettings() {
  const user = useCurrentUser()
  const availability = pushAvailability()
  // null while we're still asking the browser. Distinct from false, so the switch doesn't flash
  // "off" for a device that is in fact subscribed.
  const [subscribed, setSubscribed] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [savingPref, setSavingPref] = useState(false)

  useEffect(() => {
    let alive = true
    isSubscribedHere().then((v) => {
      if (alive) setSubscribed(v)
    })
    // Warm the VAPID key now, so the tap that follows reaches `Notification.requestPermission()`
    // with the user activation still live. Safari's activation window is a few seconds and this
    // app's API can cold-start — an awaited fetch between the two is how an iPhone gets its
    // permission prompt refused. Swallowed: `enable()` re-fetches and reports its own failure.
    primeVapidKey().catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  async function toggleDevice(next) {
    setBusy(true)
    setError('')
    const result = next ? await enable() : await disable()
    if (result.ok) {
      setSubscribed(next)
      // Either answer settles the question `NotifyNudge` asks, so stop it asking. Turning this OFF
      // here is the case that matters: browser permission stays 'granted' after an unsubscribe, and
      // the nudge shows for granted-but-unsubscribed (deliberately — that's how a failure after the
      // prompt gets a second chance). Without this, deciding "no thanks" on the You page would be
      // met by a strip on Home offering it again.
      setPref('notifyNudgeDismissed', true)
      // Turning it on for the first device with the daily nudge switched off would be a switch
      // that lights up and delivers nothing. Nobody grants notification permission in order to
      // receive none, so granting implies wanting the one thing there is to receive.
      if (next && cadenceOf(user) === 'off' && user.notify_people === false)
        await savePref({ notify_posts: 'daily' })
    } else {
      setError(result.message)
    }
    setBusy(false)
  }

  // Preferences go through PATCH /auth/me and write back to the identity cache, so the switch
  // reflects the SERVER's value rather than a local guess. A preference kept only in localStorage
  // would look correct here forever while the scheduler read the old value — the reason these
  // columns are on `users` at all.
  async function savePref(patch) {
    setSavingPref(true)
    setError('')
    try {
      const { data } = await client.patch('/auth/me', patch)
      patchUser(data)
    } catch (err) {
      setError(toUserMessage(err, 'Couldn’t save that setting. Try again.'))
    } finally {
      setSavingPref(false)
    }
  }

  // FALLS BACK THROUGH THE OLD FIELD. A cached user object written by a build that predates the
  // rename has `notify_prompt` and no `notify_posts`, and `reconcile()` only refreshes it once per
  // app start — so without this chain the control would render as "Never" for one page load and a
  // tap would then SAVE that. Same shape as #105's fallback chain for `default_recipe_visibility`.
  const cadence = cadenceOf(user)
  const hour = Number.isInteger(user.notify_hour) ? user.notify_hour : 18
  const quietFrom = Number.isInteger(user.quiet_from) ? user.quiet_from : 22
  const quietTo = Number.isInteger(user.quiet_to) ? user.quiet_to : 8
  // A nudge time inside the quiet window means no nudge, ever, silently. The server treats that
  // as a coherent "not for now" rather than an error, so saying so here is the only place a
  // person can find out.
  const selfCancelling = cadence === 'daily' && inQuietHours(hour, quietFrom, quietTo)
  // EQUAL BOUNDS MEAN NO QUIET HOURS — and it is one tap away from the 10pm→8am default, so the
  // hint has to change with it. Left as the "nothing arrives inside these hours" line, the screen
  // would tell someone trying to silence the app the exact opposite of what the server will do
  // (`app/services/push.in_quiet_hours` reads equal bounds as "don't bother", deliberately, since
  // the destructive reading of an ambiguous input is the wrong one).
  const quietOff = quietFrom === quietTo

  return (
    <>
      <h2 className="font-display font-black text-[19px] text-ink mt-7 mb-2">
        Notifications
      </h2>
      <div className="sticker bg-card px-5 py-2">
        {availability === 'install-first' ? (
          /* iOS in a browser tab. NOT "unsupported": Safari only exposes push to a site that has
             been added to the home screen, so the honest answer is an instruction, not a refusal.
             Telling an iPhone user their phone can't do notifications would be false AND a dead
             end — and iPhones are most of this app's audience. */
          <div className="py-3">
            <p className="font-display font-bold text-[14px] text-ink leading-snug">
              Add issei to your home screen first.
            </p>
            <p className="font-display italic text-[12.5px] text-ink-soft mt-1 leading-snug">
              Tap Share, then &ldquo;Add to Home Screen&rdquo;. Open issei from there and this
              setting will be here.
            </p>
          </div>
        ) : availability !== 'ready' ? (
          <div className="py-3">
            <p className="font-display font-bold text-[14px] text-ink leading-snug">
              This browser can&rsquo;t do notifications.
            </p>
            <p className="font-display italic text-[12.5px] text-ink-soft mt-1 leading-snug">
              Everything still shows up in your inbox when you open issei.
            </p>
          </div>
        ) : (
          <Toggle
            label="Notify me on this device"
            hint={
              subscribed
                ? 'This device will get notifications. Each phone or laptop is separate.'
                : 'Your browser will ask permission.'
            }
            on={!!subscribed}
            disabled={busy || subscribed === null}
            onChange={toggleDevice}
          />
        )}

        {/* The preferences follow the PERSON, so they're shown even with no device subscribed —
            that's a real state (settings ready, nothing installed yet), and hiding them would
            make the daily nudge look like it doesn't exist until you've granted permission. */}
        <div className="border-t-2 border-line py-2.5">
          <span className="block font-display font-bold text-[14px] text-ink">
            When friends post
          </span>
          <div
            className="mt-2 space-y-1.5"
            role="radiogroup"
            aria-label="When friends post"
          >
            {CADENCES.map((opt) => {
              const selected = cadence === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={savingPref}
                  onClick={() => savePref({ notify_posts: opt.value })}
                  className={`flex w-full items-start gap-2.5 text-left sticker-sm p-2.5 disabled:opacity-60 ${
                    selected ? 'bg-peach' : 'bg-card'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="flex-none flex items-center justify-center w-[17px] h-[17px] mt-0.5 rounded-full border-2 border-ink bg-cream"
                  >
                    {selected && (
                      <span className="block w-[8px] h-[8px] rounded-full bg-terra" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-display font-black text-[14px] text-ink leading-none">
                      {opt.title}
                    </span>
                    <span className="block font-display text-[12px] text-ink-soft mt-1 leading-snug">
                      {opt.detail}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="border-t-2 border-line">
          <Toggle
            label="When someone reaches you"
            hint="Someone asks you for a recipe, sends you one, or adds you as a friend."
            on={user.notify_people !== false}
            disabled={savingPref}
            onChange={(v) => savePref({ notify_people: v })}
          />
        </div>

        {cadence === 'daily' && (
          <>
            <Row label="Nudge me at">
              <select
                aria-label="Nudge me at"
                className="field !py-1.5 !px-2 font-display font-bold text-[13px] w-auto"
                value={hour}
                disabled={savingPref}
                onChange={(e) => savePref({ notify_hour: Number(e.target.value) })}
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </Row>
          </>
        )}

        {/* STACKED, not a label-plus-control row like the one above it. A label and TWO
            selects and the word "to" do not fit across 430px — measured: the label wrapped to
            two lines and the first select landed under it.

            OUTSIDE the daily-only branch: quiet hours govern EVERY push now, including someone
            asking you for a recipe, so they must stay reachable for a person who turned the daily
            nudge off. */}
        <div className="border-t-2 border-line py-2.5">
          <span className="block font-display font-bold text-[14px] text-ink">
            Quiet hours
          </span>
            <span className="flex items-center gap-1.5 mt-1.5">
              <select
                aria-label="Quiet hours start"
                className="field !py-1.5 !px-2 font-display font-bold text-[13px] w-auto"
                value={quietFrom}
                disabled={savingPref}
                onChange={(e) => savePref({ quiet_from: Number(e.target.value) })}
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
              <span className="font-display text-[13px] text-ink-soft">to</span>
              <select
                aria-label="Quiet hours end"
                className="field !py-1.5 !px-2 font-display font-bold text-[13px] w-auto"
                value={quietTo}
                disabled={savingPref}
                onChange={(e) => savePref({ quiet_to: Number(e.target.value) })}
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </span>
          <p className="font-display italic text-[12px] text-ink-soft mt-1 leading-snug">
            {quietOff
              ? 'Set to the same hour, so there are no quiet hours — anything due can arrive whenever.'
              : 'Nothing arrives inside these hours, not even a nudge that ran late.'}
          </p>
        </div>

        {selfCancelling && (
          <p className="pb-3 font-display font-bold text-[12.5px] text-brick leading-snug">
            {hourLabel(hour)} is inside your quiet hours, so the nudge won&rsquo;t arrive.
          </p>
        )}
        {error && (
          <p className="pb-3">
            <span className="error-pill">{error}</span>
          </p>
        )}
      </div>
    </>
  )
}
