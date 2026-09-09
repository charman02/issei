import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getUserProfile,
  requestFriend,
  acceptFriend,
  removeFriend,
  getFriends,
  getFriendRequests,
  blockUser,
  reportUser,
} from '../api/friends'
import { toUserMessage } from '../api/client'
import BackButton from '../components/BackButton'
import Loader from '../components/Loader'
import ProfileContent from '../components/ProfileContent'
import Avatar from '../components/Avatar'

const fullName = (p) => `${p.first_name} ${p.last_name}`.trim()

// A read-only look at another person: their name, how many of their recipes you
// can see, and a single friend button that reflects the current relationship.
// The recipe GRID and posts arrive with the feed (Phase 1); Phase 0 is the shell
// plus the friend action, so the graph is usable before there's anything to show.
export default function UserProfile() {
  const { userId } = useParams()
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // The friendship row id — needed to accept/remove. Not on the profile payload
  // (which is relationship STATE, not the row), so look it up from the lists.
  const [friendshipId, setFriendshipId] = useState(null)
  // Blocking (#85). Two taps on purpose: it deletes the friendship, clears pending asks both
  // ways, and can't be undone from here — once blocked their profile 404s for us, so unblocking
  // lives on the You page. The confirm names those consequences instead of asking "are you
  // sure?" about nothing.
  const [confirmingBlock, setConfirmingBlock] = useState(false)
  const [blocking, setBlocking] = useState(false)
  const [blockError, setBlockError] = useState('')
  // The safety menu (#87). Both acts live behind a ⋯ rather than sitting on the page: a red
  // "Block" button in the open reads as a suggestion, and this is a control you should find
  // when you go looking for it and not otherwise. `menuOpen` is only the closed/open toggle —
  // once you pick something, one of the two panels below takes over.
  const [menuOpen, setMenuOpen] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [reportReason, setReportReason] = useState('harassment')
  const [reportNote, setReportNote] = useState('')
  const [reportSending, setReportSending] = useState(false)
  const [reportError, setReportError] = useState('')
  const [reportSent, setReportSent] = useState(false)

  const me = (() => {
    try {
      return JSON.parse(localStorage.getItem('issei_user') || '{}')
    } catch {
      return {}
    }
  })()
  const isSelf = String(me.id) === String(userId)

  function load() {
    getUserProfile(userId)
      .then((res) => setProfile(res.data))
      .catch(() => setError('Profile not found'))
    // Find the friendship row id (if any) so accept/remove have something to act on.
    if (!isSelf) {
      Promise.all([getFriends(), getFriendRequests()])
        .then(([fr, rq]) => {
          const match =
            fr.data.find((f) => String(f.user_id) === String(userId)) ||
            rq.data.find((r) => String(r.user_id) === String(userId))
          setFriendshipId(match ? match.id : null)
        })
        .catch(() => {})
    }
  }
  useEffect(load, [userId])

  async function act(fn) {
    setBusy(true)
    try {
      await fn()
      load()
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <div className="min-h-screen bg-cream flex flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="error-pill">{error}</span>
        <BackButton label="Back" />
      </div>
    )
  }
  if (profile === null) return <Loader />

  // Blocking (#85) — two taps, because it deletes the friendship and can't be undone from
  // here (their profile 404s once blocked; unblocking lives on the You page). The confirm
  // states both consequences rather than asking "are you sure?" about nothing.
  async function confirmBlock() {
    setBlockError('')
    setBlocking(true)
    try {
      await blockUser(Number(userId))
      // Their profile is now a 404 for us, so staying here would show an error screen.
      navigate('/friends', { replace: true })
    } catch (err) {
      setBlockError(toUserMessage(err, 'Couldn’t block them just now. Try again.'))
      setBlocking(false)
    }
  }

  // Reporting (#87). One tap fewer than blocking, on purpose: a report doesn't change anything
  // the reporter can see, so there is nothing to warn them about — the second tap on a block
  // exists because it deletes a friendship irreversibly.
  async function sendReport() {
    setReportError('')
    setReportSending(true)
    try {
      await reportUser(Number(userId), reportReason, reportNote)
      setReportSent(true)
    } catch (err) {
      setReportError(toUserMessage(err, 'Couldn’t send that just now. Try again.'))
    } finally {
      setReportSending(false)
    }
  }

  // The one friend button, driven by state.
  function FriendButton() {
    if (isSelf) return null
    const base =
      'rounded-full border-[2.5px] border-ink px-6 py-2.5 font-display font-bold text-[14px] shadow-[0_4px_0_#2E3A24] active:translate-y-[3px] active:shadow-[0_1px_0_#2E3A24] transition-transform disabled:opacity-50'
    if (profile.friend_state === 'accepted') {
      return (
        <button
          disabled={busy}
          onClick={() => friendshipId && act(() => removeFriend(friendshipId))}
          className={`${base} bg-cream text-ink`}
        >
          Friends ✓
        </button>
      )
    }
    if (profile.friend_state === 'pending') {
      return profile.friend_can_accept ? (
        <button
          disabled={busy}
          onClick={() => friendshipId && act(() => acceptFriend(friendshipId))}
          className={`${base} bg-terra text-cream`}
        >
          Accept friend request
        </button>
      ) : (
        <button disabled className={`${base} bg-cream text-ink-soft`}>
          Requested
        </button>
      )
    }
    return (
      <button
        disabled={busy}
        onClick={() => act(() => requestFriend(Number(userId)))}
        className={`${base} bg-terra text-cream`}
      >
        Add friend
      </button>
    )
  }

  return (
    <div className="min-h-screen bg-cream px-5 pt-5 pb-10">
      <div className="mb-6">
        <BackButton label="Back" />
      </div>

      <div className="flex flex-col items-center text-center">
        <Avatar name={profile.first_name} photoUrl={profile.photo_url} size="xl" />
        <h1 className="font-display font-black text-[28px] text-ink leading-tight mt-4">
          {fullName(profile)}
        </h1>
        {/* A quiet one-line summary of what they have — mirrors the counts on your own
            "You" box. recipe_count/post_count are what YOU may see (gated); friend_count
            is a public symmetric number. Understated, not a leaderboard. */}
        <p className="font-display text-[13px] text-ink-soft mt-1.5">
          {profile.recipe_count} {profile.recipe_count === 1 ? 'recipe' : 'recipes'}
          {' · '}
          {profile.post_count} {profile.post_count === 1 ? 'post' : 'posts'}
          {' · '}
          {profile.friend_count} {profile.friend_count === 1 ? 'friend' : 'friends'}
        </p>
        <div className="mt-5">
          <FriendButton />
        </div>
      </div>

      {/* Body. A non-friend looking at someone who's shown them nothing (private
          profile, no public items) gets a warm nudge toward the core action —
          friending — instead of two empty grids. Everyone else gets the tabbed
          recipes/posts content. `nothingVisible` uses the counts the profile payload
          already computed with the same can_view/can_view_post rules the grids use, so
          the header and the body can't disagree about whether there's anything to see. */}
      {(() => {
        const nothingVisible =
          !isSelf &&
          profile.friend_state !== 'accepted' &&
          (profile.recipe_count || 0) === 0 &&
          (profile.post_count || 0) === 0
        if (nothingVisible) {
          return (
            <div className="mt-10 text-center">
              <p className="font-display text-[15px] text-ink-soft leading-snug max-w-xs mx-auto">
                Nothing to see here yet. Add {profile.first_name} as a friend to see
                what they cook.
              </p>
            </div>
          )
        }
        return <ProfileContent userId={userId} />
      })()}

      {/* THE SAFETY MENU (#85 block, #87 report) — at the BOTTOM of the page, below the
          recipes and posts, behind a ⋯.

          Two decisions here, both from watching the thing be wrong first. It used to sit
          directly under the friend button, which put a safety control inside the social one's
          blast radius — the two most consequential taps on the page were adjacent. And it used
          to be a red "Block" chip sitting in the open, which reads as a suggestion: the page
          proposing something about a person you were only looking at.

          A ⋯ fixes both without hiding anything. The options are one tap away, in the place
          every app puts them, and you reach them by deciding to. Findability was the earlier
          worry with a faint control — but ⋯ is not faint, it's *unlabelled*, which is different:
          it's a universally understood affordance rather than a quiet version of a loud one. */}
      {!isSelf && (
        // text-center because this section no longer lives inside the identity block's
        // items-center column — without it the control renders flush to the page's left edge,
        // orphaned under two full-width grids. The panels keep their own text-left, since a
        // paragraph of consequences shouldn't be centered.
        <div className="mt-8 text-center">
          {/* State 4: reported. Deliberately offers the block as the obvious next step — the
              person who just reported someone very often wants them gone too, and making them
              hunt for the ⋯ again would be the app being obtuse about it. */}
          {reportSent ? (
            <div className="sticker bg-card p-3 text-left">
              <p className="font-display font-bold text-[14px] text-ink leading-snug">
                Thanks — we&rsquo;ll take a look.
              </p>
              <p className="font-display text-[13px] text-ink-soft leading-snug mt-1">
                {profile.first_name} hasn&rsquo;t been told, and nothing about your account has
                changed. If you&rsquo;d also rather not see each other, you can block them.
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => {
                    setReportSent(false)
                    setReporting(false)
                    setConfirmingBlock(true)
                  }}
                  className="flex-1 rounded-full bg-cream text-brick border-2 border-ink px-3 py-2 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform"
                >
                  Block them too
                </button>
                <button
                  onClick={() => {
                    setReportSent(false)
                    setReporting(false)
                    setMenuOpen(false)
                    setReportNote('')
                  }}
                  className="flex-1 rounded-full bg-cream text-ink border-2 border-ink px-3 py-2 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform"
                >
                  Done
                </button>
              </div>
            </div>
          ) : reporting ? (
            /* State 3: the report form. A reason and, optionally, what happened. The note is
               optional because demanding an explanation is friction in front of someone who may
               be upset, and a reason alone is a valid report. */
            <div className="sticker bg-card p-3 text-left">
              <p className="font-display font-bold text-[14px] text-ink leading-snug">
                Report {profile.first_name}?
              </p>
              <p className="font-display text-[13px] text-ink-soft leading-snug mt-1">
                This goes to us, not to them — they won&rsquo;t be told, and reporting on its own
                doesn&rsquo;t hide either of you from the other.
              </p>
              <label className="section-label block mt-3 mb-1" htmlFor="report-reason">
                What&rsquo;s wrong?
              </label>
              <select
                id="report-reason"
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                className="field w-full"
              >
                <option value="harassment">They&rsquo;re harassing someone</option>
                <option value="inappropriate">They posted something inappropriate</option>
                <option value="spam">Spam or scams</option>
                <option value="impersonation">They&rsquo;re pretending to be someone else</option>
                <option value="other">Something else</option>
              </select>
              <label className="section-label block mt-3 mb-1" htmlFor="report-note">
                Anything you want to add? (optional)
              </label>
              <textarea
                id="report-note"
                value={reportNote}
                onChange={(e) => setReportNote(e.target.value)}
                rows={3}
                maxLength={1000}
                className="field w-full"
                placeholder="What happened?"
              />
              {reportError && (
                <p className="mt-2">
                  <span className="error-pill">{reportError}</span>
                </p>
              )}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={sendReport}
                  disabled={reportSending}
                  className="flex-1 rounded-full bg-terra text-cream border-2 border-ink px-3 py-2 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
                >
                  {reportSending ? 'Sending…' : 'Send report'}
                </button>
                <button
                  onClick={() => {
                    setReporting(false)
                    setReportError('')
                    setMenuOpen(false)
                    // Clear the draft too. Without this, backing out and reopening Report later
                    // shows the old text still in the box — and sending would attach an account
                    // of one thing to whatever reason you pick the second time.
                    setReportNote('')
                    setReportReason('harassment')
                  }}
                  disabled={reportSending}
                  className="flex-1 rounded-full bg-cream text-ink border-2 border-ink px-3 py-2 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
                >
                  Never mind
                </button>
              </div>
            </div>
          ) : confirmingBlock ? (
            /* State 2: the block confirm. Names the person AND every consequence, rather than
               asking "are you sure?" about nothing. */
            <div className="sticker bg-card p-3 text-left">
              <p className="font-display font-bold text-[14px] text-ink leading-snug">
                Block {profile.first_name}?
              </p>
              <p className="font-display text-[13px] text-ink-soft leading-snug mt-1">
                You won&rsquo;t see each other anywhere, and they can&rsquo;t ask you for a
                recipe. It also removes them as a friend
                {profile.friend_state === 'accepted' ? '' : " if you're friends"} — unblocking
                later won&rsquo;t bring that back. A recipe you already sent them stays
                theirs.
              </p>
              {blockError && (
                <p className="mt-2">
                  <span className="error-pill">{blockError}</span>
                </p>
              )}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={confirmBlock}
                  disabled={blocking}
                  className="flex-1 rounded-full bg-brick text-cream border-2 border-ink px-3 py-2 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
                >
                  {blocking ? 'Blocking…' : 'Block them'}
                </button>
                <button
                  onClick={() => {
                    setConfirmingBlock(false)
                    setBlockError('')
                    setMenuOpen(false)
                  }}
                  disabled={blocking}
                  className="flex-1 rounded-full bg-cream text-ink border-2 border-ink px-3 py-2 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
                >
                  Never mind
                </button>
              </div>
            </div>
          ) : menuOpen ? (
            /* State 1: the menu. Report above Block, in escalation order — report asks someone
               else to act, block acts yourself and deletes a friendship. Both name the person,
               so neither can be tapped without knowing who it lands on. */
            <div className="sticker bg-card p-1.5 text-left">
              <button
                onClick={() => setReporting(true)}
                className="w-full text-left rounded-xl px-3 py-2.5 font-display font-bold text-[14px] text-ink active:bg-peach/40"
              >
                Report {profile.first_name}
              </button>
              <div className="h-[2px] bg-line mx-3" />
              <button
                onClick={() => setConfirmingBlock(true)}
                className="w-full text-left rounded-xl px-3 py-2.5 font-display font-bold text-[14px] text-brick active:bg-peach/40"
              >
                Block {profile.first_name}
              </button>
              <div className="h-[2px] bg-line mx-3" />
              <button
                onClick={() => setMenuOpen(false)}
                className="w-full text-left rounded-xl px-3 py-2.5 font-display text-[14px] text-ink-soft active:bg-peach/40"
              >
                Never mind
              </button>
            </div>
          ) : (
            /* State 0: just the ⋯. Cream, not brick — at rest this control makes no suggestion
               about the person whose profile you're reading. */
            <button
              onClick={() => setMenuOpen(true)}
              aria-label={`More options for ${profile.first_name}`}
              className="inline-flex items-center justify-center w-11 h-8 rounded-full bg-cream text-ink border-2 border-ink font-display font-black text-[15px] leading-none shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform"
            >
              &middot;&middot;&middot;
            </button>
          )}
        </div>
      )}
    </div>
  )
}
