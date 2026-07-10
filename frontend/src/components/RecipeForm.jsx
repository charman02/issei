import { useState } from 'react'
import client from '../api/client'
import Icon from './Icon'
import { parseQuantity } from '../utils/quantity'

// Shared Add/Edit recipe form. Owns all field state, photo upload, ingredient/
// step management, client-side validation, and payload assembly. The parent
// (AddRecipe / EditRecipe) supplies initial values and an onSubmit that performs
// the actual POST/PATCH + navigation — this component just hands it a built
// payload and manages the surrounding loading/error UI.
//
// mode: 'add' | 'edit' — drives the heading and button labels.

const emptyIngredient = () => ({ name: '', quantity: '' })
const emptyStep = () => ({ content: '', voice_note: '' })

// Keep in sync with the backend's accepted formats in app/routers/upload.py.
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp']
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB

function hasAcceptedExtension(filename) {
  const lower = filename.toLowerCase()
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export default function RecipeForm({ mode = 'add', initialValues = {}, onSubmit, submitLabel, beforeSubmitSlot = null }) {
  const [name, setName] = useState(initialValues.name || '')
  const [servings, setServings] = useState(
    initialValues.servings != null ? String(initialValues.servings) : ''
  )
  const [cuisine, setCuisine] = useState(initialValues.cuisine || '')
  const [description, setDescription] = useState(initialValues.description || '')
  const [story, setStory] = useState(initialValues.story || '')
  const [ingredients, setIngredients] = useState(
    initialValues.ingredients?.length ? initialValues.ingredients : [emptyIngredient()]
  )
  const [steps, setSteps] = useState(
    initialValues.steps?.length ? initialValues.steps : [emptyStep()]
  )
  const [coverPhotoUrl, setCoverPhotoUrl] = useState(initialValues.coverPhotoUrl || '')
  const [uploading, setUploading] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const heading = mode === 'edit' ? 'Edit recipe' : 'Keep a recipe'
  const defaultSubmitLabel = mode === 'edit' ? 'Save changes' : 'Keep this recipe'
  const submitText = submitLabel || defaultSubmitLabel
  const loadingLabel = mode === 'edit' ? 'Saving…' : 'Keeping…'

  async function handlePhotoSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoError('')

    // Validate client-side first for instant feedback, matching the backend.
    // Check both MIME type and extension: some browsers report an empty or
    // unexpected file.type, so the extension is a reliable fallback.
    const typeOk = ACCEPTED_IMAGE_TYPES.includes(file.type)
    const extOk = hasAcceptedExtension(file.name)
    if (!typeOk && !extOk) {
      setPhotoError('Please choose a JPEG, PNG, or WebP image.')
      e.target.value = ''
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setPhotoError('That image is too large (max 10 MB).')
      e.target.value = ''
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const { data } = await client.post('/upload/recipe-photo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setCoverPhotoUrl(data.url)
    } catch (err) {
      setPhotoError(err.response?.data?.detail || 'Photo upload failed. Please try again.')
    } finally {
      setUploading(false)
      e.target.value = '' // reset so re-selecting the same file fires onChange
    }
  }

  function removePhoto() {
    setCoverPhotoUrl('')
    setPhotoError('')
  }

  function updateIngredient(index, field, value) {
    setIngredients((prev) =>
      prev.map((ing, i) => (i === index ? { ...ing, [field]: value } : ing))
    )
  }

  function removeIngredient(index) {
    setIngredients((prev) => prev.filter((_, i) => i !== index))
  }

  function updateStep(index, field, value) {
    // Spread to preserve any non-edited fields (e.g. section_header on edit).
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)))
  }

  function removeStep(index) {
    setSteps((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const payload = {
      name,
      cover_photo_url: coverPhotoUrl || null,
      servings: servings ? parseInt(servings) : null,
      cuisine: cuisine || null,
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
          position: idx + 1,
        })),
    }

    try {
      await onSubmit(payload)
      // On success the parent navigates away and this unmounts — don't touch state.
    } catch (err) {
      setError(err.response?.data?.detail || 'Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="px-[18px] pt-6 pb-8">
      <h1 className="font-serif font-black text-[26px] text-ink mb-4">{heading}</h1>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      <form onSubmit={handleSubmit}>
        {/* Cover photo */}
        {coverPhotoUrl ? (
          <div className="relative w-full h-[120px] rounded-xl overflow-hidden mb-1.5">
            <img src={coverPhotoUrl} alt="Recipe cover" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={removePhoto}
              aria-label="Remove photo"
              className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/55 text-white flex items-center justify-center hover:bg-black/70"
            >
              <Icon name="close" className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <label className="flex flex-col items-center justify-center w-full h-[120px] rounded-xl border-2 border-dashed border-line bg-paper text-terra/70 cursor-pointer mb-1.5">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handlePhotoSelect}
              className="hidden"
            />
            {uploading ? (
              <span className="text-sm text-terra/70">Uploading…</span>
            ) : (
              <>
                <Icon name="camera" className="w-[30px] h-[30px] mb-1.5" />
                <span className="font-sans text-[13px]">Add a photo to bring this recipe to life</span>
              </>
            )}
          </label>
        )}
        {photoError ? (
          <p className="text-red-600 text-xs mb-4">{photoError}</p>
        ) : (
          <p className="font-sans text-[11px] text-ink-soft mb-4">JPEG, PNG, or WebP · max 10 MB</p>
        )}

        {/* Recipe details */}
        <p className="section-label mb-2.5">Recipe details</p>
        <div className="space-y-2.5">
          <input
            type="text"
            placeholder="Recipe name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="field"
          />
          <input
            type="number"
            placeholder="Servings"
            value={servings}
            onChange={(e) => setServings(e.target.value)}
            className="field"
          />
          <input
            type="text"
            placeholder="Cuisine"
            value={cuisine}
            onChange={(e) => setCuisine(e.target.value)}
            className="field"
          />
          <textarea
            placeholder="Description — what is this dish?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="field resize-none"
          />
        </div>

        {/* The Story */}
        <p className="section-label mt-[18px] mb-1">The Story</p>
        <p className="font-sans text-[11px] text-ink-soft mb-2.5">
          Who taught you, when you make it, the memories it holds.
        </p>
        <textarea
          placeholder="My grandmother made this every Lunar New Year…"
          value={story}
          onChange={(e) => setStory(e.target.value)}
          rows={3}
          className="field resize-none"
        />

        {/* Ingredients */}
        <p className="section-label mt-[18px] mb-1">Ingredients</p>
        <p className="font-sans text-[11px] text-ink-soft mb-2.5">
          Write quantities naturally — "1 1/2 cups", "a dash".
        </p>
        <div className="space-y-2.5">
          {ingredients.map((ing, idx) => (
            <div key={idx} className="border border-line bg-card rounded-[9px] p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-sans text-[11px] text-ink-soft">#{idx + 1}</span>
                {ingredients.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeIngredient(idx)}
                    aria-label={`Remove ingredient ${idx + 1}`}
                    className="text-ink-soft/70 hover:text-red-500"
                  >
                    <Icon name="close" className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <input
                type="text"
                placeholder="Ingredient name"
                value={ing.name}
                onChange={(e) => updateIngredient(idx, 'name', e.target.value)}
                className="w-full font-sans text-[12.5px] text-ink bg-card border border-line rounded-[7px] px-2.5 py-2 mb-1.5 placeholder:text-ink-soft/70 focus:outline-none focus:border-terra"
              />
              <input
                type="text"
                placeholder="Quantity — e.g. 1 1/2 cups, a dash"
                value={ing.quantity}
                onChange={(e) => updateIngredient(idx, 'quantity', e.target.value)}
                className="w-full font-sans text-[12.5px] text-ink bg-card border border-line rounded-[7px] px-2.5 py-2 placeholder:text-ink-soft/70 focus:outline-none focus:border-terra"
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setIngredients((prev) => [...prev, emptyIngredient()])}
          className="mt-2.5 font-sans font-medium text-[13px] text-terra"
        >
          + Add Ingredient
        </button>

        {/* Steps */}
        <p className="section-label mt-[18px] mb-2.5">Steps</p>
        <div className="space-y-2.5">
          {steps.map((step, idx) => (
            <div key={idx}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-sans text-[11px] text-ink-soft">Step {idx + 1}</span>
                {steps.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeStep(idx)}
                    aria-label={`Remove step ${idx + 1}`}
                    className="text-ink-soft/70 hover:text-red-500"
                  >
                    <Icon name="close" className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <textarea
                placeholder="Describe this step…"
                value={step.content}
                onChange={(e) => updateStep(idx, 'content', e.target.value)}
                rows={2}
                className="field resize-none"
              />
              <input
                type="text"
                placeholder={'Their words for this step (optional) — "don\'t rush the onions"'}
                value={step.voice_note || ''}
                onChange={(e) => updateStep(idx, 'voice_note', e.target.value)}
                className="field mt-1.5"
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setSteps((prev) => [...prev, emptyStep()])}
          className="mt-2.5 font-sans font-medium text-[13px] text-terra"
        >
          + Add Step
        </button>

        {beforeSubmitSlot}
        <button type="submit" disabled={loading} className="btn-primary mt-5">
          {loading ? loadingLabel : submitText}
        </button>
      </form>
    </div>
  )
}
