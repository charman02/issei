import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import RecipeGlimpse from '../components/RecipeGlimpse'
import MealGlimpse from '../components/MealGlimpse'
import IsseiMeaning from '../components/IsseiMeaning'
import Wordmark from '../components/Wordmark'
import { loadPrefs, setPref } from '../lib/prefs'
import { enable, primeVapidKey, pushAvailability } from '../lib/push'

// The post-signup welcome (/welcome) — three panels, once, then never again.
//
// WHY A ROUTE, NOT AN OVERLAY ON HOME. Home can't render until three API calls
// answer, so an overlay means the new user watches a spinner before they're
// taught anything, and the teaching then floats over a screen they can't read.
// Worse, Home's own first-run hero would be arguing with the overlay on top of
// it. A route owns the whole viewport, needs no data, and is entered with
// `replace` — so it occupies no history entry and no back gesture can return to
// it.
//
// WHY THREE PANELS: ONE THAT TEACHES, THEN TWO ACTIONS. The rule has always been "at most two
// TEACHING panels", because a third is a carousel and testers punished tap-heavy onboarding. This now
// uses ONE, and the two it replaced had gone stale rather than merely long:
//
//   The old panel 2 said "So there are two things to do" — write a recipe, send it to someone — and
//   then, in a peach box, "THAT'S THE WHOLE APP." True when written. Falsified twice since: #67 made
//   a FEED OF POSTS the app's Home, and #79 made ASKING for a recipe a first-class act. So every new
//   account was told the app was two verbs and then dropped onto a feed neither verb mentioned, while
//   the act the loop now turns on appeared nowhere in onboarding. The owner read the framing as "the
//   old version of the app", and it was worse than tone — it was a claim the app had outgrown.
//
//   The old panel 1, "Recipes kept their way / Not grams. Theirs.", led with the FIDELITY promise,
//   which POSITIONING calls the supporting layer rather than the door.
//
// AND ONE TEACHING PANEL IS NOW ENOUGH, because `/join` (#111) teaches a referred stranger BEFORE
// they sign up. A referred person therefore meets `/join` while deciding and this while starting, so
// this panel deliberately does not re-run the pitch — it states the three beats in a line each and
// lets `RecipeGlimpse` carry the payload. Someone who signed up WITHOUT passing `/join` (typed the
// domain, or arrived on a recipe invite) still gets the explanation here, which is why the panel
// cannot be dropped entirely.
//
// THE SECOND PANEL ASKS FOR CONTENT, which is the gap the owner named: onboarding used to ask for a
// profile photo and a notification permission, and NEITHER PRODUCES ANYTHING. An account that
// finishes onboarding having published nothing has nothing to come back to, and neither does anybody
// who follows them — on an app whose Home is a feed. A MEAL rather than a recipe, because a post is a
// photo and a dish name (seconds) while writing a recipe cold is the heaviest thing the app asks; and
// because a post is the top of the funnel by design — it earns the ask that produces the recipe.
//
// THE PHOTO PANEL WAS DROPPED (owner's call, and it is the one thing here that lost a conversion
// point). It asked for something that produces no content, and it already has a fallback that nags
// nobody: the You-page nudge (#77) plus the retro prompt for older accounts (#84). Its framing
// machinery — `useAvatarUpload`, `PhotoFramer`, `PHOTO_ACCEPT`, `Avatar` — came out with it rather
// than being left imported and unused.
//
// EVERY ACTION STEP STAYS GENUINELY OPTIONAL, with a fallback elsewhere: Skip in the header finishes
// from anywhere, "Not now" advances one panel, and each act has a second home — Home's own empty
// state carries a "📸 Share a meal" button to the same route, and `NotifyNudge` still asks on Home.
//
// SEEN IS MARKED ON MOUNT, not on exit. Any way out counts as final: both
// buttons, a nav tap, a closed tab. Nothing here is worth making someone sit
// through twice, and a half-finished onboarding that reappears is a nag.
// SEEN IS PER ACCOUNT, not per browser. A single `welcomeSeen: true` flag meant
// the SECOND person to sign up on a device never got welcomed — the flag was
// still set from the first. That's a real case on a shared or family phone, which
// is exactly the audience here. So the flag records WHICH user ids have seen it.
const WELCOME_SEEN = 'welcomeSeenBy'

