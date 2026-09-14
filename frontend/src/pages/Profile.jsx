import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import client, { toUserMessage } from '../api/client'
import { useCurrentUser, patchUser } from '../lib/currentUser'
import { getUserProfile, getFriendRequests, getBlocks, unblockUser } from '../api/friends'
import { getIncomingRequests } from '../api/posts'
import { PHOTO_ACCEPT } from '../lib/photoUpload'
import { useAvatarUpload } from '../lib/useAvatarUpload'
import MarkerTitle from '../components/MarkerTitle'
import Avatar from '../components/Avatar'
import Toggle from '../components/Toggle'
import NotificationSettings from '../components/NotificationSettings'
import PhotoFramer from '../components/PhotoFramer'

// The client-side prefs bag. Since the Settings section was removed (2026-09-11) the ONLY key this
// page still touches is `photoNudgeDismissed` — every display preference is gone, and everything
// else on this screen is either a server field (visibility, notifications) or an account action.
//
// These local copies predate `lib/prefs.js` and duplicate it; they stay for now because the shared
// module's `setPref` merges against storage while this one merges against React state, and the
// nudge's dismissal is read at mount from `loadPrefs()` in both places. Collapse them together
// only with a test on the nudge, which is the thing that breaks if they disagree.
const PREFS_KEY = 'issei_prefs'
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
  } catch {
    return {}
  }
}

// An account row that expands into its own edit form. Closed, it's a labelled
// row with a chevron and (optionally) the current value; open, it shows `children`
// (the form) and a close control. One row open at a time is enforced by the parent.
function AccountRow({ label, value, open, onToggle, children }) {
  return (
    <div className="border-t-2 border-line first:border-t-0">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center justify-between w-full py-3 text-left"
      >
        <span className="min-w-0">
          <span className="block font-display font-bold text-[14px] text-ink">
            {label}
          </span>
          {value && !open && (
            <span className="block font-sans text-[12.5px] text-ink-soft mt-0.5 truncate">
              {value}
            </span>
          )}
        </span>
        <span
          className={`font-display font-bold text-terra text-[18px] leading-none transition-transform ${
            open ? 'rotate-90' : ''
          }`}
        >
          ›
        </span>
      </button>
      {open && <div className="pb-3">{children}</div>}
    </div>
  )
}

