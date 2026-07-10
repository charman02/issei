import { Routes, Route } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import BottomNav from './components/BottomNav'
import Login from './pages/Login'
import Home from './pages/Home'
import Browse from './pages/Browse'
import MyRecipes from './pages/MyRecipes'
import RecipeDetail from './pages/RecipeDetail'
import PlantRecipe from './pages/PlantRecipe'
import EditRecipe from './pages/EditRecipe'
import SharedWithMe from './pages/SharedWithMe'
import Profile from './pages/Profile'
import InviteLanding from './pages/InviteLanding'

function Layout({ children }) {
  return (
    <div className="max-w-app mx-auto min-h-screen pb-20">
      {children}
      <BottomNav />
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/invite/:token" element={<InviteLanding />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout><Home /></Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/browse"
        element={
          <ProtectedRoute>
            <Layout><Browse /></Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-recipes"
        element={
          <ProtectedRoute>
            <Layout><MyRecipes /></Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/recipes/:id"
        element={
          <ProtectedRoute>
            <Layout><RecipeDetail /></Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/recipes/:id/edit"
        element={
          <ProtectedRoute>
            <Layout><EditRecipe /></Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/shared"
        element={
          <ProtectedRoute>
            <Layout><SharedWithMe /></Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/add"
        element={
          <ProtectedRoute>
            <Layout><PlantRecipe /></Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <Layout><Profile /></Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  )
}
