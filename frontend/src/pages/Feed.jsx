import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getFeed, markFeedSeen } from '../api/posts'
import { useCurrentUser } from '../lib/currentUser'
import { getNotifications } from '../api/notifications'
import PostCard from '../components/PostCard'
import FriendsStrip from '../components/FriendsStrip'
import PhotoNudge from '../components/PhotoNudge'
import Wordmark from '../components/Wordmark'
import Loader from '../components/Loader'
import Icon from '../components/Icon'

// HOME is the feed now: what your friends are making, newest first. This replaced
// the old hero-deck/kitchen Home entirely — a scroll feed has no natural footer, and
// the Kitchen + Browse tabs already own your recipes. An empty feed is the make-or-
// break moment for a social feature, so it doesn't show a blank screen: it shows the
// two actions that fill it — share a meal, find friends (Phase 0's suggestions).

const PAGE = 30 // must match the backend FEED_PAGE; a short page means "maybe more"

// The masthead carries the app's ONE permanent route to Friends. It has to live here,
// not only in the empty state: the "Find friends" button below is inside the
// nothing-cooking box, so it vanishes the moment a single post lands — and FriendsStrip
// self-hides when you have no friends, which is exactly the person who needs the door.
// Without this, a friendless user with a populated feed (easy: the 'everyone' tab fills
// with strangers' public meals) had no way to Friends from Home at all, only You →
// Friends. Reported by a real user who couldn't find how to add anyone (#80).
function Masthead({ onFindFriends, onOpenInbox, unread }) {
  return (
    // Two rows, not one: at 375px a single row left the tagline about 104px for a phrase
    // that needs ~180px, so it wrapped mid-sentence. Wordmark + button share the top row
    // (both fixed-width, always room), tagline gets its own line.
    <div className="px-5 pt-6 pb-5">
      <div className="flex items-center gap-2.5">
        <h1 className="flex-none">
          <Wordmark size="sm" />
        </h1>
        {/* The inbox (#79). Sits left of Friends because an unread ask is time-sensitive
            and Friends is a permanent door. Badge only when there IS something — an
            always-present "0" is the kind of empty scoreboard this app avoids. */}
        <button
          onClick={onOpenInbox}
          aria-label={unread > 0 ? `What's new (${unread} unread)` : "What's new"}
          className="relative flex-none ml-auto inline-flex items-center justify-center w-9 h-9 rounded-full bg-cream text-ink border-2 border-ink shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform"
        >
          <Icon name="bell" className="w-[17px] h-[17px]" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-terra text-cream border-2 border-ink font-display font-bold text-[10px] leading-[14px]">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
        <button
          onClick={onFindFriends}
          aria-label="Find friends"
          className="flex-none inline-flex items-center gap-1 rounded-full bg-cream text-ink border-2 border-ink pl-2.5 pr-3 py-1.5 font-display font-bold text-[12.5px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform"
        >
          <Icon name="user" className="w-[14px] h-[14px]" />
          Friends
        </button>
      </div>
      <p className="mt-2 font-display italic text-[12.5px] leading-tight text-ink-soft">
        What your friends are making.
      </p>
    </div>
  )
}

