import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getFeed, markFeedSeen } from '../api/posts'
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
  // The friends/everyone toggle (#70). 'friends' = your friends' + own posts; 'everyone' =
  // public posts from people you're NOT friends with (discovery). Deliberately NOT
  // persisted: Friends is home base, and every visit reopens there — Everyone is a
  // deliberate peek, not a mode you get stuck in.
  const [scope, setScope] = useState('friends')
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
  // The scope a request was fired under, as a ref so an in-flight loadMore can compare it
  // against the CURRENT scope when it resolves — a state read in the async callback would
  // see the closed-over value, not the latest. This is what lets a page that overlaps a
  // tab switch be dropped instead of merged into the wrong scope.
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  // Reload from scratch whenever the scope changes (including first mount). Reset to the
  // loading state so a slow 'everyone' fetch can't briefly show the old friends list under
  // the new tab, and clear reachedEnd so the new scope paginates fresh.
  useEffect(() => {
    setPosts(null)
    setReachedEnd(false)
    setLoadingMore(false) // a stale scope's loadMore must not leave the new scope busy
    let cancelled = false
    getFeed(undefined, scope)
      .then((res) => {
        if (cancelled) return
        setPosts(res.data)
        if (res.data.length < PAGE) setReachedEnd(true)
        // Mark the feed read up to the NEWEST post we just received (#97). Sent after the
        // page is on screen, and scoped to what actually arrived — so anything posted while
        // this feed is open still counts as new next time. Fire-and-forget: a failed mark
        // just means the divider shows again, which is the harmless direction to fail in.
        // Only for the friends scope; 'everyone' isn't the feed you're catching up on.
        if (scope !== 'everyone' && res.data.length) {
          // try/catch as well as .catch: a synchronous throw here would be caught by the
          // outer .catch below and read as "the feed failed to load", blanking a list that
          // had just arrived. Bookkeeping must never be able to hide content.
          try {
            Promise.resolve(markFeedSeen(res.data[0].id)).catch(() => {})
          } catch {
            /* ignore — the divider simply shows again next time */
          }
        }
      })
      .catch(() => !cancelled && setPosts([]))
    // Ignore an in-flight response if the scope changed again before it landed.
    return () => {
      cancelled = true
    }
  }, [scope])

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
    const firedScope = scope
    setLoadingMore(true)
    try {
      const { data } = await getFeed(posts[posts.length - 1].id, firedScope)
      // Drop this page if the user switched scope while it was in flight — otherwise a
      // friends-scope page could append under the Everyone tab (mixing scopes), or land on
      // the null the scope-change effect just set (crashing on [...null]). The scope-change
      // effect owns loading the new scope; this stale page is not its job.
      if (scopeRef.current !== firedScope) return
      setPosts((prev) => [...prev, ...data])
      if (data.length < PAGE) setReachedEnd(true)
    } catch {
      // A failed page-load just stops "load more"; the feed already shown stays. Guarded
      // by the same scope check so a stale scope's failure can't end the new scope early.
      if (scopeRef.current === firedScope) setReachedEnd(true)
    } finally {
      // Always clear the busy flag — leaving it set would wedge "Load more". If the scope
      // changed, the scope-change effect has already reset it too; a redundant clear is
      // harmless, a missed one is a stuck button.
      setLoadingMore(false)
    }
  }, [loadingMore, reachedEnd, posts, scope])

  // The segmented Friends | Everyone pill under the masthead. Rendered above the loading
  // state too, so switching tabs doesn't make the control vanish while the fetch runs.
  const scopeToggle = (
    <div className="px-4 pb-3">
      <div
        role="tablist"
        aria-label="Whose meals to show"
        className="inline-flex rounded-full border-2 border-ink bg-cream p-0.5 text-[13.5px] font-display font-bold"
      >
        {[
          { value: 'friends', label: 'Friends' },
          { value: 'everyone', label: 'Everyone' },
        ].map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={scope === t.value}
            onClick={() => setScope(t.value)}
            className={`px-5 py-1.5 rounded-full transition ${
              scope === t.value ? 'bg-terra text-cream' : 'text-ink-soft'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  )

  if (posts === null)
    return (
      <div className="min-h-screen bg-cream pb-6">
        <Masthead
          onFindFriends={() => navigate('/friends')}
          onOpenInbox={() => navigate('/notifications')}
          unread={unread}
        />
        {scopeToggle}
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
      {scopeToggle}

      {/* A one-time "add a photo" strip (#84) for anyone who never saw #77's Welcome panel —
          which is every account created before it shipped. Self-hides once there's a photo or
          it's dismissed, and `nudgeKey` forces a remount so it disappears immediately rather
          than on the next navigation. */}
      <PhotoNudge key={nudgeKey} onDone={() => setNudgeKey((k) => k + 1)} />

      {/* The friends presence strip (#75) — friends' faces, most-recently-active first,
          each a tap to their profile. Only in the FRIENDS scope: the 'everyone' feed is
          strangers' discovery, where a rail of your friends is off-topic. Sits above both
          states: a user with friends but no posts yet still sees their circle. Self-hides
          when you have no friends and adds its own padding. */}
      {scope === 'friends' && (
        <div className="px-4">
          <FriendsStrip />
        </div>
      )}

      {posts.length === 0 ? (
        scope === 'everyone' ? (
          // EVERYONE, EMPTY — nobody outside your circle has shared a public meal yet.
          // No "share / find friends" prompt here: that's the friends-feed cold-start,
          // and it'd be the wrong nudge under a discovery tab.
          <div className="px-5 pt-6">
            <div className="mx-auto sticker bg-peach px-5 pt-7 pb-6 text-center">
              <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-cream border-2 border-ink shadow-[0_3px_0_#2E3A24] text-[26px] leading-none mb-3">
                🌍
              </span>
              <h2 className="font-display font-black text-[22px] text-ink leading-tight">
                Nothing public yet
              </h2>
              <p className="font-display text-[14px] text-ink-soft leading-snug mt-2 max-w-xs mx-auto">
                When people share a meal with everyone, it’ll show up here. Check
                back soon.
              </p>
            </div>
          </div>
        ) : (
          // FRIENDS, EMPTY — the cold-start fix. Not a blank screen: the two acts that
          // make the feed come alive.
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
