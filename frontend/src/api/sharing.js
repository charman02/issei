import client from './client'

// Recipe writes plus the sharing surface — the handoff and the invite a recipient
// claims. Was api/lineage.js: the tree it was named for is gone, but these calls
// are the app's actual signature (one recipe, handed to one person), so they were
// renamed rather than removed.
export const plantRecipe = (payload) => client.post('/recipes', payload)
export const deleteRecipe = (id) => client.delete(`/recipes/${id}`)
export const cookRecipe = (id, body = {}) =>
  client.post(`/recipes/${id}/cook`, body)
export const handoffRecipe = (id, body) =>
  client.post(`/recipes/${id}/handoff`, body)
export const setVisibility = (id, visibility) =>
  client.patch(`/recipes/${id}`, { visibility })
// Structure whatever someone said about a recipe into fields. Saves nothing; the
// response carries `ai: false` when the model was unavailable, which is the caller's
// signal to fall back to the local line-based parser rather than trust an empty result.
export const parseRecipeWithAI = (text) => client.post('/recipes/parse', { text })

// Rescale a recipe to a target serving count. Returns the full recipe with its
// ingredient amounts scaled — precise ones by arithmetic, folk/imprecise ones only
// when the result is still a whole vessel, and non-linear ones kept verbatim with a
// `scale_note` (×N) for the cook to apply by feel. Saves nothing; the recipe's own
// stored amounts are never touched.
export const scaleRecipe = (id, servings) =>
  client.get(`/recipes/${id}/scale`, { params: { servings } })

export const getSharedWithMe = () => client.get('/recipes/shared')

// Keeping a recipe you did not write (#57) — a bookmark, not a copy. There is still one
// recipe (the cook's), so keeping stores only that you keep it: the byline stays theirs,
// their later corrections reach you, and if they restrict or delete it your access ends.
// You can only keep what you can already read; the server 404s otherwise.
export const keepRecipe = (id) => client.post(`/recipes/${id}/save`)
export const unkeepRecipe = (id) => client.delete(`/recipes/${id}/save`)
// The Kept shelf: recipes handed to you AND ones you kept, merged server-side (so
// un-keeping can never hide a gift). Returns { recipes, unreachable_count } — the count
// is how many you can no longer open, as a bare number, never a name.
export const getKept = () => client.get('/recipes/kept')
// A user's recipes for their profile grid (#69). Visibility-gated server-side by
// can_view: own → all; friend → public + friends; stranger → public only. Never a
// private or individually-handed-off recipe. Pairs with getUserPosts in api/posts.js.
export const getUserRecipes = (userId) => client.get(`/recipes/users/${userId}`)

// PASSING A RECIPE ON that you did not write (#78). A `public` recipe needs none of this — the
// ordinary `handoffRecipe` works, because a public recipe is already in Browse so a link widens
// nothing. These three are for anything NARROWER, which is the cook's to widen: `GET
// /recipes/invite/{token}` serves a whole recipe with no account, so a reader minting a token for a
// `private` recipe would make it world-readable a link at a time.
//
// `requestPassOn` asks about PERMISSION, not about the recipe — the asker can already read it.
export const requestPassOn = (id) => client.post(`/recipes/${id}/pass-on-request`)
export const getPassOnRequests = () => client.get('/recipes/pass-on-requests/incoming')
// `decision` is 'approve' | 'decline'. A decline tells the asker NOTHING — no notification, and
// their button returns to its resting state — for the reason a block is silent (#85): the cook said
// no about a recipe carrying their own family's name, usually to a relative.
export const answerPassOnRequest = (id, decision) =>
  client.post(`/recipes/pass-on-requests/${id}/${decision}`)
export const getInvitePreview = (token) =>
  client.get(`/recipes/invite/${token}`)
export const claimInvite = (token) =>
  client.post(`/recipes/invite/${token}/claim`)
