import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import client, { toUserMessage } from '../api/client'
import { patchUser, setUser } from '../lib/currentUser'
import { localTimezone } from '../lib/push'
import { claimInvite } from '../api/sharing'
import IconField from '../components/IconField'
import Wordmark from '../components/Wordmark'

// Mirrors the server's rules (app/schemas/user.py) so a person hears about a
// short password or a blank name from the field in front of them, not from a
// round trip. The server stays the authority — this only saves the trip.
const PASSWORD_MIN = 8

// Deliberately loose: one @, something either side, a dot in the domain. A
// stricter regex here would start rejecting real addresses, and the server's
// EmailStr is the real check — this only catches the obvious typo ("mia@",
// "mia.com") before a round trip.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Returns the first problem worth stopping for, or null. Order follows the
// form top-to-bottom so the message points at the field nearest the top.
function findSignupProblem({ firstName, lastName, email, password, confirmPassword }) {
  if (!firstName.trim()) return 'Add your first name — recipes are signed with it.'
  if (!lastName.trim()) return 'Add your last name too.'
  if (!EMAIL_RE.test(email.trim())) return "That email doesn't look right."
  if (password.length < PASSWORD_MIN)
    return `Passwords need at least ${PASSWORD_MIN} characters.`
  if (password !== confirmPassword) return "Those passwords don't match."
  return null
}

