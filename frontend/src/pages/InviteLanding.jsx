import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getInvitePreview } from '../api/sharing'
import { toUserMessage } from '../api/client'
import RecipeBody from '../components/RecipeBody'
import Loader from '../components/Loader'
import IsseiMeaning from '../components/IsseiMeaning'
import Wordmark from '../components/Wordmark'

// The recipient landing (/invite/:token) — the far end of the handoff.
//
// This used to be a soft wall: name, who it's from, story, photo, then a signup
// gate before you could read a single ingredient. That inverted the point. The
// person holding this link has never tasted the dish and wants to cook it, so
// the recipe is OPEN here — the same <RecipeBody> the owner reads, cooking mode
// and all. The token is the permission.
//
// Signing up is what lets you KEEP it, so the one CTA sits under the recipe,
// where intent is highest after reading.
//
// Everything above the recipe is rationed to two facts: who sent it, and what
// the dish is. The page used to also explain itself ("the whole recipe, the way
// they make it", "nothing to sign up for — just scroll") and that prose was the
// thing standing between a cold arrival and the dish they came for.
// Why a failure is NOT just "this link is dead": the recipient has no account
// and no support path, so a wrong diagnosis here costs them the recipe entirely
// — they conclude the sender's link is broken and give up. Only the server
// saying 404 means the link is genuinely gone; everything else is our problem
// and is worth retrying.
function describeFailure(err) {
  const status = err?.response?.status
  if (status === 404) {
    return {
      message: 'This link is no longer good — ask whoever sent it for a new one.',
      canRetry: false,
    }
  }
  if (status === 429) {
    // RATE LIMITED, and this branch exists because without it the most consequential page in the
    // product gave the least useful answer. A 429 fell through to "Something went wrong opening this
    // recipe" WITH a Try again button — which fails identically for up to fifteen minutes, because
    // the limiter deliberately doesn't count a refused call and so doesn't free a slot early. So the
    // recipient tapped, failed, tapped, failed, and concluded the sender's link was broken: verbatim
    // the outcome the comment above this function was written to prevent.
    //
    // The server names the wait in `detail` ("Try again in 12 minutes"), so `toUserMessage` passes
    // through real copy — the same path Login, ForgotPassword and ResetPassword already use. This
    // page has its own handler, which is exactly how it missed out. `canRetry: false` because the
    // wait is the answer; a button that cannot work is worse than no button.
    //
    // Reaching this at all means a shared or carrier-NAT address spent 60 invite reads in 15
    // minutes. Rare, and not the recipient's fault, which is why the copy must not blame the link.
    return { message: toUserMessage(err), canRetry: false }
  }
  if (status >= 500) {
    return { message: 'issei is having trouble right now.', canRetry: true }
  }
  if (!err?.response) {
    // No response at all: offline, DNS, CORS, or a request that timed out.
    return { message: "Couldn't reach issei — check your connection.", canRetry: true }
  }
  return { message: 'Something went wrong opening this recipe.', canRetry: true }
}

