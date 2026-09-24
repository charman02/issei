import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getNotifications, markNotificationsRead } from '../api/notifications'
import BackButton from '../components/BackButton'
import MarkerTitle from '../components/MarkerTitle'
import Avatar from '../components/Avatar'
import EmptyState from '../components/EmptyState'
import Loader from '../components/Loader'

const ago = (iso) => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

// Types the server strips the actor from (mirrors ANONYMOUS_TYPES in services/notifications.py).
// The client keeps its own copy deliberately: it must render safely even if a regression ships
// an actor for one of these.
const ANON_TYPES = new Set(['recipe_kept'])

const nameOf = (n) =>
  [n.actor_first_name, n.actor_last_name].filter(Boolean).join(' ') || 'Someone'

// What each type SAYS. Kept as one table rather than branching inline, so the vocabulary is
// readable in one place and a new type is one row. Never mentions voice, audio or a
// recording — a per-step note is typed text (POSITIONING).
function lineFor(n) {
  const who = nameOf(n)
  const what = n.subject
  switch (n.type) {
    case 'recipe_request':
      return what ? `${who} asked you for your ${what}.` : `${who} asked you for a recipe.`
    case 'request_fulfilled':
      return what ? `${who} sent you ${what}.` : `${who} sent you the recipe you asked for.`
    case 'recipe_kept':
      // "Someone" is HARDCODED, not `who` (#96). The API already nulls every actor field for
      // this type, so `who` would fall back to "Someone" anyway — but writing it literally
      // means a server-side regression that leaked the name could never surface it here. The
      // cook learns how many people kept a recipe, never who: keeping is a bookmark addressed
      // to nobody, unlike an ask, which is addressed to the cook.
      return what
        ? `Someone kept your ${what}.`
        : 'Someone kept one of your recipes.'
    case 'recipe_arrived':
      // The unprompted send, and the wording is lifted from the sender's OWN default message
      // for this exact occasion ("I wanted you to have it", `defaultInviteMessage`). That is
      // what separates it from `request_fulfilled` above: both deliver a recipe, but one
      // answers a question you asked and this one doesn't. "Sent you" would collapse the
      // difference #102 went to trouble to draw.
      return what ? `${who} wanted you to have ${what}.` : `${who} sent you a recipe.`
    case 'recipe_claimed':
      // The cook's side of the same handoff. Deliberately NOT "kept" — that word means the
      // bookmark (`recipe_kept`), which is anonymous, and reusing it here would make two
      // different acts look like one act with inconsistent privacy.
      return what ? `${who} has your ${what} now.` : `${who} opened the recipe you sent.`
    case 'pass_on_request':
      // #78, to the COOK. Named and answerable — unlike `recipe_kept` above, which is anonymous,
      // because this one is addressed to them and wants a yes or a no.
      return what
        ? `${who} would like to pass on your ${what}.`
        : `${who} would like to pass on one of your recipes.`
    case 'pass_on_approved':
      // #78, to the ASKER. Deliberately about the DISH rather than about a permission — they asked
      // about a recipe, and what they want to know is that they can send it now. There is no
      // `pass_on_declined` case because no such notification is ever written.
      return what
        ? `${who} says you can pass on their ${what}.`
        : `${who} says you can pass their recipe on.`
    case 'recipe_passed_on':
      // #78, to the COOK: their recipe is travelling. For a `public` recipe this is the ONLY signal
      // they get that it moved, since nobody had to ask. Named, not anonymous like a keep — a keep
      // is a bookmark addressed to nobody, while this is somebody creating access to the cook's
      // recipe, so who did it is the substance rather than a detail.
      return what
        ? `${who} passed your ${what} on to someone.`
        : `${who} passed one of your recipes on.`
    case 'friend_request':
      return `${who} wants to be friends.`
    case 'friend_accept':
      return `${who} is now your friend.`
    default:
      // An unknown type must still render as a line rather than blanking the inbox — a
      // client can be older than the server that wrote the row.
      return `${who} did something.`
  }
}

