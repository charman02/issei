import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import RecipeGlimpse from '../components/RecipeGlimpse'
import IsseiMeaning from '../components/IsseiMeaning'
import Wordmark from '../components/Wordmark'
import Avatar from '../components/Avatar'
import { loadPrefs, setPref } from '../lib/prefs'
import { PHOTO_ACCEPT } from '../lib/photoUpload'
import { useAvatarUpload } from '../lib/useAvatarUpload'
import PhotoFramer from '../components/PhotoFramer'

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
// WHY (NOW) THREE PANELS. Two panels TEACH — what issei is for, and how to use
// it — and the rule used to be "never three", because a third TEACHING panel is a
// carousel and testers punished tap-heavy onboarding. The third panel added here is
// NOT teaching: it's a single ACTION (add a profile photo). An action step as the
// last thing before "you're in" is the standard onboarding shape (it converts because
// it's isolated and prominent), and it's categorically different from another wall of
// text to absorb. It stays honest by being genuinely optional — Skip in the header and
// "Open my kitchen" both finish with or without a photo, no hard gate. So the rule is
// really "at most two TEACHING panels"; the photo step is the exception that proves it.
// (The You page also nudges anyone who skips — see #77 — so this panel maximizes
// photo adoption without becoming a gate.)
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

// The signed-in user's first name, for the photo panel's monogram fallback.
function currentUserName() {
  try {
    return JSON.parse(localStorage.getItem('issei_user') || 'null')?.first_name ?? ''
  } catch {
    return ''
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

// A numbered how-to row: the action as a heading, the mechanics beneath. The
// numeral is a sticker disc so the two steps read as a sequence, not a menu.
function HowToStep({ n, title, children }) {
  return (
    <li className="flex gap-3.5">
      <span className="flex-none flex items-center justify-center w-8 h-8 rounded-full bg-sage border-2 border-ink shadow-[0_2px_0_#2E3A24] font-display font-black text-[15px] text-ink">
        {n}
      </span>
      <span className="min-w-0 pt-0.5">
        <span className="block font-display font-black text-[17px] leading-tight text-ink">
          {title}
        </span>
        <span className="block font-display text-[13.5px] leading-snug text-ink-soft mt-1">
          {children}
        </span>
      </span>
    </li>
  )
}

export default function Welcome() {
  const navigate = useNavigate()
  // Snapshot the flag on the FIRST render, before the effect below sets it —
  // otherwise marking-on-mount would immediately redirect the panel away.
  const [alreadySeen] = useState(hasSeenWelcome)
  const [panel, setPanel] = useState(0)
  // The photo step (panel 2). photoUrl reflects the just-uploaded avatar so the panel
  // shows it immediately; uploading drives the busy state on the picker.
  const {
    onPick,
    uploading: uploadingPhoto,
    error: photoError,
    photoUrl,
    framerProps,
  } = useAvatarUpload()

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
      {/* The framing step (#103) — real DOM in this tree so the overlay inherits the app's styles.
          Null file renders nothing. */}
      {framerProps?.file && <PhotoFramer {...framerProps} />}
      <div className="max-w-app mx-auto px-5 pt-6">
        {/* Skip sits in the header on BOTH panels, at the same coordinates, so it
          never has to be hunted for and nobody is one panel from being stuck.
          On panel two the wordmark gives way to Back: a forward-only intro means
          a mistaken tap costs you the explanation permanently, since the welcome
          never runs again. The wordmark isn't load-bearing here — they just came
          from a screen with it. */}
        <div className="flex items-baseline justify-between">
          {panel === 0 ? (
            <Wordmark size="sm" />
          ) : (
            <button
              onClick={() => setPanel((p) => p - 1)}
              className="font-display font-bold text-[14px] text-ink-soft"
            >
              &larr; Back
            </button>
          )}
          <button
            onClick={done}
            className="font-display font-bold text-[14px] text-terra underline underline-offset-2"
          >
            Skip
          </button>
        </div>

        {panel === 0 ? (
          /* PANEL 1 — WHAT IT'S FOR, in as few words as possible.
           The owner cut this panel's prose: a new user shouldn't have to READ a
           paragraph to learn what the app is. So the headline makes the claim and
           the sample recipe below it IS the evidence — you can see "3 soup spoons"
           left alone faster than you can read a sentence saying amounts are left
           alone. The name is glossed last, once there's a reason to care. */
          <div className="pt-6">
            <StepBadge>1 of 3</StepBadge>
            <h1 className="font-display font-medium text-[30px] leading-[1.08] text-ink mt-4 max-w-[17rem]">
              Recipes kept <span className="font-black italic">their way.</span>
            </h1>
            <p className="font-display text-[15px] leading-snug text-ink-soft mt-2.5 max-w-xs">
              Not grams. Theirs.
            </p>

            <RecipeGlimpse className="mt-5" />
            <IsseiMeaning className="mt-5 px-0.5" />

            <button onClick={() => setPanel(1)} className="btn-primary !mt-7">
              Next &rarr;
            </button>
          </div>
        ) : panel === 1 ? (
          /* PANEL 2 — HOW TO USE IT. Two steps because the app really only has
           two verbs; naming the actual controls ("＋", "Send this to someone")
           rather than paraphrasing them means the words they just read are the
           words they'll find on screen. */
          <div className="pt-6">
            <StepBadge>2 of 3</StepBadge>
            <h1 className="font-display font-medium text-[30px] leading-[1.08] text-ink mt-4 max-w-[17rem]">
              So there are two things{' '}
              <span className="font-black italic">to do.</span>
            </h1>

            <ul className="list-none m-0 p-0 mt-6 space-y-6">
              <HowToStep n="1" title="Write a recipe">
                Tap the <span className="font-bold text-terra">&#65291;</span>{' '}
                in the bar at the bottom and write a dish down the way
                it&rsquo;s really made.
              </HowToStep>
              <HowToStep n="2" title="Send it to someone">
                Open a recipe and tap &ldquo;Send this to someone&rdquo;. They
                get a link — once they make an account, it&rsquo;s in their
                kitchen for good.
              </HowToStep>
            </ul>

            <div className="sticker bg-peach px-5 py-4 mt-7">
              <p className="font-display text-[14px] leading-snug text-ink">
                That&rsquo;s the whole app. Nothing you keep is shared with
                anyone until you choose to share it.
              </p>
            </div>

            <button onClick={() => setPanel(2)} className="btn-primary !mt-7">
              Next &rarr;
            </button>
          </div>
        ) : (
          /* PANEL 3 — THE ONE ACTION: add a profile photo. Last, so it's the "you're
           all set" moment, not a gate between the teaching. Genuinely optional: Skip in
           the header finishes, and "Open my kitchen" works with or without a photo. Once
           a photo is picked the button label switches to the finish so the flow moves on
           without a second tap; anyone who skips gets the You-page nudge (#77). */
          <div className="pt-6">
            <StepBadge>3 of 3</StepBadge>
            <h1 className="font-display font-medium text-[30px] leading-[1.08] text-ink mt-4 max-w-[17rem]">
              Add a <span className="font-black italic">photo.</span>
            </h1>
            <p className="font-display text-[15px] leading-snug text-ink-soft mt-2.5 max-w-xs">
              So the people you cook with recognize you. You can always change it later.
            </p>

            <div className="flex flex-col items-center mt-8">
              <label
                className="relative inline-block cursor-pointer"
                aria-busy={uploadingPhoto || undefined}
              >
                <input
                  type="file"
                  accept={PHOTO_ACCEPT}
                  onChange={onPick}
                  aria-label="Add a profile photo"
                  className="sr-only"
                />
                <Avatar name={currentUserName()} photoUrl={photoUrl} size="xl" bg="bg-plum" />
                <span className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-terra text-cream border-2 border-ink flex items-center justify-center text-[13px] shadow-[0_2px_0_#2E3A24]">
                  {uploadingPhoto ? '…' : photoUrl ? '✓' : '＋'}
                </span>
              </label>
              <span className="font-display text-[13px] text-ink-soft mt-3">
                {photoUrl ? 'Looking good.' : 'Tap to add a photo'}
              </span>
              {photoError && (
                <p className="mt-2"><span className="error-pill">{photoError}</span></p>
              )}
            </div>

            <button onClick={done} className="btn-primary !mt-8">
              {photoUrl ? 'Open my kitchen →' : 'Skip for now →'}
            </button>
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
