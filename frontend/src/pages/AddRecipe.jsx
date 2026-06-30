import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import client from '../api/client'
import { parseQuantity } from '../utils/quantity'

const emptyIngredient = () => ({
  name: '',
  quantity: '',
})

const emptyStep = () => ({ content: '' })

// Keep in sync with the backend's accepted formats in app/routers/upload.py.
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp']
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB

function hasAcceptedExtension(filename) {
  const lower = filename.toLowerCase()
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export default function AddRecipe() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [servings, setServings] = useState('')
  const [cuisine, setCuisine] = useState('')
  const [description, setDescription] = useState('')
  const [story, setStory] = useState('')
  const [ingredients, setIngredients] = useState([emptyIngredient()])
  const [steps, setSteps] = useState([emptyStep()])
  const [coverPhotoUrl, setCoverPhotoUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
      e.target.value = '' // allow re-selecting the same file after a fix
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

  function updateStep(index, value) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { content: value } : s)))
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
          position: idx + 1,
        })),
    }

    try {
      await client.post('/recipes', payload)
      navigate('/my-recipes')
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create recipe')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="px-4 pt-6 pb-8">
      <h1 className="font-serif text-2xl font-bold text-primary mb-6">Add Recipe</h1>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Cover Photo */}
        <section>
          {coverPhotoUrl ? (
            <div className="relative w-full h-44 rounded-xl overflow-hidden">
              <img src={coverPhotoUrl} alt="Recipe cover" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={removePhoto}
                aria-label="Remove photo"
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/55 text-white flex items-center justify-center text-lg leading-none hover:bg-black/70"
              >
                ×
              </button>
            </div>
          ) : (
            <label className="block w-full h-44 rounded-xl overflow-hidden cursor-pointer">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handlePhotoSelect}
                className="hidden"
              />
              <div className="w-full h-full bg-cream border-2 border-dashed border-secondary flex flex-col items-center justify-center text-center px-4">
                {uploading ? (
                  <span className="text-sm text-accent/70">Uploading…</span>
                ) : (
                  <>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      className="w-9 h-9 text-accent/70 mb-2"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"
                      />
                    </svg>
                    <span className="text-sm text-accent/70">
                      Add a photo to bring this recipe to life
                    </span>
                  </>
                )}
              </div>
            </label>
          )}
          {photoError ? (
            <p className="text-red-600 text-xs mt-2">{photoError}</p>
          ) : (
            <p className="text-gray-400 text-xs mt-2">JPEG, PNG, or WebP · max 10 MB</p>
          )}
        </section>

        {/* Recipe Details */}
        <section>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            Recipe Details
          </h2>
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Recipe name *"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-lg border border-secondary bg-surface text-sm focus:outline-none focus:border-accent"
            />
            <input
              type="number"
              placeholder="Servings"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-secondary bg-surface text-sm focus:outline-none focus:border-accent"
            />
            <input
              type="text"
              placeholder="Cuisine"
              value={cuisine}
              onChange={(e) => setCuisine(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-secondary bg-surface text-sm focus:outline-none focus:border-accent"
            />
            <textarea
              placeholder="Description — what is this dish? (helps anyone unfamiliar with it)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-4 py-3 rounded-lg border border-secondary bg-surface text-sm focus:outline-none focus:border-accent resize-none"
            />
          </div>
        </section>

        {/* The Story */}
        <section>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-1">
            The Story
          </h2>
          <p className="text-xs text-gray-400 mb-3">
            What makes this recipe yours? Who taught you, when you make it, the
            memories it holds. (optional)
          </p>
          <textarea
            placeholder="My grandmother made this every Lunar New Year…"
            value={story}
            onChange={(e) => setStory(e.target.value)}
            rows={4}
            className="w-full px-4 py-3 rounded-lg border border-secondary bg-surface text-sm focus:outline-none focus:border-accent resize-none"
          />
        </section>

        {/* Ingredients */}
        <section>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-1">
            Ingredients
          </h2>
          <p className="text-xs text-gray-400 mb-3">
            Write quantities naturally — fractions ("1 1/2 cups"), approximations
            ("~3 tbsp"), or by feel ("a dash", "to taste").
          </p>
          <div className="space-y-3">
            {ingredients.map((ing, idx) => (
              <div key={idx} className="bg-surface rounded-lg border border-secondary p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">#{idx + 1}</span>
                  {ingredients.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeIngredient(idx)}
                      className="text-gray-400 hover:text-red-500 text-lg leading-none"
                    >
                      ×
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  placeholder="Ingredient name *"
                  value={ing.name}
                  onChange={(e) => updateIngredient(idx, 'name', e.target.value)}
                  className="w-full px-3 py-2 rounded border border-secondary/60 text-sm focus:outline-none focus:border-accent"
                />
                <input
                  type="text"
                  placeholder="Quantity — e.g. 1 1/2 cups, 3 tbsp, a dash"
                  value={ing.quantity}
                  onChange={(e) => updateIngredient(idx, 'quantity', e.target.value)}
                  className="w-full px-3 py-2 rounded border border-secondary/60 text-sm focus:outline-none focus:border-accent"
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setIngredients((prev) => [...prev, emptyIngredient()])}
            className="mt-3 text-sm text-accent font-medium"
          >
            + Add Ingredient
          </button>
        </section>

        {/* Steps */}
        <section>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            Steps
          </h2>
          <div className="space-y-3">
            {steps.map((step, idx) => (
              <div key={idx} className="relative">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-400">Step {idx + 1}</span>
                  {steps.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeStep(idx)}
                      className="text-gray-400 hover:text-red-500 text-lg leading-none"
                    >
                      ×
                    </button>
                  )}
                </div>
                <textarea
                  placeholder="Describe this step..."
                  value={step.content}
                  onChange={(e) => updateStep(idx, e.target.value)}
                  rows={2}
                  className="w-full px-4 py-3 rounded-lg border border-secondary bg-surface text-sm focus:outline-none focus:border-accent resize-none"
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setSteps((prev) => [...prev, emptyStep()])}
            className="mt-3 text-sm text-accent font-medium"
          >
            + Add Step
          </button>
        </section>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 rounded-lg bg-accent text-white font-medium text-sm disabled:opacity-50"
        >
          {loading ? 'Saving...' : 'Save Recipe'}
        </button>
      </form>
    </div>
  )
}
