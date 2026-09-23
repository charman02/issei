import { useState } from 'react'
import { handoffRecipe } from '../api/sharing'
import { toUserMessage } from '../api/client'
import { defaultInviteMessage } from '../lib/inviteMessage'
import { shareOrCopy } from '../lib/shareLink'

// Hand this recipe to someone — send them a link that opens it.
//
// Copy note (round-2 user testing): "Pass it on" told people nothing about what
// the button would DO, and several worried it published their family recipe. The
// strings here state the mechanism instead, and every privacy claim below is one
// verified in the backend:
//   · POST /recipes/{id}/handoff only mints a Handoff token — it never touches
//     `visibility`, and GET /recipes/browse filters on effective_visibility() ==
//     "public", so a handed-off private recipe still cannot appear in Browse.
//   · GET /recipes/invite/{token} returns the whole recipe to ANYONE holding the
//     token, with no account required, and POST /invite/{token}/claim grants a
//     second (and third) claimer their own grant on purpose. So the honest line
//     is "whoever has the link", NOT "only the person you send it to" — the link
//     is the permission, and a forwarded link works. We say so rather than
//     implying a per-person lock the code doesn't enforce.
//
// Two stages:
//   1. COMPOSE — an optional note (+ optional email, which ADDRESSES the grant to a person:
//      an address that belongs to an account is granted the recipe at send time and notified;
//      one that doesn't stays a pending invite that signup claims. It used to be only the
//      second of those, which was a bug rather than a design — see CLAUDE.md, "An ADDRESS that
//      belongs to an account is a PERSON"). Neither field is required: the fast path is just
//      tapping the button to mint a link.
//   2. SHARE   — the invite link, with the native share sheet (iMessage/WhatsApp/
//      anything) and a copy fallback. This stage is the whole point: previously
//      the token was minted and thrown away, so the recipient was never told.
//
// `onDone` fires when the sender finishes (after sharing) — callers used to get
// `onSent` immediately on send, which skipped the share step entirely.
export default function HandoffInvite({
  recipeId,
  recipeName = 'this recipe',
  recipeVisibility = 'private',
  onSent,
  onSkip,
  // HandoffPage prints its own "Send {recipe}" header + subline, so it suppresses
  // this component's — otherwise the same "you'll get a link…" line appeared twice
  // on one screen. The post-save flow in PlantRecipe has no header, so it keeps it.
  showHeading = true,
}) {
  // The dish name for message-building. recipeName defaults to the prose string
  // "this recipe"; that's fine in a sentence but must not be treated as a real dish
  // name, so it collapses to empty and the message uses its dish-less fallback.
  const dishName = recipeName === 'this recipe' ? '' : recipeName

  // WAS THIS ASKED FOR? The app cannot know, and the answer changes the truest sentence available.
  //
  // "You asked for my Adobo recipe" is the product's own one-liner, and it is the right words
  // whenever someone actually asked. But an in-app request never reaches this screen — it is
  // answered at /requests via fulfillPost(), which mints grants server-side without rendering the
  // share stage — so what arrives here is either an unprompted send or the founding case: someone
  // who asked AT THE TABLE, which leaves no trace in any database.
  //
  // So neither default is honest, and the sender is the only party who knows. Two chips, one tap,
  // and the message rewrites itself. `asked` starts false because the unprompted case is the one
  // the app has evidence for. An earlier version of this screen had starter chips and they were
  // removed for restating the default — these don't: they pick between two different claims.
  const [asked, setAsked] = useState(false)
  const defaultMessage = defaultInviteMessage({ recipeName: dishName, asked })
  const [email, setEmail] = useState('')
  const [note, setNote] = useState(defaultMessage)

  // Switching the occasion rewrites the box — unless the sender has written their own words, which
  // must never be thrown away by a tap on a chip. `touched` is what separates "still the app's
  // sentence" from "theirs".
  const [touched, setTouched] = useState(false)
  function chooseOccasion(next) {
    setAsked(next)
    if (!touched) setNote(defaultInviteMessage({ recipeName: dishName, asked: next }))
  }
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [handoff, setHandoff] = useState(null) // set once created → share stage
  const [copied, setCopied] = useState(false)

  const inviteUrl = handoff?.token
    ? `${window.location.origin}/invite/${handoff.token}`
    : ''

  async function send() {
    setError('')
    setSending(true)
    try {
      // The message is NOT sent to the server (#102). It used to be stored on the handoff row and
      // read by nothing; the owner's call was to stop keeping it, so it lives only in the share text
      // below and in the sender's own texting app.
      const { data } = await handoffRecipe(recipeId, {
        to_email: email.trim() || null,
      })
      setHandoff(data)
    } catch (err) {
      setError(toUserMessage(err, 'Could not send. Try again.'))
    } finally {
      setSending(false)
    }
  }

  // The exact string that goes out: the sender's sentence, then the link.
  //
  // The note is pre-seeded with the default message, so it's normally non-empty; if the sender
  // cleared it, fall back to the same sender+dish default rather than a bare link.
  function shareText() {
    const body = note.trim() || defaultMessage
    return `${body}\n\n${inviteUrl}`
  }

  async function share() {
    // DELEGATED TO `lib/shareLink` since a SECOND caller appeared (the referral share, #111), and
    // the three cases it holds were each a bug shipped once: a dismissed sheet is NOT a failure
    // (AbortError — say nothing, or "Copied ✓" flashes at someone who had just decided not to
    // send); a real rejection DOES fall through to the clipboard (Safari's NotAllowedError outside
    // a user gesture); and with no sheet at all the WHOLE message is copied rather than a bare URL,
    // because the sentence is what the compose stage exists to write. One implementation of that,
    // not two — the `services/media.py` lesson applied to the frontend.
    const outcome = await shareOrCopy({
      title: `${recipeName} — issei`,
      text: shareText(),
    })
    if (outcome === 'shared' || outcome === 'cancelled') return
    if (outcome === 'copied') {
      // 'message', not 'link' — this path put the SENTENCE on the clipboard as well, and the
      // confirmation has to name what was actually taken, on the button that was tapped.
      setCopied('message')
      setTimeout(() => setCopied(false), 2400)
      return
    }
    setError('Could not copy. Select the link and copy it manually.')
  }

  // `what` decides the confirmation wording, because the two callers copy different things and a
  // single "Copied ✓" can't tell a sender which one they got.
  async function copy(value = inviteUrl, what = 'link') {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(what)
      setTimeout(() => setCopied(false), 2400)
    } catch {
      setError('Could not copy. Select the link and copy it manually.')
    }
  }

  // ---- STAGE 2: share the link ----
  if (handoff) {
    return (
      <div className="px-[18px] py-6 text-center">
        <span className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-sage border-[2.5px] border-ink shadow-[0_4px_0_#2E3A24]">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="w-8 h-8">
            <path
              d="M5 12.5l4.5 4.5L19 7.5"
              stroke="#2E3A24"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <h1 className="font-display font-black text-[26px] text-ink leading-tight mt-5">
          Your link is ready
        </h1>
        <p className="font-display italic text-[14px] text-ink-soft mt-2 mb-5">
          Send it however you text them. Opening it shows them {recipeName} —
          no account needed to read and cook it.
        </p>

        {/* the link itself, visible so it never feels like nothing happened */}
        <p className="sticker bg-card px-3 py-2.5 font-mono text-[11.5px] text-ink-soft break-all text-left mb-4">
          {inviteUrl}
        </p>

        {/* The confirmation lands on the button that was pressed. It used to live only on "Copy
            link", so a sender on a browser with no share sheet tapped the PRIMARY button, got
            silence there, and had to notice a tick appear on a different control. */}
        <button onClick={share} className="btn-primary">
          {copied === 'message' ? 'Copied — paste it in your message ✓' : 'Share the link'}
        </button>
        <button
          onClick={() => copy()}
          className="w-full mt-3 py-2.5 rounded-full bg-cream border-2 border-ink text-ink font-display font-bold text-[14px] shadow-[0_3px_0_#2E3A24] transition-transform active:translate-y-[2px] active:shadow-[0_1px_0_#2E3A24]"
        >
          {copied === 'link' ? 'Copied ✓' : 'Copy just the link'}
        </button>

        {error && (
          <p className="mt-3">
            <span className="error-pill">{error}</span>
          </p>
        )}

        {/* Said here, at the moment the link exists, because this is when someone
            decides who to forward it to. It's the literal rule the server
            enforces: preview_invite authorizes on the token alone, so a
            forwarded link opens the recipe too. Better they know than assume a
            lock we don't have. */}
        <p className="font-display italic text-[12.5px] text-ink-soft mt-4">
          Anyone who has this link can open the recipe, so send it to the people
          you mean it for.
        </p>

        {email.trim() && (
          /* TRUE IN BOTH CASES, AND DELIBERATELY DOES NOT SAY WHICH. This used to read "When
             {email} signs up, this recipe will be waiting for them", which the grant-binding fix
             (2026-09-23) made false for the common case: an address that belongs to an account is
             now resolved, bound and ACCEPTED at send time, so the recipe is on their shelf already
             and they have been notified. Nothing is waiting for a signup that has happened.

             The response carries `state` ("accepted" vs "pending"), so this could branch and say
             which — and that would be more useful. It does not, because the branch would tell the
             sender whether that address has an account, and `handoff_recipe` refuses to answer that
             question on the `invite_permission` path (every refusal there is the same 404 a block
             and an unknown user get). The app does disclose account existence elsewhere on purpose
             (signup answers "Email already registered"; #80 lists every user by name), so branching
             is a defensible product call rather than a leak — it just isn't one to make silently
             while fixing a bug. One sentence that is true either way costs nothing here. */
          <p className="font-display italic text-[12.5px] text-ink-soft mt-2">
            {email.trim()} gets this recipe in their kitchen — now if they&rsquo;re on
            issei, when they join if they&rsquo;re not.
          </p>
        )}

        <button
          onClick={() => onSent?.(handoff)}
          className="block w-full mt-4 font-display italic text-ink-soft text-sm"
        >
          Done
        </button>
      </div>
    )
  }

  // ---- STAGE 1: compose ----
  return (
    <div className="px-[18px] py-6 text-center">
      {/* Heading only where the surrounding page hasn't already printed one
          (see showHeading). The post-save flow has no page header, so it needs
          this; HandoffPage suppresses it to avoid saying the same thing twice. */}
      {showHeading && (
        <>
          <h1 className="font-display font-black text-[26px] text-ink leading-tight">
            Who else should
            <br />
            have this recipe?
          </h1>
          <p className="font-display italic text-[14px] text-ink-soft mt-2 mb-5">
            {recipeVisibility === 'public'
              ? 'You’ll get a link to send. This recipe is already in Browse for anyone to find.'
              : 'You’ll get a link to send. Whoever opens it can read and cook it, no account needed.'}
          </p>
        </>
      )}
      {/* The reassurance testers asked for — a private recipe stays out of Browse — stated only as
          strongly as the backend backs up (handoff mints a grant and leaves visibility alone).
          THREE-WAY, because two of the three values are not the same promise. "only someone with
          the link can open it" was shown for `friends` too, and for a friends recipe it is simply
          false: `GET /recipes/users/{id}` is can_view-gated so every accepted friend already opens
          it from your profile grid with no link at all. It also contradicted `VisibilityControl`
          one tap earlier on the same recipe ("Only the people you're friends with on issei can see
          it"). `friends` is the DEFAULT for every new recipe, so the wrong branch was the common
          one. */}
      {recipeVisibility !== 'public' && (
        <p className="font-display text-[12.5px] text-ink leading-snug bg-sage/40 border-2 border-ink rounded-[12px] px-3 py-2 mb-4 text-left">
          {recipeVisibility === 'friends'
            ? 'This won’t put your recipe in Browse. Your friends on issei can already open it — the link is how you reach anyone else.'
            : 'This won’t put your recipe in Browse — only someone with the link can open it.'}
        </p>
      )}
      {/* THE OCCASION. Two chips, because the app can't tell which one this is and the sender can
          — see the long note beside `asked` above. Tapping one rewrites the message below, but only
          while it is still the app's sentence: once the sender has typed, their words win and the
          chips just record the occasion. */}
      <p className="section-label mb-1.5 text-left">Your message</p>
      <div className="flex gap-2 mb-2">
        {[
          [true, 'They asked for it'],
          [false, 'Just because'],
        ].map(([value, label]) => (
          <button
            key={label}
            type="button"
            onClick={() => chooseOccasion(value)}
            aria-pressed={asked === value}
            className={`chip ${asked === value ? '!bg-saffron' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>
      {/* Pre-filled so the sender never faces a blank box; fully editable, and goes out in their own
          text message with the link. */}
      <textarea
        placeholder="Say something with it… (optional)"
        value={note}
        onChange={(e) => {
          setNote(e.target.value)
          setTouched(true)
        }}
        rows={3}
        aria-label="Your message"
        className="field resize-none mb-1.5"
      />
      <p className="font-display italic text-[12px] text-ink-soft mb-3 text-left">
        This goes in your text, with the link.
      </p>
      <input
        type="email"
        placeholder="Their email (optional)"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="field mb-1.5"
      />
      {/* Deliberately does NOT say "we'll email them" — nothing on this path sends mail
          (`handoff_recipe` never touches `services/email.py`). That half is unchanged.

          What the address DOES has two cases since the grant-binding fix: if it belongs to an
          account, the recipe is granted to that person at send time and they are notified; if it
          doesn't, the invite waits and signup claims it. This line used to say only the second
          ("if they sign up"), which was the bug's own description. Worded to cover both without
          saying which — see the note on the share-stage line. */}
      <p className="font-display italic text-[12px] text-ink-soft mb-3">
        We won&rsquo;t email them — you send the link. Their address also keeps the
        recipe for them.
      </p>
      {error && (
        <p className="mb-3">
          <span className="error-pill">{error}</span>
        </p>
      )}
      <button
        onClick={send}
        disabled={sending}
        className="btn-primary disabled:opacity-50"
      >
        {sending ? 'Getting your link…' : 'Get a link to send'}
      </button>
      <button
        onClick={onSkip}
        className="block w-full mt-3 font-display italic text-ink-soft text-sm"
      >
        Skip for now
      </button>
    </div>
  )
}
