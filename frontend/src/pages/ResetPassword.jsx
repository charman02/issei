import { useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import client, { toUserMessage } from '../api/client'
import IconField from '../components/IconField'
import Wordmark from '../components/Wordmark'

// The two ways off this page, shown in every state it can reach.
//
// "Send me a new link" comes first and is the emphasized one, because on a page that just refused a
// reset link it is the action that actually solves the problem — "Back to sign in" only helps
// someone who has remembered their password after all.
function WayOut() {
  return (
    <p className="w-full max-w-sm text-center font-display text-[13px] text-ink-soft pt-5">
      <Link
        to="/forgot-password"
        className="font-bold text-terra underline underline-offset-2"
      >
        Send me a new link
      </Link>
      <span className="px-2 text-line">·</span>
      <Link to="/login" className="font-bold text-terra underline underline-offset-2">
        Back to sign in
      </Link>
    </p>
  )
}

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError("Those passwords don't match.")
      return
    }

    setLoading(true)
    try {
      await client.post('/auth/reset-password', { token, new_password: password })
      navigate('/login?reset=1', { replace: true })
    } catch (err) {
      setError(toUserMessage(err, 'This reset link is invalid or has expired.'))
    } finally {
      setLoading(false)
    }
  }

  // EVERY STATE OF THIS PAGE NEEDS A WAY OUT, and for a while none of them had one.
  //
  // This screen is reached from an email, which means it is very often opened in a mail client's
  // in-app browser with NO history — so the browser's Back button is not the escape hatch it looks
  // like. Both failure states used to render two paragraphs and nothing else: the copy said
  // "request a new one from the sign-in page" while offering no route to the sign-in page, so the
  // only way onward was editing the URL by hand.
  //
  // The no-token state below is the one a prod check found, but the expensive one is the state
  // further down: the token is valid for ONE HOUR, so anyone who opens the link later has a
  // truthy token, fills in the form, submits, and is told the link expired — with, until now,
  // nothing to tap. The person most locked out had the fewest ways forward.
  //
  // `ForgotPassword` has carried a "Back to sign in" link in both of its states all along; this is
  // just the same affordance, plus a direct route to asking for a fresh link.
  if (!token) {
    return (
      <div className="min-h-screen bg-cream flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm sticker bg-peach px-5 py-6 text-center">
          <p className="font-display font-black text-[17px] text-ink mb-1">
            This reset link isn&rsquo;t complete
          </p>
          <p className="font-display text-[13.5px] text-ink-soft leading-snug">
            Ask for a new one and we&rsquo;ll email it to you.
          </p>
        </div>
        <WayOut />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-cream flex flex-col items-center justify-center px-6 py-12">
      <div className="text-center mb-4">
        <h1>
          <Wordmark size="lg" />
        </h1>
      </div>

      <div className="w-full max-w-sm">
        <h2 className="font-display font-black text-[22px] text-ink mb-1">
          Set a new password
        </h2>
        <p className="font-display italic text-[14px] text-ink-soft mb-6">
          At least 8 characters.
        </p>

        {error && (
          <p className="mb-4 text-center">
            <span className="error-pill">{error}</span>
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <IconField
            icon="lock"
            type="password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="field--login"
          />
          <IconField
            icon="lock"
            type="password"
            placeholder="Confirm new password"
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
            {loading ? 'Saving…' : 'Set new password'}
          </button>
        </form>
      </div>

      {/* Shown even before anything fails. A reset token lives one hour, so the likeliest visitor to
          this form is someone whose link died on the way — and finding that out only AFTER typing a
          password twice, with no way onward, is the dead end this fixes. */}
      <WayOut />
    </div>
  )
}
