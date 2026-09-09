import { useEffect, useRef, useState } from 'react'
import client, { toUserMessage } from '../api/client'
import { createUploader, PHOTO_ACCEPT } from '../lib/photoUpload'
import Icon from './Icon'
import MarkerTitle from './MarkerTitle'
import FieldLabel from './FieldLabel'
import IngredientNameField from './IngredientNameField'
import SuggestField from './SuggestField'
import { CUISINES } from '../lib/cuisines'
import { DIETS } from '../lib/diets'
import AmountUnitChips from './AmountUnitChips'
import DictateButton from './DictateButton'
import { parseQuantity } from '../utils/quantity'
import { mergeSuggestions } from '../lib/commonIngredients'
import { shouldOfferUnits } from '../lib/amountChips'
import { buildOriginPayload } from '../lib/originPayload'

// Shared Add/Edit recipe form. Owns all field state, photo upload, ingredient/
// step management, client-side validation, and payload assembly. The parent
// (AddRecipe / EditRecipe) supplies initial values and an onSubmit that performs
// the actual POST/PATCH + navigation — this component just hands it a built
// payload and manages the surrounding loading/error UI.
//
// mode: 'add' | 'edit' — drives the heading and button labels.

const emptyIngredient = () => ({ name: '', quantity: '' })

// Every step row carries a `uid` that outlives its index. A step's photo upload
// is async and its row can be removed (or shifted by removing an earlier row)
// while the request is in flight, so anything that addresses a row by position
// would land the photo on whichever step happens to sit at that index when the
// response arrives. The uid is the row's identity for both the upload slot and
// the state write; it is deliberately NOT part of the submitted payload.
let stepUid = 0
const emptyStep = () => ({
  uid: `s${++stepUid}`,
  content: '',
  voice_note: '',
  photo_url: '',
})

// Steps handed in by the parent (EditRecipe) have no uid — mint one per row.
const withUids = (rows) => rows.map((s) => (s.uid ? s : { ...s, uid: `s${++stepUid}` }))

// How many empty rows a NEW recipe starts with. More than one because a single
// empty box gave no visual cue that entries were meant to be separate — a tester
// typed their whole method into step 1 and every ingredient into ingredient 1.
// Seeing the shape of the list before typing is what prevents that; blank rows
// are filtered out on submit, so extras cost nothing.
// TWO of each. Three apiece made the form read as a chore on open — the capture-effort
// problem two rounds of user testing already flagged — but ONE gives no hint that these are
// separate entries, and a tester once typed their whole method into step 1 for exactly that
// reason. Two is the smallest count that still shows the SHAPE: this is a list, not a box.
// (Owner: 3 → 1 → 2, 2026-09-08.) The "one step per box" copy backs it up; keep both.
const STARTING_INGREDIENTS = 2
const STARTING_STEPS = 2

const emptyRows = (make, n) => Array.from({ length: n }, make)

// Keep in sync with the backend's accepted formats in app/routers/upload.py.
// The cover's upload-slot key. Step slots use the row's uid, and both share one
// keyed ticket map — a plain string can't collide with a generated `s<n>` uid.
const COVER_SLOT = 'cover'


// A section heading for the form — a chunky Fraunces title with a highlighter
// swipe, so the form reads as playful sections rather than a flat field list.
function FormSection({ children }) {
  return (
    <div className="mt-7 mb-3">
      <MarkerTitle
        as="h2"
        color="bg-saffron"
        className="font-display font-black text-[22px] text-ink leading-none"
      >
        {children}
      </MarkerTitle>
    </div>
  )
}

// The story prompt changes with where the recipe came from. Asking "who taught
// you?" of someone who invented the dish is a small thing that makes the app feel
// like it isn't listening — testers noticed.
const STORY_COPY = {
  inherited: {
    label: 'Their story',
    help: 'Who taught you, when they made it, what you remember.',
    placeholder: 'My grandmother made this every Lunar New Year…',
  },
  own: {
    label: 'What makes it yours',
    help: 'How you came to it, when you make it, who you make it for.',
    placeholder: 'I started making this the winter I moved out…',
  },
}

