import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import client from '../api/client'

const emptyIngredient = () => ({
  name: '',
  quantity_text: '',
  quantity_value: '',
  unit: '',
  quantity_type: 'precise',
})

const emptyStep = () => ({ content: '' })

export default function AddRecipe() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [servings, setServings] = useState('')
  const [cuisine, setCuisine] = useState('')
  const [description, setDescription] = useState('')
  const [ingredients, setIngredients] = useState([emptyIngredient()])
  const [steps, setSteps] = useState([emptyStep()])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
      servings: servings ? parseInt(servings) : null,
      cuisine: cuisine || null,
      description: description || null,
      ingredients: ingredients
        .filter((ing) => ing.name.trim())
        .map((ing, idx) => ({
          name: ing.name.trim(),
          quantity_text: ing.quantity_text || null,
          quantity_value: ing.quantity_value ? parseFloat(ing.quantity_value) : null,
          unit: ing.unit || null,
          quantity_type: ing.quantity_type,
          position: idx + 1,
        })),
      steps: steps
        .filter((s) => s.content.trim())
        .map((s, idx) => ({
          content: s.content.trim(),
          position: idx + 1,
        })),
    }

    try {
      await client.post('/recipes', payload)
      navigate('/recipes')
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
            <div className="flex gap-3">
              <input
                type="number"
                placeholder="Servings"
                value={servings}
                onChange={(e) => setServings(e.target.value)}
                className="flex-1 px-4 py-3 rounded-lg border border-secondary bg-surface text-sm focus:outline-none focus:border-accent"
              />
              <input
                type="text"
                placeholder="Cuisine"
                value={cuisine}
                onChange={(e) => setCuisine(e.target.value)}
                className="flex-1 px-4 py-3 rounded-lg border border-secondary bg-surface text-sm focus:outline-none focus:border-accent"
              />
            </div>
            <textarea
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-4 py-3 rounded-lg border border-secondary bg-surface text-sm focus:outline-none focus:border-accent resize-none"
            />
          </div>
        </section>

        {/* Ingredients */}
        <section>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            Ingredients
          </h2>
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
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Qty text"
                    value={ing.quantity_text}
                    onChange={(e) => updateIngredient(idx, 'quantity_text', e.target.value)}
                    className="flex-1 px-3 py-2 rounded border border-secondary/60 text-sm focus:outline-none focus:border-accent"
                  />
                  <input
                    type="number"
                    step="any"
                    placeholder="Value"
                    value={ing.quantity_value}
                    onChange={(e) => updateIngredient(idx, 'quantity_value', e.target.value)}
                    className="w-20 px-3 py-2 rounded border border-secondary/60 text-sm focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Unit"
                    value={ing.unit}
                    onChange={(e) => updateIngredient(idx, 'unit', e.target.value)}
                    className="flex-1 px-3 py-2 rounded border border-secondary/60 text-sm focus:outline-none focus:border-accent"
                  />
                  <select
                    value={ing.quantity_type}
                    onChange={(e) => updateIngredient(idx, 'quantity_type', e.target.value)}
                    className="flex-1 px-3 py-2 rounded border border-secondary/60 text-sm focus:outline-none focus:border-accent bg-surface"
                  >
                    <option value="precise">Precise</option>
                    <option value="imprecise">Imprecise</option>
                    <option value="unmeasured">Unmeasured</option>
                  </select>
                </div>
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
