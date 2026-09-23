import { useState, useEffect, useRef } from 'react'
import { useLocation, useParams, useNavigate } from 'react-router-dom'
import {
  getPost,
  requestRecipe,
  retractRequest,
  deletePost,
  updatePost,
  fulfillPost,
  detachRecipe,
} from '../api/posts'
import VisibilityChoice from '../components/VisibilityChoice'
import { toUserMessage } from '../api/client'
import BackButton from '../components/BackButton'
import Avatar from '../components/Avatar'
import SafetyMenu from '../components/SafetyMenu'
import Loader from '../components/Loader'
import { toUtcMs } from '../utils/time'
import { createUploader, PHOTO_ACCEPT } from '../lib/photoUpload'
import { usePhotoFramer } from '../lib/usePhotoFramer'
import PhotoFramer from '../components/PhotoFramer'
import RecipePicker from '../components/RecipePicker'

const fullName = (p) => `${p.author_first_name} ${p.author_last_name}`.trim()

// "12 Aug 2026" — an absolute date, because this page is a permalink rather than a feed you
// scan. Guarded: a missing or unparseable timestamp renders nothing rather than "Invalid Date".
//
// Goes through toUtcMs for the reason spelled out in utils/time.js: the API sends a zone-less
// timestamp, and parsing it raw lands on the wrong DAY for every viewer west of UTC. A relative
// "3d" absorbs that error; a printed date displays it.
function postedOn(iso) {
  if (!iso) return ''
  const ms = toUtcMs(iso)
  if (Number.isNaN(ms)) return ''
  return new Date(ms).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// PostPage (/posts/:id) — a single shared meal. Read-only to everyone but its AUTHOR, who
// also gets the edit and delete controls below. A real permalink for any post the viewer may
// see, reached from the Kitchen's Posts tab or a profile grid. (Browse used to be a third
// door; #94 removed that tab.) Read authorization is the backend's: GET /posts/{id} returns
// the post only if can_view_post allows this viewer (author, a friend on a friends post, or
// ANYONE on a public one), else 404 — so a non-friend opening a public meal gets it, and a
// private/friends post they aren't entitled to reads as "not found", never confirming it
// exists.
//
// No like button, ever. ONE action for a non-author, and it's the same either/or as the feed
// card: a post whose recipe you can read links through to it; one you can't gets "Ask for the
// recipe" (#79). This page especially needs the ask — it's where someone who isn't a friend
// lands, which is exactly the person with no other way to reach the cook.
//
// THREE author-only controls, and all three are the cook's alone. The ask COUNT renders here for the
// author exactly as it does on the feed card — `request_count` is null for every non-author
// (POSITIONING invariant 4), so there is no public tally to leak and no zero printed under
// anyone's ordinary meal, including the cook's own. And DELETE lives here because this is the
// only page that is unambiguously one post; a delete on a feed or grid card is a mis-tap
// waiting to happen. Deleting is a hard delete server-side, so the confirm names what actually
// goes: the post, and any pending asks on it (RecipeRequest.post_id cascades). It also says
// what does NOT go — a linked recipe is a separate row and survives — because "delete post"
// reads as "delete the recipe I attached" otherwise, and that would be the scariest possible
// misunderstanding in an app whose whole point is keeping the recipe. EDIT (#98) sits beside it,
// inline rather than on its own route, and covers dish name, description, visibility AND — since
// #106, reversing #98 on the owner's call — the PHOTO. The old rule ("a different photo is a
// different meal, so re-shoot it as a new post") described what a post means but answered the
// wrong question: the common case is a photo that came out badly, and delete-and-repost was the
// only remedy, which throws away the post's date, its place in every feed, and any asks on it.
export default function PostPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  // MUST be the router's location, not the global one. `window.location` has no `.state`, so
  // reading it would make the #104 deep-link below silently never fire — a whole feature that
  // compiles, ships, and does nothing.
  const location = useLocation()
  const [post, setPost] = useState(null)
  const [error, setError] = useState('')
  // The ask (#79). Mirrors the server's answer; `asked` is seeded from the loaded post so a
  // reload or a return visit shows the true state rather than resetting to "not asked".
  const [asking, setAsking] = useState(false)
  const [asked, setAsked] = useState(false)
  const [askError, setAskError] = useState('')
  // Delete (author-only). Two taps: it can't be undone, and it takes pending asks with it.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  // Editing your own meal. Inline rather than a separate route: the thing you're editing is
  // already on screen, and a caption fix shouldn't cost a page transition. `draft` is null when
  // not editing, so opening the form always starts from the CURRENT post rather than from stale
  // state left behind by a previous cancel.
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  // Replacing the photo (#106). The same uploader and framer the composer uses, so a replacement
  // gets HEIC conversion and the 4:3 framing step exactly like an original — a second, simpler
  // upload path here would be the one that drifts.
  const uploader = useRef(createUploader())
  const { frame, framerProps } = usePhotoFramer()
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [photoError, setPhotoError] = useState('')

  // Attaching / unlinking a recipe after the post is published (#99).
  const [pickerOpen, setPickerOpen] = useState(false)
  // TWO flags, not one: a single shared flag put "Working…" on Unlink while an attach started from
  // "Change recipe" was running — feedback for one act landing on the destructive-sounding control
  // beside it. Each button still disables BOTH, because only one of these should ever be in flight.
  const [attaching, setAttaching] = useState(false)
  const [detaching, setDetaching] = useState(false)
  const [attachError, setAttachError] = useState('')

  async function attach(recipe) {
    setPickerOpen(false)
    if (attaching || detaching) return
    setAttaching(true)
    setAttachError('')
    try {
      // `fulfillPost` is the attach path. Named for the case where people HAVE asked — it mints a
      // grant per pending requester and notifies them — and it also just attaches when nobody has,
      // because `post.recipe_id` is set outside that loop server-side. One endpoint, because
      // attaching IS answering: a second "attach quietly" route would be the #98 loose end again,
      // leaving asks pending under an already-attached recipe.
      const { data } = await fulfillPost(post.id, recipe.id)
      setPost(data)
    } catch (err) {
      setAttachError(toUserMessage(err, 'Couldn’t attach that recipe. Try again.'))
    } finally {
      setAttaching(false)
    }
  }

  async function detach() {
    if (attaching || detaching) return
    setDetaching(true)
    setAttachError('')
    try {
      const { data } = await detachRecipe(post.id)
      setPost(data)
    } catch (err) {
      setAttachError(toUserMessage(err, 'Couldn’t unlink that. Try again.'))
    } finally {
      setDetaching(false)
    }
  }

  function onPickNewPhoto(e) {
    return uploader.current.upload({
      slot: 'post-edit',
      event: e,
      frame: frame('cover'),
      onBusy: setUploadingPhoto,
      onError: setPhotoError,
      // Into the DRAFT, not the post: nothing is saved until "Save changes", so backing out with
      // "Never mind" has to leave the original photo untouched. Functional update because the
      // upload resolves long after the handler's closure was made and the dish name may have been
      // edited in between.
      onUrl: (url) => setDraft((d) => (d ? { ...d, photo_url: url } : d)),
    })
  }

  const me = JSON.parse(localStorage.getItem('issei_user') || '{}')
  const isMine = post ? String(me.id) === String(post.user_id) : false

  async function ask() {
    if (asking || !post) return
    setAsking(true)
    setAskError('')
    const next = !asked
    setAsked(next)
    try {
      const { data } = next ? await requestRecipe(post.id) : await retractRequest(post.id)
      // A retract can answer 204 with an empty body (the ask was the only credential on a post
      // the cook has since hidden). Guard both: `setPost("")` would blank the page back to a
      // loader, and reading a field off it would throw.
      if (data) setPost(data)
      setAsked(Boolean(data?.requested_by_me))
    } catch (err) {
      setAsked(!next)
      setAskError(toUserMessage(err, 'Couldn’t ask just now. Try again.'))
    } finally {
      setAsking(false)
    }
  }

  async function confirmDelete() {
    setDeleteError('')
    setDeleting(true)
    try {
      await deletePost(post.id)
      // This page is a 404 for everyone now, so land back where your posts live.
      navigate('/my-recipes?tab=posts', { replace: true })
    } catch (err) {
      setDeleteError(toUserMessage(err, 'Couldn’t delete this post. Try again.'))
      setDeleting(false)
      // Deliberately leave the panel OPEN — it's where the error renders.
    }
  }

  async function saveEdit() {
    setSaveError('')
    setSaving(true)
    try {
      // Send the whole set rather than diffing: the API treats null as "unchanged", so a diff
      // would silently lose a cleared description. An empty string is how you clear one.
      const { data } = await updatePost(post.id, {
        dish_name: draft.dish_name.trim(),
        description: draft.description,
        visibility: draft.visibility,
        // Only when it actually changed. Sending the unchanged URL would work (the router
        // re-validates and reassigns the same string), but "send only what changed" is what keeps
        // an edit from depending on the host rule for a photo the person never touched.
        photo_url: draft.photo_url === post.photo_url ? null : draft.photo_url,
      })
      setPost(data)
      setDraft(null)
    } catch (err) {
      setSaveError(toUserMessage(err, 'Couldn’t save your changes. Try again.'))
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    getPost(id)
      .then((res) => {
        setPost(res.data)
        // ARRIVING STRAIGHT INTO A CONTROL (#104). A post card's ⋯ menu names "Edit this meal" and
        // "Delete", and both actions live here rather than on the card — so the card sends the
        // intent along in router state and this opens the matching control. A menu item that only
        // dropped someone on the page would make them hunt for the thing they just asked for.
        //
        // Gated on OWNERSHIP as answered by the server, not by the card: `res.data.user_id` is the
        // authority, so a hand-crafted navigation can't open an editor on someone else's meal. The
        // form would fail on save anyway (PATCH is author-only) — but showing it at all would be
        // the client claiming an edit is possible when it isn't, which is the class of lie #104's
        // sibling tasks keep removing.
        const wanted = location.state?.open
        const mine = String(me.id) === String(res.data.user_id)
        if (mine && wanted === 'edit') {
          setDraft({
            dish_name: res.data.dish_name,
            description: res.data.description || '',
            visibility: res.data.visibility,
          })
        } else if (mine && wanted === 'delete') {
          setConfirmingDelete(true)
        }
        // Consume it, so a back-then-forward or a refresh doesn't reopen a confirm someone
        // already dismissed — router state survives both.
        if (wanted) navigate(`/posts/${id}`, { replace: true, state: {} })
        // Seed the ask state from the server, or a reload shows "Ask for the recipe" to
        // someone who already asked — and tapping it would then RETRACT the ask they
        // still wanted. Caught by its own test.
        setAsked(Boolean(res.data.requested_by_me))
      })
      .catch(() => setError('This meal isn’t available.'))
    // EVERY piece of per-post state resets here — and it has to be every one. React Router
    // reuses this element when only the :id param changes, so nothing unmounts:
    //   - `draft`: an edit form left open across /posts/5 → /posts/6 would save post 5's dish
    //     name, description AND visibility onto post 6, since the draft survives while `post`
    //     is replaced. `confirmingDelete` is the same trap with a worse ending.
    //   - `error`: it short-circuits the whole render, so arriving from a 404'd id would show
    //     "isn't available" over a post that loaded perfectly well.
    //   - `post`: without clearing it, the PREVIOUS meal stays on screen during the refetch —
    //     briefly showing one person's dinner under another's permalink.
    // No in-app link makes that jump today, which is exactly why this is a guard rather than a
    // comment: the next link that does won't arrive with a test.
    setPost(null)
    setError('')
    setDraft(null)
    setSaveError('')
    setConfirmingDelete(false)
    setDeleteError('')
    // #99's three, added because the comment above says EVERY one and meant it: a picker left open
    // across the id change would attach post 5's chosen recipe to post 6, which is the same trap as
    // the draft, and a stuck `attaching` would leave the new post's controls disabled with no way to
    // clear them.
    setPickerOpen(false)
    setAttaching(false)
    setDetaching(false)
    setAttachError('')
  }, [id])

  if (error) {
    return (
      <div className="min-h-screen bg-cream flex flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="error-pill">{error}</span>
        <BackButton to="/browse" label="Back" />
      </div>
    )
  }
  if (post === null) return <Loader />

  // Own post → your read-only self view is /profile ("You"); anyone else → their profile.
  const openAuthor = () => navigate(isMine ? '/profile' : `/u/${post.user_id}`)

  return (
    <div className="min-h-screen bg-cream px-5 pt-4 pb-10">
      {/* The framing step (#103) for a replacement photo (#106). A null file renders nothing. */}
      {framerProps?.file && <PhotoFramer {...framerProps} />}
      {/* Your own recipes, to attach (#99) — the same sheet the composer uses, so "attach one"
          means the same thing before and after publishing. */}
      {pickerOpen && <RecipePicker onPick={attach} onClose={() => setPickerOpen(false)} />}
      <div className="mb-3">
        <BackButton to="/browse" label="Back" />
      </div>

      <article className="sticker bg-card overflow-hidden">
        {/* Author header — tap to their profile. A column, not a row: the posted-on date sits
            below the name and deliberately OUTSIDE the button (see below). */}
        <div className="px-3.5 py-3">
          <button
            onClick={openAuthor}
            className="flex items-center gap-2.5 min-w-0 max-w-full text-left"
          >
            <Avatar name={post.author_first_name} photoUrl={post.author_photo_url} size="sm" />
            <span className="block font-display font-bold text-[14.5px] text-ink truncate">
              {fullName(post)}
            </span>
          </button>
          {/* WHEN it was made. It was missing entirely, and on a page whose whole subject is
              "what someone cooked" the date is part of the fact — a meal from Tuesday and a
              meal from March are different claims. Absolute, not "3d ago": the relative form
              suits a feed you're scanning, but a permalink is where you come to know.

              OUTSIDE the author button, though it sits under the name: inside it, tapping the
              date navigated to their profile, and a date is not a link to a person. */}
          <p className="mt-1 ml-[42px] font-display italic text-[12px] text-ink-soft">
            {postedOn(post.created_at)}
          </p>
        </div>

        {/* The meal photo. */}
        <img
          src={post.photo_url}
          alt={post.dish_name}
          className="w-full aspect-square object-cover block border-y-2 border-ink"
        />

        {/* Dish name + optional description. */}
        <div className="px-3.5 py-3">
          <h1 className="font-display font-black text-[22px] text-ink leading-tight">
            {post.dish_name}
          </h1>
          {post.description && (
            <p className="font-display text-[14.5px] text-ink-soft leading-snug mt-1.5">
              {post.description}
            </p>
          )}
          {/* Attached recipe → link through (the discovery payoff). recipe_id is already
              nulled by the API when the viewer can't open it, so this never dead-ends —
              and that same nulling is why the ask below covers both "never written down"
              and "written but private" without distinguishing them. */}
          {post.recipe_id ? (
            <button
              onClick={() => navigate(`/recipes/${post.recipe_id}`)}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 font-display font-bold text-[15px] text-cream bg-terra rounded-full px-3.5 py-3 border-[2.5px] border-ink shadow-[0_4px_0_#2E3A24] active:translate-y-[3px] active:shadow-[0_1px_0_#2E3A24] transition-transform"
            >
              See the recipe &rarr;
            </button>
          ) : (
            !isMine && (
              <>
                <button
                  onClick={ask}
                  disabled={asking}
                  aria-pressed={asked}
                  className={`mt-3 w-full inline-flex items-center justify-center gap-2 font-display font-bold text-[15px] rounded-full px-3.5 py-3 border-[2.5px] border-ink shadow-[0_4px_0_#2E3A24] active:translate-y-[3px] active:shadow-[0_1px_0_#2E3A24] transition-transform disabled:opacity-50 ${
                    asked ? 'bg-cream text-ink-soft' : 'bg-saffron text-ink'
                  }`}
                >
                  {asked ? 'Asked ✓' : 'Ask for the recipe'}
                </button>
                {askError && (
                  <p className="mt-2">
                    <span className="error-pill">{askError}</span>
                  </p>
                )}
              </>
            )
          )}

          {/* The cook's own count, and ONLY the cook's — same rule and same wording as the
              feed card, so one act reads the same in both places. Hidden at zero: "0 people
              asked for this" on your own meal is the discouraging line the private count
              exists to avoid. */}
          {isMine && post.request_count > 0 && (
            <button
              onClick={() => navigate('/requests')}
              className="mt-3 block font-display font-bold text-[13.5px] text-terra"
            >
              {post.request_count === 1
                ? '1 person asked for this →'
                : `${post.request_count} people asked for this →`}
            </button>
          )}

          {/* ATTACH A RECIPE AFTER THE FACT (#99). The gap this closes: a recipe could only
              reach a post at CREATE time (the composer, or writing one mid-post per #81) or via
              `fulfill`, which needs somebody to have asked. So a cook who posted the meal on
              Tuesday and wrote the recipe on Thursday had no way to connect them, and one who
              attached the wrong recipe could only delete the post.

              It sits HERE, with the recipe link, rather than in the edit form — because it is not
              a caption edit. `PATCH /posts/{id}` deliberately refuses `recipe_id` (#98): attaching
              quietly there would leave every pending ask still pending, with the cook's own card
              reading "1 person asked for this" underneath an already-attached recipe.

              ATTACHING IS ANSWERING, and the copy says so BEFORE the tap when anyone is waiting.
              `fulfillPost` mints a grant per pending requester and notifies them, which is right —
              but it is a bigger act than "link my recipe", so the person doing it should know. */}
          {isMine && !draft && !confirmingDelete && (
            <div className="mt-3">
              {post.recipe_id ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPickerOpen(true)}
                    disabled={attaching || detaching}
                    className="flex-1 rounded-full bg-cream text-ink border-2 border-ink px-3 py-2 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
                  >
                    {attaching ? 'Working…' : 'Change recipe'}
                  </button>
                  <button
                    onClick={detach}
                    disabled={attaching || detaching}
                    className="flex-none rounded-full bg-cream text-ink-soft border-2 border-ink px-3 py-2 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
                  >
                    {detaching ? 'Working…' : 'Unlink'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setPickerOpen(true)}
                  disabled={attaching || detaching}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-[14px] border-2 border-dashed border-ink/50 bg-card py-3 font-display font-bold text-[13.5px] text-ink-soft active:translate-y-[1px] transition-transform disabled:opacity-50"
                >
                  {attaching ? 'Attaching…' : 'Attach a recipe'}
                </button>
              )}
              {/* Said before the tap, not after. Attaching answers everyone still waiting.
                  NOT gated on "nothing attached", which is what it was first and which got it
                  backwards: a pending ask and an attached recipe routinely COEXIST. `request_recipe`
                  deliberately allows an ask when a recipe is linked but the asker can't read it
                  (a private recipe on a public meal — the response nulls `recipe_id` for them), so
                  a public post can collect asks with a recipe already attached. The author sees
                  "Change recipe" in that state, and tapping it mints grants on the new recipe and
                  notifies those people — the exact act this sentence exists to disclose. */}
              {post.request_count > 0 && (
                <p className="font-display italic text-[12.5px] text-ink-soft mt-1.5 leading-snug">
                  {post.request_count === 1
                    ? 'This also sends it to the 1 person who asked.'
                    : `This also sends it to the ${post.request_count} people who asked.`}
                </p>
              )}
              {attachError && (
                <p className="mt-2">
                  <span className="error-pill">{attachError}</span>
                </p>
              )}
            </div>
          )}

          {/* OWNER CONTROLS — edit and delete, as buttons rather than a text link. Delete used
              to be grey underlined text, which read as a footnote for something consequential.
              Edit is the primary of the two (you'll want it far more often), so it carries the
              filled style and delete stays outlined until you commit to it. */}
          {isMine && !draft && !confirmingDelete && (
            <div className="mt-4 pt-3 border-t-2 border-line flex gap-2">
              <button
                // Disabled mid-attach: `attach`/`detach` end in an unconditional `setPost(data)`,
                // and a fulfill response is a snapshot from BEFORE an edit — so opening and saving
                // an edit while one is outstanding lets the later response overwrite it. The attach
                // controls already hide while a draft is open; this is the same rule in reverse.
                disabled={attaching || detaching}
                onClick={() =>
                  setDraft({
                    dish_name: post.dish_name,
                    description: post.description || '',
                    visibility: post.visibility,
                    photo_url: post.photo_url,
                  })
                }
                className="flex-1 rounded-full bg-terra text-cream border-2 border-ink px-3 py-2 font-display font-bold text-[13.5px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
              >
                Edit this meal
              </button>
              <button
                onClick={() => setConfirmingDelete(true)}
                disabled={attaching || detaching}
                className="flex-none rounded-full bg-cream text-brick border-2 border-ink px-3.5 py-2 font-display font-bold text-[13.5px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          )}

          {/* The edit form: the photo, the dish name, the line under it, and who can see it.
              The PHOTO became editable in #106 (owner's call), reversing #98's "a different photo
              is a different meal, so re-shoot it as a new post". That rule described what a post
              MEANS but answered the wrong question — the common case isn't a different meal, it's
              a photo that came out badly or the wrong one of two picked in a hurry, and the only
              remedy on offer was delete-and-repost, which throws away the post's date, its place
              in every feed, and any recipe asks already sitting on it. It goes through the same
              pick → HEIC-convert → frame → upload path as the composer, so a replacement is
              framed (#103) exactly like an original. There is no "remove" — a post with no photo
              is not a post; deleting the post is how you have no photo. */}
          {isMine && draft && (
            <div className="mt-4 pt-3 border-t-2 border-line">
              <span className="section-label block mb-1">Photo</span>
              <label
                aria-busy={uploadingPhoto || undefined}
                className="relative block cursor-pointer focus-within:ring-4 focus-within:ring-terra/25 rounded-[14px]"
              >
                <input
                  type="file"
                  accept={PHOTO_ACCEPT}
                  onChange={onPickNewPhoto}
                  aria-label="Replace the photo"
                  className="sr-only"
                />
                <img
                  src={draft.photo_url}
                  alt="Your meal"
                  className="w-full h-[180px] object-cover block rounded-[14px] border-[2.5px] border-ink"
                />
                {/* A label over the image rather than a separate button: the photo IS the control,
                    which is the same idiom the composer uses for picking one in the first place. */}
                <span className="absolute bottom-2 right-2 rounded-full bg-cream text-ink border-2 border-ink px-3 py-1 font-display font-bold text-[12.5px] shadow-[0_2px_0_#2E3A24]">
                  {uploadingPhoto ? 'Uploading…' : 'Change photo'}
                </span>
              </label>
              {photoError && (
                <p className="mt-2">
                  <span className="error-pill">{photoError}</span>
                </p>
              )}
              <label className="section-label block mt-3 mb-1" htmlFor="edit-dish">
                What is it?
              </label>
              <input
                id="edit-dish"
                value={draft.dish_name}
                onChange={(e) => setDraft({ ...draft, dish_name: e.target.value })}
                className="field w-full"
                placeholder="Sunday adobo"
              />
              <label className="section-label block mt-3 mb-1" htmlFor="edit-desc">
                Anything to add? (optional)
              </label>
              <textarea
                id="edit-desc"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                rows={3}
                className="field w-full"
                placeholder="Slow-cooked all afternoon."
              />
              <div className="mt-4">
                <VisibilityChoice
                  compact
                  value={draft.visibility}
                  onChange={(v) => setDraft({ ...draft, visibility: v })}
                />
              </div>
              {saveError && (
                <p className="mt-2">
                  <span className="error-pill">{saveError}</span>
                </p>
              )}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={saveEdit}
                  disabled={saving || uploadingPhoto || !draft.dish_name.trim()}
                  className="flex-1 rounded-full bg-terra text-cream border-2 border-ink px-3 py-2 font-display font-bold text-[13.5px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
                <button
                  onClick={() => {
                    // Retire the slot so an in-flight upload can't write into a draft that no
                    // longer exists — the same reason PostComposer retires on remove.
                    uploader.current.retire('post-edit')
                    // AND clear the busy flag by hand. `retire` bumps the slot's sequence, which
                    // makes `isCurrent()` false, which makes the upload's own `finally` SKIP
                    // `onBusy(false)` (photoUpload.js) — by design, so a superseded pick can't
                    // stop a newer upload's spinner. The consequence here is that backing out
                    // mid-upload left `uploadingPhoto` true for the rest of the session, and the
                    // control that would have recovered it is the one it disables: "Save changes"
                    // reads `uploadingPhoto`, so the editor was permanently unsaveable.
                    setUploadingPhoto(false)
                    setDraft(null)
                    setSaveError('')
                    setPhotoError('')
                  }}
                  disabled={saving}
                  className="flex-1 rounded-full bg-cream text-ink border-2 border-ink px-3 py-2 font-display font-bold text-[13.5px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
                >
                  Never mind
                </button>
              </div>
            </div>
          )}

          {/* Delete (author-only) — the two-tap confirm, which replaces the button pair above
              while it's open so the page never shows two competing delete affordances. */}
          {isMine && confirmingDelete && (
            <div className="mt-4 pt-3 border-t-2 border-line">
              <div className="sticker bg-card p-3">
                <p className="font-display font-bold text-[14px] text-ink leading-snug">
                  Delete this meal?
                </p>
                <p className="font-display text-[13px] text-ink-soft leading-snug mt-1">
                  It comes off your kitchen and your friends&rsquo; feeds for good.
                  {post.request_count > 0 &&
                    ' Anyone still waiting on the recipe stops waiting.'}
                  {post.recipe_id && ' The recipe you attached stays in your kitchen.'}
                </p>
                {deleteError && (
                  <p className="mt-2">
                    <span className="error-pill">{deleteError}</span>
                  </p>
                )}
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={confirmDelete}
                    disabled={deleting}
                    className="flex-1 rounded-full bg-brick text-cream border-2 border-ink px-3 py-2 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
                  >
                    {deleting ? 'Deleting…' : 'Delete it'}
                  </button>
                  <button
                    onClick={() => {
                      setConfirmingDelete(false)
                      setDeleteError('')
                    }}
                    disabled={deleting}
                    className="flex-1 rounded-full bg-cream text-ink border-2 border-ink px-3 py-2 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
                  >
                    Keep it
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </article>

      {/* REPORT THIS MEAL (#87 part two) — for a non-author only, at the bottom, behind a ⋯.
          Guideline 1.2 wants a way to report objectionable CONTENT as well as the people posting
          it, and a photo of someone's dinner is the highest-risk content this app carries.

          ON THE PAGE, NOT THE CARD, deliberately: #104's rule is that a consequential control two
          taps from a scrolling feed is a mis-tap, which is why `PostCard`'s ⋯ only NAVIGATES. You
          tap through to the meal, then report it — and by then you are looking at the thing you are
          reporting, which is also what makes the label honest.

          `isMine` is answered by the SERVER (`res.data.user_id`), not by the navigation, same as the
          edit/delete controls above. `subjectLabel` is what the report copy calls it; the block item
          still names the person, because a block is never about a post. */}
      {!isMine && post.user_id && (
        <SafetyMenu
          userId={post.user_id}
          personName={post.author_first_name}
          subject={{ post_id: post.id }}
          subjectLabel="this meal"
        />
      )}
    </div>
  )
}
