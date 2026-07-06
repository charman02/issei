import { useNavigate } from 'react-router-dom'
import client from '../api/client'
import RecipeForm from '../components/RecipeForm'

// Thin wrapper around the shared RecipeForm: POSTs a new recipe, then routes to
// the user's kitchen. All field/photo/validation logic lives in RecipeForm.
export default function AddRecipe() {
  const navigate = useNavigate()

  async function handleCreate(payload) {
    await client.post('/recipes', payload)
    navigate('/my-recipes')
  }

  return <RecipeForm mode="add" onSubmit={handleCreate} />
}