// Where tapping goes. A reference the row lost (the post or recipe was deleted, so the FK
// SET NULL'd) simply isn't a link — the line still reads, because it still happened.
function targetFor(n) {
  if (n.type === 'request_fulfilled' && n.recipe_id) return `/recipes/${n.recipe_id}`
  // Gated on post_id, which the API SET NULLs when the post is deleted. The asks themselves
  // cascade away with the post, so /requests would be empty — the line still reads ("Ben asked
  // you for a recipe" did happen) but tapping it must not assert an ask that no longer exists.
  if (n.type === 'recipe_request') return n.post_id ? '/requests' : null
  // Opens the recipe itself — the cook's own, so there's no access question. No keeper list
  // to link to, because there isn't one and never will be.
  if (n.type === 'recipe_kept') return n.recipe_id ? `/recipes/${n.recipe_id}` : null
  // Both halves of the handoff open the recipe. The recipient holds an accepted grant (the
  // notification is only written where that is true, see handoff_recipe) and the cook owns it,
  // so neither can land on a 404 — and `recipe_id` is already nulled by the API when the recipe
  // was soft-deleted, which is the case where the line reads but doesn't link.
  if (n.type === 'recipe_arrived' || n.type === 'recipe_claimed')
    return n.recipe_id ? `/recipes/${n.recipe_id}` : null
  // #78. The cook's ask lands on the screen where they answer it; the other two open the recipe.
  // `/requests` is gated on `recipe_id` for the same reason `recipe_request` is gated on `post_id`
  // — the request row CASCADES away with the recipe, so the line must still read while the tap must
  // not assert an ask that no longer exists.
  if (n.type === 'pass_on_request') return n.recipe_id ? '/requests' : null
  if (n.type === 'pass_on_approved' || n.type === 'recipe_passed_on')
    return n.recipe_id ? `/recipes/${n.recipe_id}` : null
  if (n.type === 'friend_request') return '/friends'
  if (n.type === 'friend_accept' && n.actor_id) return `/u/${n.actor_id}`
  if (n.post_id) return `/posts/${n.post_id}`
  return null
}

// The inbox (#79). issei's first notification surface: the cook learns someone asked, and
// the requester learns their recipe arrived. Opening the page marks everything read, which
// is the behaviour people expect from an inbox and avoids a per-row "mark read" control
// nobody wants to tap.
export default function Notifications() {
  const navigate = useNavigate()
  const [items, setItems] = useState(null)

  useEffect(() => {
    let stale = false
    // One call: marking read returns the refreshed list, so the badge and the rows come
    // from the same round trip and can't disagree.
    markNotificationsRead()
      .then((res) => !stale && setItems(res.data.notifications))
      .catch(() =>
        getNotifications()
          .then((res) => !stale && setItems(res.data.notifications))
          .catch(() => !stale && setItems([])),
      )
    return () => {
      stale = true
    }
  }, [])

  if (items === null) return <Loader />

  return (
    <div className="min-h-screen bg-cream px-5 pt-5 pb-10">
      <div className="mb-5">
        <BackButton to="/" label="Back" />
      </div>
      <MarkerTitle
        color="bg-peach"
        className="font-display font-black text-[32px] text-ink leading-none"
      >
        What&rsquo;s new<span className="text-terra">.</span>
      </MarkerTitle>
      <p className="font-display italic text-[15px] text-ink-soft mt-2 mb-6">
        Asks, arrivals and friends.
      </p>

      {items.length === 0 ? (
        <EmptyState
          icon="📬"
          badge="bg-sage"
          title="Nothing new"
          sub="When someone asks you for a recipe — or sends you one you asked for — it lands here."
          className="mt-6"
        />
      ) : (
        <div className="space-y-2.5">
          {items.map((n) => {
            const to = targetFor(n)
            const body = (
              <>
                {/* An ANONYMOUS row gets a mark, not a face (#96). Avatar renders the first
                    INITIAL of whatever name it's given, so passing the actor here would print
                    "Z" beside a line that says "Someone" if the server ever leaked one — the
                    avatar was the one place the anonymity could still break. A bookmark isn't
                    a person, so a person-shaped monogram was wrong for this type anyway. */}
                {ANON_TYPES.has(n.type) ? (
                  <span
                    aria-hidden="true"
                    className="flex-none flex items-center justify-center w-9 h-9 rounded-full bg-cream border-2 border-ink text-[15px] leading-none"
                  >
                    🔖
                  </span>
                ) : (
                  <Avatar name={n.actor_first_name || '?'} photoUrl={n.actor_photo_url} size="sm" />
                )}
                <span className="min-w-0 flex-1">
                  {/* Clamped for the same reason a feed card is: the dish name inside this
                      sentence can be 120 characters, and one inbox row four lines tall pushes
                      the rest of someone's inbox off the screen. The name is at the TAIL of
                      every one of these sentences, so a clamp costs the least-important part. */}
                  <span className="block font-display text-[14px] text-ink leading-snug line-clamp-3">
                    {lineFor(n)}
                  </span>
                  <span className="block font-display italic text-[12px] text-ink-soft mt-0.5">
                    {ago(n.created_at)}
                  </span>
                </span>
              </>
            )
            return to ? (
              <button
                key={n.id}
                onClick={() => navigate(to)}
                className="sticker bg-card w-full flex items-center gap-3 p-3 text-left"
              >
                {body}
              </button>
            ) : (
              <div key={n.id} className="sticker bg-card flex items-center gap-3 p-3">
                {body}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
