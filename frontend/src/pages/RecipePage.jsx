import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import client, { toUserMessage } from '../api/client'
import { deleteRecipe, keepRecipe, unkeepRecipe } from '../api/sharing'
import { getUserProfile } from '../api/friends'
import VisibilityControl from '../components/VisibilityControl'
import RecipeBody from '../components/RecipeBody'
import SafetyMenu from '../components/SafetyMenu'
import PassItOn from '../components/PassItOn'
import Icon from '../components/Icon'
import Loader from '../components/Loader'

// RecipePage — the classic recipe detail page (kitchen, not garden). Loads the
// recipe and renders a centered Fraunces title, the readable body (cover, byline,
// story, ingredients + steps via <RecipeBody>), and — for the owner — the
// visibility control and a handoff button. No plant hero, no growth, no soul
// sheet: the recipe is a recipe.
//
// The handoff button used to read "Pass it on", which testers couldn't decode and
// several read as publishing. It now says what tapping it produces.
//
// It carried an italic sub-line ruling out the publish fear ("It doesn't change
// who else can see it"). Together with the visibility prose and the delete
// button, the bottom of the page turned into paragraphs with buttons embedded in
// them. The reassurance isn't lost: HandoffInvite — the very next screen, before
// any link exists — states it outright ("This doesn't put your recipe in
// Browse"), which is where it's actually load-bearing.
export default function RecipePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [recipe, setRecipe] = useState(null)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Keeping a recipe that isn't yours (#57). Seeded from the recipe's own kept_by_me,
  // which the single-recipe read populates for the caller only.
  const [kept, setKept] = useState(false)
  const [keeping, setKeeping] = useState(false)
  // Its own error slot: `error` swaps the whole page for a not-found screen, which would
  // be a wild overreaction to a failed bookmark.
  const [keepError, setKeepError] = useState('')

  useEffect(() => {
    client
      .get(`/recipes/${id}`)
      .then((res) => {
        setRecipe(res.data)
        setKept(Boolean(res.data.kept_by_me))
      })
      .catch(() => setError('Recipe not found'))
  }, [id])

  // Keep / stop keeping. Optimistic-free on purpose: the button reflects the server's
  // answer, because "is this on my shelf" is the one thing the user is asking about.
  async function toggleKeep() {
    if (keeping) return
    setKeeping(true)
    setKeepError('')
    try {
      if (kept) {
        await unkeepRecipe(id)
        setKept(false)
      } else {
        await keepRecipe(id)
        setKept(true)
      }
    } catch (err) {
      // Through toUserMessage, per CLAUDE.md — a router's deliberate `detail` passes
      // through untouched. A flat "try again" was wrong twice over: the 404 you get when
      // the cook made the recipe private mid-page invites a retry that can never succeed,
      // and the router's "This one is already yours" was never shown.
      setKeepError(
        toUserMessage(
          err,
          err?.response?.status === 404
            ? 'This recipe isn’t available any more — whoever shared it changed who can see it, or removed it.'
            : 'Could not update your kitchen. Please try again.',
        ),
      )
    } finally {
      setKeeping(false)
    }
  }

  const currentUser = JSON.parse(localStorage.getItem('issei_user') || '{}')
  // String-compare the ids, matching PostCard / PostPage / UserProfile. The cached
  // issei_user is JSON from localStorage, so a stored id could be a string while the
  // API's is a number — an uncoerced === would then hide the owner's own edit,
  // visibility, handoff and delete controls from them.
  const isOwner = recipe && String(currentUser.id) === String(recipe.user_id)

  // The cook's first name, for the safety menu at the bottom and nothing else. Fetched rather than
  // read off the recipe — see the note where SafetyMenu renders. Failure is SILENT AND NON-FATAL:
  // the menu still renders without it, offering Report (which names the recipe) and not Block
  // (which cannot be offered without naming a person). That matters because the thing that
  // actually makes this fetch fail is a BLOCK — `GET /friends/profile/{id}` 404s across one, while
  // an accepted handoff grant survives it (#85), so the blocked cook's recipe is still open in
  // front of you. Hiding the menu there made the block cover for the person who earned it.
  const [cookName, setCookName] = useState('')
  useEffect(() => {
    if (!recipe || isOwner) return
    let cancelled = false
    getUserProfile(recipe.user_id)
      .then(({ data }) => {
        if (!cancelled) setCookName(data?.first_name || '')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [recipe, isOwner])

  async function handleDelete() {
    if (deleting) return
    setDeleting(true)
    try {
      await deleteRecipe(id)
      navigate('/my-recipes')
    } catch {
      setError('Could not delete this recipe. Please try again.')
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (error) {
    return (
      <div className="min-h-screen bg-cream flex flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="error-pill">{error}</span>
        <button
          onClick={() => navigate('/my-recipes')}
          className="font-display font-bold text-[13px] text-terra"
        >
          Back to your kitchen →
        </button>
      </div>
    )
  }

  if (!recipe) {
    return <Loader />
  }

  return (
    <div className="min-h-screen bg-cream">
      {/* HEADER — circular back button, owner edit affordance, centered title. */}
      <header className="px-5 pt-4 pb-1">
        <div className="flex items-center justify-between mb-2.5">
          <button
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="inline-flex items-center justify-center w-10 h-10 rounded-full border-2 border-ink bg-cream text-ink shadow-[0_3px_0_#2E3A24] active:translate-y-[2px] active:shadow-[0_1px_0_#2E3A24] transition-transform"
          >
            <Icon name="back" className="w-5 h-5" />
          </button>
          {isOwner && (
            <button
              onClick={() => navigate(`/recipes/${recipe.id}/edit`)}
              aria-label="Edit recipe"
              className="inline-flex items-center justify-center w-10 h-10 rounded-full border-2 border-ink bg-cream text-ink shadow-[0_3px_0_#2E3A24] active:translate-y-[2px] active:shadow-[0_1px_0_#2E3A24] transition-transform"
            >
              <Icon name="edit" className="w-5 h-5" />
            </button>
          )}
        </div>

        <h1 className="font-display font-black text-[34px] leading-[1.0] tracking-[-0.01em] text-ink text-center">
          {recipe.name}
        </h1>
      </header>

      {/* BODY — cover, byline, story, ingredients + steps (with cooking mode). */}
      <div className="px-5 pb-8">
        <RecipeBody recipe={recipe} scalable />

        {/* SOMEONE ELSE'S RECIPE. Only for a non-owner — your own recipes are already in your
            kitchen. Two controls, in escalation order:

            KEEP (#57) is a bookmark: this stays the cook's recipe, so there is no "edit" here and
            never will be. Kept recipes live in the Kitchen's Kept tab.

            PASS IT ON (#78) hands on the COOK'S recipe rather than a copy of it — which is why it
            sits second. Keep is for you; this creates access for somebody else. (This comment said
            "there is no edit or pass it on here" until #78 shipped the latter; the edit half is
            still true.) */}
        {!isOwner && (
          <div className="mt-8">
            <button
              onClick={toggleKeep}
              disabled={keeping}
              aria-pressed={kept}
              className={`w-full inline-flex items-center justify-center gap-2 font-display font-bold text-[15px] rounded-full px-3.5 py-3 border-[2.5px] border-ink shadow-[0_4px_0_#2E3A24] active:translate-y-[3px] active:shadow-[0_1px_0_#2E3A24] transition-transform disabled:opacity-50 ${
                kept ? 'bg-sage text-ink' : 'bg-terra text-cream'
              }`}
            >
              {keeping ? '…' : kept ? 'Kept ✓' : 'Keep this recipe'}
            </button>
            <p className="font-display italic text-[12.5px] text-ink-soft text-center mt-2">
              {kept
                ? 'It’s in your kitchen, under Kept.'
                : 'Keeps it in your kitchen. It stays their recipe.'}
            </p>
            {keepError && (
              <p className="mt-2 text-center">
                <span className="error-pill">{keepError}</span>
              </p>
            )}

            {/* PASS IT ON (#78) — the other half of keeping, and the thing a satisfied recipient
                most often wants next: Lola's adobo reached you and your sibling asks for it.
                Placed UNDER Keep deliberately. Keep is the low-commitment act (a bookmark, for
                you) and this one creates access for somebody else, so the more consequential
                control sits second — the same escalation ordering as report-above-block in
                `SafetyMenu`. It is a SIBLING of the Keep block rather than inside it: you do not
                have to keep a recipe to pass it on, and nesting would imply you did. */}
            <PassItOn
              recipeId={recipe.id}
              state={recipe.pass_on_state}
              cookName={cookName}
              recipeName={recipe.name}
            />
          </div>
        )}

        {/* OWNER SURFACES — who can see it, and passing it on to the next hand. */}
        {isOwner && (
          <div className="mt-8">
            {/* How many people keep this (#96) — THE COOK'S ALONE. `keeper_count` is null for
                every other viewer, so there is no number for anyone else to render, and there
                is no keeper list anywhere: how many, never who.

                Hidden at zero, like the ask count. "0 people keep this" under your own recipe
                is the discouraging line the private count exists to avoid — and it's the
                default state for every recipe ever written. */}
            {recipe.keeper_count > 0 && (
              <p className="font-display font-bold text-[13.5px] text-terra mb-3">
                {recipe.keeper_count === 1
                  ? '1 person keeps this in their kitchen'
                  : `${recipe.keeper_count} people keep this in their kitchen`}
              </p>
            )}
            <VisibilityControl
              recipe={recipe}
              onChange={(v) => setRecipe({ ...recipe, visibility: v })}
            />

            <button
              onClick={() => navigate(`/recipes/${recipe.id}/handoff`)}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 font-display font-bold text-[15px] text-cream bg-terra rounded-full px-3.5 py-3 border-[2.5px] border-ink shadow-[0_4px_0_#2E3A24] active:translate-y-[3px] active:shadow-[0_1px_0_#2E3A24] transition-transform"
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="w-[15px] h-[15px]">
                <path
                  d="M4 12l16-7-7 16-2.5-6.5L4 12Z"
                  stroke="#FBF3E2"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
              Send this to someone
            </button>

            <button
              onClick={() => setConfirmDelete(true)}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 font-display font-bold text-[14px] text-terra bg-cream rounded-full px-3.5 py-2.5 border-2 border-ink shadow-[0_3px_0_#2E3A24] active:translate-y-[2px] active:shadow-[0_1px_0_#2E3A24] transition-transform"
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="w-[15px] h-[15px]">
                <path
                  d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6"
                  stroke="#B5502A"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Delete recipe
            </button>
          </div>
        )}
      </div>

      {/* DELETE CONFIRM — a sticker dialog; delete is permanent from the user's
          view (soft-deleted server-side, but there's no un-delete UI). */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-ink/30 flex items-center justify-center z-50 px-6">
          <div className="sticker bg-cream p-5 max-w-xs w-full text-center">
            <p className="font-display font-black text-ink text-[20px] leading-tight">
              Delete {recipe.name}?
            </p>
            <p className="font-display text-[13px] text-ink-soft mt-1.5 mb-4">
              This removes it from your kitchen. You can&rsquo;t undo this.
            </p>
            <div className="flex gap-2.5">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="flex-1 rounded-full bg-cream border-2 border-ink text-ink font-display font-bold text-[14px] py-2.5 shadow-[0_3px_0_#2E3A24] active:translate-y-[2px] active:shadow-[0_1px_0_#2E3A24] transition-transform disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 rounded-full bg-brick border-2 border-ink text-cream font-display font-bold text-[14px] py-2.5 shadow-[0_3px_0_#2E3A24] active:translate-y-[2px] active:shadow-[0_1px_0_#2E3A24] transition-transform disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REPORT THIS RECIPE (#87 part two) — non-owner only, bottom of the page, behind a ⋯. Same
          shape and the same reasons as the meal page; see `components/SafetyMenu`.

          THE COOK'S NAME IS FETCHED, not read off the recipe, and that is worth knowing before
          "simplifying" it. `RecipeResponse` carries `user_id` but no author name — `origin_attribution`
          is the BYLINE ("from Lola"), which is whoever the dish came from and frequently not the
          account holder at all, so using it here would name the wrong person on a safety control.
          Adding an author name to `RecipeResponse` would mean populating it in every path that
          serialises a recipe (get, browse, kept, profile grids), so this asks the one route that
          already answers "who is this person" instead. Only for a non-owner, so the owner's own
          recipe page makes no extra call.

          THE NAME IS NOT REQUIRED FOR THE MENU TO RENDER, and that reversal is the point. The locked
          rule is that a control must not be tappable without knowing who it lands on — which binds
          BLOCK, not report-a-recipe. So an absent name suppresses the block item only. Gating the
          whole menu on it (the first version) meant a cook could hand you a recipe, harass you,
          block you, and become unreportable from the one surface a block leaves open. */}
      {/* WRAPPED, because this sits OUTSIDE the page's padded body (`px-5 pb-8`, which closes above
          the owner-only panels) and the root div has no horizontal or bottom padding of its own. A
          ship gate caught the unwrapped version: every open panel rendered full-bleed with its 2px
          ink outline flush to both viewport edges and the select/textarea touching the screen sides,
          and with zero bottom padding the ⋯ was the last ~32px of the document — underneath
          `BottomNav`, which is `fixed bottom-0` and centred exactly like it. The control added to
          make reporting reachable would have been hidden by the nav pill. `PostPage` never had this
          because its root already carries `px-5 pt-4 pb-10`.

          No test in the suite can see either problem: jsdom has no layout engine. */}
      {!isOwner && (
        <div className="px-5 pb-10">
          <SafetyMenu
            userId={recipe.user_id}
            personName={cookName}
            subject={{ recipe_id: recipe.id }}
            subjectLabel="this recipe"
            onBlocked={() => navigate('/', { replace: true })}
          />
        </div>
      )}
    </div>
  )
}
