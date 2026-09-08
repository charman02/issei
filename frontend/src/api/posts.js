import client from './client'

// The presence feed (social feed Phase 1). A post is a light "meal I made" —
// photo + dish name + optional line — not a recipe.
export const createPost = (payload) => client.post('/posts', payload)
// The presence feed, newest first. Keyset cursor on id: pass the last post's id to page
// backward. id DESC is reverse-chronological (ids are monotonic and posts aren't
// backdated), so this can't skip or repeat a post at a boundary.
// scope: 'friends' (default — your friends' + own posts) or 'everyone' (public posts from
// non-friends, #70). Omitted → the backend's 'friends' default.
export const getFeed = (beforeId, scope) =>
  client.get('/posts/feed', {
    params: {
      ...(beforeId ? { before_id: beforeId } : {}),
      ...(scope ? { scope } : {}),
    },
  })
// Advance the feed read-mark (#97). `throughPostId` is the NEWEST post the client actually
// received, so the mark lands on that post's timestamp rather than on now() — otherwise a post
// that arrives while the feed is on screen gets silently marked seen. Forward-only server-side,
// so a retry or a second tab can never rewind it. Marking seen HIDES NOTHING; it only stops
// those posts being flagged as new next time.
export const markFeedSeen = (throughPostId) =>
  client.post('/posts/feed/seen', { through_post_id: throughPostId ?? null })

export const getPost = (id) => client.get(`/posts/${id}`)
// Public posts for Browse discovery (#71). Returns every public post (newest first);
// Browse filters/searches client-side, same shape as GET /recipes/browse. Backend scopes
// to visibility == 'public', so this never returns a friends/private post.
export const browsePosts = () => client.get('/posts/browse')
export const deletePost = (id) => client.delete(`/posts/${id}`)
export const getUserPosts = (userId) => client.get(`/posts/users/${userId}`)
// Recipe requests (#79) — the app's premise as a mechanic: you tasted it and asked for it.
// Allowed for anyone who can already SEE the post (not friends-only), and only where the
// caller can't currently read a recipe for it. Each returns the updated post, so the button
// re-renders from the server's answer rather than a guess.
export const requestRecipe = (postId) => client.post(`/posts/${postId}/request`)
export const retractRequest = (postId) => client.delete(`/posts/${postId}/request`)
// The COOK's surface: their own posts that have pending asks, plus who asked. Nobody else
// can see either the names or the count (PostResponse.request_count is null for non-authors).
export const getIncomingRequests = () => client.get('/posts/requests/incoming')
// Answer the asks on your own post with one of your recipes. Mints a handoff grant per
// requester, so a PRIVATE recipe is delivered without its visibility changing.
export const fulfillPost = (postId, recipeId) =>
  client.post(`/posts/${postId}/fulfill`, { recipe_id: recipeId })
