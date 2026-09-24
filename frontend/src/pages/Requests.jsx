import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { getIncomingRequests, fulfillPost } from '../api/posts'
import { getPassOnRequests, answerPassOnRequest } from '../api/sharing'
import { toUserMessage } from '../api/client'
import BackButton from '../components/BackButton'
import MarkerTitle from '../components/MarkerTitle'
import Avatar from '../components/Avatar'
import EmptyState from '../components/EmptyState'
import Loader from '../components/Loader'
import RecipePicker from '../components/RecipePicker'

const fullName = (p) => `${p.first_name} ${p.last_name}`.trim()

// The cook's asks (#79) — the only place request counts and requester names are ever shown,
// which is what keeps them out of every public surface. Reached from the You page, a post's
// own "N people asked" line, or a notification.
//
// Two ways to answer, and both end in the same server call: WRITE the recipe (hands the
// post's dish name, description and photo into the add-a-recipe flow exactly as #81 does,
// then fulfils on save) or ATTACH one already written. Fulfilling mints a handoff grant per
// requester, so a private recipe reaches the people who asked without becoming public.
export default function Requests() {
  const navigate = useNavigate()
  const location = useLocation()
  const [rows, setRows] = useState(null)
  // Seeded from the write-the-recipe flow when the recipe saved but delivery failed. Without
  // this the cook returns to an unchanged list with no explanation, which reads as "the save
  // didn't work" — and the obvious recovery is to write the whole thing again.
  const [error, setError] = useState(() => {
    const failed = location.state?.deliveryFailed
    if (!failed) return ''
    const name = typeof failed === 'string' ? `“${failed}”` : 'Your recipe'
    return `${name} is saved, but sending it didn’t go through. Use “Attach one” to try again.`
  })
  const [busyPostId, setBusyPostId] = useState(null)
  const [pickerFor, setPickerFor] = useState(null)
  // PASS-ON ASKS (#78) — a SECOND kind of ask on this screen, and a different question. The first
  // ("asked for") is somebody who wants a recipe they cannot read. This one is somebody who can
  // already read it asking whether they may hand it to a third person. Both belong here because
  // this is the cook's one answer-things screen and both are answered in a tap — but they are kept
  // in separate sections with their own headings, because folding them together would make the
  // Approve button look like it delivers a recipe, which it does not.
  const [passOn, setPassOn] = useState([])
  const [busyPassOnId, setBusyPassOnId] = useState(null)

  function load() {
    getIncomingRequests()
      .then((res) => setRows(res.data))
      .catch(() => setRows([]))
    // Independent failure: one list going down must not blank the other, so no combined catch.
    getPassOnRequests()
      .then((res) => setPassOn(res.data))
      .catch(() => setPassOn([]))
  }
  useEffect(load, [])

  // Approve or decline. Both remove the row from this list, because it is a to-do list rather than
  // a history — and a DECLINE tells the asker nothing at all, which is the server's behaviour and
  // is why there is no "declined" state to render here either.
  async function answerPassOn(id, decision) {
    setError('')
    setBusyPassOnId(id)
    try {
      await answerPassOnRequest(id, decision)
      setPassOn((rows) => rows.filter((r) => r.id !== id))
    } catch (err) {
      setError(toUserMessage(err, 'Couldn’t save that just now. Try again.'))
    } finally {
      setBusyPassOnId(null)
    }
  }

  // WRITE: reuse the mid-post authoring hand-off from #81 — same draft shape, plus the id
  // of the post to fulfil once the recipe exists.
  function writeFor(row) {
    navigate('/add/recipe', {
      state: {
        postDraft: {
          photo_url: row.post.photo_url,
          dish_name: row.post.dish_name,
          description: row.post.description || '',
          visibility: row.post.visibility,
        },
        fulfillPostId: row.post.id,
      },
    })
  }

  // ATTACH: a recipe already written answers the ask directly.
  async function attach(postId, recipe) {
    setPickerFor(null)
    setBusyPostId(postId)
    setError('')
    try {
      await fulfillPost(postId, recipe.id)
      load()
    } catch (err) {
      setError(toUserMessage(err, 'Couldn’t send that just now. Try again.'))
    } finally {
      setBusyPostId(null)
    }
  }

  if (rows === null) return <Loader />

  return (
    <div className="min-h-screen bg-cream px-5 pt-5 pb-10">
      <div className="mb-5">
        <BackButton to="/profile" label="Back" />
      </div>
      <MarkerTitle
        color="bg-saffron"
        className="font-display font-black text-[32px] text-ink leading-none"
      >
        Asked for<span className="text-terra">.</span>
      </MarkerTitle>
      <p className="font-display italic text-[15px] text-ink-soft mt-2 mb-6">
        People who want a recipe from you. Only you can see this.
      </p>

      {error && (
        <p className="mb-4">
          <span className="error-pill">{error}</span>
        </p>
      )}

      {rows.length === 0 && passOn.length === 0 ? (
        <EmptyState
          icon="🍲"
          badge="bg-peach"
          title="Nobody's asked yet"
          sub="When someone wants the recipe behind one of your meals, they'll show up here."
          className="mt-6"
        />
      ) : rows.length === 0 ? null : (
        <div className="space-y-4">
          {rows.map((row) => (
            <section key={row.post.id} className="sticker bg-card overflow-hidden">
              <div className="flex items-center gap-3 p-3">
                <img
                  src={row.post.photo_url}
                  alt=""
                  className="flex-none w-14 h-14 rounded-[10px] border-2 border-ink object-cover"
                />
                <div className="min-w-0 flex-1">
                  <h2 className="font-display font-black text-[16px] text-ink truncate">
                    {row.post.dish_name}
                  </h2>
                  <p className="font-display italic text-[12.5px] text-ink-soft">
                    {row.requesters.length === 1
                      ? '1 person asked'
                      : `${row.requesters.length} people asked`}
                  </p>
                </div>
              </div>

              {/* Who asked — names, not a bare number, because this is the one audience
                  entitled to them. Tapping opens their profile. */}
              <div className="px-3 pb-1 flex flex-wrap gap-2">
                {row.requesters.map((r) => (
                  <button
                    key={r.user_id}
                    onClick={() => navigate(`/u/${r.user_id}`)}
                    className="inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-cream pl-1 pr-2.5 py-1"
                  >
                    <Avatar name={r.first_name} photoUrl={r.photo_url} size="sm" />
                    <span className="font-display font-bold text-[12.5px] text-ink">
                      {fullName(r)}
                    </span>
                  </button>
                ))}
              </div>

              <div className="p-3 flex gap-2">
                <button
                  onClick={() => writeFor(row)}
                  disabled={busyPostId === row.post.id}
                  className="flex-1 rounded-full bg-terra text-cream border-2 border-ink px-3 py-2 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
                >
                  Write the recipe
                </button>
                <button
                  onClick={() => setPickerFor(row.post.id)}
                  disabled={busyPostId === row.post.id}
                  className="flex-1 rounded-full bg-cream text-ink border-2 border-ink px-3 py-2 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
                >
                  {busyPostId === row.post.id ? 'Sending…' : 'Attach one'}
                </button>
              </div>
            </section>
          ))}
        </div>
      )}

      {/* PASS-ON ASKS (#78). Its own heading, because it is a different question from the one
          above: these people can already READ the recipe and are asking whether they may hand it
          to somebody else. Rendered only when there are any — an empty section with a heading
          would tell every cook about a mechanism most of them will never see. */}
      {passOn.length > 0 && (
        <div className="mt-8">
          <h2 className="section-label mb-2">Asked to pass one on</h2>
          <p className="font-display italic text-[13px] text-ink-soft mb-3">
            {/* States exactly what approving does and what it does not, BEFORE the tap — the #99
                discipline. A cook must not think this hands the recipe to a stranger themselves. */}
            They can already see the recipe. Saying yes lets them send it on as a link — you
            won’t be sending anything yourself.
          </p>
          <div className="space-y-3">
            {passOn.map((req) => (
              <section key={req.id} className="sticker bg-card p-3">
                <p className="font-display font-bold text-[15px] text-ink leading-snug">
                  <span className="text-plum">{req.requester_name}</span> wants to pass on your{' '}
                  {req.recipe_name}
                </p>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => answerPassOn(req.id, 'approve')}
                    disabled={busyPassOnId === req.id}
                    className="flex-1 rounded-full bg-terra text-cream border-2 border-ink px-3 py-2 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
                  >
                    {busyPassOnId === req.id ? '…' : 'Yes, they can'}
                  </button>
                  <button
                    onClick={() => answerPassOn(req.id, 'decline')}
                    disabled={busyPassOnId === req.id}
                    className="flex-1 rounded-full bg-cream text-ink border-2 border-ink px-3 py-2 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
                  >
                    {/* "No thanks" rather than "Decline": this is a person, usually one they know,
                        and the asker is never told either way. */}
                    No thanks
                  </button>
                </div>
              </section>
            ))}
          </div>
        </div>
      )}

      {pickerFor !== null && (
        <RecipePicker
          onPick={(recipe) => attach(pickerFor, recipe)}
          onClose={() => setPickerFor(null)}
        />
      )}
    </div>
  )
}