// The signed-in user's id, or null when there's nobody (or a corrupt blob).
function currentUserId() {
  try {
    return JSON.parse(localStorage.getItem('issei_user') || 'null')?.id ?? null
  } catch {
    return null
  }
}

export function markWelcomeSeen() {
  const id = currentUserId()
  if (id == null) return
  const seen = loadPrefs()[WELCOME_SEEN]
  // Tolerate the old boolean shape rather than throwing on it: an existing user
  // upgrading mid-session shouldn't crash, they just get welcomed once more.
  const list = Array.isArray(seen) ? seen : []
  if (!list.includes(id)) setPref(WELCOME_SEEN, [...list, id])
}

export function hasSeenWelcome() {
  const id = currentUserId()
  if (id == null) return false
  const seen = loadPrefs()[WELCOME_SEEN]
  return Array.isArray(seen) && seen.includes(id)
}

// The eyebrow badge — reused on both panels so the panel count is stated up
// front. "1 of 3" is a promise that this is short; a bare dot row isn't.
function StepBadge({ children }) {
  return (
    <span className="inline-block font-display font-bold uppercase tracking-[0.14em] text-[10.5px] text-ink bg-saffron border-2 border-ink rounded-full px-3 py-1">
      {children}
    </span>
  )
}

// A line on the notifications panel. A dot rather than the numbered disc `Step` uses: these are
// two facts, not a sequence, and numbering them would imply an order to do something in.
function NotifyLine({ children }) {
  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden="true"
        className="flex-none w-2 h-2 rounded-full bg-terra border-2 border-ink mt-[0.45rem]"
      />
      <span className="font-display text-[14px] leading-snug text-ink">{children}</span>
    </li>
  )
}


