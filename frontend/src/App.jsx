import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { reconcile } from './lib/currentUser'
import { reconcileSubscription, registerServiceWorker } from './lib/push'
import ProtectedRoute from './components/ProtectedRoute'
import PublicOnlyRoute from './components/PublicOnlyRoute'
import Landing from './pages/Landing'
import BottomNav from './components/BottomNav'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Welcome from './pages/Welcome'
import Feed from './pages/Feed'
import Browse from './pages/Browse'
import MyRecipes from './pages/MyRecipes'
import RecipePage from './pages/RecipePage'
import PostPage from './pages/PostPage'
import AddChooser from './pages/AddChooser'
import PostComposer from './pages/PostComposer'
import PlantRecipe from './pages/PlantRecipe'
import EditRecipe from './pages/EditRecipe'
import HandoffPage from './pages/HandoffPage'
import Friends from './pages/Friends'
import UserProfile from './pages/UserProfile'
import Profile from './pages/Profile'
import Feedback from './pages/Feedback'
import Notifications from './pages/Notifications'
import Requests from './pages/Requests'
import InviteLanding from './pages/InviteLanding'

// `/` ANSWERS TO BOTH AUDIENCES. Signed in it is Home (the friends feed); signed OUT it is the
// public Landing rather than a bounce to `/login`. That is the whole referral fix: until #111 every
// public door except an invite link led to a sign-in form that never said what issei is, so anyone
// told "check out issei.app" was asked for a password before being told what for.
//
// A COMPONENT, AND THAT IS NOT A STYLE CHOICE — it is the fix for a defect a ship gate caught. The
// first version put the ternary inline in the route's `element` prop, which is evaluated in App's
// OWN function body — and `App` never re-executes after mount: `main.jsx` creates one stable
// `<App />`, App holds no state and consumes no context, so a location change re-renders only the
// `LocationContext` consumer (`Routes`), which re-uses the `element` object built at mount. The
// token was therefore read ONCE, at page load, and frozen.
//
// What that did, measured against this repo's own React and router versions: a referred stranger
// tapped "Open your kitchen", signed up, and `Welcome` sent them to `/` — which was still
// `<Landing />`. So was "Sign in" for a returning user. And they were TRAPPED: Landing renders
// outside `Layout` so there is no bottom nav, and its "Sign in" link goes to `/login`, where
// `PublicOnlyRoute` sees the token and sends them straight back. Only a manual reload escaped.
//
// `ProtectedRoute` and `PublicOnlyRoute` were always immune to this precisely BECAUSE they are
// components: they re-execute on every match. This one now does too, so the token is re-read every
// time `/` is matched — which also means sign-out lands on Landing rather than bouncing to
// `/login`, the better answer for someone who may just be leaving a shared device.
//
// WHO THIS DOES *NOT* REACH, recorded because it looks like a hole and is not one: a returning
// visitor whose `issei_token` has EXPIRED still HAS a token, so they take the Feed arm, the first
// request 401s, and `client.js` sends them to `/login` — never the Landing. That is the right
// destination for them: they have an account, and this page exists to explain the product to
// someone who does not. `/` is deliberately NOT added to `NO_REDIRECT_ON_401` for that reason.
//
// A BRANCH RATHER THAN A SEPARATE MARKETING PATH, deliberately: `issei.app` is the only address a
// person repeats out loud, and the static OG tags in `index.html` describe that exact URL — so a
// shared link unfurls correctly with no crawler rewrite, unlike `/invite/:token`.
function HomeOrLanding() {
  if (!localStorage.getItem('issei_token')) return <Landing />
  return (
    <Layout>
      <Feed />
    </Layout>
  )
}

function Layout({ children }) {
  return (
    <div className="max-w-app mx-auto min-h-screen pb-28">
      {children}
      <BottomNav />
    </div>
  )
}

