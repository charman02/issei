import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import client from '../api/client'
import Wordmark from '../components/Wordmark'

export default function Login() {
  const [tab, setTab] = useState('login')
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

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
      localStorage.setItem('issei_token', data.access_token)
      localStorage.setItem('issei_user', JSON.stringify(data.user))
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleSignup(e) {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      await client.post('/auth/signup', {
        email,
        password,
        first_name: firstName,
        last_name: lastName,
      })
      const params = new URLSearchParams()
      params.append('username', email)
      params.append('password', password)
      const { data } = await client.post('/auth/login', params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      localStorage.setItem('issei_token', data.access_token)
      localStorage.setItem('issei_user', JSON.stringify(data.user))
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.detail || 'Signup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-paper flex flex-col items-center justify-center px-6 py-12">
      <div className="text-center mb-2">
        <Wordmark className="text-[56px]" as="h1" />
      </div>
      <p className="font-serif italic text-base text-ink-soft mb-6 text-center max-w-xs">
        Recipes that live in memory, not cookbooks.
      </p>

      {/* The meaning of the name — every newcomer meets it before signing up. */}
      <div className="w-full max-w-sm mb-8 pl-4 border-l-2 border-terra">
        <p className="font-serif text-xs text-terra tracking-[0.2em] mb-1.5">一世 · issei</p>
        <p className="font-serif italic text-sm leading-relaxed text-ink-soft">
          The first of a family to arrive somewhere new — the ones who carry the recipes no one
          wrote down. This is where they stay alive, passed from one generation to the next.
        </p>
      </div>

      <div className="w-full max-w-sm">
        <div className="flex bg-[#E6D7BD] rounded-full p-1 mb-6">
          <button
            onClick={() => { setTab('login'); setError('') }}
            className={`flex-1 py-2.5 rounded-full font-serif font-semibold text-sm transition-colors ${
              tab === 'login' ? 'bg-paper text-terra shadow-[0_2px_6px_rgba(90,60,30,0.15)]' : 'text-ink-soft'
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => { setTab('signup'); setError('') }}
            className={`flex-1 py-2.5 rounded-full font-serif font-semibold text-sm transition-colors ${
              tab === 'signup' ? 'bg-paper text-terra shadow-[0_2px_6px_rgba(90,60,30,0.15)]' : 'text-ink-soft'
            }`}
          >
            Join the table
          </button>
        </div>

        {error && (
          <p className="text-red-600 text-sm mb-4 text-center">{error}</p>
        )}

        {tab === 'login' ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-lg border border-line bg-card text-sm focus:outline-none focus:border-terra"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-lg border border-line bg-card text-sm focus:outline-none focus:border-terra"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-lg bg-terra text-white font-serif font-semibold text-sm shadow-[0_8px_18px_rgba(189,90,44,0.3)] disabled:opacity-50"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSignup} className="space-y-4">
            <input
              type="text"
              placeholder="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-lg border border-line bg-card text-sm focus:outline-none focus:border-terra"
            />
            <input
              type="text"
              placeholder="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-lg border border-line bg-card text-sm focus:outline-none focus:border-terra"
            />
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-lg border border-line bg-card text-sm focus:outline-none focus:border-terra"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-lg border border-line bg-card text-sm focus:outline-none focus:border-terra"
            />
            <input
              type="password"
              placeholder="Confirm Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-lg border border-line bg-card text-sm focus:outline-none focus:border-terra"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-lg bg-terra text-white font-serif font-semibold text-sm shadow-[0_8px_18px_rgba(189,90,44,0.3)] disabled:opacity-50"
            >
              {loading ? 'Setting your table…' : 'Join the table'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
