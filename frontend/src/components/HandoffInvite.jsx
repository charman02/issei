import { useState } from 'react'
import { handoffRecipe } from '../api/lineage'

// "Who else should have this seed?" — the growth-engine invite (spec §3.1/§3.4).
export default function HandoffInvite({ recipeId, recipeVisibility = 'private', onSent, onSkip }) {
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  async function send() {
    setError(''); setSending(true)
    try {
      const { data } = await handoffRecipe(recipeId, { to_email: email.trim(), note: note.trim() || null })
      onSent?.(data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not send. Try again.')
      setSending(false)
    }
  }

  return (
    <div className="px-[18px] py-6 text-center">
      <h1 className="font-serif font-black text-[24px] text-ink leading-tight">
        Who else should<br />have this seed?
      </h1>
      <p className="font-serif italic text-[14px] text-ink-soft mt-2 mb-5">
        {recipeVisibility === 'public'
          ? 'Let them know about this — it’s already public.'
          : 'They’ll be able to see, cook, and remix this.'}
      </p>
      <input
        type="email" placeholder="Their email" value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="field mb-2.5"
      />
      <input
        type="text" placeholder="Add the part they always forget… (optional)" value={note}
        onChange={(e) => setNote(e.target.value)}
        className="field mb-3"
      />
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
      <button
        onClick={send} disabled={!email.trim() || sending}
        className="btn-primary disabled:opacity-50"
      >
        {sending ? 'Sending…' : 'Pass it on'}
      </button>
      <button onClick={onSkip} className="block w-full mt-3 font-serif italic text-ink-soft text-sm">
        Skip for now
      </button>
    </div>
  )
}
