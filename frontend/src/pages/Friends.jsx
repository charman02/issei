import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getFriends,
  getFriendRequests,
  getFriendSuggestions,
  discoverPeople,
  acceptFriend,
  removeFriend,
  requestFriend,
} from '../api/friends'
import MarkerTitle from '../components/MarkerTitle'
import TellAFriend from '../components/TellAFriend'
import BackButton from '../components/BackButton'
import Loader from '../components/Loader'
import EmptyState from '../components/EmptyState'
import IconField from '../components/IconField'
import Avatar from '../components/Avatar'
import { toUserMessage } from '../api/client'

const fullName = (p) => `${p.first_name} ${p.last_name}`.trim()

// A person's avatar in a friends-list row — their photo (#33) or the monogram
// fallback, via the shared <Avatar>. `person` carries first_name + photo_url from the
// friend/request/suggestion payloads.
function Monogram({ person }) {
  return <Avatar name={person.first_name} photoUrl={person.photo_url} size="md" />
}

// Who you cook with. Four sections: requests waiting on you, people you've shared
// recipes with (the handoff graph — the strongest signal, so it stays first), EVERYONE
// else on the app with a name search, and your current friends.
//
// The directory (#80) exists because a real user couldn't work out how to find anybody.
// Before it, the only routes to a friend were the feed's "everyone" tab or somebody
// having handed you a recipe — and the suggestions section was hidden when empty, so a
// new account with no handoffs saw no find-friends surface at all.
export default function Friends() {
  const [friends, setFriends] = useState(null)
  const [requests, setRequests] = useState([])
  const [suggestions, setSuggestions] = useState([])
  // The app-wide directory + its search box. `people === null` means the first load
  // hasn't landed, so the section renders nothing rather than flashing "nobody here".
  const [people, setPeople] = useState(null)
  const [search, setSearch] = useState('')
  // Kept apart from `people: []` so a failed request never renders as "nobody's here".
  const [peopleError, setPeopleError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Bumped after any friend action so the directory refetches — the row's state comes from
  // the server (`friend_state`), so it needs re-reading once an action lands.
  const [reloadKey, setReloadKey] = useState(0)
  // People the caller has just asked to add, so the row acknowledges the tap immediately
  // instead of keeping a live "Add" button until the refetch lands (250ms + a round trip).
  // This is now only a HEAD START on the server's `friend_state: "requested"`, not the only
  // record of it — the person used to drop out of the directory entirely once the refetch
  // landed, which a real user read as "did that work, or did I just remove them?".
  const [requested, setRequested] = useState(() => new Set())
  const firstLoad = useRef(true)
  // Generation counter for load(): three independent requests, and two rapid actions
  // could land them out of order, leaving an older list on screen. Same bug class the
  // directory effect guards against, so it gets the same treatment.
  const loadGen = useRef(0)
  const navigate = useNavigate()

  function load() {
    loadGen.current += 1
    const gen = loadGen.current
    const fresh = () => gen === loadGen.current
    getFriends()
      .then((res) => fresh() && setFriends(res.data))
      .catch(() => fresh() && setFriends([]))
    getFriendRequests()
      .then((res) => fresh() && setRequests(res.data))
      .catch(() => fresh() && setRequests([]))
    getFriendSuggestions()
      .then((res) => fresh() && setSuggestions(res.data))
      .catch(() => fresh() && setSuggestions([]))
  }
  useEffect(load, [])

  // The directory reloads on every search change (and after any friend action, since
  // adding someone must drop them out of the list). Debounced so typing doesn't fire a
  // request per keystroke; the search runs SERVER-side so it covers everyone, not just
  // the capped page already on screen.
  useEffect(() => {
    // `stale` is the guard that matters: clearTimeout only cancels a request that hasn't
    // FIRED yet. Once one is in flight, a slower earlier response can land after a faster
    // later one and overwrite the newer list — the classic search-box race, where you end
    // up looking at results for a term you already finished typing past. Ignoring any
    // response whose effect has been superseded is the fix.
    let stale = false
    // The FIRST load fires immediately: there is nothing to debounce on mount, and the
    // 250ms floor was long enough for the page to paint "No one here yet" before the
    // directory landed — the exact false message #80 exists to remove, shown to the exact
    // user it targets. Only subsequent (typing-driven) loads are debounced.
    const t = setTimeout(() => {
      discoverPeople(search.trim() || undefined)
        .then((res) => {
          if (!stale) {
            setPeople(res.data)
            setPeopleError(false)
          }
        })
        .catch(() => {
          // NOT an empty list: "nobody else yet" would be a flat lie about the app when
          // the truth is the request failed. Distinguished so the copy can say so.
          if (!stale) {
            setPeople([])
            setPeopleError(true)
          }
        })
    }, firstLoad.current ? 0 : 250)
    firstLoad.current = false
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [search, reloadKey])

  // One guarded runner for every friend action: blocks a double-tap (busy), and
  // surfaces a failure through the app's single error-copy path instead of
  // swallowing it. A common cause is the row already being gone (the other party
  // unfriended/declined) — a refresh reconciles, so we reload either way.
  async function act(fn) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(toUserMessage(err, 'Couldn’t do that. Try again.'))
    } finally {
      setBusy(false)
      load()
      setReloadKey((k) => k + 1)
    }
  }
  const onAccept = (id) => act(() => acceptFriend(id))
  const onRemove = (id) => act(() => removeFriend(id))
  const onAdd = (userId) => {
    // Optimistic only for the label — the request still has to succeed, and a failure
    // surfaces through `error` while the refetch restores the true state either way.
    setRequested((prev) => new Set(prev).add(userId))
    return act(() => requestFriend(userId))
  }

  if (friends === null) return <Loader />

  // The directory is always offered, so "nothing anywhere" now only means the app itself
  // is empty of other people — which is the one case where the warm empty state is true.
  const nothingAnywhere =
    friends.length === 0 &&
    requests.length === 0 &&
    suggestions.length === 0 &&
    // `people !== null` is load-bearing: while the first directory load is still in
    // flight, "nobody anywhere" is not yet known — and asserting it renders the very
    // "No one here yet" message this task exists to stop showing.
    people !== null &&
    people.length === 0 &&
    !peopleError &&
    !search.trim()

  return (
    <div className="min-h-screen bg-cream px-5 pt-5 pb-10">
      <div className="mb-5">
        <BackButton to="/profile" label="Back" />
      </div>
      <MarkerTitle
        color="bg-peach"
        className="font-display font-black text-[32px] text-ink leading-none"
      >
        Friends<span className="text-terra">.</span>
      </MarkerTitle>
      {/* Was "The people you share recipes with." — true when the handoff graph was the
          only source, false now that the page's main content is everyone on the app. */}
      <p className="font-display italic text-[15px] text-ink-soft mt-2 mb-6">
        The people you cook with — and everyone else here.
      </p>

      {error && (
        <p className="mb-4">
          <span className="error-pill">{error}</span>
        </p>
      )}

      {nothingAnywhere && (
        <EmptyState
          icon="🧑‍🍳"
          badge="bg-peach"
          title="No one here yet"
          sub="You’re the first one in the kitchen. When other people join, they’ll show up here to add — and anyone you hand a recipe to lands here too."
          className="mt-6 mb-9"
        />
      )}

      {/* Requests waiting on you — first, because they need an answer. */}
      {requests.length > 0 && (
        <section className="mb-7">
          <h2 className="section-label mb-2.5">Wants to be friends</h2>
          <div className="space-y-2.5">
            {requests.map((r) => (
              <div key={r.id} className="sticker bg-card flex items-center gap-3 p-3">
                <Monogram person={r} />
                <button
                  onClick={() => navigate(`/u/${r.user_id}`)}
                  className="min-w-0 flex-1 text-left font-display font-bold text-[15px] text-ink truncate"
                >
                  {fullName(r)}
                </button>
                <button
                  onClick={() => onAccept(r.id)}
                  disabled={busy}
                  className="flex-none rounded-full bg-terra text-cream border-2 border-ink px-4 py-1.5 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
                >
                  Accept
                </button>
                <button
                  onClick={() => onRemove(r.id)}
                  disabled={busy}
                  aria-label={`Decline ${fullName(r)}`}
                  className="flex-none font-display font-bold text-[13px] text-ink-soft px-1 disabled:opacity-50"
                >
                  Ignore
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* People to add — seeded from the handoff graph. */}
      {suggestions.length > 0 && (
        <section className="mb-7">
          <h2 className="section-label mb-2.5">People you’ve shared recipes with</h2>
          <div className="space-y-2.5">
            {suggestions.map((s) => (
              <div
                key={s.user_id}
                className="sticker bg-card flex items-center gap-3 p-3"
              >
                <Monogram person={s} />
                <button
                  onClick={() => navigate(`/u/${s.user_id}`)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block font-display font-bold text-[15px] text-ink truncate">
                    {fullName(s)}
                  </span>
                  <span className="block font-display italic text-[12px] text-ink-soft">
                    {s.reason === 'sent'
                      ? 'You sent them a recipe'
                      : 'Sent you a recipe'}
                  </span>
                </button>
                <button
                  onClick={() => onAdd(s.user_id)}
                  disabled={busy}
                  className="flex-none rounded-full bg-cream text-ink border-2 border-ink px-4 py-1.5 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* EVERYONE ELSE (#80) — the app-wide directory, always offered, with a name search.
          Deliberately BELOW the handoff suggestions: someone who has actually cooked for
          you is a far stronger candidate than a stranger, so that list keeps the top slot.
          The search runs server-side, so it reaches past the capped page on screen. */}
      <section className="mb-7">
        <h2 className="section-label mb-2.5">Everyone on issei</h2>
        <IconField
          icon="search"
          iconClassName="text-ink-soft"
          type="text"
          placeholder="Search by name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          wrapperClassName="mb-3"
        />
        {people === null ? null : peopleError ? (
          <p className="font-display italic text-[13px] text-ink-soft">
            Couldn’t load people just now. Check your connection.
          </p>
        ) : people.length === 0 ? (
          <p className="font-display italic text-[13px] text-ink-soft">
            {search.trim()
              ? `Nobody here called “${search.trim()}”.`
              : 'Nobody else yet — you’re early.'}
          </p>
        ) : (
          <div className="space-y-2.5">
            {people.map((p) => (
              <div
                key={p.user_id}
                className="sticker bg-card flex items-center gap-3 p-3"
              >
                <Monogram person={p} />
                <button
                  onClick={() => navigate(`/u/${p.user_id}`)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block font-display font-bold text-[15px] text-ink truncate">
                    {fullName(p)}
                  </span>
                </button>
                {/* Three states, and nobody leaves the list for having one. `requested` is
                    OR'd with the optimistic set so the label lands on tap and then stays put
                    once the server agrees. An accepted friend isn't here at all — they're in
                    the Friends section below. */}
                {requested.has(p.user_id) || p.friend_state === 'requested' ? (
                  <span className="flex-none font-display font-bold text-[13px] text-ink-soft px-3 py-1.5">
                    Requested
                  </span>
                ) : p.friend_state === 'incoming' ? (
                  <button
                    onClick={() => onAccept(p.friendship_id)}
                    disabled={busy}
                    className="flex-none rounded-full bg-sage text-ink border-2 border-ink px-4 py-1.5 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
                  >
                    Accept
                  </button>
                ) : (
                  <button
                    onClick={() => onAdd(p.user_id)}
                    disabled={busy}
                    className="flex-none rounded-full bg-cream text-ink border-2 border-ink px-4 py-1.5 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
                  >
                    Add
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* THE REFERRAL DOOR. Placed here rather than on the You page because the directory just above
          answers "who is already here", and the honest next question — when the answer is "not the
          person I actually cook with" — is how to get them here. Unconditional: it is as useful to
          someone with fifty friends as to someone with none. */}
      <TellAFriend />

      {/* Current friends. */}
      {friends.length > 0 && (
        <section>
          <h2 className="section-label mb-2.5">Friends</h2>
          <div className="space-y-2.5">
            {friends.map((f) => (
              <div key={f.id} className="sticker bg-card flex items-center gap-3 p-3">
                <Monogram person={f} />
                <button
                  onClick={() => navigate(`/u/${f.user_id}`)}
                  className="min-w-0 flex-1 text-left font-display font-bold text-[15px] text-ink truncate"
                >
                  {fullName(f)}
                </button>
                <button
                  onClick={() => onRemove(f.id)}
                  disabled={busy}
                  className="flex-none font-display font-bold text-[13px] text-ink-soft px-1 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
