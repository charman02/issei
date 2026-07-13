import { useState } from 'react'
import { handoffRecipe } from '../api/lineage'
import { HANDOFF_STARTERS, defaultStarterKey } from '../lib/handoffStarters'

// "Who else should have this seed?" — the pass-it-on invite (spec §4). One broad
// action; the sender's NOTE carries intent. One-tap starters pre-fill the note;
// when passing back to the recorded source, the fill-in starter is pre-selected
// (the one safe auto-touch). Remix is cut (§0.1) — copy invites cook + keep.
export default function HandoffInvite({
  recipeId,
  recipeVisibility = 'private',
  sourceName = null,
  onSent,
  onSkip,
}) {
  const seedKey = defaultStarterKey(sourceName)
  const seedNote = seedKey
    ? HANDOFF_STARTERS.find((s) => s.key === seedKey).note
    : ''
  const [email, setEmail] = useState('')
  const [note, setNote] = useState(seedNote)
  const [activeStarter, setActiveStarter] = useState(seedKey)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  function applyStarter(starter) {
    setActiveStarter(starter.key)
    setNote(starter.note)
  }

  async function send() {
    setError('')
    setSending(true)
    try {
      const { data } = await handoffRecipe(recipeId, {
        to_email: email.trim(),
        note: note.trim() || null,
      })
      onSent?.(data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not send. Try again.')
      setSending(false)
    }
  }

  return (
    <div className="px-[18px] py-6 text-center">
      <h1 className="font-serif font-black text-[24px] text-ink leading-tight">
        Who else should
        <br />
        have this seed?
      </h1>
      <p className="font-serif italic text-[14px] text-ink-soft mt-2 mb-5">
        {recipeVisibility === 'public'
          ? 'Let them know about this — it’s already public.'
          : 'They’ll be able to cook it and keep it — and add the parts only they know.'}
      </p>
      <input
        type="email"
        placeholder="Their email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="field mb-3"
      />
      <div className="flex gap-2 mb-2.5">
        {HANDOFF_STARTERS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => applyStarter(s)}
            aria-pressed={activeStarter === s.key}
            className={`flex-1 text-[12.5px] font-sans rounded-full px-3 py-2 border transition-colors ${
              activeStarter === s.key
                ? 'border-terra bg-terra/10 text-terra'
                : 'border-line text-ink-soft'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <textarea
        placeholder="A note in your words… (optional)"
        value={note}
        onChange={(e) => {
          setNote(e.target.value)
          setActiveStarter(null)
        }}
        rows={2}
        className="field resize-none mb-3"
      />
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
      <button
        onClick={send}
        disabled={!email.trim() || sending}
        className="btn-primary disabled:opacity-50"
      >
        {sending ? 'Sending…' : 'Pass it on'}
      </button>
      <button
        onClick={onSkip}
        className="block w-full mt-3 font-serif italic text-ink-soft text-sm"
      >
        Skip for now
      </button>
    </div>
  )
}
