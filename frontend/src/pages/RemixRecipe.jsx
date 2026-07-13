import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import client from '../api/client'
import RecipeForm from '../components/RecipeForm'
import { buildRemixInitialValues } from '../lib/lineagePayload'
import { remixRecipe } from '../api/lineage'

export default function RemixRecipe() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [parent, setParent] = useState(null)
  const [error, setError] = useState('')
  const [promptAnswer, setPromptAnswer] = useState('')

  useEffect(() => {
    client
      .get(`/recipes/${id}`)
      .then((res) => setParent(res.data))
      .catch(() => setError('Recipe not found'))
  }, [id])

  if (error) return <div className="p-6 text-center text-red-600">{error}</div>
  if (!parent)
    return <div className="p-6 text-center text-ink-soft">Loading…</div>

  async function handleSubmit(formPayload) {
    // Send the edited scalars too, so a remixer's name/notes/etc. edits aren't
    // silently dropped (the backend inherits from the parent only when omitted).
    const { data } = await remixRecipe(id, {
      name: formPayload.name,
      servings: formPayload.servings,
      cuisine: formPayload.cuisine,
      description: formPayload.description,
      notes: formPayload.notes,
      ingredients: formPayload.ingredients,
      steps: formPayload.steps,
      prompt_answer: promptAnswer.trim() || null,
    })
    navigate(`/recipes/${data.id}`)
  }

  return (
    <div>
      <div className="px-[18px] pt-6">
        <p className="font-sans text-[11px] uppercase tracking-[0.14em] text-terra mb-3">
          Branching from {parent.author_full_name || 'the original'}
        </p>
        <p className="section-label mb-1">What makes yours yours?</p>
        <input
          className="field mb-1"
          placeholder="What makes yours yours? e.g. Mom used lard"
          value={promptAnswer}
          onChange={(e) => setPromptAnswer(e.target.value)}
        />
      </div>
      <RecipeForm
        mode="edit"
        initialValues={buildRemixInitialValues(parent)}
        submitLabel="Make it mine"
        onSubmit={handleSubmit}
      />
    </div>
  )
}