export default function Feed() {
  const [posts, setPosts] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [reachedEnd, setReachedEnd] = useState(false)
  // The friends/everyone TOGGLE IS GONE (#94, un-shipping #70). It asked people to choose
  // between two things they had no basis for choosing between, and "Everyone" read as a
  // different app rather than more of the same one. Home is now unambiguously the people you
  // know — which is the product thesis: presence → the ask → the handoff.
  //
  // Public posts didn't go away, they changed job. `mode` is DERIVED FROM DATA, never tapped:
  //   'friends'  — normal. Your friends' posts and your own.
  //   'discover' — COLD START ONLY, when nobody but you has posted anything you can see.
  //                Then the feed is public posts from strangers, because a brand-new user's
  //                Home was otherwise EMPTY: the worst screen in the app, on the page they
  //                land on. The dish that makes someone ask for a recipe is also the thing
  //                that shows them what issei is for.
  //
  // Note this is a MODE, not a concatenation of friends + strangers. The objection to mixing
  // is that a stranger's meal must never bury a friend's — and in cold start there are no
  // friends' posts to bury, so the two can't conflict. Your OWN posts are kept and rendered
  // above the strangers (see ownPosts) so sharing a meal doesn't make it vanish from Home.
  const [mode, setMode] = useState('friends')
  const [ownPosts, setOwnPosts] = useState([])
  const navigate = useNavigate()
  // Unread count for the masthead badge (#79). One cheap call; the inbox itself marks
  // everything read, so coming back shows no badge without extra bookkeeping here.
  const [unread, setUnread] = useState(0)
  // Bumped when the photo nudge is satisfied or dismissed, so it unmounts at once.
  const [nudgeKey, setNudgeKey] = useState(0)
  useEffect(() => {
    let stale = false
    getNotifications()
      .then((res) => !stale && setUnread(res.data.unread_count || 0))
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [])
  // The mode a request was fired under, as a ref so an in-flight loadMore can compare it
  // against the CURRENT mode when it resolves — a state read in the async callback would see
  // the closed-over value, not the latest. Mode is now set once per mount rather than by a
  // tap, so this is narrower than it was, but a first page and a loadMore can still overlap
  // the friends→discover switch and a discover page must not append under a friends list.
  const modeRef = useRef(mode)
  modeRef.current = mode
  // Own id, for splitting "posts by other people" from "posts by me" — the test for cold
  // start. Read through the identity store, not localStorage (see lib/currentUser).
  const me = useCurrentUser()

  // ONE load per mount. Ask for the friends feed; if nobody but you has posted anything you
  // can see, fall through to public posts and keep your own above them.
  useEffect(() => {
    setPosts(null)
    setReachedEnd(false)
    setLoadingMore(false)
    let cancelled = false

    getFeed(undefined, 'friends')
      .then((res) => {
        if (cancelled) return
        const others = res.data.filter((p) => String(p.user_id) !== String(me.id))
        if (others.length > 0) {
          setMode('friends')
          setOwnPosts([])
          setPosts(res.data)
          if (res.data.length < PAGE) setReachedEnd(true)
          // Mark the feed read up to the NEWEST post received (#97), and only here: the
          // discover mode below is not a feed you're catching up on, so advancing the mark
          // from it would measure future friends' posts against strangers' ids.
          try {
            Promise.resolve(markFeedSeen(res.data[0].id)).catch(() => {})
          } catch {
            /* ignore — the divider simply shows again next time */
          }
          return
        }
        // COLD START. Keep your own posts (there may be none) and load the public feed.
        setOwnPosts(res.data)
        return getFeed(undefined, 'everyone')
          .then((r2) => {
            if (cancelled) return
            setMode('discover')
            setPosts(r2.data)
            if (r2.data.length < PAGE) setReachedEnd(true)
          })
          .catch(() => {
            if (cancelled) return
            // Public posts failed to load. Fall back to the friends empty state rather than
            // a spinner — it carries the two actions that actually fill the feed.
            setMode('friends')
            setOwnPosts([])
            setPosts(res.data)
            setReachedEnd(true)
          })
      })
      .catch(() => !cancelled && setPosts([]))

    return () => {
      cancelled = true
    }
  }, [me.id])

  // Index of the LAST post flagged new, or -1. The divider goes after it, and only when
  // there is a genuine boundary to mark: at least one new post AND at least one older one
  // below it. A permanent "all caught up" banner on every open stops meaning anything, and a
  // line at the very bottom of an all-new first visit marks nothing at all.
  //
  // Never on the Everyone tab: `is_new` is null there (the server only computes it for the
  // friends feed) and the mark is deliberately never advanced from it, so a divider there
  // would freeze in one spot forever in a tab you never caught up on.
  const lastNewIndex = posts
    ? posts.reduce((acc, p, i) => (p.is_new ? i : acc), -1)
    : -1
  const caughtUpAfter =
    posts && lastNewIndex >= 0 && lastNewIndex < posts.length - 1 ? lastNewIndex : -1

  const loadMore = useCallback(async () => {
    if (loadingMore || reachedEnd || !posts || posts.length === 0) return
    const firedMode = mode
    setLoadingMore(true)
    try {
      const { data } = await getFeed(
        posts[posts.length - 1].id,
        firedMode === 'discover' ? 'everyone' : 'friends',
      )
      // Drop this page if the mode changed while it was in flight — a friends page appended
      // under a discover list would mix the two, and it could also land on the null the load
      // effect just set (crashing on [...null]).
      if (modeRef.current !== firedMode) return
      if (data.length === 0 || data.length < PAGE) setReachedEnd(true)
      setPosts((prev) => [...prev, ...data])
    } catch {
      if (modeRef.current === firedMode) setReachedEnd(true)
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, reachedEnd, posts, mode])

  if (posts === null)
    return (
      <div className="min-h-screen bg-cream pb-6">
        <Masthead
          onFindFriends={() => navigate('/friends')}
          onOpenInbox={() => navigate('/notifications')}
          unread={unread}
        />
        <Loader />
      </div>
    )

  return (
    <div className="min-h-screen bg-cream pb-6">
      <Masthead
        onFindFriends={() => navigate('/friends')}
        onOpenInbox={() => navigate('/notifications')}
        unread={unread}
      />

      {/* A one-time "add a photo" strip (#84) for anyone who never saw #77's Welcome panel —
          which is every account created before it shipped. Self-hides once there's a photo or
          it's dismissed, and `nudgeKey` forces a remount so it disappears immediately rather
          than on the next navigation. */}
      <PhotoNudge key={nudgeKey} onDone={() => setNudgeKey((k) => k + 1)} />

      {/* The friends presence strip (#75) — friends' faces, most-recently-active first, each
          a tap to their profile. No longer gated on a scope (there is none): it self-hides
          when you have no friends, which is already the right behaviour in cold start, and a
          user who HAS friends but whose circle hasn't posted yet should still see them. */}
      <div className="px-4">
        <FriendsStrip />
      </div>

      {posts.length === 0 && ownPosts.length === 0 ? (
        (
          // EMPTY EVERYWHERE — no friends' posts, none of your own, and nothing public
          // either. The only case left is an app with nothing in it, so this is the right
          // and only nudge: the two acts that make a feed exist at all.
          <div className="px-5 pt-6">
            <div className="mx-auto sticker bg-peach px-5 pt-7 pb-6 text-center">
              <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-cream border-2 border-ink shadow-[0_3px_0_#2E3A24] text-[26px] leading-none mb-3">
                🍳
              </span>
              <h2 className="font-display font-black text-[22px] text-ink leading-tight">
                Nothing cooking yet
              </h2>
              <p className="font-display text-[14px] text-ink-soft leading-snug mt-2 max-w-xs mx-auto">
                Share what you made, or find the people you cook with — their meals
                will show up here.
              </p>
              <div className="flex flex-col gap-2.5 mt-5">
                <button
                  onClick={() => navigate('/add/meal')}
                  className="rounded-full bg-terra text-cream border-[2.5px] border-ink px-6 py-2.5 font-display font-bold text-[14px] shadow-[0_4px_0_#2E3A24] active:translate-y-[3px] active:shadow-[0_1px_0_#2E3A24] transition-transform"
                >
                  📸 Share a meal
                </button>
                <button
                  onClick={() => navigate('/friends')}
                  className="rounded-full bg-cream text-ink border-[2.5px] border-ink px-6 py-2.5 font-display font-bold text-[14px] shadow-[0_4px_0_#2E3A24] active:translate-y-[3px] active:shadow-[0_1px_0_#2E3A24] transition-transform"
                >
                  🧑‍🍳 Find friends
                </button>
              </div>
            </div>
          </div>
        )
      ) : (
        <div className="px-4 space-y-5">
          {/* COLD START (#94): your own posts first, then a labelled band of public meals from
              strangers. Safe to put them in one list precisely because this mode only exists
              when there are NO friends' posts — the thing mixing must never bury. The label is
              load-bearing: without it a stranger's dish reads as somebody you know. */}
          {ownPosts.map((p) => (
            <PostCard key={`own-${p.id}`} post={p} onOpen={() => navigate(`/posts/${p.id}`)} />
          ))}
          {mode === 'discover' && posts.length > 0 && (
            <div className="pt-1">
              <div className="flex items-center gap-3">
                <span className="h-[2px] flex-1 bg-line" />
                <span className="font-display font-bold text-[12px] uppercase tracking-[0.08em] text-ink-soft">
                  While you find your people
                </span>
                <span className="h-[2px] flex-1 bg-line" />
              </div>
              <p className="font-display italic text-[12.5px] text-ink-soft text-center mt-1.5">
                Meals people have shared with everyone.
              </p>
            </div>
          )}
          {/* onOpen makes each photo open the post — that page carries the author's own
              delete control, so a card that doesn't open is a dead end for the person most
              likely to want it (PostComposer lands you back here after publishing).

              THIS MUST BE A JSX COMMENT, not a `//` one. In children position `//` lines are
              TEXT NODES: an earlier version of this block rendered four lines of source above
              every card on Home. It compiled, built clean and passed every test, because
              nothing asserted the ABSENCE of stray text. */}
          {posts.map((p, i) => (
            <div key={p.id} className="space-y-5">
              <PostCard post={p} onOpen={() => navigate(`/posts/${p.id}`)} />
              {/* The caught-up line (#97), after the LAST new post: above it is what arrived
                  since you last looked, below is where you'd got to. Nothing is hidden or
                  removed — the older posts are right there under it, still scrollable.

                  The boundary index is computed ONCE from the array (see caughtUpAfter) rather
                  than per row. Per-row would draw a line wherever a new post sits directly
                  above a not-new one, and the flag is NOT monotonic: your own post is never
                  `is_new` to you, so one of yours between two friends' new posts produced TWO
                  dividers, the upper one claiming you were caught up on unread content. */}
              {i === caughtUpAfter && (
                <div className="flex items-center gap-3 pt-1">
                  <span className="h-[2px] flex-1 bg-line" />
                  <span className="font-display font-bold text-[12px] uppercase tracking-[0.08em] text-ink-soft">
                    You&rsquo;re all caught up
                  </span>
                  <span className="h-[2px] flex-1 bg-line" />
                </div>
              )}
            </div>
          ))}
          {!reachedEnd && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full py-3 font-display font-bold text-[14px] text-terra disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
