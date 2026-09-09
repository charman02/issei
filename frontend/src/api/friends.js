import client from './client'

// The friend graph (social feed Phase 0). Symmetric friends, both-accept.
export const requestFriend = (toUserId) =>
  client.post('/friends/request', { to_user_id: toUserId })
export const acceptFriend = (friendshipId) =>
  client.post(`/friends/${friendshipId}/accept`)
export const removeFriend = (friendshipId) =>
  client.delete(`/friends/${friendshipId}`)
// order: 'recent' (default — newest friendship first, the Friends page) or 'active'
// (friends who posted most recently first — the Feed's presence strip, #75).
export const getFriends = (order) =>
  client.get('/friends', { params: order ? { order } : {} })
export const getFriendRequests = () => client.get('/friends/requests')
// Seeded from the handoff graph — people you've handed a recipe to or received one
// from, who aren't already friends. The cold-start seed for the coming feed.
export const getFriendSuggestions = () => client.get('/friends/suggestions')
// Everyone else on the app, so a new user can actually find someone (#80). Optional name
// search. Excludes you, your friends, and anyone with a pending request either way — all
// cases where "Add" would be wrong. Distinct from getFriendSuggestions, which is the
// handoff graph (a much stronger signal, so it stays pinned above this).
export const discoverPeople = (q) =>
  client.get('/friends/discover', { params: q ? { q } : {} })
export const getUserProfile = (userId) => client.get(`/friends/profile/${userId}`)
// Blocking (#85). issei had no block, mute or report at all before this, and #79 opened
// recipe requests to any signed-in stranger on a public post — so unfriending was the only
// lever and it stopped neither discovery nor asking.
//
// A block is MUTUALLY invisible: neither sees the other in the directory, Browse, the
// everyone-feed or on each other's profile. It also deletes the friendship (unblocking does
// NOT restore it) and clears pending recipe-asks both ways. It deliberately does NOT revoke a
// recipe you already handed them.
export const blockUser = (userId) => client.post('/friends/blocks', { user_id: userId })
export const unblockUser = (userId) => client.delete(`/friends/blocks/${userId}`)
// Only people YOU have blocked — never who has blocked you. This list is the ONLY way to
// unblock: once blocked, their profile 404s, so the control can't live there.
export const getBlocks = () => client.get('/friends/blocks')

// Reporting (#87) — the other half of blocking, and a different act. A block is something you
// do FOR YOURSELF and it takes effect instantly; a report goes to whoever runs the app and takes
// effect when a human looks. Only having the block leaves someone free to move on to the next
// person. It's also required to ship an app with user content to the App Store.
//
// `reason` is one of harassment | spam | inappropriate | impersonation | other; `note` is the
// reporter's own words and optional. Answers 204 — the reported person is never told, and the
// caller can't tell a first report from a duplicate (deliberate: "you already reported them"
// makes someone doubt the first one landed). NOT gated on blocking in either direction, so you
// can still report someone who has blocked you.
export const reportUser = (userId, reason, note) =>
  client.post('/friends/reports', { user_id: userId, reason, note: note || null })