export default function InviteLanding() {
  const { token } = useParams()
  const [preview, setPreview] = useState(null)
  const [failure, setFailure] = useState(null)
  // Bumping this re-runs the fetch effect — the retry button's whole mechanism.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setFailure(null)
    getInvitePreview(token)
      .then(({ data }) => {
        if (live) setPreview(data)
      })
      .catch((err) => {
        if (live) setFailure(describeFailure(err))
      })
    return () => {
      live = false
    }
  }, [token, attempt])

  if (failure) {
    return (
      <div className="min-h-screen bg-cream flex flex-col items-center justify-center gap-5 px-6 text-center">
        <span className="error-pill">{failure.message}</span>
        {failure.canRetry && (
          <button
            onClick={() => setAttempt((n) => n + 1)}
            className="inline-block rounded-full bg-terra px-7 py-3 font-display font-bold text-[15px] text-cream border-[2.5px] border-ink shadow-[0_4px_0_#2E3A24] active:translate-y-[3px] active:shadow-[0_1px_0_#2E3A24] transition-transform"
          >
            Try again
          </button>
        )}
        <Link
          to="/login"
          className={
            failure.canRetry
              ? 'font-display font-bold text-[14px] text-terra underline'
              : 'inline-block rounded-full bg-terra px-7 py-3 font-display font-bold text-[15px] text-cream border-[2.5px] border-ink shadow-[0_4px_0_#2E3A24] active:translate-y-[3px] active:shadow-[0_1px_0_#2E3A24] transition-transform'
          }
        >
          Go to issei
        </Link>
      </div>
    )
  }
  if (!preview) {
    return <Loader label="Opening…" />
  }

  const signupHref = `/login?tab=signup&invite=${token}`

  return (
    <div className="min-h-screen bg-cream">
      <div className="max-w-[430px] mx-auto px-5 pt-7 pb-10">
        {/* Two facts only: who sent it, and what it is. The wordmark is small
            and quiet here — it answers "where am I" for someone who tapped an
            unfamiliar link, but it is not the headline; the dish is. */}
        <div className="text-center">
          <Wordmark size="sm" className="scale-[0.72] origin-center" />
        </div>
        <div className="text-center">
          {/* The eyebrow and the dish name are one sentence broken across two
              type sizes ("Charlie passed you / Lola's Adobo"), so the handoff is
              stated without a separate line of prose explaining it. Sentence
              case, not uppercase tracking: this is a person, not a label. Plum
              is the palette's person color. */}
          <div className="mt-9">
            {preview.from_name && (
              <p className="font-display text-[14px] leading-none text-ink-soft">
                <span className="font-bold text-plum">{preview.from_name}</span>{' '}
                passed you
              </p>
            )}
            <h1 className="font-display font-black text-[34px] leading-[1.1] text-ink text-balance mt-2.5">
              {preview.name}
            </h1>
          </div>
        </div>

        {/* The recipe itself, exactly as the keeper reads it. RecipeBody opens
            with its own chunky control and cover photo, so the header needs real
            clearance here — butted straight up against the dish name, the two
            bold elements read as one crowded mass. */}
        <div className="mt-8">
          {/* context="reader": a recipient can't upload anything, so the
              no-photo fallback must not show the owner's "add a photo" prompt —
              and it must not stamp a second issei. wordmark under the one in this
              page's own header. */}
          <RecipeBody recipe={preview} context="reader" />
        </div>

        {/* The ask, placed AFTER the reading — once they know they want it.
            The claim is exactly what a granted (non-owning) account gets: the
            recipe stays reachable. It does NOT promise they can edit or add to
            it — that requires ownership (PATCH /recipes/{id} filters on
            user_id), so promising it here would break at the first tap. */}
        <div className="sticker bg-peach px-5 py-6 mt-10 text-center">
          <p className="font-display font-black text-[20px] text-ink leading-tight">
            Don&rsquo;t lose this one
          </p>
          {/* Deliberately not "{from_name}'s recipe": from_name is whoever sent
              the link, who is often NOT whose recipe it is (here Charlie passes
              on Lola's). Naming the wrong person in the one line asking for
              trust is worse than naming nobody. */}
          <p className="font-display text-[14px] text-ink-soft leading-snug mt-2">
            A free account keeps this recipe in your kitchen.
          </p>
          <Link
            to={signupHref}
            className="block rounded-full bg-terra px-7 py-3 font-display font-bold text-[15px] text-cream border-[2.5px] border-ink shadow-[0_4px_0_#2E3A24] active:translate-y-[3px] active:shadow-[0_1px_0_#2E3A24] transition-transform mt-5"
          >
            Keep this recipe →
          </Link>
        </div>

        {/* THE NAME, at the very bottom. By now they've read a real recipe with
            someone's amounts and someone's warnings in it, so the word lands
            against something concrete. Putting it at the top would have been
            vocabulary homework before the recipe they came for. */}
        <div className="mt-10 pt-6 border-t-2 border-dashed border-line">
          <IsseiMeaning />
        </div>
      </div>
    </div>
  )
}