export default function RecipeForm({
  mode = 'add',
  initialValues = {},
  onSubmit,
  submitLabel,
  beforeSubmitSlot = null,
  intro = null,
  topSlot = null,
  // Save with the dish name alone. See the button below the name field.
  onQuickSave = null,
}) {
  const [name, setName] = useState(initialValues.name || '')
  // Who passed this recipe down — optional, and asked right on the form now that
  // the add flow no longer forks into "inherited vs your own" doorways. Empty
  // means self-authored (no byline). The paste parser seeds this when the model
  // detects a source; the user can always edit or clear it.
  const [sourceName, setSourceName] = useState(initialValues.sourceName || '')
  const [servings, setServings] = useState(
    initialValues.servings != null ? String(initialValues.servings) : '',
  )
  const [prepTime, setPrepTime] = useState(
    initialValues.prep_time_minutes != null
      ? String(initialValues.prep_time_minutes)
      : '',
  )
  const [cuisine, setCuisine] = useState(initialValues.cuisine || '')
  const [diet, setDiet] = useState(initialValues.diet || '')
  const [description, setDescription] = useState(
    initialValues.description || '',
  )
  const [story, setStory] = useState(initialValues.story || '')
  // Editing shows exactly what's saved; adding pre-seeds blank rows so the
  // list's shape is visible before typing (see STARTING_* above).
  const [ingredients, setIngredients] = useState(
    initialValues.ingredients?.length
      ? initialValues.ingredients
      : emptyRows(emptyIngredient, mode === 'add' ? STARTING_INGREDIENTS : 1),
  )
  const [steps, setSteps] = useState(
    initialValues.steps?.length
      ? withUids(initialValues.steps)
      : emptyRows(emptyStep, mode === 'add' ? STARTING_STEPS : 1),
  )
  const [coverPhotoUrl, setCoverPhotoUrl] = useState(
    initialValues.coverPhotoUrl || '',
  )
  const [uploading, setUploading] = useState(false)
  const [photoError, setPhotoError] = useState('')
  // Per-step photo progress + failure, keyed by the row's uid rather than its
  // index (see emptyStep): a step can be removed or shifted mid-upload, and an
  // index-keyed map would then show step 4's spinner on step 3.
  const [stepUploading, setStepUploading] = useState({})
  const [stepPhotoError, setStepPhotoError] = useState({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Photo-upload concurrency, per independent SLOT. The picker stays enabled
  // during an upload on purpose — on a slow phone connection a disabled input
  // that sits there "Uploading…" for 30s is indistinguishable from a hung app,
  // and the user's instinct (pick again) has to keep working. So instead of
  const uploader = useRef(createUploader())
  const uploadPhotoFor = (args) => uploader.current.upload(args)
  const retireSlot = (slot) => uploader.current.retire(slot)


  // Ingredient autosuggest source. Starts as the shipped common list so the very
  // first keystroke suggests something, then folds in the words this user has
  // written before once they arrive. A failed or slow fetch is not an error the
  // user should ever see — the common list alone is a working feature, and the
  // one thing a suggestion must never do is get in the way of typing.
  const [suggestions, setSuggestions] = useState(() => mergeSuggestions([]))
  // Autosuggest pools for the two free-text detail fields. Cuisine seeds from the
  // shared static CUISINES list so a brand-new account still gets suggestions on
  // the first keystroke; the user's own past cuisines merge in front. Source has
  // no static list — it's people's names — so it's only ever the user's own past
  // sources. Both fetched from /recipes/field-suggestions; a failed/slow fetch is
  // never surfaced (the static cuisine list alone still works).
  const [cuisinePool, setCuisinePool] = useState(() => mergeSuggestions([], CUISINES))
  const [sourcePool, setSourcePool] = useState([])
  useEffect(() => {
    let live = true
    client
      .get('/recipes/ingredient-suggestions')
      .then(({ data }) => {
        if (live) setSuggestions(mergeSuggestions(data?.names || []))
      })
      .catch(() => {})
    client
      .get('/recipes/field-suggestions')
      .then(({ data }) => {
        if (!live) return
        setCuisinePool(mergeSuggestions(data?.cuisines || [], CUISINES))
        setSourcePool(mergeSuggestions(data?.sources || [], []))
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  // The story prompt follows the optional source field: name someone and it asks
  // about them ("who taught you"); leave it blank and the recipe starts with you.
  // Asking "who taught you this?" of a dish you invented was one of the things
  // testers said made the app feel like it wasn't listening.
  const storyCopy = sourceName.trim() ? STORY_COPY.inherited : STORY_COPY.own
  const heading = mode === 'edit' ? 'Edit recipe' : 'Write a recipe'
  const defaultSubmitLabel =
    mode === 'edit' ? 'Save changes' : 'Save this recipe'
  // Has the user put in anything BEYOND the dish name? Drives the "just keep the
  // name" escape: once there's real content, offering to discard it isn't a shortcut.
  // Reads the same fields the payload does, so it can't drift out of agreement with
  // what would actually be saved. Includes sourceName — the byline is the app's
  // signature datum, so a typed "from Lola" must not be silently dropped by the
  // name-only shortcut (which posts name+visibility only).
  const hasMoreThanName =
    Boolean(
      sourceName.trim() ||
        description.trim() ||
        story.trim() ||
        servings.trim() ||
        cuisine.trim() ||
        diet.trim() ||
        prepTime.trim() ||
        coverPhotoUrl,
    ) ||
    ingredients.some((i) => i.name.trim() || i.quantity.trim()) ||
    steps.some((s) => s.content.trim() || s.voice_note?.trim() || s.photo_url)

  const submitText = submitLabel || defaultSubmitLabel
  const loadingLabel = 'Saving…'

  function handlePhotoSelect(e) {
    return uploadPhotoFor({
      slot: COVER_SLOT,
      event: e,
      onBusy: setUploading,
      onError: setPhotoError,
      onUrl: setCoverPhotoUrl,
    })
  }

  function removePhoto() {
    // Local-state only: the uploaded Cloudinary asset is deliberately left in
    // place. Deleting here would be wrong, not just incomplete — on the edit
    // form this URL belongs to the *saved* recipe, so removing and then
    // abandoning the form would leave the still-saved recipe pointing at a
    // deleted image. Orphan cleanup has to be server-side and reference-aware;
    // see the note in app/routers/upload.py.
    // Retiring the ticket is defensive: today the remove button and the picker
    // never render at once, so no upload can be in flight here. If that ever
    // changes (e.g. previewing the new photo while it uploads) a landing
    // response would silently re-fill the cover the user just cleared.
    retireSlot(COVER_SLOT)
    setCoverPhotoUrl('')
    setPhotoError('')
  }

  // A step's photo. Identical pipeline to the cover, addressed by the row's uid
  // so a slow upload writes to the step the user picked FOR — not to whatever
  // step now occupies that index after a removal above it.
  function handleStepPhotoSelect(uid, e) {
    const setFlag = (setter) => (v) =>
      setter((prev) => ({ ...prev, [uid]: v }))
    return uploadPhotoFor({
      slot: uid,
      event: e,
      onBusy: setFlag(setStepUploading),
      onError: setFlag(setStepPhotoError),
      onUrl: (url) =>
        setSteps((prev) =>
          prev.map((s) => (s.uid === uid ? { ...s, photo_url: url } : s)),
        ),
    })
  }

  function removeStepPhoto(uid) {
    // Same asset-retention reasoning as removePhoto. Unlike the cover, the
    // remove button here DOES coexist with a pick (choosing a replacement while
    // one is uploading is reachable), so retiring the ticket is load-bearing
    // rather than defensive: without it a landing response would re-fill a photo
    // the user just cleared.
    retireSlot(uid)
    setSteps((prev) =>
      prev.map((s) => (s.uid === uid ? { ...s, photo_url: '' } : s)),
    )
    setStepUploading((prev) => ({ ...prev, [uid]: false }))
    setStepPhotoError((prev) => ({ ...prev, [uid]: '' }))
  }

  function updateIngredient(index, field, value) {
    setIngredients((prev) =>
      prev.map((ing, i) => (i === index ? { ...ing, [field]: value } : ing)),
    )
  }

  function removeIngredient(index) {
    setIngredients((prev) => prev.filter((_, i) => i !== index))
  }

  function updateStep(index, field, value) {
    // Spread to preserve any non-edited fields (e.g. section_header on edit).
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    )
  }

  function removeStep(index) {
    // Retire the row's upload slot on the way out: a photo still in flight for a
    // deleted step has nowhere to land, and its uid is never reused, so leaving
    // the ticket live would only let a response write into a vanished row.
    const uid = steps[index]?.uid
    if (uid) retireSlot(uid)
    setSteps((prev) => prev.filter((_, i) => i !== index))
  }

  // Enter advances to the next row instead of doing nothing (in a textarea it
  // would insert a newline, and on a phone the keyboard's "return" key is right
  // there). Adding a row when you're on the last one means a whole list can be
  // entered without ever reaching for "+ Add" — testers found the tapping, not
  // the typing, to be the tiring part.
  //
  // Shift+Enter still inserts a real newline, since a step legitimately runs long.
  // Open row index+1 for editing, adding it first if we're on the last one.
  // Extracted from advanceOnEnter so the ingredient CONFIRM button lands in
  // exactly the same place Enter does — two affordances, one behaviour, and no
  // second copy of the keyboard-preserving focus dance to keep in step.
  function openNextRow({ container, index, addRow, selector }) {
    const focusNext = () => {
      const fields = document.querySelectorAll(selector)
      fields[index + 1]?.focus()
    }
    if (index === container.length - 1) {
      addRow()
      // The new row doesn't exist until React commits, so wait a tick. On a phone
      // this also keeps the keyboard up — focusing an existing element in the same
      // gesture is what stops iOS from dismissing it.
      setTimeout(focusNext, 0)
    } else {
      focusNext()
    }
  }

  function advanceOnEnter(e, opts) {
    if (e.key !== 'Enter' || e.shiftKey) return
    e.preventDefault()
    openNextRow(opts)
  }

  function focusIngredientField(index, selector) {
    document.querySelectorAll(selector)[index]?.focus()
  }

  // Move focus onto a field by id — the after-dictation advance. When a dictation
  // session ends (it ends on a pause, continuous=false), the mic reports it via
  // onDone and we land the cursor on the next field, so a recipe can be filled
  // field by field by voice with only a mic tap between each. Focus only; no mic
  // auto-starts (a mic never turns itself on). See DictateButton's onDone.
  function focusFieldById(id) {
    document.getElementById(id)?.focus()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const payload = {
      name,
      cover_photo_url: coverPhotoUrl || null,
      servings: servings ? parseInt(servings) : null,
      prep_time_minutes: prepTime ? parseInt(prepTime) : null,
      cuisine: cuisine || null,
      diet: diet || null,
      description: description || null,
      story: story || null,
      ingredients: ingredients
        .filter((ing) => ing.name.trim())
        .map((ing, idx) => {
          const parsed = parseQuantity(ing.quantity)
          return {
            name: ing.name.trim(),
            quantity_text: parsed.quantity_text,
            quantity_value: parsed.quantity_value,
            unit: parsed.unit,
            quantity_type: parsed.quantity_type,
            position: idx + 1,
          }
        }),
      steps: steps
        .filter((s) => s.content.trim())
        .map((s, idx) => ({
          content: s.content.trim(),
          voice_note: s.voice_note?.trim() || null,
          section_header: s.section_header ?? null,
          // uid is client-side row identity and deliberately not sent.
          photo_url: s.photo_url || null,
          position: idx + 1,
        })),
    }

    // Attribution.
    //  · ADD: always send it (nothing is stored yet). A blank field → null origin
    //    → no byline; a parsed or typed name → the byline. buildOriginPayload
    //    handles both.
    //  · EDIT: send only when the name actually changed from what was seeded, so an
    //    edit that never touched the field leaves the stored byline untouched.
    //    When the name DID change, carry the seeded place/year through — the form
    //    shows only the name, but a recipe may have place/year from the older
    //    multi-field door, and rebuilding from the name alone would silently drop
    //    them. Clearing the name → null origin → the backend removes the byline.
    if (mode === 'add') {
      payload.origin = buildOriginPayload({ name: sourceName })
    } else if (sourceName.trim() !== (initialValues.sourceName || '').trim()) {
      const seededParts = initialValues.sourceParts || {}
      payload.origin = buildOriginPayload({
        name: sourceName,
        place: seededParts.place || null,
        year: seededParts.year || null,
      })
    }

    try {
      await onSubmit(payload)
      // On success the parent navigates away and this unmounts — don't touch state.
    } catch (err) {
      setError(
        toUserMessage(err, 'Something went wrong. Please try again.'),
      )
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-cream px-[18px] pt-5 pb-8">
      {topSlot && <div className="mb-4">{topSlot}</div>}
      <h1 className="font-display font-black text-[30px] text-ink mb-4">
        {heading}
      </h1>

      {intro}

      {error && (
        <p className="mb-4">
          <span className="error-pill">{error}</span>
        </p>
      )}

      <form onSubmit={handleSubmit}>
        {/* Cover photo — a sticker photo target, matching the frame RecipeCard
            and RecipeBody put around a real cover: ink outline, hard offset
            shadow, and the same 150px photo height so the empty box previews
            the space the picture will occupy. The old dashed-outline dropzone
            was the one surface still speaking the pre-redesign language. */}
        {coverPhotoUrl ? (
          <div className="relative sticker overflow-hidden bg-card w-full h-[150px] mb-1.5">
            <img
              src={coverPhotoUrl}
              alt="Recipe cover"
              className="w-full h-full object-cover block"
            />
            {/* Corner stamp — same saffron tag RecipeCard pins on a cover, so a
                chosen photo reads as finished rather than as a raw preview. */}
            <span className="absolute top-2 left-2 font-display font-bold uppercase tracking-[0.06em] text-[9.5px] text-ink bg-cream/95 border-2 border-ink px-2 py-0.5 rounded-full">
              Cover photo
            </span>
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
            className={`relative sticker sticker-press flex flex-col items-center justify-center w-full h-[150px] mb-1.5 cursor-pointer focus-within:ring-4 focus-within:ring-terra/25 ${
              // A failed pick tints the target itself, so the retry is obvious
              // at the thing you tap — not only in the pill below it.
              photoError ? 'bg-brick/20' : 'bg-peach'
            }`}
          >
            {/* sr-only, NOT `hidden`: display:none drops the input out of the tab
                order, which made the whole photo step keyboard-unreachable.
                Clipping keeps it focusable, and focus-within rings the box the
                user can actually see. aria-label keeps the accessible name
                stable while the visible copy swaps between states. */}
            <input
              type="file"
              accept={PHOTO_ACCEPT}
              onChange={handlePhotoSelect}
              aria-label="Add a cover photo"
              className="sr-only"
            />
            {uploading ? (
              // Bobbing saffron badge — the same waiting signal as <Loader>.
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
                  It brings the dish to life
                </span>
              </>
            )}
          </label>
        )}
        {photoError ? (
          <p className="mb-4">
            <span className="error-pill">{photoError}</span>
          </p>
        ) : (
          <p className="font-display italic text-[12px] text-ink-soft mb-4">
            JPEG, PNG, WebP, or iPhone (HEIC) · max 10 MB
          </p>
        )}

        {/* Recipe details */}
        <FormSection>The dish</FormSection>
        <div className="space-y-3">
          {/* dish-led naming: the person is captured separately as the origin */}
          {/* Not a <label> wrapper, for the same reason the ingredient name isn't
              one: this field owns a dictation button and a live status line, and a
              label around both would fold "Dictating…" into the input's own
              accessible name. htmlFor keeps the visible label attached without
              adopting the controls beside it.
              `relative` + `pr-11`: the mic sits in the field's bottom-right
              corner, and the reserved right padding is what keeps typed text from
              ever running underneath it. Same pairing on every dictatable field. */}
          <div className="block">
            <FieldLabel>
              <label htmlFor="recipe-name">Dish name</label>
            </FieldLabel>
            <div className="relative">
              <input
                id="recipe-name"
                type="text"
                placeholder="e.g. “Adobo”"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                required
                className="field pr-11"
              />
              <DictateButton
                value={name}
                maxLength={120}
                onChange={setName}
                what="the dish name"
                onDone={() => focusFieldById('recipe-source')}
              />
            </div>
            {/* KEEP JUST THE NAME — the escape hatch for the failure testers actually
                described. One person abandoned this form mid-way, and abandoning meant
                losing everything typed so far. Only `name` is required (in the form AND
                in RecipeCreate), so a two-tap save was always possible; the form just
                never offered it. Home's "Fill these in" already finds and ranks
                incomplete recipes, so the recipe gets finished later instead of never.

                Only on ADD, and only before anything else is filled in: on the edit
                page it would read as "discard my changes", and once someone has typed
                three ingredients, "just the name" is no longer the easy path. */}
            {mode === 'add' && onQuickSave && name.trim() && !hasMoreThanName && (
              <button
                type="button"
                disabled={loading}
                // Hand back the live cover too. The caller used to substitute a cover it
                // had seeded (#81's inherited post photo), which meant a cover the user had
                // just REMOVED came back on save — two sources of truth for one field, with
                // the stale one winning. The form owns this value, so the form reports it.
                onClick={() => onQuickSave(name.trim(), { coverPhotoUrl })}
                className="mt-3 w-full text-left sticker sticker-press bg-sage px-4 py-3"
              >
                <span className="block font-display font-black text-[14.5px] text-ink leading-tight">
                  Just save the name for now &rarr;
                </span>
                <span className="block font-display italic text-[12.5px] text-ink-soft mt-0.5 leading-snug">
                  Saves it as {name.trim()}. Add the rest whenever you like.
                </span>
              </button>
            )}
          </div>
          {/* Optional attribution, right on the form. Naming someone makes the
              recipe read "from {name}" (a byline in plum) and switches the story
              prompt to ask about them; leaving it blank means the recipe is your
              own. The paste parser seeds this when the model detects a source.
              Not a <label> wrapper (see the dish name): it owns a mic + status
              line, so htmlFor keeps the label attached without adopting them. */}
          <div className="block">
            <FieldLabel accent="plum">
              <label htmlFor="recipe-source">Passed down from (optional)</label>
            </FieldLabel>
            {/* Suggests the people this user has credited before (their own past
                sources only — no static list of names). Skips Servings on dictation
                (numeric — a recognizer says "four", not "4"). */}
            <SuggestField
              id="recipe-source"
              value={sourceName}
              maxLength={80}
              onChange={setSourceName}
              suggestions={sourcePool}
              placeholder="e.g. Lola Remedios"
              label="who this came from"
              listLabel="People you've credited before"
              onDone={() => focusFieldById('recipe-cuisine')}
            />
          </div>
          {/* Two numeric fields side by side. No mic on either: a recognizer
              returns "four"/"thirty", not "4"/"30", and these inputs reject words. */}
          <div className="flex gap-3">
            <label className="block flex-1">
              <FieldLabel>Servings</FieldLabel>
              <input
                type="number"
                placeholder="4"
                value={servings}
                onChange={(e) => setServings(e.target.value)}
                className="field"
              />
            </label>
            <label className="block flex-1">
              <FieldLabel>Ready in (min)</FieldLabel>
              <input
                type="number"
                inputMode="numeric"
                placeholder="30"
                value={prepTime}
                onChange={(e) => setPrepTime(e.target.value)}
                className="field"
              />
            </label>
          </div>
          <div className="flex gap-3">
            <div className="block flex-1">
              <FieldLabel>
                <label htmlFor="recipe-cuisine">Cuisine</label>
              </FieldLabel>
              {/* Static CUISINES list + the user's own past cuisines (see cuisinePool).
                  Free text still allowed; the Browse filter tolerates minor drift. */}
              <SuggestField
                id="recipe-cuisine"
                value={cuisine}
                maxLength={60}
                onChange={setCuisine}
                suggestions={cuisinePool}
                placeholder="Filipino"
                label="the cuisine"
                listLabel="Cuisines"
                onDone={() => focusFieldById('recipe-description')}
              />
            </div>
            <label className="block flex-1">
              {/* Single-select from the shared DIETS list (matches the single-string
                  column + the Browse Diet filter). Blank = unset. */}
              <FieldLabel>Diet</FieldLabel>
              <select
                value={diet}
                onChange={(e) => setDiet(e.target.value)}
                className="field"
                aria-label="Diet"
              >
                <option value="">Any</option>
                {DIETS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="block">
            <FieldLabel>
              <label htmlFor="recipe-description">Description</label>
            </FieldLabel>
            <div className="relative">
              <textarea
                id="recipe-description"
                placeholder="What is this dish?"
                value={description}
                maxLength={500}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="field resize-none pr-11"
              />
              <DictateButton
                value={description}
                maxLength={500}
                onChange={setDescription}
                what="the description"
                bottomClass="bottom-3.5"
                onDone={() => focusFieldById('recipe-story')}
              />
            </div>
          </div>
        </div>

        {/* The story — optional, and prompted differently depending on whether
            the recipe was inherited or invented (see STORY_COPY). Marked optional
            explicitly: testers treated an unlabeled textarea as required and
            stalled on it, which is the worst place to lose someone. */}
        <FormSection>The story</FormSection>
        <div className="block">
          <FieldLabel accent="plum">
            <label htmlFor="recipe-story">{storyCopy.label} (optional)</label>
          </FieldLabel>
          <p className="font-display italic text-[12px] text-ink-soft mb-1.5">
            {storyCopy.help}
          </p>
          <div className="relative">
            <textarea
              id="recipe-story"
              placeholder={storyCopy.placeholder}
              value={story}
              maxLength={4000}
              onChange={(e) => setStory(e.target.value)}
              rows={3}
              className="field resize-none pr-11"
            />
            {/* The field this feature exists for. It's the one people skip — it
                needs whole sentences, and it's where a tester stopped. */}
            <DictateButton
              value={story}
              maxLength={4000}
              onChange={setStory}
              what="the story"
              bottomClass="bottom-3.5"
              // Into the ingredients: the first ingredient's name field.
              onDone={() => focusFieldById('ingredient-name-0')}
            />
          </div>
        </div>

        {/* Ingredients — each row pairs a bold NAME field with a tinted
            MEASUREMENT field, each with a persistent label so the two are never
            confused. */}
        <FormSection>Ingredients</FormSection>
        <p className="font-display italic text-[12px] text-ink-soft mb-3">
          Write amounts naturally — “1 1/2 cups”, “a good splash”, “to taste”.
        </p>
        <div className="space-y-3">
          {ingredients.map((ing, idx) => (
            <div key={idx} data-ingredient-row className="sticker-sm bg-card p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-display font-black text-[13px] text-ink">
                  #{idx + 1}
                </span>
                {ingredients.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeIngredient(idx)}
                    aria-label={`Remove ingredient ${idx + 1}`}
                    className="text-ink-soft/70 hover:text-red-500"
                  >
                    <Icon name="close" className="w-4 h-4" />
                  </button>
                )}
              </div>
              {/* Not a <label> wrapper: the name field is a combobox owning a
                  listbox, and a label around both would put the suggestions
                  inside the field's own accessible name. */}
              <div className="block mb-2">
                <FieldLabel>
                  <label htmlFor={`ingredient-name-${idx}`}>Ingredient</label>
                </FieldLabel>
                <IngredientNameField
                  id={`ingredient-name-${idx}`}
                  index={idx}
                  value={ing.name}
                  maxLength={120}
                  suggestions={suggestions}
                  placeholder="e.g. soy sauce"
                  onChange={(v) => updateIngredient(idx, 'name', v)}
                  // Within a row, name → amount rather than skipping to the
                  // next ingredient.
                  onAdvance={() =>
                    focusIngredientField(idx, '[data-ingredient-qty]')
                  }
                />
              </div>
              {/* Not a <label> wrapper (see the dish name): this field owns a mic
                  and its status line, which a label around both would fold into
                  the input's accessible name. htmlFor keeps the label attached. */}
              <div className="block">
                <FieldLabel accent="terra">
                  <label htmlFor={`ingredient-qty-${idx}`}>How much</label>
                </FieldLabel>
                <div className="relative">
                  <input
                    id={`ingredient-qty-${idx}`}
                    type="text"
                    data-ingredient-qty
                    // The phone keyboard's action key reads "next" and, on this last
                    // field of the row, advances to the next ingredient — the same
                    // thing Enter does, surfaced where a thumb already is. No on-screen
                    // button needed (that duplicated "+ Add ingredient").
                    enterKeyHint="next"
                    placeholder="1/2 cup · a dash · to taste"
                    value={ing.quantity}
                    maxLength={60}
                    onChange={(e) =>
                      updateIngredient(idx, 'quantity', e.target.value)
                    }
                    onKeyDown={(e) =>
                      advanceOnEnter(e, {
                        container: ingredients,
                        index: idx,
                        addRow: () =>
                          setIngredients((prev) => [...prev, emptyIngredient()]),
                        selector: '[data-ingredient-name]',
                      })
                    }
                    className="field bg-peach/50 pr-11"
                  />
                  <DictateButton
                    value={ing.quantity}
                    maxLength={60}
                    onChange={(v) => updateIngredient(idx, 'quantity', v)}
                    what={`the amount for ingredient ${idx + 1}`}
                    // Same move Enter makes on this field: open the next
                    // ingredient's name, adding a row if this is the last one — so
                    // a whole ingredient list can be spoken name/amount/name/amount.
                    onDone={() =>
                      openNextRow({
                        container: ingredients,
                        index: idx,
                        addRow: () =>
                          setIngredients((prev) => [...prev, emptyIngredient()]),
                        selector: '[data-ingredient-name]',
                      })
                    }
                  />
                </div>
              </div>
              {/* Units appear only over a bare number, so the strip is answering
                  a question the user has visibly just asked. */}
              {shouldOfferUnits(ing.quantity) && (
                <AmountUnitChips
                  index={idx}
                  value={ing.quantity}
                  maxLength={60}
                  onPick={(v) => updateIngredient(idx, 'quantity', v)}
                  onDone={() =>
                    focusIngredientField(idx, '[data-ingredient-qty]')
                  }
                />
              )}
              {/* No inline "next ingredient" confirm here: it duplicated the
                  "+ Add ingredient" button below, and pressing Enter on the amount
                  field already banks the row and opens the next one. */}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setIngredients((prev) => [...prev, emptyIngredient()])}
          className="mt-3 font-display font-bold text-[13px] text-terra"
        >
          + Add ingredient
        </button>

        {/* Steps — each row pairs the STEP itself with an optional personal
            remark, distinctly tinted + labeled.

            A tester wrote their ENTIRE method into step 1, because with only one
            empty step rendered there was nothing on screen suggesting steps were
            meant to be separate. The fix is structural, not a hint: the add flow
            starts with two empty steps (see STARTING_STEPS) so the pattern is
            visible before you type, and pressing Enter in a step opens the next
            one. The line below states the intent for anyone who still wonders. */}
        <FormSection>Steps</FormSection>
        <p className="font-display italic text-[12px] text-ink-soft mb-3">
          One step per box — press Enter to start the next one.
        </p>
        <div className="space-y-3">
          {/* Keyed by uid, not index. Each row now holds an UNCONTROLLED file
              input, so index keys would let React reuse a removed row's DOM
              (and its retained file selection) for the row that shifts up. */}
          {steps.map((step, idx) => (
            <div key={step.uid} className="sticker-sm bg-card p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-display font-black text-[13px] text-ink">
                  Step {idx + 1}
                </span>
                {steps.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeStep(idx)}
                    aria-label={`Remove step ${idx + 1}`}
                    className="text-ink-soft/70 hover:text-red-500"
                  >
                    <Icon name="close" className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="block mb-2">
                <FieldLabel>
                  <label htmlFor={`step-content-${step.uid}`}>What to do</label>
                </FieldLabel>
                <div className="relative">
                  <textarea
                    id={`step-content-${step.uid}`}
                    data-step-content
                    // Enter advances to the next step (Shift+Enter still inserts a
                    // newline); the keyboard action key mirrors it with "next".
                    enterKeyHint="next"
                    placeholder="Describe this step…"
                    value={step.content}
                    maxLength={2000}
                    onChange={(e) => updateStep(idx, 'content', e.target.value)}
                    onKeyDown={(e) =>
                      advanceOnEnter(e, {
                        container: steps,
                        index: idx,
                        addRow: () => setSteps((prev) => [...prev, emptyStep()]),
                        selector: '[data-step-content]',
                      })
                    }
                    rows={2}
                    className="field resize-none pr-11"
                  />
                  {/* Tap, talk, Enter, repeat: dictation lands the sentence and
                      the existing Enter-to-advance opens the next step, so a
                      five-step method never needs the keyboard. */}
                  <DictateButton
                    value={step.content}
                    maxLength={2000}
                    onChange={(v) => updateStep(idx, 'content', v)}
                    what={`step ${idx + 1}`}
                    bottomClass="bottom-3.5"
                    // Into this step's own note next — the optional remark that
                    // belongs with it — rather than skipping straight to step 2.
                    onDone={() => focusFieldById(`step-note-${step.uid}`)}
                  />
                </div>
              </div>
              <div className="block">
                <FieldLabel accent="plum">
                  <label htmlFor={`step-note-${step.uid}`}>
                    A note on this step (optional)
                  </label>
                </FieldLabel>
                <div className="relative">
                  <input
                    id={`step-note-${step.uid}`}
                    type="text"
                    placeholder={'“don\'t rush the onions”'}
                    value={step.voice_note || ''}
                    maxLength={2000}
                    onChange={(e) => updateStep(idx, 'voice_note', e.target.value)}
                    className="field bg-plum/[0.06] pr-11"
                  />
                  <DictateButton
                    value={step.voice_note || ''}
                    onChange={(v) => updateStep(idx, 'voice_note', v)}
                    what={`the note on step ${idx + 1}`}
                    // Finishing a note moves to the NEXT step's instruction, adding
                    // a step row if this is the last one — so the steps chain the
                    // same way ingredients do: instruction, note, next instruction.
                    onDone={() =>
                      openNextRow({
                        container: steps,
                        index: idx,
                        addRow: () => setSteps((prev) => [...prev, emptyStep()]),
                        selector: '[data-step-content]',
                      })
                    }
                  />
                </div>
              </div>

              {/* Optional technique photo — "fold it like this", "until it looks
                  like this". The one thing this must not do is make the steps
                  section heavier: the add flow starts with THREE step rows, one
                  tester abandoned it as too effortful, and a dropzone per row
                  would triple the visual weight of the section to serve a field
                  most steps will never use.

                  So the resting state is a single line of small terra text — the
                  same weight as "+ Add step" below, which the form has already
                  taught reads as "optional extra". The line IS the file input
                  (an sr-only input inside the label), so it opens the picker in
                  one tap; an expanding panel would have cost a second tap to
                  reach the same place and left a dropzone sitting open in the
                  row. It only grows into something bigger once there's a photo
                  to show, i.e. once the user has asked for it.

                  sr-only, NOT `hidden`: display:none drops the input out of the
                  tab order, which is what made the cover picker unreachable by
                  keyboard. */}
              {step.photo_url ? (
                <div className="mt-2.5 flex items-center gap-2.5">
                  {/* Small, not a banner: enough to recognise your own photo and
                      confirm the right one uploaded, not enough to dominate a row
                      whose subject is the instruction. */}
                  <img
                    src={step.photo_url}
                    alt={`Photo for step ${idx + 1}`}
                    className="w-14 h-14 object-cover rounded-[10px] border-2 border-ink block flex-none"
                  />
                  <span className="font-display font-bold text-[12.5px] text-ink-soft flex-1">
                    Photo added
                  </span>
                  <button
                    type="button"
                    onClick={() => removeStepPhoto(step.uid)}
                    aria-label={`Remove photo for step ${idx + 1}`}
                    className="flex-none w-7 h-7 rounded-full bg-cream border-2 border-ink text-ink flex items-center justify-center"
                  >
                    <Icon name="close" className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <label
                  aria-busy={stepUploading[step.uid] || undefined}
                  className="mt-2.5 inline-flex items-center gap-1.5 font-display font-bold text-[12.5px] text-terra cursor-pointer rounded-full focus-within:ring-4 focus-within:ring-terra/25"
                >
                  <input
                    type="file"
                    accept={PHOTO_ACCEPT}
                    onChange={(e) => handleStepPhotoSelect(step.uid, e)}
                    aria-label={`Add a photo of step ${idx + 1}`}
                    className="sr-only"
                  />
                  <Icon name="camera" className="w-3.5 h-3.5" />
                  {stepUploading[step.uid]
                    ? 'Uploading…'
                    : 'Add a photo of this step'}
                </label>
              )}
              {stepPhotoError[step.uid] && (
                <p className="mt-2">
                  <span className="error-pill">{stepPhotoError[step.uid]}</span>
                </p>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setSteps((prev) => [...prev, emptyStep()])}
          className="mt-3 font-display font-bold text-[13px] text-terra"
        >
          + Add step
        </button>

        {beforeSubmitSlot}
        <button type="submit" disabled={loading} className="btn-primary mt-5">
          {loading ? loadingLabel : submitText}
        </button>
      </form>
    </div>
  )
}
