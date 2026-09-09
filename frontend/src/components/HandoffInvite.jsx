import { useState } from 'react'
import { handoffRecipe } from '../api/sharing'
import { toUserMessage } from '../api/client'
import { defaultInviteMessage } from '../lib/inviteMessage'

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
//   1. COMPOSE — an optional note (+ optional email, which enables auto-accept
//      when that address signs up). Neither is required: the fast path is just
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

  // The note field defaults to a warm, ready-to-send message in the sender's own
  // voice ("Here's my Adobo recipe — I wanted you to have it 💛") — the app is about
  // that handoff, so the sender shouldn't face a blank box. It's fully editable. The
  // one-tap starter chips were removed: the default already carries the warm "I
  // wanted you to have it" intent, so a "You'd love this" chip just restated it, and
  // the second chip is better served by the sender typing their own line.
  const defaultMessage = defaultInviteMessage({ recipeName: dishName })
  const [email, setEmail] = useState('')
  const [note, setNote] = useState(defaultMessage)
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
      const { data } = await handoffRecipe(recipeId, {
        to_email: email.trim() || null,
        note: note.trim() || null,
      })
      setHandoff(data)
    } catch (err) {
      setError(toUserMessage(err, 'Could not send. Try again.'))
    } finally {
      setSending(false)
    }
  }

  async function share() {
    // The note is pre-seeded with the default message, so it's normally non-empty;
    // if the sender cleared it, fall back to the same sender+dish default rather
    // than a bare link.
    const body = note.trim() || defaultMessage
    const text = `${body}\n\n${inviteUrl}`
    // Native share sheet where available (mobile); clipboard fallback elsewhere.
    if (navigator.share) {
      try {
        await navigator.share({ title: `${recipeName} — issei`, text })
        return
      } catch {
        // user dismissed the sheet, or share failed — fall through to copy
      }
    }
    copy()
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
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

        <button onClick={share} className="btn-primary">
          Share the link
        </button>
        <button
          onClick={copy}
          className="w-full mt-3 py-2.5 rounded-full bg-cream border-2 border-ink text-ink font-display font-bold text-[14px] shadow-[0_3px_0_#2E3A24] transition-transform active:translate-y-[2px] active:shadow-[0_1px_0_#2E3A24]"
        >
          {copied ? 'Copied ✓' : 'Copy link'}
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
          <p className="font-display italic text-[12.5px] text-ink-soft mt-2">
            When {email.trim()} signs up, this recipe will be waiting for them.
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
      {/* The reassurance testers asked for — a private recipe stays out of Browse —
          stated only as strongly as the backend backs up (handoff mints a grant and
          leaves visibility alone). Private recipes only; false for a public one. */}
      {recipeVisibility !== 'public' && (
        <p className="font-display text-[12.5px] text-ink leading-snug bg-sage/40 border-2 border-ink rounded-[12px] px-3 py-2 mb-4 text-left">
          This won’t put your recipe in Browse — only someone with the link can open it.
        </p>
      )}
      {/* The note comes pre-filled with the default message; the sender edits or
          replaces it in their own words. No starter chips — the default already
          carries the warm intent they'd have picked. */}
      <textarea
        placeholder="Say something with it… (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        className="field resize-none mb-3"
      />
      <input
        type="email"
        placeholder="Their email (optional)"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="field mb-1.5"
      />
      {/* Deliberately does NOT say "we'll email them" — nothing in this app sends
          mail. The email only pre-addresses the invite, which auth.py's signup
          auto-accepts (pending handoffs matching the new user's email). You still
          send the link yourself. */}
      <p className="font-display italic text-[12px] text-ink-soft mb-3">
        We won&rsquo;t email them — you send the link. Their address just saves the
        recipe for them if they sign up.
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
