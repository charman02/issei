import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import RecipeForm from '../components/RecipeForm'
import PasteRecipe from '../components/PasteRecipe'
import HandoffInvite from '../components/HandoffInvite'
import SaveCelebration from '../components/SaveCelebration'
import BackButton from '../components/BackButton'
import VisibilityChoice from '../components/VisibilityChoice'
import { plantRecipe } from '../api/sharing'
import { fulfillPost } from '../api/posts'

// The add-a-recipe flow (route /add): choose a door (fill it in, or paste the
// whole thing) → the form → a "saved" confirmation → an optional hand-off.
//
// TWO doors only. The old flow forked on "passed down to you vs. one of your
// own", which decided whether the form even asked who the recipe came from.
// That question is now a single optional field on the form itself (RecipeForm's
// "Passed down from"), so the doorway no longer has to make the call — it just
// picks HOW you enter the recipe. Pasting stays a separate door because a parser
// can be confidently wrong, and someone who hit that unasked would think the app
// was broken. See PasteRecipe + lib/parseRecipeText.
export default function PlantRecipe() {
  const navigate = useNavigate()
  const location = useLocation()
  // Entered mid-post from the composer (#81): "you just cooked something you've never
  // written down". The draft rides along in router state so the post survives the detour,
  // and on save we go BACK to it with the new recipe attached instead of running the
  // celebrate/handoff tail — the user is in the middle of something else.
  const postDraft = location.state?.postDraft || null
  // A recipe already attached to the post before this detour. Carried so backing out hands
  // it back instead of silently dropping the attachment.
  const alreadyAttached = location.state?.attachRecipe || null
  // Set when the flow was entered from the cook's requests page (#79): the post whose asks
  // this recipe answers. On save we fulfil it, which mints a handoff grant per requester —
  // so a recipe saved as PRIVATE still reaches the people who asked, without going public.
  const fulfillPostId = location.state?.fulfillPostId || null
  // No doorway step any more: /add already chose "Write a recipe", so we land straight
  // on the say/paste screen (the one signature way in). The old blank-form door lives
  // on as a "Rather fill in the form?" link at the bottom of that screen.
  const [step, setStep] = useState('paste') // paste|form|celebrate|saved|handoff
  // What a paste produced, mapped into RecipeForm's initialValues shape. Held here
  // rather than passed through navigation so a back-and-forth doesn't lose it.
  const [seeded, setSeeded] = useState(null)
  // The raw pasted text, kept so back-from-the-form returns to it intact.
  const [pastedText, setPastedText] = useState('')
  // Concrete visibility (#68). The default the form auto-selects mirrors the author's
  // profile — "Everyone" on a public profile, "Friends only" on a private one — but the
  // chosen value is stored literally, not as a live pointer to the profile. The user can
  // pick any of the three in VisibilityChoice, always shown at save time.
  const profileVisibility =
    JSON.parse(localStorage.getItem('issei_user') || '{}').profile_visibility ||
    'private'
  const [visibility, setVisibility] = useState(
    // Mid-post, start from what the author already chose for the post — same dish, same
    // moment, same audience intent. Still shown in VisibilityChoice and still stored
    // literally, so this is a starting point, not a link to the post's value.
    postDraft?.visibility || (profileVisibility === 'public' ? 'public' : 'friends'),
  )
  const [saved, setSaved] = useState(null)

  // Step-aware back. The say/paste screen is now the entry point, so its back exits to
  // the /add chooser. The form goes back to PASTE when a parse seeded it (so correcting
  // the source text is possible without losing the parse); a blank form reached via
  // "Rather fill in the form?" goes back to the paste screen too.
  function goBack() {
    if (step === 'form') setStep('paste')
    // Answering an ask came from /requests, not from a composer. Sending this draft to
    // /add/meal would pre-fill a NEW post with the photo, name, description and visibility
    // of the meal that is already published — one tap from a duplicate.
    else if (fulfillPostId) navigate('/requests')
    else if (postDraft)
      navigate('/add/meal', { state: { postDraft, attachRecipe: alreadyAttached } })
    else navigate('/add')
  }

  // "Rather fill in the form?" — the demoted blank-form door, offered at the bottom of the
  // say/paste screen for someone with nothing to paste (the paste word-gate would
  // otherwise strand them).
  function typeItIn() {
    setSeeded(null)
    setStep('form')
  }

  // A parse lands on the ordinary form, pre-filled. Nothing is saved here — either
  // parser is allowed to be wrong, and the form is where that gets corrected.
  //
  // Handles both parsers' output. The local one returns steps as plain strings; the
  // model returns objects carrying a note ("don't crowd the pan"), which becomes the
  // step's voice_note — the field that exists precisely for the remark an ingredient
  // list can't hold. The model also picks out who the recipe came from, which now
  // seeds the form's own "Passed down from" field.
  function handleParsed(parsed, sourceText) {
    setPastedText(sourceText)
    setSeeded({
      name: parsed.name,
      description: parsed.description || undefined,
      cuisine: parsed.cuisine || undefined,
      servings: parsed.servings || undefined,
      sourceName: parsed.sourceName || '',
      ingredients: parsed.ingredients.length
        ? parsed.ingredients.map((i) => ({ name: i.name, quantity: i.amount }))
        : undefined,
      steps: parsed.steps.length
        ? parsed.steps.map((s) =>
            typeof s === 'string'
              ? { content: s, voice_note: '', photo_url: '' }
              : { content: s.content, voice_note: s.note || '', photo_url: '' },
          )
        : undefined,
      guessedLines: parsed.guessedLines,
      usedHeaders: parsed.usedHeaders,
      viaAI: Boolean(parsed.viaAI),
    })
    setStep('form')
  }

  // Save with the dish name alone. Same endpoint and the same visibility choice as a
  // full save — this is a smaller recipe, not a different kind of thing. No origin:
  // the name-only escape hatch is offered before the source field is filled.
  async function handleQuickSave(dishName, { coverPhotoUrl } = {}) {
    const { data } = await plantRecipe({
      name: dishName,
      visibility,
      // The cover comes from the FORM's live value, which the mid-post seed pre-filled with
      // the post's photo. Reading the draft directly here instead meant a cover the user had
      // just removed reappeared on save.
      ...(coverPhotoUrl ? { cover_photo_url: coverPhotoUrl } : {}),
    })
    finish(data)
  }

  // The form builds its own payload, including the optional origin from its
  // "Passed down from" field. This handler just adds visibility and posts.
  async function handleFormSubmit(formPayload) {
    const { data } = await plantRecipe({ ...formPayload, visibility })
    finish(data)
  }

  // What the post already knows, handed to the form so nothing is typed twice — the
  // "zero re-entry" the social-feed design specifies (docs/SOCIAL_FEED_DESIGN.md): the post's
  // dish name becomes the recipe name, its description the description, its photo the cover.
  // The post's description field is deliberately worded as a DISH description for exactly
  // this reason. A parse wins over all of it: `seeded` values overwrite these, but only where
  // the parser actually produced one — a plain spread would blank a real draft value with the
  // parser's `undefined`.
  const draftSeed = postDraft
    ? {
        name: postDraft.dish_name?.trim() || undefined,
        description: postDraft.description?.trim() || undefined,
        coverPhotoUrl: postDraft.photo_url || undefined,
      }
    : {}
  const formInitial = { ...draftSeed }
  for (const [k, v] of Object.entries(seeded || {})) {
    if (v !== undefined) formInitial[k] = v
  }

  // Where a save lands. Standalone: the celebration, then the optional hand-off. Mid-post:
  // straight back to the composer with the recipe attached — the celebration would be
  // claiming the act is finished when the post still isn't shared. The recipe is saved
  // either way before this runs, so abandoning the post never loses it.
  async function finish(data) {
    if (fulfillPostId) {
      // Deliver to everyone who asked, then show them on the requests page. A failure here
      // must not look like the recipe wasn't saved — it was; only the delivery didn't land,
      // and the cook can retry with "Attach one".
      let delivered = true
      try {
        await fulfillPost(fulfillPostId, data.id)
      } catch {
        // The recipe IS saved, so this must not read as data loss — but silence was worse:
        // the cook landed on an unchanged list with no error, which reads as "the save
        // didn't take", and the obvious recovery is to write the whole recipe again. Say it.
        delivered = false
      }
      navigate('/requests', {
        state: delivered ? undefined : { deliveryFailed: data.name || true },
      })
      return
    }
    if (postDraft) {
      navigate('/add/meal', { state: { postDraft, attachRecipe: data } })
      return
    }
    setSaved(data)
    setStep('celebrate')
  }

  if (step === 'paste') {
    return (
      <PasteRecipe
        initialText={pastedText}
        onParsed={handleParsed}
        onBack={goBack}
        onTypeItIn={typeItIn}
        // Said on the FIRST screen, not just the form: the live run showed you land here
        // with no sign your meal survived the tap, which is the one thing you'd worry about.
        note={
          // Only for the mid-post flow (#81). In the fulfil flow (#79) the meal is already
          // shared and saving returns to /requests, so both halves of this would be false.
          postDraft && !fulfillPostId
            ? 'Your meal is still waiting — saving brings you back to it, recipe attached.'
            : fulfillPostId
              ? 'Saving sends this to everyone who asked.'
              : null
        }
      />
    )
  }

  if (step === 'form') {
    return (
      <div className="min-h-screen bg-cream">
        <RecipeForm
          mode="add"
          onSubmit={handleFormSubmit}
          onQuickSave={handleQuickSave}
          initialValues={formInitial}
          topSlot={<BackButton onClick={goBack} label="Back" />}
          // Sits just above "Save this recipe" — the last thing you decide before
          // saving, and no extra step in a flow testers already found effortful.
          beforeSubmitSlot={
            <VisibilityChoice value={visibility} onChange={setVisibility} />
          }
          intro={
            seeded ? (
              /* After a paste, the form's job changes from "fill this in" to "check
                 this". Saying HOW MANY lines were guessed — rather than a vague
                 "review your recipe" — tells someone where to actually look, and
                 admits the parser might be wrong instead of presenting its output as
                 fact. A paste that used the author's own Ingredients:/Instructions:
                 headers guessed nothing, so it says that instead. */
              <div className="sticker bg-peach px-4 py-3 -mt-1 mb-4">
                <p className="font-display font-bold text-[14px] text-ink leading-snug">
                  {seeded.viaAI
                    ? 'Sorted out what you said.'
                    : seeded.usedHeaders
                      ? 'Sorted using your own headings.'
                      : `Sorted ${seeded.guessedLines} ${
                          seeded.guessedLines === 1 ? 'line' : 'lines'
                        } as best we could.`}
                </p>
                <p className="font-display italic text-[13px] text-ink-soft mt-1 leading-snug">
                  Fix anything that landed in the wrong place — nothing is saved yet.
                </p>
              </div>
            ) : (
              <p className="font-display italic text-[14px] text-ink-soft -mt-2 mb-4">
                Add what you&rsquo;ve got — &ldquo;a splash of vinegar&rdquo; is
                perfect. Only the dish name is required.
                {postDraft &&
                  !fulfillPostId &&
                  ' Saving brings you back to your meal, recipe attached.'}
                {fulfillPostId && ' Saving sends it to everyone who asked.'}
              </p>
            )
          }
        />
      </div>
    )
  }

  if (step === 'celebrate') {
    // The recipe is already saved (the handlers posted before setting this step),
    // so this is pure celebration over the top. Its reveal IS the terminal "saved"
    // screen: the cloud parts to show a checkmark, the recipe card (tap → view it),
    // and a share button. Reduced motion renders that reveal on the first frame, so
    // both actions are always one tap away. Guard `saved` defensively.
    if (!saved) return null
    return (
      <SaveCelebration
        recipe={saved}
        onView={() => navigate(`/recipes/${saved.id}`)}
        onShare={() => setStep('handoff')}
      />
    )
  }

  // step === 'handoff' — only reachable after a successful save, but guard
  // `saved` defensively to match the optional-chaining used elsewhere.
  if (!saved) return null
  return (
    <div className="min-h-screen bg-cream">
      {/* recipeVisibility is NOT optional here in practice. Without it HandoffInvite falls back to
          its 'private' default and tells the sender "only someone with the link can open it" — on a
          recipe they may have just published to Browse. `saved` is the POST response, so it carries
          the value the server actually stored. */}
      <HandoffInvite
        recipeId={saved.id}
        recipeName={saved.name}
        recipeVisibility={saved.visibility}
        onSent={() => navigate(`/recipes/${saved.id}`)}
        onSkip={() => navigate(`/recipes/${saved.id}`)}
      />
    </div>
  )
}