export default function Profile() {
  const navigate = useNavigate()
  // From the shared identity store (lib/currentUser), NOT a local snapshot of localStorage.
  // That snapshot is what made this page show a stale monogram while the avatar on the user's
  // own post card was correct: a post card renders server data, this rendered a cache nobody
  // reconciled. Writes below go through patchUser, which merges over a FRESH read.
  const user = useCurrentUser()
  // Held in state so `setPref` can merge without re-reading storage. Nothing RENDERS from it any
  // more — the display toggles that did are gone — so it is write-mostly now.
  const [prefs, setPrefs] = useState(loadPrefs)

  // Identity-box counts (recipes · posts · friends) + the incoming friend-request
  // count for the separate requests button. Loaded from the SAME endpoint that powers
  // another user's profile — GET /friends/profile/{id} with your own id: can_view/
  // can_view_post let the owner see everything, so the counts come back complete.
  // Reusing it keeps one definition of "the counts", rather than a second self-only path.
  const [stats, setStats] = useState(null) // { recipe_count, post_count, friend_count }
  const [requestCount, setRequestCount] = useState(0)
  // Pending recipe-asks across ALL your posts (#79). Deliberately separate from the bell's
  // unread badge: reading the notification clears that, but the ask itself is still waiting
  // on you, and an obligation shouldn't disappear because you glanced at it.
  const [askCount, setAskCount] = useState(0)
  // Blocked people (#85). This list is the ONLY route back: once blocked, their profile 404s
  // for you, so the unblock control cannot live where the block control does.
  const [blocks, setBlocks] = useState([])
  const [unblocking, setUnblocking] = useState(null)
  const [blocksError, setBlocksError] = useState('')
  useEffect(() => {
    if (!user.id) return
    getUserProfile(user.id)
      .then((r) => setStats(r.data))
      .catch(() => setStats(null))
    getFriendRequests()
      .then((r) => setRequestCount(r.data.length))
      .catch(() => setRequestCount(0))
    getIncomingRequests()
      .then((r) =>
        setAskCount(r.data.reduce((n, row) => n + row.requesters.length, 0)),
      )
      .catch(() => setAskCount(0))
    // Don't swallow this one. An empty list is indistinguishable from "you've blocked
    // nobody", and this list is the ONLY place an unblock exists — a silent GET failure would
    // strand someone with no way back.
    getBlocks()
      .then((r) => {
        setBlocks(r.data)
        setBlocksError('')
      })
      .catch((err) => {
        setBlocks([])
        setBlocksError(
          toUserMessage(err, 'Couldn’t load your blocked list. Pull to refresh.'),
        )
      })
  }, [user.id])

  // Avatar upload (#33) via the shared hook — it uploads (square face-crop), PATCHes
  // /auth/me, and writes through the identity store, which this page subscribes to. So
  // there is nothing for onDone to mirror locally any more.
  const {
    onPick: onPickPhoto,
    uploading: uploadingPhoto,
    error: photoError,
    framerProps,
  } = useAvatarUpload({
    // No local mirror needed — the hook writes through patchUser, and useCurrentUser above
    // re-renders this page from the store.
    onDone: () => {},
  })
  // Skipper reminder (#77): a gentle, dismissible line under the avatar shown only while
  // the user has NO photo and hasn't dismissed it. Disappears the moment a photo is set
  // (user.photo_url), or when dismissed (persisted in prefs so it stays gone). Not shown
  // on the feed too — one nudge, in the place the fix already lives.
  const [photoNudgeDismissed, setPhotoNudgeDismissed] = useState(
    () => !!loadPrefs().photoNudgeDismissed,
  )
  const showPhotoNudge = !user.photo_url && !photoNudgeDismissed
  function dismissPhotoNudge() {
    setPref('photoNudgeDismissed', true)
    setPhotoNudgeDismissed(true)
  }

  // Which account row is open (only one at a time), plus the edit form's own state.
  const [openRow, setOpenRow] = useState(null) // 'name' | 'email' | 'password' | 'delete' | null
  const [firstName, setFirstName] = useState(user.first_name || '')
  const [lastName, setLastName] = useState(user.last_name || '')
  const [newEmail, setNewEmail] = useState(user.email || '')
  const [newPassword, setNewPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [accountError, setAccountError] = useState('')
  const [accountDone, setAccountDone] = useState('')

  // --- The two #105 settings -------------------------------------------------------------
  // Seeded from the cached user so the controls render in their true state on first paint, with
  // the same pre-#105 fallback the create form uses (a cached user written by an older build has
  // neither field, and showing someone the wrong current state is worse than a beat of loading).
  const [defaultVisibility, setDefaultVisibility] = useState(
    user.default_recipe_visibility ||
      (user.profile_visibility === 'public' ? 'public' : 'friends'),
  )
  const [savingDefault, setSavingDefault] = useState(false)
  const [savingInvites, setSavingInvites] = useState(false)
  // Its OWN error line, rendered inside its own card. The first version routed this into
  // `accountError`, which lives in the Account section five cards down the page — so a failed save
  // rolled the control back correctly and explained itself somewhere the person wasn't looking.
  const [settingsError, setSettingsError] = useState('')
  const [invitesFriendsOnly, setInvitesFriendsOnly] = useState(
    user.invite_permission === 'friends',
  )
  // A useState initializer runs ONCE, so both controls above would keep showing whatever the cache
  // held at mount — even after `reconcile()` (which syncs GET /auth/me once per app start) landed a
  // different value, or after the setting was changed on another device. `useCurrentUser()` already
  // re-renders this component when the cache updates; this effect is what makes the controls
  // follow it. Skipped while a save is in flight, so an optimistic value isn't stomped by a cache
  // write that has not caught up yet.
  //
  // It matters most for the invite toggle: showing "off" for a restriction that is actually on is
  // exactly the wrong direction for a safety control to be wrong in.
  useEffect(() => {
    if (savingDefault || savingInvites) return
    if (user.default_recipe_visibility) setDefaultVisibility(user.default_recipe_visibility)
    if (user.invite_permission) setInvitesFriendsOnly(user.invite_permission === 'friends')
  }, [user.default_recipe_visibility, user.invite_permission, savingDefault, savingInvites])

  // OPTIMISTIC, then reconciled from the response — and rolled back on failure. A settings
  // control that silently keeps the new position after a failed save is the worst of the three
  // outcomes: the person believes a restriction is in force when it is not.
  async function onPickDefaultVisibility(value) {
    if (value === defaultVisibility || savingDefault) return
    setSettingsError('')
    const previous = defaultVisibility
    setDefaultVisibility(value)
    setSavingDefault(true)
    try {
      const { data } = await client.patch('/auth/me', { default_recipe_visibility: value })
      setDefaultVisibility(data.default_recipe_visibility)
      // Into the cached user, because the create form reads it from there before any /auth/me
      // round trip could answer — the same reason profile_visibility is cached.
      patchUser({ default_recipe_visibility: data.default_recipe_visibility })
    } catch (err) {
      setDefaultVisibility(previous)
      setSettingsError(toUserMessage(err, 'Could not save that. Please try again.'))
    } finally {
      setSavingDefault(false)
    }
  }

  async function onToggleInvites(next) {
    // An in-flight guard, which the visibility picker had and this did not. A double-tap fired two
    // PATCHes, and because each writes the switch from its OWN response, an out-of-order arrival
    // left it displaying the opposite of what is stored — on the one control whose entire job is
    // telling someone whether a restriction is in force. Same failure the rollback prevents,
    // reached by racing instead of by failing.
    if (savingInvites) return
    setSavingInvites(true)
    setSettingsError('')
    const previous = invitesFriendsOnly
    setInvitesFriendsOnly(next)
    try {
      const { data } = await client.patch('/auth/me', {
        invite_permission: next ? 'friends' : 'anyone',
      })
      setInvitesFriendsOnly(data.invite_permission === 'friends')
      patchUser({ invite_permission: data.invite_permission })
    } catch (err) {
      setInvitesFriendsOnly(previous)
      setSettingsError(
        toUserMessage(err, 'Could not change that just now. Please try again.'),
      )
    } finally {
      setSavingInvites(false)
    }
  }

  // --- Export (#105) ---------------------------------------------------------------------
  // The honest answer to "what if issei goes away?" for someone who has typed thirty recipes in.
  // A Blob and an object URL rather than pointing a link at the endpoint: the request needs the
  // Authorization header, so a bare <a href> would 401, and a token in a query string would end
  // up in history and logs.
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  async function exportRecipes() {
    if (exporting) return
    setExporting(true)
    setExportError('')
    try {
      const { data } = await client.get('/recipes/export')
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      // Dated, because someone exporting twice should end up with two files rather than
      // "issei-recipes (1).json" and no idea which is current.
      a.download = `issei-recipes-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(toUserMessage(err, 'Could not export your recipes. Please try again.'))
    } finally {
      setExporting(false)
    }
  }

  function setPref(key, val) {
    const next = { ...prefs, [key]: val }
    setPrefs(next)
    localStorage.setItem(PREFS_KEY, JSON.stringify(next))
  }

  // Open a row (or close it if it's already open), resetting the form fields to
  // the current values and clearing any stale message.
  function toggleRow(row) {
    setAccountError('')
    setAccountDone('')
    if (openRow === row) {
      setOpenRow(null)
      return
    }
    setFirstName(user.first_name || '')
    setLastName(user.last_name || '')
    setNewEmail(user.email || '')
    setNewPassword('')
    setCurrentPassword('')
    setDeletePassword('')
    setDeleteError('')
    setOpenRow(row)
  }

  // PATCH /auth/me with only the fields this row changes, then refresh the cached
  // user so the identity card + localStorage agree with the server. The token is
  // keyed by user id, so a name/email change doesn't invalidate it.
  async function saveAccount(patch, doneMsg) {
    setSaving(true)
    setAccountError('')
    setAccountDone('')
    try {
      const { data } = await client.patch('/auth/me', patch)
      // patchUser merges over a FRESH read of the store. The old form spread `...user` from
      // this component's closure, so a photo uploaded after mount got written back stale —
      // one of the two ways the avatar drifted.
      patchUser({
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email,
      })
      setAccountDone(doneMsg)
      setOpenRow(null)
    } catch (err) {
      setAccountError(toUserMessage(err, 'Could not save. Please try again.'))
    } finally {
      setSaving(false)
    }
  }

  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Profile visibility (public/private) — the visibility model (#68). Its own busy flag
  // so a mid-flight toggle disables just this control. On success we refresh the cached
  // issei_user so the create default ("Everyone" vs "Friends only") stays correct
  // everywhere without a reload.
  const [savingVisibility, setSavingVisibility] = useState(false)
  // Flipping the profile is asked, not silent — because item visibility is CONCRETE, a
  // flip alone changes nothing existing, so we offer a bulk sweep in the same step.
  // `pending` is the direction being confirmed: 'public' or 'private' (null = no dialog).
  const [pendingFlip, setPendingFlip] = useState(null)
  const isPublicProfile = user.profile_visibility === 'public'

  // Apply the profile flip, optionally sweeping every existing item to `applyToAll`
  // ("public" or "friends"). Omit applyToAll to leave existing items untouched.
  async function applyProfileVisibility(makePublic, applyToAll = null) {
    setSavingVisibility(true)
    try {
      const body = { profile_visibility: makePublic ? 'public' : 'private' }
      if (applyToAll) body.apply_visibility_to_all = applyToAll
      const { data } = await client.patch('/auth/me', body)
      patchUser({ profile_visibility: data.profile_visibility })
      setPendingFlip(null)
    } finally {
      setSavingVisibility(false)
    }
  }

  // The toggle handler: either direction opens its confirm dialog, since a sweep of
  // existing items is offered both ways (make-everything-public / make-everything-
  // friends-only). Neither direction changes existing items on its own.
  function onToggleProfile(makePublic) {
    if (savingVisibility) return
    setPendingFlip(makePublic ? 'public' : 'private')
  }

  function handleLogout() {
    localStorage.removeItem('issei_token')
    localStorage.removeItem('issei_user')
    navigate('/login')
  }

  async function handleDeleteAccount() {
    if (!deletePassword) {
      setDeleteError('Enter your password to confirm.')
      return
    }
    setDeleteError('')
    setDeleting(true)
    try {
      await client.delete('/auth/me', { data: { password: deletePassword } })
      localStorage.removeItem('issei_token')
      localStorage.removeItem('issei_user')
      navigate('/login', { replace: true })
    } catch (err) {
      setDeleteError(toUserMessage(err, 'Could not delete account. Try again.'))
    } finally {
      setDeleting(false)
    }
  }

  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ')

  return (
    <div className="min-h-screen bg-cream px-5 pt-6">
      {/* The framing step (#103) — "can't edit profile photo to make sure it looks as u want" was
          reported from this page. Real DOM in this tree so the overlay inherits the app's styles;
          a null file renders nothing. */}
      {framerProps?.file && <PhotoFramer {...framerProps} />}
      <MarkerTitle
        color="bg-peach"
        className="font-display font-black text-[32px] text-ink leading-none"
      >
        You<span className="text-terra">.</span>
      </MarkerTitle>

      {/* ACCOUNT — identity card. Avatar + name, then three quiet tappable counts
          (recipes · posts · friends). The counts are shortcuts into existing surfaces,
          NOT new grids: recipes/posts → your Kitchen (which has Recipes|Posts tabs),
          friends → the Friends page. Deliberately understated — issei avoids vanity
          metrics; a friend count is fine because it's mutual, but it's a label, not a
          trophy. */}
      <div className="sticker bg-card p-5 mt-6">
        {/* Tap the avatar to change your photo. The camera badge signals it's editable;
            the label wraps a hidden file input (same pattern as the recipe photo box). */}
        <label
          className="relative inline-block cursor-pointer mb-4"
          aria-busy={uploadingPhoto || undefined}
        >
          <input
            type="file"
            accept={PHOTO_ACCEPT}
            onChange={onPickPhoto}
            aria-label="Change your profile photo"
            className="sr-only"
          />
          <Avatar name={fullName || user.email} photoUrl={user.photo_url} size="lg" bg="bg-plum" />
          <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-terra text-cream border-2 border-ink flex items-center justify-center text-[11px] shadow-[0_2px_0_#2E3A24]">
            {uploadingPhoto ? '…' : '✎'}
          </span>
        </label>
        {photoError && (
          <p className="mb-2"><span className="error-pill">{photoError}</span></p>
        )}
        {/* Skipper reminder (#77): only while there's no photo and it hasn't been
            dismissed. The avatar above IS the fix, so this is a pointer to it, not a
            second control — a tiny × dismisses it for good. */}
        {showPhotoNudge && (
          <div className="flex items-start gap-2 mb-3 -mt-1">
            <p className="font-display text-[13px] text-ink-soft leading-snug">
              Add a photo so friends recognize you — tap the circle above.
            </p>
            <button
              onClick={dismissPhotoNudge}
              aria-label="Dismiss"
              className="flex-none font-display font-bold text-[14px] text-ink-soft leading-none px-1"
            >
              &times;
            </button>
          </div>
        )}
        {fullName && (
          <p className="font-display font-black text-[22px] text-ink">
            {fullName}
          </p>
        )}
        <p className="font-sans text-[13px] text-ink-soft mt-0.5">
          {user.email || 'Unknown'}
        </p>

        {/* The three counts. Rendered as buttons so each is a tap target; a thin
            divider row under the identity, not a stat-block. Shows em-dashes until the
            fetch lands so the layout doesn't jump. */}
        <div className="flex items-stretch gap-1 mt-4 border-t-2 border-line pt-3">
          {[
            { key: 'recipe_count', label: 'Recipes', to: '/my-recipes' },
            { key: 'post_count', label: 'Posts', to: '/my-recipes?tab=posts' },
            { key: 'friend_count', label: 'Friends', to: '/friends' },
          ].map((c) => (
            <button
              key={c.key}
              onClick={() => navigate(c.to)}
              className="flex-1 text-center py-1 rounded-[10px] active:bg-cream transition-colors"
            >
              <span className="block font-display font-black text-[20px] text-ink leading-none">
                {stats ? stats[c.key] : '—'}
              </span>
              <span className="block font-display text-[12px] text-ink-soft mt-1">
                {c.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Friend requests — its own button below the box, because a pending request is
          an action waiting on you, not a stat. Shows a count badge only when there are
          any. Routes to the Friends page, which lists incoming requests at the top. */}
      {askCount > 0 && (
        <button
          onClick={() => navigate('/requests')}
          className="w-full mt-3 inline-flex items-center justify-center gap-2 py-2.5 rounded-full bg-saffron text-ink border-[2.5px] border-ink font-display font-bold text-[14px] shadow-[0_4px_0_#2E3A24] transition-transform active:translate-y-[3px] active:shadow-[0_1px_0_#2E3A24]"
        >
          {askCount === 1 ? '1 person asked for a recipe' : `${askCount} people asked for a recipe`} &rarr;
        </button>
      )}

      {requestCount > 0 && (
        <button
          onClick={() => navigate('/friends')}
          className="w-full mt-3 inline-flex items-center justify-center gap-2 py-2.5 rounded-full bg-terra text-cream border-[2.5px] border-ink font-display font-bold text-[14px] shadow-[0_4px_0_#2E3A24] transition-transform active:translate-y-[3px] active:shadow-[0_1px_0_#2E3A24]"
        >
          {requestCount} friend {requestCount === 1 ? 'request' : 'requests'} →
        </button>
      )}

      {/* PROFILE VISIBILITY — the profile-visibility model (#68). Its own card above
          Settings because it decides who sees everything you make, not just a display
          preference. The hint names the consequence for each state; a per-recipe or
          per-post override still wins over this default. */}
      <h2 className="font-display font-black text-[19px] text-ink mt-7 mb-2">
        Who can see your kitchen
      </h2>
      {/* Blocked people (#85). Only rendered when there are any — an empty "Blocked (0)" row
          is a permanent reminder of a thing that isn't happening. Lives here rather than on
          the blocked person's profile because that profile 404s for you once blocked, so this
          is the only place an unblock can exist. */}
      {blocksError && (
        <p className="mb-3">
          <span className="error-pill">{blocksError}</span>
        </p>
      )}
      {blocks.length > 0 && (
        <div className="sticker bg-card px-5 py-3 mb-3">
          <p className="section-label mb-2">Blocked</p>
          <div className="space-y-2">
            {blocks.map((b) => (
              <div key={b.user_id} className="flex items-center gap-2.5">
                <Avatar name={b.first_name} photoUrl={b.photo_url} size="sm" />
                <span className="min-w-0 flex-1 font-display font-bold text-[14px] text-ink truncate">
                  {`${b.first_name} ${b.last_name}`.trim()}
                </span>
                <button
                  disabled={unblocking === b.user_id}
                  onClick={async () => {
                    setUnblocking(b.user_id)
                    setBlocksError('')
                    try {
                      await unblockUser(b.user_id)
                      setBlocks((prev) => prev.filter((x) => x.user_id !== b.user_id))
                    } catch (err) {
                      // The block path routes its failure through toUserMessage; this half of
                      // the same feature must too. Left uncaught, a 500 or an offline tap just
                      // flipped the label back to "Unblock" and said nothing.
                      setBlocksError(
                        toUserMessage(err, 'Couldn’t unblock them just now. Try again.'),
                      )
                    } finally {
                      setUnblocking(null)
                    }
                  }}
                  className="flex-none rounded-full bg-cream text-ink border-2 border-ink px-3 py-1 font-display font-bold text-[12.5px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
                >
                  {unblocking === b.user_id ? 'Unblocking…' : 'Unblock'}
                </button>
              </div>
            ))}
          </div>
          <p className="font-display italic text-[12px] text-ink-soft mt-2 leading-snug">
            Unblocking lets them find you again. It doesn&rsquo;t make you friends again.
          </p>
        </div>
      )}
      <div className="sticker bg-card px-5 py-2">
        <Toggle
          label="Public profile"
          hint={
            isPublicProfile
              ? 'Anyone can see your recipes and posts. Turn off to keep them to friends.'
              : 'Only your friends see your recipes and posts. You can still make a single recipe or post public.'
          }
          on={isPublicProfile}
          onChange={onToggleProfile}
        />
      </div>

      {/* NEW RECIPES START AS — (#105). This was previously INFERRED from the toggle above, and
          the inference lost a value: the profile is two-valued while a recipe's visibility is
          three, so "Friends only" — the actual default for every new recipe — existed only as the
          side effect of having a private profile, and nothing on any screen said so. Stated here.

          It sets the STARTING POINT of the picker on the create form, nothing more. Changing it
          moves nothing already saved (#68: a recipe's visibility is stored literally), which is
          what the hint says in the words a person would use. */}
      <div className="sticker bg-card px-5 py-4 mt-3">
        <p className="font-display font-bold text-[14px] text-ink">New recipes start as</p>
        <p className="font-display italic text-[12.5px] text-ink-soft mt-0.5 mb-2.5 leading-snug">
          Just the starting point — you can change it on any recipe. Nothing you&rsquo;ve already
          saved moves.
        </p>
        <div className="flex gap-2" role="radiogroup" aria-label="New recipes start as">
          {[
            { value: 'public', label: 'Everyone' },
            { value: 'friends', label: 'Friends' },
            { value: 'private', label: 'Only me' },
          ].map((opt) => {
            const selected = defaultVisibility === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={savingDefault}
                onClick={() => onPickDefaultVisibility(opt.value)}
                className={`flex-1 rounded-full border-2 border-ink px-3 py-2 font-display font-bold text-[13px] transition-transform active:translate-y-[1px] disabled:opacity-50 ${
                  selected ? 'bg-peach text-ink' : 'bg-card text-ink-soft'
                }`}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* WHO CAN SEND YOU A RECIPE — (#105). Grouped with visibility rather than with Account
          because it is about CONTACT, and it belongs on this page at all because it is the app's
          last unsolicited-contact channel: a handoff can be pre-addressed to your EMAIL, so a
          sender needs no relationship with you and blocking (#85) cannot reach it — there is
          nobody to block until after it has happened.

          The copy does not say "strangers", which would describe most senders unfairly; the
          honest framing is who it stays OPEN to. A refusal is invisible to the sender by design
          (a uniform 404), so this hint is the only place the consequence is stated. */}
      <div className="sticker bg-card px-5 py-2 mt-3">
        <Toggle
          label="Only friends can send me recipes"
          hint={
            invitesFriendsOnly
              ? 'Someone has to be your friend before they can send a recipe to your email. A shared link still works.'
              : 'Anyone who knows your email address can send you a recipe.'
          }
          on={invitesFriendsOnly}
          onChange={onToggleInvites}
          disabled={savingInvites}
        />
      </div>
      {settingsError && (
        <p className="mt-2">
          <span className="error-pill">{settingsError}</span>
        </p>
      )}

      {/* Confirm dialog for either flip. Because item visibility is concrete, changing
          the profile alone leaves existing recipes/posts as they are — so we ask what
          to do with them: keep them, or sweep everything to match the new profile. Copy
          differs by direction (public vs private). */}
      {pendingFlip && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/40 px-4"
          onClick={() => !savingVisibility && setPendingFlip(null)}
        >
          <div
            className="sticker bg-card w-full max-w-sm p-5 mb-4 sm:mb-0"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display font-black text-[20px] text-ink leading-tight">
              {pendingFlip === 'public'
                ? 'Make your profile public?'
                : 'Make your profile private?'}
            </h3>
            <p className="font-display text-[14px] text-ink-soft leading-snug mt-2">
              {pendingFlip === 'public'
                ? 'New recipes and posts will default to Everyone. What about the ones you’ve already made?'
                : 'New recipes and posts will default to Friends only. What about the ones you’ve already made?'}
            </p>
            <div className="flex flex-col gap-2.5 mt-5">
              {/* Primary = the sweep that matches the new profile. */}
              <button
                onClick={() =>
                  applyProfileVisibility(
                    pendingFlip === 'public',
                    pendingFlip === 'public' ? 'public' : 'friends',
                  )
                }
                disabled={savingVisibility}
                className="rounded-full bg-terra text-cream border-[2.5px] border-ink px-5 py-2.5 font-display font-bold text-[14px] shadow-[0_4px_0_#2E3A24] active:translate-y-[3px] active:shadow-[0_1px_0_#2E3A24] transition-transform disabled:opacity-50"
              >
                {pendingFlip === 'public'
                  ? 'Make everything public'
                  : 'Make everything friends-only'}
              </button>
              {/* Secondary = flip the profile only, leave existing items as they are. */}
              <button
                onClick={() => applyProfileVisibility(pendingFlip === 'public')}
                disabled={savingVisibility}
                className="rounded-full bg-cream text-ink border-[2.5px] border-ink px-5 py-2.5 font-display font-bold text-[14px] shadow-[0_4px_0_#2E3A24] active:translate-y-[3px] active:shadow-[0_1px_0_#2E3A24] transition-transform disabled:opacity-50"
              >
                Leave my existing ones as they are
              </button>
              <button
                onClick={() => setPendingFlip(null)}
                disabled={savingVisibility}
                className="font-display font-bold text-[13px] text-ink-soft py-1 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NOTIFICATIONS (#89). Its own section above Settings, not a row inside it: the toggles
          below are display preferences that change what this screen looks like, while these
          decide whether the app is allowed to interrupt someone's day. */}
      <NotificationSettings />

      {/* THE "SETTINGS" SECTION IS GONE (owner's call, 2026-09-11) — both toggles removed, and the
          heading with them, because two display preferences were all it ever held.

          "Open recipes at Ingredients & steps" was read by NOTHING. It wrote `cookingByDefault` to
          localStorage and no component ever looked at it, so tapping it changed nothing at all —
          the same defect #102 removed from the notifications screen, sitting one heading below it.

          "Turn off animations" DID work, via `prefersReducedMotion()`, but it duplicated a control
          the operating system already owns. `prefers-reduced-motion` is a real OS setting that this
          app still honours; someone who wants stillness sets it once and every app obeys, which is
          strictly better than setting it again here. `SaveCelebration` keeps checking it.

          What's left on this page is now all consequential: who can see your kitchen, whether the
          app may interrupt your day, who you've blocked, and your account. */}

      {/* ACCOUNT ACTIONS — real edits via PATCH /auth/me. */}
      <h2 className="font-display font-black text-[19px] text-ink mt-7 mb-2">
        Account
      </h2>
      {accountDone && (
        <p className="mb-2 font-display font-bold text-[13px] text-ink bg-sage/50 border-2 border-ink rounded-[10px] px-3 py-2">
          {accountDone}
        </p>
      )}
      <div className="sticker bg-card px-5 py-1">
        {/* Edit name — low-risk, no password required. */}
        <AccountRow
          label="Edit name"
          value={fullName}
          open={openRow === 'name'}
          onToggle={() => toggleRow('name')}
        >
          <div className="flex gap-2">
            <input
              aria-label="First name"
              className="field flex-1"
              placeholder="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
            <input
              aria-label="Last name"
              className="field flex-1"
              placeholder="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
          {openRow === 'name' && accountError && (
            <p className="mt-2"><span className="error-pill">{accountError}</span></p>
          )}
          <button
            disabled={saving}
            onClick={() =>
              saveAccount(
                { first_name: firstName.trim(), last_name: lastName.trim() },
                'Your name is updated.',
              )
            }
            className="btn-primary mt-3 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save name'}
          </button>
        </AccountRow>

        {/* Change email — requires the current password (it's a login identity). */}
        <AccountRow
          label="Change email"
          value={user.email}
          open={openRow === 'email'}
          onToggle={() => toggleRow('email')}
        >
          <input
            type="email"
            aria-label="New email"
            className="field mb-2"
            placeholder="New email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <input
            type="password"
            aria-label="Current password"
            className="field"
            placeholder="Current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          {openRow === 'email' && accountError && (
            <p className="mt-2"><span className="error-pill">{accountError}</span></p>
          )}
          <button
            disabled={saving}
            onClick={() =>
              saveAccount(
                { email: newEmail.trim(), current_password: currentPassword },
                'Your email is updated.',
              )
            }
            className="btn-primary mt-3 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save email'}
          </button>
        </AccountRow>

        {/* Change password — current password verified server-side before it changes. */}
        <AccountRow
          label="Change password"
          open={openRow === 'password'}
          onToggle={() => toggleRow('password')}
        >
          <input
            type="password"
            aria-label="Current password"
            className="field mb-2"
            placeholder="Current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <input
            type="password"
            aria-label="New password"
            className="field"
            placeholder="New password (at least 8 characters)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          {openRow === 'password' && accountError && (
            <p className="mt-2"><span className="error-pill">{accountError}</span></p>
          )}
          <button
            disabled={saving}
            onClick={() =>
              saveAccount(
                { new_password: newPassword, current_password: currentPassword },
                'Your password is updated.',
              )
            }
            className="btn-primary mt-3 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save password'}
          </button>
        </AccountRow>

        {/* EXPORT YOUR RECIPES (#105). Beside delete-account because both are "your data, your
            call" — and deliberately ABOVE it, so the row that ends an account is still the last
            thing on the page.

            NOT a row that expands: there is nothing to configure and nothing to confirm. One tap
            downloads a file, which is the whole feature.

            JSON, not a PDF or a printable cookbook — a keepsake artefact is the legacy-archive
            product POSITIONING keeps issei out of, and a machine-readable file is what actually
            answers "what if this goes away?", because it can be re-imported somewhere else. The
            hint says what is IN it (your own recipes, verbatim) and what is not (recipes other
            people handed you, which are theirs). */}
        <div className="border-t-2 border-line py-3.5">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-display font-bold text-[14px] text-ink">Export your recipes</p>
              <p className="font-display italic text-[12.5px] text-ink-soft mt-0.5 leading-snug">
                A file with every recipe you&rsquo;ve written, exactly as you wrote it — &ldquo;a
                good splash&rdquo; and all. Recipes other people sent you stay theirs.
              </p>
            </div>
            <button
              onClick={exportRecipes}
              disabled={exporting}
              className="flex-none rounded-full bg-cream text-ink border-2 border-ink px-3.5 py-1.5 font-display font-bold text-[12.5px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
            >
              {exporting ? 'Preparing…' : 'Download'}
            </button>
          </div>
          {exportError && (
            <p className="mt-2">
              <span className="error-pill">{exportError}</span>
            </p>
          )}
        </div>

        {/* Delete account — same expandable row pattern, gated on password. */}
        <AccountRow
          label="Delete account"
          open={openRow === 'delete'}
          onToggle={() => toggleRow('delete')}
        >
          <p className="font-display text-[13px] text-ink-soft mb-3">
            This can't be undone. Your recipes, cook events, and all account
            data will be permanently deleted.
          </p>
          <input
            type="password"
            aria-label="Confirm password"
            className="field"
            placeholder="Enter your password to confirm"
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
          />
          {openRow === 'delete' && deleteError && (
            <p className="mt-2"><span className="error-pill">{deleteError}</span></p>
          )}
          <button
            onClick={handleDeleteAccount}
            disabled={deleting}
            className="btn-primary mt-3 !bg-terra disabled:opacity-50"
          >
            {deleting ? 'Deleting...' : 'Delete forever'}
          </button>
        </AccountRow>
      </div>

      {/* (The Friends entry moved into the identity box's tappable counts — the
          Friends count links here, and incoming requests get their own button above.) */}

      {/* Send feedback — now an in-app form (/feedback), replacing the external
          hosted form this used to open in a new tab. VITE_FEEDBACK_URL is gone
          rather than kept as a fallback: two routes to the same thing would split
          the reports across a Google Sheet and the database, and a stale env var
          on the deploy host would silently keep sending beta testers out of the
          app — the exact friction the native form exists to remove. The form is
          always shown, because unlike an external link it can't point at nothing. */}
      <button
        onClick={() => navigate('/feedback', { state: { from: '/profile' } })}
        className="w-full mt-3 inline-flex items-center justify-center gap-2 py-3 rounded-full bg-saffron border-[2.5px] border-ink text-ink font-display font-bold text-[14px] shadow-[0_4px_0_#2E3A24] transition-transform active:translate-y-[3px] active:shadow-[0_1px_0_#2E3A24]"
      >
        💬 Send feedback
      </button>

      <button
        onClick={handleLogout}
        className="w-full py-3 mt-3 mb-2 rounded-full bg-cream border-[2.5px] border-ink text-terra font-display font-bold text-[14px] shadow-[0_4px_0_#2E3A24] transition-transform active:translate-y-[3px] active:shadow-[0_1px_0_#2E3A24]"
      >
        Log out
      </button>

      {/* REMOVED (#102): "More ways to share and connect are on the way. 💛"
          It signed the APP's own voice with 💛 — the same glyph that signs the sender's message in
          `lib/inviteMessage.js`, which is supposed to read like something a person wrote from their
          own texting app. One heart cannot be both the app's warm cue and the sender's, and the
          sender's is the one that matters, so this is the one that goes. (It was also a roadmap
          promise on a settings page, which is a thing to ship rather than to say.) */}
    </div>
  )
}
