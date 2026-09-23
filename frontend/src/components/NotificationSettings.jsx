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
// THREE SWITCHES, SPLIT BY SUBJECT — and the version of this screen that shipped one day earlier
// had a three-value cadence here instead, which is worth explaining because the reasoning behind it
// was correct about the wrong thing.
//
// That control read "When friends post: Right away / Once a day / Never", on the grounds that a
// per-post push and a daily digest are ALTERNATIVES: a nudge saying "3 friends posted since you
// last looked" summarises exactly what the instant pushes already announced, so both on delivers
// four notifications for three posts. True — of a digest. The mistake was one level up: #89 was
// specified as a BeReal-style PROMPT TO POST and built as a digest, so the daily line was about
// other people when it was supposed to be asking YOU for a photo. It was also circular: it only
// fired once friends had posted, so it could amplify activity and never start it.
//
// Once the daily line means "share a meal", the two stop being alternatives — one is about YOU and
// one is about THEM — and collapsing them into one field becomes wrong. So: three switches, by
// SUBJECT rather than by notification type.
//
//   Remind me to share a meal    the app asking YOU            (notify_prompt_me)
//   When a friend shares a meal  ambient news about THEM       (notify_friend_posts)
//   When someone reaches you     addressed TO you              (notify_people)
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

// HOW OFTEN the prompt may arrive, as a minimum gap in the person's own local days. Three choices
// against a column that accepts 1..30, because a gap is the honest model and 1 IS the behaviour
// that already shipped — the at-most-once-a-day rule is this rule at its floor.
//
// It exists because #108 removed something that was capping the nudge by accident: the old design
// only fired when a friend had posted, so a quiet week sent nothing. Gating on the person's own
// absence instead — the fix that made the prompt work at all — means someone who never posts would
// otherwise get the same line every evening forever. The owner's call was to hand that choice to
// the person rather than impose a cap.
const PROMPT_FREQUENCIES = [
  { days: 1, label: 'Every day' },
  { days: 3, label: 'A few days a week' },
  { days: 7, label: 'Once a week' },
]

// MIRRORS `app/services/push.in_quiet_hours` — keep the two in step, like the folk-unit lists.
// Only used to warn about a self-defeating combination; the server is the authority on whether a
// notification actually goes out.
export function inQuietHours(hour, from, to) {
  if (from === to) return false // equal bounds mean "no quiet hours", not a 24-hour blackout
  if (from < to) return from <= hour && hour < to
  return hour >= from || hour < to // wraps midnight: 22 → 8
}

// FALLS BACK THROUGH TWO GENERATIONS OF OLD FIELD, because `reconcile()` refreshes the identity
// cache only once per app start — so a cached user written by an older build has `notify_posts`, or
// (older still) `notify_prompt`, and neither has the new booleans. Without the chain these switches
// would render as OFF for one page load, and a tap would then SAVE that. Same shape as #105's
// fallback for `default_recipe_visibility`, and the same reason.
//
// Shared with `toggleDevice`, which runs before the render body computes anything.
function promptMeOf(user) {
  if (user.notify_prompt_me !== undefined) return user.notify_prompt_me !== false
  if (user.notify_posts !== undefined) return user.notify_posts !== 'off'
  return user.notify_prompt !== false
}