export default function App() {
  // Bring the cached identity in line with the server, once per app start. The cache is what
  // every screen displays your name and avatar from, and nothing used to reconcile it — so a
  // photo added on one screen could stay invisible on another indefinitely. Deliberately
  // fire-and-forget: `reconcile` swallows its own errors, because being offline is not a
  // reason to blank someone's own name, and the cached value is the right fallback.
  useEffect(() => {
    if (localStorage.getItem('issei_token')) reconcile()
  }, [])

  // Register the push service worker on every load (#89), signed in or not.
  //
  // Not conditional on notifications being ON, and not deferred to the moment someone flips the
  // switch: the worker is also what handles `pushsubscriptionchange`, which the browser fires on
  // its own schedule to rotate a subscription. A device whose worker isn't registered silently
  // stops receiving anything after a rotation, with nothing to notice it by.
  //
  // Safe to run for an anonymous invite reader too — this worker does no caching, so the usual
  // PWA hazard (a stale bundle served from cache) doesn't exist here. See `public/sw.js`.
  // Then, for a signed-in user, re-assert that this browser's subscription belongs to THEM. The
  // case is a shared phone: person A subscribes, person B signs in on the same browser, and the
  // browser still holds A's subscription — so the switch reads "on" for B while the server row
  // still says A. B gets nothing and A's nudges land on the phone B is using. `POST /subscribe` is
  // idempotent and deliberately MOVES ownership, so re-sending what the browser already has fixes
  // it. A no-op for the overwhelming majority, who have no subscription on this device at all.
  useEffect(() => {
    registerServiceWorker().then(() => {
      if (localStorage.getItem('issei_token')) reconcileSubscription()
    })
  }, [])

  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <Login />
          </PublicOnlyRoute>
        }
      />
      <Route path="/invite/:token" element={<InviteLanding />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      {/* The post-signup welcome. Protected (it's for an account that exists,
          and a signed-out visitor has nothing to be welcomed to) but pointedly
          NOT wrapped in Layout: no bottom nav, because a two-panel intro whose
          own buttons lead out doesn't need a second set of exits, and tab bars
          invite wandering off mid-explanation. Welcome self-redirects to Home
          once seen, so nobody can be stranded here. */}
      <Route
        path="/welcome"
        element={
          <ProtectedRoute>
            <Welcome />
          </ProtectedRoute>
        }
      />
      <Route
        path="/"
        element={<HomeOrLanding />}
      />
      <Route
        path="/browse"
        element={
          <ProtectedRoute>
            <Layout>
              <Browse />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-recipes"
        element={
          <ProtectedRoute>
            <Layout>
              <MyRecipes />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/recipes/:id"
        element={
          <ProtectedRoute>
            <Layout>
              <RecipePage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/posts/:id"
        element={
          <ProtectedRoute>
            <Layout>
              <PostPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/recipes/:id/edit"
        element={
          <ProtectedRoute>
            <Layout>
              <EditRecipe />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/recipes/:id/handoff"
        element={
          <ProtectedRoute>
            <Layout>
              <HandoffPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      {/* /shared is retired (#57): recipes people sent you now sit beside the ones you
          kept, in the Kitchen's Kept tab. Kept as a REDIRECT rather than deleted because
          PublicOnlyRoute sends a just-claimed invite here, and older links exist. */}
      <Route path="/shared" element={<Navigate to="/my-recipes?tab=kept" replace />} />
      <Route
        path="/friends"
        element={
          <ProtectedRoute>
            <Layout>
              <Friends />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/u/:userId"
        element={
          <ProtectedRoute>
            <Layout>
              <UserProfile />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/add"
        element={
          <ProtectedRoute>
            <Layout>
              <AddChooser />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/add/meal"
        element={
          <ProtectedRoute>
            <Layout>
              <PostComposer />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/add/recipe"
        element={
          <ProtectedRoute>
            <Layout>
              <PlantRecipe />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <Layout>
              <Profile />
            </Layout>
          </ProtectedRoute>
        }
      />
      {/* Feedback is protected because POST /feedback is authenticated — the note
          is stored against an account, which is what makes a report answerable. */}
      <Route
        path="/feedback"
        element={
          <ProtectedRoute>
            <Layout>
              <Feedback />
            </Layout>
          </ProtectedRoute>
        }
      />
      {/* The inbox (#79) — issei's first notification surface. Protected and inside
          Layout: it's a normal destination you return from, not a takeover. */}
      <Route
        path="/notifications"
        element={
          <ProtectedRoute>
            <Layout>
              <Notifications />
            </Layout>
          </ProtectedRoute>
        }
      />
      {/* The cook's asks (#79). The ONLY place request counts and requester names are
          shown, which is what keeps them off every public surface. */}
      <Route
        path="/requests"
        element={
          <ProtectedRoute>
            <Layout>
              <Requests />
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  )
}