export default function Login() {
  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('invite')
  const resetSuccess = searchParams.get('reset') === '1'
  const [tab, setTab] = useState(
    searchParams.get('tab') === 'signup' ? 'signup' : 'login',
  )
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  function switchTab(next) {
    setTab(next)
    setError('')
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setFirstName('')
    setLastName('')
  }

  // `isNew` is what separates the two callers: only handleSignup passes it, so a
  // returning sign-in can never trip the welcome no matter how empty their
  // kitchen looks. The alternative — inferring "new" from having no recipes —
  // would re-teach anyone who signed up and hasn't kept a dish yet, every single
  // time they came back.
  async function finishAuth(data, { isNew = false } = {}) {
    localStorage.setItem('issei_token', data.access_token)
    setUser(data.user)
    // Tell the server what time zone this person is in (#89).
    //
    // HERE rather than in a settings screen, and that placement is the whole point: the daily
    // prompt fires at a fixed hour in the RECIPIENT'S local time, so a user with no zone stored
    // is never due for anything. Nobody opens settings to volunteer their time zone, and asking
    // would be a question with an obvious answer the browser already knows.
    //
    // Only when it actually differs, so a returning user's sign-in isn't one extra write every
    // time. NOT AWAITED: nothing below depends on it, and awaiting put a round trip between the
    // tap and the destination — on the invite path it delayed `claimInvite` too. One caveat this
    // deliberately does not hide: a 401 here is intercepted by `api/client.js` BEFORE the local
    // catch, which clears the session and bounces to /login. That is vanishingly unlikely with a
    // seconds-old token, but it is not the "ignored entirely" the first version of this comment
    // claimed.
    const tz = localTimezone()
    if (tz && tz !== data.user?.timezone) {
      client
        .patch('/auth/me', { timezone: tz })
        .then(({ data: me }) => patchUser(me))
        .catch(() => {})
    }
    if (inviteToken) {
      // The token IS the authorization; claim the grant for this account, then
      // land the user on the recipe they were invited to.
      try {
        await claimInvite(inviteToken)
      } catch {
        // A bad/expired token shouldn't block sign-in; just proceed home.
      }
    }
    // An invite recipient is deliberately exempt even when brand new: they have
    // just scrolled a real recipe on /invite/:token and signed up to keep that
    // one dish. A tutorial standing between them and it would be the app talking
    // over the thing it's trying to explain — and Home leads with their recipe,
    // which teaches it better than any panel.
    const destination = isNew && !inviteToken ? '/welcome' : '/'
    // REPLACE, not push: a pushed entry leaves /login sitting behind Home, so the
    // first thing a new user does — swipe/press back — lands them on the sign-in
    // screen while already signed in. Replacing drops it from history entirely.
    navigate(destination, { replace: true })
  }

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('username', email)
      params.append('password', password)
      const { data } = await client.post('/auth/login', params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      await finishAuth(data)
    } catch (err) {
      setError(toUserMessage(err, "Sign-in didn't go through. Try again?"))
    } finally {
      setLoading(false)
    }
  }

  async function handleSignup(e) {
    e.preventDefault()
    setError('')
    const problem = findSignupProblem({
      firstName,
      lastName,
      email,
      password,
      confirmPassword,
    })
    if (problem) {
      setError(problem)
      return
    }
    setLoading(true)
    try {
      // Trim before sending: a trailing space from a phone keyboard's autocap
      // would otherwise ride along into every byline this person's recipes
      // carry. The schema strips too — this keeps the two in agreement so the
      // stored name matches what the user was shown.
      await client.post('/auth/signup', {
        email: email.trim(),
        password,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      })
      const params = new URLSearchParams()
      params.append('username', email.trim())
      params.append('password', password)
      const { data } = await client.post('/auth/login', params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      await finishAuth(data, { isNew: true })
    } catch (err) {
      setError(toUserMessage(err, "Couldn't open your kitchen. Try again?"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-cream flex flex-col items-center justify-center px-6 py-12">
      {/* The wordmark at full size — on this screen the mark IS the content. */}
      <div className="text-center mb-4">
        <h1>
          <Wordmark size="lg" />
        </h1>
      </div>
      {/* One line, and only one. The explaining moved to /welcome after signup:
          a sign-in screen's job is to get a returning user past it, and an
          earlier pass that stacked a pitch, a sample recipe and a glossary here
          made the form itself something you had to scroll to reach. This line
          stays because a wordmark alone leaves a first-time visitor with no idea
          what they're signing into. */}
      <p className="font-display italic text-[16px] leading-snug text-ink-soft mb-7 text-center max-w-[19rem]">
        For the dish someone cooked you that you&rsquo;d never had before.
      </p>

      {resetSuccess && (
        <div className="w-full max-w-sm mb-7 sticker bg-peach px-5 py-4 text-center">
          <p className="font-display font-black text-[17px] leading-tight text-ink">
            Password updated.
          </p>
          <p className="font-display text-[13.5px] leading-snug text-ink-soft mt-1.5">
            Sign in with your new password.
          </p>
        </div>
      )}

      {inviteToken && (
        /* COLD INVITE RECIPIENT — they arrive here having just read a real
           recipe on /invite/:token, so they already know what the app is. What
           they need is the thread back to the dish they were reading, not a
           general introduction. (They skip /welcome after signup too, for the
           same reason — see finishAuth.) */
        <div className="w-full max-w-sm mb-7 sticker bg-peach px-5 py-4 text-center">
          <p className="font-display font-black text-[17px] leading-tight text-ink">
            One more step to keep that recipe.
          </p>
          <p className="font-display text-[13.5px] leading-snug text-ink-soft mt-1.5">
            Make an account and it&rsquo;s yours — in your kitchen, for good.
          </p>
        </div>
      )}

      <div className="w-full max-w-sm">
        <div className="flex bg-cream border-2 border-ink rounded-full p-1 mb-6">
          <button
            onClick={() => switchTab('login')}
            className={`flex-1 py-2 rounded-full font-display font-bold text-sm transition-colors ${
              tab === 'login' ? 'bg-terra text-cream' : 'text-ink-soft'
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => switchTab('signup')}
            className={`flex-1 py-2 rounded-full font-display font-bold text-sm transition-colors ${
              tab === 'signup' ? 'bg-terra text-cream' : 'text-ink-soft'
            }`}
          >
            Open your kitchen
          </button>
        </div>

        {error && (
          <p className="mb-4 text-center">
            <span className="error-pill">{error}</span>
          </p>
        )}

        {tab === 'login' ? (
          <form onSubmit={handleLogin} className="space-y-3">
            <IconField
              icon="mail"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="field--login"
            />
            <IconField
              icon="lock"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="field--login"
            />
            <button
              type="submit"
              disabled={loading}
              className="btn-primary !mt-4"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
            <p className="text-center font-display text-[13px] text-ink-soft pt-1">
              <Link
                to="/forgot-password"
                className="font-bold text-terra underline underline-offset-2"
              >
                Forgot your password?
              </Link>
            </p>
          </form>
        ) : (
          <form onSubmit={handleSignup} className="space-y-3">
            <input
              type="text"
              placeholder="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              className="field field--login"
            />
            <input
              type="text"
              placeholder="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              className="field field--login"
            />
            <IconField
              icon="mail"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="field--login"
            />
            <IconField
              icon="lock"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="field--login"
            />
            {/* The rule stated BEFORE it can be broken. Discovering an
                8-character minimum by being rejected for a 6-character password
                is the app withholding something it knew all along — and it lands
                on a person mid-signup, the worst moment to be told to think
                again. Sits under the password field, where it's read while
                typing, not above the form where it's scrolled past. */}
            <p className="font-sans text-[12.5px] leading-snug text-ink-soft px-1 !mt-1.5">
              At least 8 characters.
            </p>
            <IconField
              icon="lock"
              type="password"
              placeholder="Confirm password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="field--login"
            />
            <button
              type="submit"
              disabled={loading}
              className="btn-primary !mt-4"
            >
              {loading ? 'Setting up…' : 'Open your kitchen'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
