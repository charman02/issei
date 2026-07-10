import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getInvitePreview } from '../api/lineage'
import Plant from '../components/Plant'
import { stageForRecipe, vitalityForRecipe } from '../lib/growth'
import Wordmark from '../components/Wordmark'

// The soft-wall recipient landing (spec §4.3): a warm preview — name, who it's
// from, the story, the growth plant — then a signup gate to participate. The
// emotional hook lands BEFORE the ask. Public route; no account required to view.
export default function InviteLanding() {
  const { token } = useParams()
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    getInvitePreview(token)
      .then(({ data }) => { if (live) setPreview(data) })
      .catch(() => { if (live) setError('This invite link is not valid or has expired.') })
    return () => { live = false }
  }, [token])

  if (error) {
    return (
      <div className="min-h-screen bg-paper flex flex-col items-center justify-center px-6 text-center">
        <p className="font-serif italic text-ink-soft">{error}</p>
        <Link to="/login" className="btn-primary mt-5 inline-block">Go to issei</Link>
      </div>
    )
  }
  if (!preview) {
    return <div className="min-h-screen bg-paper flex items-center justify-center"><p className="font-serif italic text-ink-soft">Opening…</p></div>
  }

  return (
    <div className="min-h-screen bg-paper flex flex-col items-center px-6 py-12 text-center">
      <Wordmark className="text-[40px] mb-6" />
      <Plant stage={stageForRecipe(preview)} vitality={vitalityForRecipe(preview)} size={72} />
      {preview.from_name && (
        <p className="font-sans text-[11px] tracking-[0.18em] uppercase text-herb mt-4 mb-1">
          {preview.from_name} passed you
        </p>
      )}
      <h1 className="font-serif font-black text-[28px] text-ink leading-tight">{preview.name}</h1>
      {preview.origin_attribution && (
        <p className="font-serif italic text-[14px] text-ink-soft mt-1">🌱 {preview.origin_attribution.split('·')[0].trim()}</p>
      )}
      {preview.story && (
        <p className="font-serif italic text-[15px] text-ink-soft mt-5 max-w-sm leading-relaxed">{preview.story}</p>
      )}
      <div className="mt-8 w-full max-w-sm">
        <Link to={`/login?tab=signup&invite=${token}`} className="btn-primary block">
          Keep this recipe — join the table
        </Link>
        <p className="font-sans text-[12px] text-ink-soft mt-3">
          Make a free account to cook it, keep it, and add the parts only you know.
        </p>
      </div>
    </div>
  )
}
