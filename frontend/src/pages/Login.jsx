import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import client from '../api/client'

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
    <div className="min-h-screen bg-paper flex flex-col items-center justify-center px-6">
      <h1 className="font-serif text-5xl font-bold text-ink mb-2">一世</h1>
      <p className="text-sm text-ink-soft">Issei</p>
      <p className="text-sm text-ink-soft italic mb-8 mt-1 text-center max-w-xs">
        Recipes that live in memory, not cookbooks.
      </p>

      <div className="w-full max-w-sm">
        <div className="flex border-b border-line mb-6">
          <button
            onClick={() => { setTab('login'); setError('') }}
            className={`flex-1 pb-2 text-sm font-medium ${
              tab === 'login' ? 'border-b-2 border-terra text-terra' : 'text-ink-soft'
            }`}
          >
            Login
          </button>
          <button
            onClick={() => { setTab('signup'); setError('') }}
            className={`flex-1 pb-2 text-sm font-medium ${
              tab === 'signup' ? 'border-b-2 border-terra text-terra' : 'text-ink-soft'
            }`}
          >
            Sign Up
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
              className="w-full py-3 rounded-lg bg-terra text-white font-medium text-sm disabled:opacity-50"
            >
              {loading ? 'Logging in...' : 'Log In'}
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
              className="w-full py-3 rounded-lg bg-terra text-white font-medium text-sm disabled:opacity-50"
            >
              {loading ? 'Creating account...' : 'Join the table'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
