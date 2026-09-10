import axios from 'axios'

const client = axios.create({
  // Defaults to the local dev backend; override with VITE_API_URL (e.g. to point
  // at a throwaway demo backend) without editing this file.
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  // Without a timeout a stalled request never settles, so a screen waiting on it
  // shows its loader forever with no way out. 45s is deliberately generous: the
  // API sleeps when idle on its host's free tier, and the first request after
  // that has to wait for a full cold boot. Better a slow success than a
  // premature failure — but bounded, so a truly dead request surfaces as one.
  timeout: 45000,
})

// Field names as a person would say them, for turning a server-side validation
// failure back into a sentence about the form they're looking at.
// Every field a user can actually be refused on needs a line here, or the message names no
// field at all. That became load-bearing with #100's length ceilings: before them almost
// nothing could be too long, so "That field is too long" was rare and roughly locatable.
// Now a cook who writes a 4,100-character story taps Save and gets one sentence with twelve
// textareas on screen and no way to tell which one. The recipe fields below are why.
//
// The key is the LAST segment of Pydantic's `loc`, which is why a nested error on
// `steps[3].content` lands on `content` rather than the index — good enough, since the form
// puts every step in a visibly numbered box.
const FIELD_LABELS = {
  email: 'Email',
  password: 'Password',
  first_name: 'First name',
  last_name: 'Last name',
  name: 'Name',
  // Recipe (#100)
  description: 'Description',
  story: 'The story',
  notes: 'Notes',
  source: 'Passed down from',
  cuisine: 'Cuisine',
  diet: 'Diet',
  servings: 'Servings',
  prep_time_minutes: 'Ready in',
  content: 'A step',
  voice_note: 'A note on a step',
  section_header: 'A section heading',
  quantity_text: 'An amount',
  unit: 'A unit',
  cover_photo_url: 'Photo',
  photo_url: 'Photo',
  // Post + report
  dish_name: 'Dish name',
  note: 'Note',
}

// A Pydantic 422 entry is { loc: ['body', 'password'], msg: 'String should have
// at least 8 characters', ... }. `loc[0]` is the request part ('body', 'query'),
// so the field is the last segment.
function humanizeFieldError(entry) {
  if (typeof entry === 'string') return entry
  const path = Array.isArray(entry?.loc) ? entry.loc : []
  const field = [...path].reverse().find((p) => typeof p === 'string' && p !== 'body')
  const label = FIELD_LABELS[field] || 'That field'
  const msg = typeof entry?.msg === 'string' ? entry.msg : ''

  // Pydantic's own wording leaks its internals ("String should have at least 8
  // characters", "value is not a valid email address: An email address must
  // have an @-sign") — true, but written for whoever wrote the schema. These
  // rewrites cover every rule the auth schema actually enforces; anything else
  // falls through to the server's words, which beats inventing a diagnosis.
  if (/valid email/i.test(msg)) return "That email doesn't look right."
  const tooShort = msg.match(/at least (\d+) character/i)
  if (tooShort) return `${label} needs at least ${tooShort[1]} characters.`
  const tooLong = msg.match(/at most (\d+) character/i)
  if (tooLong) return `${label} is too long — keep it under ${tooLong[1]} characters.`
  // #100's collection caps (100 ingredients / 100 steps / 30 sections). Pydantic says "List
  // should have at most 100 items after validation, not 101", which is true and unreadable.
  const tooMany = msg.match(/at most (\d+) item/i)
  if (tooMany) return `That's more than ${tooMany[1]} — a recipe can't hold that many.`
  if (/field required/i.test(msg)) return `${label} is required.`
  return msg ? `${label}: ${msg}` : `${label} isn't valid.`
}

/**
 * Turn any axios failure into one sentence a person can act on.
 *
 * This lives here rather than in each form because every screen reads the same
 * `detail` field and every screen got the same bug: FastAPI answers a schema
 * failure with 422 and `detail` as an ARRAY OF OBJECTS, so `detail || fallback`
 * put `[object Object]` in front of a user who had simply chosen a short
 * password. One place to pass through means one place to get this right.
 *
 * `fallback` is the caller's plain-language description of the failed action,
 * used only when the server gave us nothing better to say.
 */
export function toUserMessage(err, fallback = 'Something went wrong.') {
  // No response at all: offline, DNS, CORS, or a timeout. Reporting this as
  // "Login failed" tells a user on a dead train connection that their password
  // is wrong — they then change a password that was never the problem.
  if (!err?.response) {
    return "Couldn't reach issei — check your connection."
  }
  const detail = err.response.data?.detail

  // 400/401/403/404 carry a `detail` string written for the user by the router
  // ("Email already registered", "Invalid email or password") — pass it through
  // untouched; those are deliberate copy.
  if (typeof detail === 'string' && detail.trim()) return detail

  if (Array.isArray(detail) && detail.length) {
    // Every failing field, not just the first: hiding the second one makes the
    // user fix one thing, submit, and get stopped again. Deduped because a
    // repeated rule (two blank names) would otherwise say the same thing twice.
    const seen = new Set()
    for (const entry of detail) {
      seen.add(humanizeFieldError(entry))
    }
    return [...seen].join(' ')
  }

  // A `detail`-less error is either a crash or a proxy/gateway page; a 5xx is
  // ours to own rather than something the user can fix by retyping.
  if (err.response.status >= 500) return 'issei is having trouble right now.'
  return fallback
}

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('issei_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// The routes that are deliberately readable WITHOUT a session. A 401 on one of these must clear the
// stale token but must NOT redirect: the whole premise of `/invite/:token` is that the token is the
// capability and no account is needed, so bouncing that reader to /login defeats the page with the
// highest intent in the product — and the invite token is gone from the URL by the time they get
// there. It only takes one stale `issei_token` in the recipient's browser (a week-old session, an
// account since deleted) for `reconcile()` to 401 at app start and throw them off the recipe.
//
// A SET, not the single literal '/login' this used to compare against, so any future unauthenticated
// surface is covered by adding it here rather than by rediscovering the bug.
const NO_REDIRECT_ON_401 = ['/login', '/invite/', '/forgot-password', '/reset-password']

// On any 401 (expired token, or token for a user that no longer exists), clear
// the stale session and send the user to login. This keeps session expiry from
// surfacing as a confusing error inside an unrelated feature.
client.interceptors.response.use(
  (response) => response,
  (error) => {
    const isLoginRequest = error.config?.url?.includes('/auth/login')
    if (error.response?.status === 401 && !isLoginRequest) {
      localStorage.removeItem('issei_token')
      localStorage.removeItem('issei_user')
      const path = window.location.pathname
      const staysPut = NO_REDIRECT_ON_401.some((p) => path === p || path.startsWith(p))
      if (!staysPut) {
        window.location.assign('/login')
      }
    }
    return Promise.reject(error)
  },
)

export default client
