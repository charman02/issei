import { useEffect, useState } from 'react'
import { loadPrefs, setPref } from '../lib/prefs'
import { useCurrentUser } from '../lib/currentUser'
import {
  enable,
  isSubscribedHere,
  permissionState,
  primeVapidKey,
  pushAvailability,
} from '../lib/push'
import Icon from './Icon'

// A one-time, dismissible "turn on notifications" strip on Home (#89).
//
// WHY IT EXISTS, given the You page already has the setting: a notification setting nobody finds
// is a notification feature nobody has. The whole reason #89 was built is that consistent use of
// this app depends on being reminded to post — and a switch three screens deep, under two other
// headings, is found by roughly nobody. This asks once, where the person already is, and then
// never again.
//
// It follows `PhotoNudge` exactly (same shape, same dismissal model, same pref bag) rather than
// inventing a second nudge idiom. One difference: it has its OWN pref key, because "stop asking me
// for a photo" and "stop asking me about notifications" are genuinely different requests.
//
// FOUR CONDITIONS, and each one removes a way for this to be obnoxious:
//   - signed in (an anonymous invite reader has nothing to be notified about),
//   - the browser can actually do it *right now* — 'ready' only, so an iPhone in Safari is not
//     shown a switch that would fail. Its instruction ("add to home screen") lives on the You
//     page, where there is room to say it properly; a strip that says "install the app first" in
//     the middle of a feed is an ad, not a nudge.
//   - permission is not 'denied' — never after someone has said no. A person who declined the
//     browser prompt has answered this question, and re-asking is what makes an app feel like it
//     isn't listening. (Browsers also permanently block the prompt after a denial, so it would be
//     a button that cannot work.) It deliberately does NOT hide on 'granted': permission granted
//     with no subscription is the state where something failed AFTER the prompt — the worker
//     wasn't active yet, or the POST didn't land — and that is precisely the state this strip
//     exists to rescue. Hiding it there leaves someone permitted-but-silent with no visible way
//     back, which is the failure it was written to prevent.
//   - not already subscribed, and not dismissed.
export default function NotifyNudge({ onDone }) {
  const user = useCurrentUser()
  const [subscribed, setSubscribed] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    let alive = true
    isSubscribedHere().then((v) => {
      if (alive) setSubscribed(v)
    })
    // Warm the VAPID key before the tap, so `Notification.requestPermission()` is reached while
    // the user activation is still live — Safari's window is a few seconds and this app's API can
    // cold-start. Swallowed: `enable()` re-fetches and reports its own failure.
    primeVapidKey().catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const dismissed = !!loadPrefs().notifyNudgeDismissed
  // `subscribed === null` means we haven't heard back from the browser yet — render nothing
  // rather than flashing a prompt at someone who is already subscribed.
  const hide =
    !user.id ||
    done ||
    dismissed ||
    subscribed !== false ||
    pushAvailability() !== 'ready' ||
    permissionState() === 'denied'
  if (hide) return null

  function dismiss() {
    setPref('notifyNudgeDismissed', true)
    onDone?.()
  }

  async function turnOn() {
    setBusy(true)
    setError('')
    const result = await enable()
    setBusy(false)
    if (result.ok) {
      // Also mark it dismissed: the strip's job is done, and leaving the pref unset would bring it
      // back on any device where the browser later drops the subscription — re-asking someone who
      // already said yes.
      setPref('notifyNudgeDismissed', true)
      setDone(true)
      onDone?.()
    } else {
      setError(result.message)
    }
  }

  return (
    <div className="px-4 pb-3">
      <div className="sticker bg-card flex items-center gap-3 p-3">
        <span className="flex-none w-9 h-9 rounded-full border-2 border-ink bg-saffron flex items-center justify-center">
          <Icon name="bell" className="w-4 h-4 text-ink" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display font-bold text-[14px] text-ink leading-snug">
            Get a nudge when your friends have been cooking.
          </p>
          {error ? (
            <p className="mt-1">
              <span className="error-pill">{error}</span>
            </p>
          ) : (
            <button
              onClick={turnOn}
              disabled={busy}
              className="mt-1 font-display font-bold text-[13px] text-terra disabled:opacity-50"
            >
              {busy ? 'Turning on…' : 'Turn on notifications'}
            </button>
          )}
        </div>
        <button
          onClick={dismiss}
          aria-label="Not now"
          className="flex-none w-7 h-7 rounded-full border-2 border-ink bg-cream text-ink flex items-center justify-center"
        >
          <Icon name="close" className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
