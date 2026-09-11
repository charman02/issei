import { useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { createPost } from '../api/posts'
import { toUserMessage } from '../api/client'
import { createUploader, PHOTO_ACCEPT } from '../lib/photoUpload'
import { usePhotoFramer } from '../lib/usePhotoFramer'
import { sourceNameOf } from '../lib/sourceName'
import BackButton from '../components/BackButton'
import Icon from '../components/Icon'
import FieldLabel from '../components/FieldLabel'
import RecipePicker from '../components/RecipePicker'
import PhotoFramer from '../components/PhotoFramer'

// "Share a meal" — the light everyday post. Photo (required, it IS the post) + dish
// name (required) + an optional line. NOT a recipe: no ingredients, no steps. Lands
// on the feed (Home). Reuses the same Cloudinary pick→convert→upload pipeline as the
// recipe cover, so HEIC handling and the race-safe uploader come for free.
export default function PostComposer() {
  const navigate = useNavigate()
  const location = useLocation()
  // A draft handed back from the write-a-recipe flow (#81). Everything on this form is a
  // string or an already-uploaded Cloudinary URL — no File objects — so the draft survives
  // a round trip through another route intact. Read at useState INIT time, not in an
  // effect, so the restored form is what renders first (no empty-then-filled flash).
  const draft = location.state?.postDraft || null
  const returned = location.state?.attachRecipe || null
  const [photoUrl, setPhotoUrl] = useState(draft?.photo_url || '')
  const [dishName, setDishName] = useState(() => {
    // Same rule as attachRecipe below, TRIM-aware to match it: a recipe fills the dish
    // name only if the author hasn't typed one, capped to the field's own maxLength.
    // Truthiness alone let a whitespace-only name block the fill, stranding the user on a
    // field that looks empty with "Share it" disabled and nothing explaining why.
    const typed = draft?.dish_name || ''
    if (typed.trim()) return typed
    return returned ? returned.name.slice(0, 120) : typed
  })
  const [description, setDescription] = useState(draft?.description || '')
  // Concrete visibility (#68). Auto-select mirrors the author's profile — "Everyone" on
  // a public profile, "Friends only" on a private one — but the value is stored literally.
  // Same source as the recipe form since #105 — the author's stated default, with the old
  // profile-derived value as the fallback for a cached user written before it existed.
  //
  // NOTE the setting is named for RECIPES and is applied to a post too. That is deliberate: a
  // person has one sense of who they share with, and two separate defaults would be a settings
  // screen asking a question nobody has. If posts ever need their own, it becomes a second field —
  // not a reinterpretation of this one.
  const cached = JSON.parse(localStorage.getItem('issei_user') || '{}')
  const [visibility, setVisibility] = useState(
    draft?.visibility ||
      cached.default_recipe_visibility ||
      (cached.profile_visibility === 'public' ? 'public' : 'friends'),
  )
  const [uploading, setUploading] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [error, setError] = useState('')
  const [posting, setPosting] = useState(false)
  const uploader = useRef(createUploader())
  // The framing step (#103) — see onPickPhoto.
  const { frame, framerProps } = usePhotoFramer()
  // Optionally link one of your OWN recipes (#72). We keep the whole recipe object for the
  // chip's label/byline; only its id is sent. Ownership is the backend's call — create_post
  // 404s a recipe_id that isn't the caller's — so this is a convenience link, not a grant.
  const [recipe, setRecipe] = useState(returned)
  const [pickerOpen, setPickerOpen] = useState(false)

  // "Write one" (#81): hand the draft to the real add-a-recipe flow rather than
  // reimplementing recipe entry in a sheet here. That flow owns paste/dictate, the LLM
  // parse and the 1000-line form; duplicating a "quick" version would fork the folk-unit
  // vocabulary and the validation. It saves the recipe for real and returns here with it
  // attached — so a recipe you wrote isn't lost if you then abandon the post.
  function writeRecipe() {
    // Never leave mid-upload: photoUrl is still '' until the upload resolves, and the
    // in-flight response writes to an unmounted component (a silent no-op), so the recipe
    // would inherit no cover and the post would come back photo-less. Every other exit
    // already waits on this — `ready` gates "Share it" the same way.
    if (uploading) return
    const state = {
      postDraft: { photo_url: photoUrl, dish_name: dishName, description, visibility },
      // Carried so a return trip can hand it back: without this, backing out of the recipe
      // flow rebuilt the draft with no recipe and silently dropped an existing attachment.
      attachRecipe: recipe,
    }
    // Stamp THIS history entry before pushing, so the phone's back gesture (which pops
    // rather than running our handler) lands on a composer that still has the draft
    // instead of an empty one.
    navigate('.', { replace: true, state })
    navigate('/add/recipe', { state })
  }

  function attachRecipe(r) {
    setRecipe(r)
    setPickerOpen(false)
    // Prefill the dish name from the recipe ONLY if the field is still empty — never
    // clobber something the author already typed. Recipe names are uncapped but a post's
    // dish_name is bounded at 120 (PostCreate.DishName), so clamp the programmatic fill to
    // match the input's maxLength — otherwise a long recipe name would sail past the field
    // cap and 422 on submit.
    if (!dishName.trim()) setDishName(r.name.slice(0, 120))
  }

  function onPickPhoto(e) {
    return uploader.current.upload({
      slot: 'post',
      event: e,
      // A POST IS ITS PHOTO — it carries no ingredients and no steps — so this is the single most
      // load-bearing image in the app, and "hard to adjust the photo to center the subject" was
      // reported against exactly this screen. 4:3 to match what the endpoint stores (800x600),
      // which makes the server's crop a pure resize.
      frame: frame('cover'),
      onBusy: setUploading,
      onError: setPhotoError,
      onUrl: setPhotoUrl,
    })
  }

  function removePhoto() {
    uploader.current.retire('post')
    setPhotoUrl('')
    setPhotoError('')
  }

  const ready = Boolean(photoUrl) && dishName.trim().length > 0 && !uploading

  async function share() {
    if (!ready || posting) return
    setPosting(true)
    setError('')
    try {
      const { data } = await createPost({
        photo_url: photoUrl,
        dish_name: dishName.trim(),
        description: description.trim() || null,
        visibility,
        recipe_id: recipe ? recipe.id : null,
      })
      // REPLACE, don't push. This entry's router state still holds a complete draft, so a
      // pushed navigation left it one back-gesture away: remounting re-seeded every field,
      // reset `posting` to false, and re-enabled "Share it" — one tap from a duplicate post
      // that nothing on the server dedupes.
      navigate('/', { state: { justPosted: data.id }, replace: true })
    } catch (err) {
      setError(toUserMessage(err, 'Couldn’t share that. Try again.'))
      setPosting(false)
    }
  }

  return (
    <div className="min-h-screen bg-cream px-[18px] pt-5 pb-10">
      {/* The framing step (#103) — real DOM in this tree so the overlay inherits the app's styles.
          A null file renders nothing. */}
      {framerProps?.file && <PhotoFramer {...framerProps} />}
      <div className="mb-4">
        <BackButton to="/add" label="Back" />
      </div>
      <h1 className="font-display font-black text-[28px] text-ink leading-tight">
        Share a meal
      </h1>
      <p className="font-display italic text-[14px] text-ink-soft mt-2 mb-5">
        A photo and what it is. Your friends will see it.
      </p>

      {/* Photo — the post itself, so it's the first and largest field. */}
      {photoUrl ? (
        <div className="relative sticker overflow-hidden bg-card w-full h-[240px] mb-4">
          <img src={photoUrl} alt="Your meal" className="w-full h-full object-cover block" />
          <button
            type="button"
            onClick={removePhoto}
            aria-label="Remove photo"
            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-cream border-2 border-ink text-ink flex items-center justify-center shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform"
          >
            <Icon name="close" className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <label
          aria-busy={uploading || undefined}
          className={`relative sticker sticker-press flex flex-col items-center justify-center w-full h-[240px] mb-4 cursor-pointer focus-within:ring-4 focus-within:ring-terra/25 ${
            photoError ? 'bg-brick/20' : 'bg-peach'
          }`}
        >
          <input
            type="file"
            accept={PHOTO_ACCEPT}
            onChange={onPickPhoto}
            aria-label="Add a photo of your meal"
            className="sr-only"
          />
          {uploading ? (
            <>
              <span className="flex items-center justify-center w-14 h-14 rounded-full bg-saffron border-[2.5px] border-ink shadow-[0_3px_0_#2E3A24] text-ink animate-bounce">
                <Icon name="camera" className="w-7 h-7" />
              </span>
              <span className="font-display font-black text-[16px] text-ink mt-3 leading-none">
                Uploading…
              </span>
            </>
          ) : (
            <>
              <span className="flex items-center justify-center w-14 h-14 rounded-full bg-cream border-[2.5px] border-ink shadow-[0_3px_0_#2E3A24] text-ink -rotate-[6deg]">
                <Icon name="camera" className="w-7 h-7" />
              </span>
              <span className="font-display font-black text-[17px] text-ink mt-3 leading-none">
                Add a photo
              </span>
              <span className="font-display italic text-[12.5px] text-ink-soft mt-1.5">
                Snap what you made
              </span>
            </>
          )}
        </label>
      )}
      {photoError && (
        <p className="mb-4">
          <span className="error-pill">{photoError}</span>
        </p>
      )}

      <div className="block mb-3">
        <FieldLabel>
          <label htmlFor="post-dish">What is it?</label>
        </FieldLabel>
        <input
          id="post-dish"
          type="text"
          placeholder="e.g. Sunday adobo"
          value={dishName}
          onChange={(e) => setDishName(e.target.value)}
          maxLength={120}
          className="field"
        />
      </div>

      <div className="block">
        <FieldLabel>
          <label htmlFor="post-note">Description (optional)</label>
        </FieldLabel>
        {/* Framed as a dish description, not a note-to-friends, so the same text carries
            over verbatim if this meal later becomes a recipe (recipe form's own field is
            "Description"). */}
        <textarea
          id="post-note"
          placeholder="A little about it — what's in it, how it tastes"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={500}
          className="field resize-none"
        />
      </div>

      {/* Attach a recipe (#72) — optional link to one of YOUR recipes, so a friend who
          sees the meal can open the actual recipe. Closed state: a dashed "add" button.
          Attached: a chip showing the recipe (cover/pot + name) with a remove ×. The
          post is still a light meal post; this is a pointer, not the recipe itself. */}
      <div className="mt-5">
        <span className="section-label">Write or attach a recipe (optional)</span>
        {recipe ? (
          <div className="mt-2 flex items-center gap-3 rounded-[14px] border-2 border-ink bg-card p-2 shadow-[0_2px_0_#2E3A24]">
            {recipe.cover_photo_url ? (
              <img
                src={recipe.cover_photo_url}
                alt=""
                className="flex-none w-10 h-10 rounded-[10px] border-2 border-ink object-cover"
              />
            ) : (
              <span className="flex-none flex items-center justify-center w-10 h-10 rounded-[10px] border-2 border-ink bg-peach text-ink">
                <Icon name="pot" className="w-5 h-5" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block font-display font-bold text-[14px] text-ink truncate">
                {recipe.name}
              </span>
              {sourceNameOf(recipe) && (
                <span className="block font-display text-[12px] text-ink-soft truncate">
                  from {sourceNameOf(recipe)}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => setRecipe(null)}
              aria-label="Remove recipe"
              className="flex-none w-8 h-8 rounded-full bg-cream border-2 border-ink text-ink flex items-center justify-center shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform"
            >
              <Icon name="close" className="w-4 h-4" />
            </button>
          </div>
        ) : (
          /* Two doors. "Write one" leads, because the case that was missing is the one
             where you just cooked something you've never written down — the whole reason
             this exists. "Attach one" is #72's original path, unchanged. */
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={writeRecipe}
              disabled={uploading}
              className="disabled:opacity-50 flex flex-1 items-center justify-center gap-1.5 rounded-[14px] border-2 border-dashed border-ink/50 bg-card py-3 font-display font-bold text-[13.5px] text-ink-soft active:translate-y-[1px] transition-transform"
            >
              <Icon name="plus" className="w-4 h-4" />
              Write one
            </button>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-[14px] border-2 border-dashed border-ink/50 bg-card py-3 font-display font-bold text-[13.5px] text-ink-soft active:translate-y-[1px] transition-transform"
            >
              <Icon name="book" className="w-4 h-4" />
              Attach one
            </button>
          </div>
        )}
      </div>

      {/* Who sees it — three concrete choices (#68), each stored literally. Auto-selected
          from the author's profile, but any is pickable. Compact pill row — a post is a
          light act, not a form. */}
      <fieldset className="mt-5">
        <legend className="section-label mb-2">Who can see this?</legend>
        <div className="flex gap-2" role="radiogroup" aria-label="Who can see this post">
          {[
            { value: 'friends', label: 'Friends' },
            { value: 'public', label: 'Everyone' },
            { value: 'private', label: 'Only me' },
          ].map((opt) => {
            const selected = visibility === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setVisibility(opt.value)}
                className={`flex-1 rounded-full border-2 border-ink px-3 py-2 font-display font-bold text-[13px] transition-transform active:translate-y-[1px] ${
                  selected ? 'bg-peach text-ink' : 'bg-card text-ink-soft'
                }`}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </fieldset>

      {error && (
        <p className="mt-4">
          <span className="error-pill">{error}</span>
        </p>
      )}

      <button
        onClick={share}
        disabled={!ready || posting}
        className="btn-primary mt-5 disabled:opacity-50"
      >
        {posting ? 'Sharing…' : 'Share it'}
      </button>

      {pickerOpen && (
        <RecipePicker onPick={attachRecipe} onClose={() => setPickerOpen(false)} />
      )}
    </div>
  )
}
