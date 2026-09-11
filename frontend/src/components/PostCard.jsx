import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { requestRecipe, retractRequest } from '../api/posts'
import { toUserMessage } from '../api/client'
import Avatar from './Avatar'
import { toUtcMs } from '../utils/time'

// A single meal in the feed: the photo big, then who made it and what it is.
//
// ONE action, and it is not a like — there is no like button and never will be. A post
// whose recipe you can read links through to it; one you can't gets "Ask for the recipe"
// (#79), which is the app's premise as a mechanic: you tasted it and asked. A request is
// costly and specific and ends in a real artifact, which is what makes it not a reaction.
//
// The cook — and ONLY the cook — also sees "N people asked for this", as a private nudge.
// Everyone else is handed `request_count: null`, so there is no public tally to render and
// no zero printed under an ordinary Tuesday meal. Public demand is meant to surface later
// by RANK (a "most asked for" row in Browse), which shows the dishes that HAVE demand
// without ever displaying an absence. Don't turn the count into a badge on the card.

// Short relative time — "just now / 3h / 2d / Aug 4". Kept tiny and local; the feed
// doesn't need a date library for this. The naive-UTC parse lives in utils/time.js —
// see the long note there for why a bare new Date() is wrong on every one of these.
function ago(iso) {
  const then = toUtcMs(iso)
  const now = Date.now()
  const s = Math.max(0, Math.round((now - then) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d`
  return new Date(toUtcMs(iso)).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

const fullName = (p) => `${p.author_first_name} ${p.author_last_name}`.trim()

// `onOpen` makes the photo AND the text a tap target that opens the post. Every list that
// renders a card passes it — the Feed, your Kitchen's Posts tab, a profile grid — because the
// post page carries the author's own edit and delete controls, so a card that doesn't open is a
// dead end for the person most likely to want it. (It began as Browse-only in #71, where a card
// was a preview; #94 removed that tab, and by then every other list had adopted it.) The prop
// stays optional so the component is renderable without a destination, but nothing ships that
// way — which is why the clamps below are written ONCE rather than per branch.

// ONE copy of each class string. The clamps used to be written twice (an onOpen branch and a
// fallback), which meant a test could assert `line-clamp-3` on the branch no screen renders while
// the rendered one silently lost it — the classic duplicated-JSX hazard, and exactly what the
// first version of these tests did.
const TITLE_CLASS = 'font-display font-black text-[18px] text-ink leading-tight line-clamp-2'
const DESC_CLASS = 'font-display text-[14px] text-ink-soft leading-snug mt-1 line-clamp-3'

export default function PostCard({ post, onOpen }) {
  const navigate = useNavigate()
  // The ask (#79). Local mirror of the server's answer so the button responds instantly.
  // No parent callback: every list that renders this card refetches on mount, and a prop no
  // caller passes is a comment claiming wiring that doesn't exist.
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState('')
  const [asked, setAsked] = useState(Boolean(post.requested_by_me))
  // The author's own ⋯ (#104). Closed/open only — both items navigate away, so there is no second
  // panel state to track the way the safety menu on `/u/:id` needs one.
  const [menuOpen, setMenuOpen] = useState(false)

  // Tapping the author opens their profile — but for your OWN post, /u/{yourId} is the
  // read-only "other user" view of yourself; send yourself to /profile ("You") instead.
  const me = JSON.parse(localStorage.getItem('issei_user') || '{}')
  const isMine = String(me.id) === String(post.user_id)
  const openAuthor = () => navigate(isMine ? '/profile' : `/u/${post.user_id}`)

  async function ask() {
    if (asking) return
    setAsking(true)
    setAskError('')
    // Optimistic on the LABEL only — the server's response is what we then trust, and a
    // failure puts the button back rather than leaving a lie on screen.
    const next = !asked
    setAsked(next)
    try {
      const { data } = next ? await requestRecipe(post.id) : await retractRequest(post.id)
      // A retract can answer 204 with no body — when the ask was the caller's only credential
      // on a post the cook has since hidden, there is nothing to hand back. `?.` covers it:
      // no body means the ask is gone, which is exactly `false`.
      setAsked(Boolean(data?.requested_by_me))
    } catch (err) {
      setAsked(!next)
      setAskError(toUserMessage(err, 'Couldn’t ask just now. Try again.'))
    } finally {
      setAsking(false)
    }
  }

  return (
    <article className="sticker bg-card overflow-hidden">
      {/* Header: who + when. Tapping the name opens their profile. */}
      <div className="flex items-center gap-2.5 px-3.5 py-3">
        <button
          onClick={openAuthor}
          className="flex items-center gap-2.5 min-w-0 text-left"
        >
          <Avatar name={post.author_first_name} photoUrl={post.author_photo_url} size="sm" />
          <span className="font-display font-bold text-[14.5px] text-ink truncate">
            {fullName(post)}
          </span>
        </button>
        <span className="ml-auto flex-none font-display text-[12px] text-ink-soft">
          {ago(post.created_at)}
        </span>
        {/* YOUR OWN POST, AND ONLY YOURS (#104). Reported by a real user: "I want to demote the
            post but don't know how to."

            Everything they wanted already existed — tapping the card opens the post page, which
            has Edit (dish name, description, VISIBILITY — the "demote") and Delete. The card just
            never said so, so the controls were reachable only by guessing.

            A ⋯ rather than visible buttons, matching the safety menu on `/u/:id`: unlabelled is not
            the same as faint, and this is a control you should find when you go looking. Nothing is
            added to anyone else's card — same discipline as `request_count`, which is null for every
            non-author so no tally can leak.

            Both items NAVIGATE; neither acts here. The actions live on the post page and stay
            there — a Delete two taps from a scrolling feed is the mis-tap #92 and #98 both
            corrected — but they land on the open control rather than on a page to hunt through. */}
        {isMine && onOpen && (
          <div className="relative flex-none">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Manage this meal"
              aria-expanded={menuOpen}
              className="w-7 h-7 -mr-1 rounded-full flex items-center justify-center font-display font-black text-[15px] leading-none text-ink-soft"
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-8 z-20 sticker bg-card w-44 py-1 text-left">
                <button
                  onClick={() => navigate(`/posts/${post.id}`, { state: { open: 'edit' } })}
                  className="block w-full px-3 py-2 font-display font-bold text-[13.5px] text-ink text-left"
                >
                  Edit this meal
                </button>
                <button
                  onClick={() => navigate(`/posts/${post.id}`, { state: { open: 'delete' } })}
                  className="block w-full px-3 py-2 font-display font-bold text-[13.5px] text-brick text-left border-t-2 border-line"
                >
                  Delete this meal
                </button>
                <button
                  onClick={() => setMenuOpen(false)}
                  className="block w-full px-3 py-2 font-display font-bold text-[12.5px] text-ink-soft text-left border-t-2 border-line"
                >
                  Never mind
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* The photo — the point of the post. In Browse (onOpen set) it's a button that
          opens the full post; in the feed it's a plain image (the post is already inline). */}
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${post.dish_name}`}
          className="block w-full"
        >
          <img
            src={post.photo_url}
            alt={post.dish_name}
            className="w-full aspect-square object-cover block border-y-2 border-ink"
          />
        </button>
      ) : (
        <img
          src={post.photo_url}
          alt={post.dish_name}
          className="w-full aspect-square object-cover block border-y-2 border-ink"
        />
      )}

      {/* Dish name + optional line, both CLAMPED on a card.
          A feed is scanned; a permalink is read. Neither of these was clamped, and with a
          500-character description (the schema ceiling) one post pushed the next person's photo
          clean off the screen — so the cost of someone writing at length was paid by everyone
          below them in the feed. Two lines for the dish name, three for the line under it, and
          the browser's own ellipsis is the "there's more" signal; the post page shows the whole
          thing unclamped.

          The markup below is deliberately fussy, because the obvious version was wrong twice
          over. Wrapping the <h3> and <p> in one <button> put FLOW content inside a button
          (invalid), and ARIA treats a button's children as presentational — so every dish name
          in the feed stopped being a heading, and each card's accessible name became the whole
          620 characters of title-plus-description read aloud before you reached the action.
          So: the <h3> stays a real heading with a phrasing-only button INSIDE it, the
          description is its own text-only button, and both carry an explicit aria-label so the
          clamped text is never the accessible name. One shared class string each, rather than
          two copies of the markup — the duplicated version let a test assert a clamp on the
          branch nothing renders. */}
      <div className="px-3.5 py-3">
        <h3 className={TITLE_CLASS}>
          {onOpen ? (
            <button
              type="button"
              onClick={onOpen}
              aria-label={post.dish_name}
              className="block w-full text-left"
            >
              {post.dish_name}
            </button>
          ) : (
            post.dish_name
          )}
        </h3>
        {post.description &&
          (onOpen ? (
            <button
              type="button"
              onClick={onOpen}
              aria-label={`Read all of ${post.dish_name}`}
              className={`${DESC_CLASS} block w-full text-left`}
            >
              {post.description}
            </button>
          ) : (
            <p className={DESC_CLASS}>{post.description}</p>
          ))}
        {/* The action row. A post whose recipe you CAN read links through to it; one you
            can't gets the ask. Exactly one of the two, because `recipe_id` arrives nulled
            when you may not read it — so "never written down" and "written but private" are
            the same state here, and the button reveals nothing either way. This is also
            deliberately where a like button would have gone; there isn't one. */}
        {post.recipe_id ? (
          <button
            onClick={() => navigate(`/recipes/${post.recipe_id}`)}
            className="mt-2.5 inline-flex items-center gap-1 font-display font-bold text-[13px] text-terra"
          >
            See the recipe &rarr;
          </button>
        ) : (
          !isMine && (
            <button
              onClick={ask}
              disabled={asking}
              aria-pressed={asked}
              className={`mt-2.5 inline-flex items-center gap-1.5 rounded-full border-2 border-ink px-3.5 py-1.5 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50 ${
                asked ? 'bg-cream text-ink-soft' : 'bg-saffron text-ink'
              }`}
            >
              {asked ? 'Asked ✓' : 'Ask for the recipe'}
            </button>
          )
        )}
        {/* The cook's own nudge, and ONLY the cook's: request_count is null for everyone
            else, so there is no public tally and no zero printed under an ordinary meal. */}
        {isMine && post.request_count > 0 && (
          <button
            onClick={() => navigate('/requests')}
            className="mt-2.5 block font-display font-bold text-[13px] text-terra"
          >
            {post.request_count === 1
              ? '1 person asked for this →'
              : `${post.request_count} people asked for this →`}
          </button>
        )}
        {askError && (
          <p className="mt-2">
            <span className="error-pill">{askError}</span>
          </p>
        )}
      </div>
    </article>
  )
}