export default function Welcome() {
  const navigate = useNavigate()
  // Snapshot the flag on the FIRST render, before the effect below sets it —
  // otherwise marking-on-mount would immediately redirect the panel away.
  const [alreadySeen] = useState(hasSeenWelcome)
  const [panel, setPanel] = useState(0)
  // The notifications step (panel 3). `availability` is read ONCE on mount rather than per render:
  // it cannot change while this screen is open (installing to the home screen restarts the app),
  // and reading it in the render body would recompute a `matchMedia` query on every keystroke
  // elsewhere in the tree.
  const [availability] = useState(pushAvailability)
  const [notify, setNotify] = useState('idle') // idle | busy | on | error
  const [notifyError, setNotifyError] = useState('')

  // PRIME THE SERVER KEY ON MOUNT, NOT ON THE TAP — the constraint is in `lib/push.js`'s own
  // header and this panel was the only one of three call sites to skip it.
  //
  // `enable()` awaits `primeVapidKey()` (an uncached GET) BEFORE `Notification.requestPermission()`,
  // and the permission prompt has to be reached while the tap's USER ACTIVATION is still live —
  // WebKit's window is a couple of seconds, while this app's axios client allows 45s because the API
  // can cold-start. So on a slow connection or a cold ECS task, an unprimed tap means Safari refuses
  // the prompt outright.
  //
  // The HAZARD is WebKit-specific, but the BUTTON is not — `pushAvailability()` returns 'ready' for
  // desktop Chrome/Edge/Firefox and Android Chrome too; what iOS-in-a-tab returns is 'install-first',
  // which renders the Add-to-Home-Screen copy instead and never reaches this button. An earlier
  // version of this comment said an installed iPhone was "the ONLY platform where this button
  // renders", which would tell the next person the priming is an iOS-only concern. It isn't: it is
  // cheap everywhere and load-bearing on the platform most of this audience is on.
  //
  // `NotifyNudge` and `NotificationSettings` both prime in a mount effect with a comment saying why;
  // this one didn't. Found by the ship gate.
  useEffect(() => {
    // `.catch(() => {})` is the convention `lib/push.js`'s own header states, and both sibling
    // call sites follow it: on a failed GET the function nulls its cache and RE-THROWS inside the
    // chain, so an unhandled rejection would land on the one screen every new account passes
    // through. Swallowing is right here — this is a prefetch, and the tap path re-fetches and
    // surfaces its own message.
    if (availability === 'ready') primeVapidKey().catch(() => {})
  }, [availability])

  async function askForNotifications() {
    setNotify('busy')
    setNotifyError('')
    const result = await enable()
    if (result.ok) {
      setNotify('on')
      // The Home strip's job is done — without this it would ask again on the very next screen,
      // which reads as the app not having heard the yes. Same key `NotificationSettings` sets.
      setPref('notifyNudgeDismissed', true)
    } else {
      setNotify('error')
      setNotifyError(result.message)
    }
  }

  useEffect(() => {
    markWelcomeSeen()
  }, [])

  // A second arrival — a typed URL, a restored tab — gets nothing. This is what
  // makes skipping exactly as final as finishing.
  if (alreadySeen) return <Navigate to="/" replace />

  const done = () => navigate('/', { replace: true })

  return (
    // max-w-app centred, matching every other screen. Without it this page was
    // the one place that sprawled to the full window on a desktop browser —
    // /welcome sits outside App's Layout wrapper, so it has to set its own width.
    <div className="min-h-screen bg-cream">
      <div className="max-w-app mx-auto px-5 pt-6">
        {/* Skip sits in the header on EVERY panel, at the same coordinates, so it never has to be
          hunted for and nobody is one panel from being stuck. After the first, the wordmark gives way
          to Back: a forward-only intro means a mistaken tap costs you the explanation permanently,
          since the welcome never runs again. The wordmark isn't load-bearing here — they just came
          from a screen with it. */}
        <div className="flex items-baseline justify-between">
          {panel === 0 ? (
            <Wordmark size="sm" />
          ) : (
            <button
              onClick={() => setPanel((p) => p - 1)}
              className="chip shadow-[0_2px_0_#2E3A24] sticker-press"
            >
              &larr; Back
            </button>
          )}
          {/* THE QUIET CONTROLS ARE CHIPS, not underlined text (owner's note: they did not look like
              buttons, and the underlines made them read as links). `.chip` is the app's own outlined
              pill — ink border, cream fill — so they are unmistakably pressable while staying clearly
              secondary to the terra `btn-primary`. Same treatment on Back, Skip and "Not now", since
              all three are the same KIND of control: a way out that is not the main act. */}
          <button onClick={done} className="chip shadow-[0_2px_0_#2E3A24] sticker-press">
            Skip
          </button>
        </div>

        {panel === 0 ? (
          /* PANEL 1 — WHAT ISSEI IS, AS IT IS NOW. This replaces two panels, and the pair it
             replaced had gone stale in a way worth recording rather than quietly deleting.

             The old panel 2 said "So there are two things to do" — write a recipe, send it to
             someone — and then, in a peach box, "THAT'S THE WHOLE APP." That was true when it was
             written. It stopped being true twice: #67 made a FEED OF POSTS the app's Home, and #79
             made ASKING for a recipe a first-class act. So every new account was told the app was
             two verbs and then dropped onto a feed that panel never mentioned, while the act the
             whole loop now turns on was absent from onboarding entirely. The owner spotted the
             framing as "the old version of the app"; it was worse than tone — it was a false claim.

             The old panel 1 had the same slant: "Recipes kept their way / Not grams. Theirs." is the
             FIDELITY promise, which POSITIONING calls the supporting layer, not the door.

             So: the sequence, in the order POSITIONING states it — presence, the ask, the handoff.
             `RecipeGlimpse` still does the heavy lifting, because a sample beats a sentence here (its
             own docstring records two rounds of user testing that proved it). The name is glossed
             last, once there is a reason to care.

             OVERLAP WITH `/join` IS DELIBERATELY SMALL. A referred person sees both — `/join` while
             deciding, this while starting — so this panel does NOT re-run the pitch. It states the
             three beats in one line each and shows the payload. */
          <div className="pt-6">
            <StepBadge>1 of 3</StepBadge>
            <h1 className="font-display font-medium text-[30px] leading-[1.08] text-ink mt-4 max-w-[17rem]">
              See it, ask for it, <span className="font-black italic">cook it.</span>
            </h1>
            <ul className="list-none m-0 p-0 mt-5 space-y-3 max-w-xs">
              <NotifyLine>Friends post what they cooked. That is your Home.</NotifyLine>
              <NotifyLine>See one you want? Ask them for the recipe.</NotifyLine>
              <NotifyLine>What arrives is the dish the way they really make it:</NotifyLine>
            </ul>
            <RecipeGlimpse className="mt-4" />
            <IsseiMeaning className="mt-5 px-0.5" />
            <button onClick={() => setPanel(1)} className="btn-primary !mt-7">
              Next &rarr;
            </button>
          </div>
        ) : panel === 1 ? (
          /* PANEL 2 — THE FIRST ACTION, AND THE ONE THE APP ACTUALLY NEEDS. Onboarding used to ask
             for a profile photo and notification permission: two things that produce no CONTENT, on
             an app whose Home is empty until somebody posts. A new account that finishes onboarding
             having published nothing has nothing to come back to, and neither does anyone who
             follows them.

             A MEAL, NOT A RECIPE, and that is the whole reason this converts: a post is a photo and a
             dish name — seconds — whereas writing a recipe cold is the heaviest thing the app asks of
             anyone, and that form has already been trimmed twice for reading as a chore. A post is
             also the top of the funnel by design: it is what earns an ask, which is what produces a
             recipe. So the light action feeds the heavy one instead of competing with it.

             SKIPPABLE, with a real fallback, like every other action step here: "Not now" advances,
             and Home's own empty state carries a "📸 Share a meal" button to the same route. Nobody
             who skips is stranded, and nobody is asked twice on the same screen. */
          <div className="pt-6">
            <StepBadge>2 of 3</StepBadge>
            <h1 className="font-display font-medium text-[30px] leading-[1.08] text-ink mt-4 max-w-[17rem]">
              What did you cook <span className="font-black italic">lately?</span>
            </h1>
            <p className="font-display text-[15px] leading-snug text-ink-soft mt-2.5 max-w-xs">
              A photo and the name of the dish. That is the whole post.
            </p>
            {/* THE EXAMPLE, rather than a description of one. Same dish and cook as panel 1's recipe,
                so the two panels read as one story: this is the post, that is what somebody gets when
                they ask you for it. `showAsk={false}` because here the reader IS the cook — an ask
                control on your own meal is nonsense. */}
            <MealGlimpse showAsk={false} className="mt-5" />
            <button
              onClick={() => navigate('/add/meal')}
              className="btn-primary !mt-7"
            >
              Share a meal &rarr;
            </button>
            {/* "Not now", not "Skip": the header's Skip ends the whole intro, this advances one
                panel. Two words that do different things must not share a label. Centred under the
                full-width primary, as a chip rather than an underlined link. */}
            <div className="text-center mt-4">
              <button onClick={() => setPanel(2)} className="chip shadow-[0_2px_0_#2E3A24] sticker-press">
                Not now
              </button>
            </div>
          </div>
        ) : (
          /* PANEL 4 — NOTIFICATIONS (#110). An ACTION step like the photo, not teaching, and
           deliberately LAST.

           WHY ASK HERE AT ALL. Before this, the only prompt was `NotifyNudge`, a dismissible strip
           on Home — so someone had to happen across it. The owner's call was that a new person
           should be asked up front, and the person-level preferences already default to on, so the
           browser permission was the only thing still unasked.

           THE THREE LINES MAP 1:1 ONTO THE THREE SETTINGS, and they have to, because this is a
           consent screen and it was WRONG. The first version said "Two things, and nothing else:"
           over two bullets — and both ship gates independently found that false. Nine kinds of push
           can reach a new account on the defaults, and the two bullets covered four; uncovered were
           `recipe_kept`, `recipe_claimed`, `friend_request`, `friend_accept`, and — worst — the
           FRIEND-POST push, which is on by default and is likely the highest-volume notification
           the person will ever get. A post is emphatically not a recipe in this product, so "sends
           you one" could not be read to cover it.

           Over-specifying is the same harm as under-specifying on the one screen whose entire job
           is buying an irrevocable permission with an honest disclosure: the person consented to a
           scope the app doesn't keep. And the test asserted the false sentence, which is the #103
           PhotoFramer shape exactly — copy claiming a behaviour that doesn't exist, held in place by
           a test.

           Three lines is now both honest AND complete, because "kinds" is the axis the settings
           already use: `notify_people`, `notify_friend_posts`, `notify_prompt_me`. Anything new must
           either fit one of these three or add a fourth line here as well as a fourth switch.

           WHY THE SYSTEM DIALOG IS NOT FIRED ON MOUNT, which is the version of "ask on first
           launch" that costs you the user. A permission prompt is ONE SHOT: a decline sets
           `denied` for the origin permanently, and no web app can ask again — the person has to go
           into browser settings. So the panel spends a screen naming what actually arrives — THREE
           lines, one per gate; see the block above, which is also where the first version's false
           "two things, and nothing else" is recorded — BEFORE the dialog appears, and the dialog is
           behind a tap. A primed ask converts;
           a cold one at the coldest possible moment is how an app loses people who would have said
           yes later. `NotifyNudge` encodes the same rule from the other end: it hides on `denied`,
           because they answered.

           WHY IT IS STILL SKIPPABLE. Skip in the header finishes, and "Not now" advances without
           touching permission — which leaves `permission === 'default'`, which is exactly the state
           `NotifyNudge` shows for. So skipping here costs nothing; only a real decline is final.

           ON AN IPHONE IN SAFARI THERE IS NOTHING TO ASK. Push is granted only to a site added to
           the home screen, so `pushAvailability()` is 'install-first' and this panel shows the
           install instruction instead of a button that cannot work. That is not an edge case —
           iPhones are most of this app's audience, and "when they first download the app" has no
           download on iOS, it has Add to Home Screen. Same reasoning as
           `NotificationSettings.jsx`, and the same refusal to render a control that would fail. */
          <div className="pt-6">
            <StepBadge>3 of 3</StepBadge>
            <h1 className="font-display font-medium text-[30px] leading-[1.08] text-ink mt-4 max-w-[17rem]">
              Know when it <span className="font-black italic">happens.</span>
            </h1>

            {availability === 'ready' ? (
              <>
                <p className="font-display text-[15px] leading-snug text-ink-soft mt-2.5 max-w-xs">
                  Three kinds. You can switch any of them off later:
                </p>
                <ul className="mt-4 space-y-3 max-w-xs">
                  <NotifyLine>
                    When someone reaches you — asks for a recipe, sends you one, adds you as
                    a friend.
                  </NotifyLine>
                  <NotifyLine>When a friend shares a meal.</NotifyLine>
                  <NotifyLine>
                    A nudge to share what you cooked. You choose how often.
                  </NotifyLine>
                </ul>

                {notify === 'on' ? (
                  <>
                    <p className="font-display font-bold text-[15px] text-ink mt-7">
                      You&rsquo;re set. ✓
                    </p>
                    <button onClick={done} className="btn-primary !mt-4">
                      Open my kitchen →
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={askForNotifications}
                      disabled={notify === 'busy'}
                      className="btn-primary !mt-7 disabled:opacity-60"
                    >
                      {notify === 'busy' ? 'One moment…' : 'Turn on notifications'}
                    </button>
                    {notifyError && (
                      <p className="mt-3"><span className="error-pill">{notifyError}</span></p>
                    )}
                    {/* "Not now" rather than "Skip": it finishes without touching permission, so
                      the Home strip can still ask. Wording matters — "Never" would be a promise
                      this button doesn't keep. A chip like the other quiet controls, centred under
                      the full-width primary. */}
                    <div className="text-center mt-4">
                      <button
                        onClick={done}
                        className="chip shadow-[0_2px_0_#2E3A24] sticker-press"
                      >
                        Not now
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : availability === 'install-first' ? (
              <>
                <p className="font-display text-[15px] leading-snug text-ink-soft mt-2.5 max-w-xs">
                  Add issei to your home screen and notifications become available. Tap
                  Share, then &ldquo;Add to Home Screen&rdquo;.
                </p>
                <p className="font-display italic text-[13px] text-ink-soft mt-3 max-w-xs">
                  It also opens without the browser bars, which is nicer to cook from.
                </p>
                <button onClick={done} className="btn-primary !mt-7">
                  Open my kitchen →
                </button>
              </>
            ) : (
              <>
                {/* NOT "everything still shows up in your inbox", which the first version said and
                  which is false twice: the daily nudge writes no notification row at all (see
                  `services/prompt.py` — it imports `PromptSend`, never `Notification`), and the
                  friend-post push deliberately writes none either, because the feed's `is_new` mark
                  is its persistent half. Naming what DOES land is both true and more useful. */}
                <p className="font-display text-[15px] leading-snug text-ink-soft mt-2.5 max-w-xs">
                  This browser can&rsquo;t do notifications. Asks and arrivals still wait for
                  you in your inbox; the daily nudge just won&rsquo;t reach you.
                </p>
                <button onClick={done} className="btn-primary !mt-7">
                  Open my kitchen →
                </button>
              </>
            )}
          </div>
        )}

        {/* Progress, under the fold-line rather than above the headline: it's
          reassurance, not the point of the screen. */}
        <div className="flex justify-center gap-2 pt-7 pb-8" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`w-2.5 h-2.5 rounded-full border-2 border-ink ${
                i === panel ? 'bg-terra' : 'bg-cream'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
