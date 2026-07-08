import { Navigate } from 'react-router-dom'
// Superseded by the stepped PlantRecipe flow (spec §3.1).
export default function AddRecipe() {
  return <Navigate to="/add" replace />
}