function friendPostsOf(user) {
  if (user.notify_friend_posts !== undefined) return user.notify_friend_posts !== false
  if (user.notify_posts !== undefined) return user.notify_posts !== 'off'
  // THE OLDEST GENERATION STILL DECIDES THIS, and returning a bare `true` here was wrong in a way
  // that bit twice. Someone who turned #89's daily nudge OFF has `notify_prompt: false` cached and
  // neither newer field; both migrations map that to `notify_friend_posts = FALSE`, so this switch
  // rendered ON while the server said OFF — exactly the "wrong for one page load, and a tap would
  // then SAVE it" failure this chain exists to prevent, inverted. It also defeated
  // `toggleDevice`'s rescue, which fires only when every preference is off: the person granted
  // notification permission and ended up subscribed to nothing, which is the state the rescue was
  // written for. Found by the ship gate.
  return user.notify_prompt !== false
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
      if (next && !promptMeOf(user) && !friendPostsOf(user) && user.notify_people === false)
        await savePref({ notify_prompt_me: true })
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

  const promptMe = promptMeOf(user)
  const friendPosts = friendPostsOf(user)
  const hour = Number.isInteger(user.notify_hour) ? user.notify_hour : 18
  // Defaults to daily for a cached user written before this column existed — the same fallback
  // shape as the hour above it, and the same value the column itself defaults to.
  const everyDays = Number.isInteger(user.notify_prompt_every_days)
    ? user.notify_prompt_every_days
    : 1
  const quietFrom = Number.isInteger(user.quiet_from) ? user.quiet_from : 22
  const quietTo = Number.isInteger(user.quiet_to) ? user.quiet_to : 8
  // A nudge time inside the quiet window means no nudge, ever, silently. The server treats that
  // as a coherent "not for now" rather than an error, so saying so here is the only place a
  // person can find out.
  const selfCancelling = promptMe && inQuietHours(hour, quietFrom, quietTo)
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
            {/* NOT "everything still shows up in your inbox" — false twice, for the same two
                reasons the identical sentence was removed from `Welcome.jsx`: the daily nudge
                writes no `Notification` row at all (`services/prompt.py` imports `PromptSend`,
                never `Notification`), and the friend-post push deliberately writes none either,
                because the feed's #97 `is_new` mark is its persistent half. Naming what DOES
                land is true and more useful than a reassurance that isn't. */}
            <p className="font-display italic text-[12.5px] text-ink-soft mt-1 leading-snug">
              Asks and arrivals still wait for you in your inbox; the daily nudge and
              friends&rsquo; meals just won&rsquo;t reach you here.
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
        <div className="border-t-2 border-line">
          <Toggle
            label="Remind me to share a meal"
            hint="A nudge to put up a photo of what you cooked — at the time and how often you set below."
            on={promptMe}
            disabled={savingPref}
            onChange={(v) => savePref({ notify_prompt_me: v })}
          />
        </div>

        <div className="border-t-2 border-line">
          <Toggle
            label="When a friend shares a meal"
            hint="A notification each time, as it happens."
            on={friendPosts}
            disabled={savingPref}
            onChange={(v) => savePref({ notify_friend_posts: v })}
          />
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

        {promptMe && (
          <>
            <Row label="Remind me at">
              <select
                aria-label="Remind me at"
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
            <Row
              label="How often"
              hint={
                everyDays === 1
                  ? 'Every evening you haven’t shared a meal.'
                  : 'Only if it’s been this long since the last reminder — and never on a day you’ve already shared something.'
              }
            >
              <select
                aria-label="How often"
                className="field !py-1.5 !px-2 font-display font-bold text-[13px] w-auto"
                value={everyDays}
                disabled={savingPref}
                onChange={(e) =>
                  savePref({ notify_prompt_every_days: Number(e.target.value) })
                }
              >
                {PROMPT_FREQUENCIES.map((f) => (
                  <option key={f.days} value={f.days}>
                    {f.label}
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
            {hourLabel(hour)} is inside your quiet hours, so the reminder won&rsquo;t arrive.
          </p>
        )}

        {/* EMAIL, UNDER ITS OWN HEADING, and the heading is the whole point of putting it here
            rather than in the list above (#107). Every switch above this line gates a PUSH — it
            needs a subscription on a device, it respects quiet hours, and on an iPhone in Safari it
            can't fire at all. This one is mail, so none of that applies to it: it arrives whatever
            the device, and quiet hours have nothing to do with it. Filed under the same section
            because a person thinking "stop sending me things" looks in one place, but separated by a
            heading so nobody reads it as a fourth push toggle.

            OUTSIDE every `availability` branch too — an iPhone in Safari shows the install
            instruction instead of the device switch, and this must still be reachable there. It is
            the only channel that works on that platform today. */}
        <div className="border-t-2 border-line pt-3">
          <span className="section-label">By email</span>
          <Toggle
            label="Updates about issei"
            hint="Occasional mail from us when something changes. Not recipes, not friend activity — those are the switches above."
            on={user.announcement_emails !== false}
            disabled={savingPref}
            onChange={(v) => savePref({ announcement_emails: v })}
          />
        </div>

        {error && (
          <p className="pb-3">
            <span className="error-pill">{error}</span>
          </p>
        )}
      </div>
    </>
  )
}
