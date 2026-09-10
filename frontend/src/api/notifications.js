import client from './client'

// The inbox (#79). issei had no notification surface at all before this; the request loop
// needs one on both ends — the cook learns someone asked, the requester learns it arrived.
// One generic feed rather than a counter per feature, so friend requests and accepts land
// here too and there is a single place a person looks.

// Newest first, keyset-paginated on id (ids are monotonic; rows are never backdated).
// Returns { notifications, unread_count } — the badge and the list are always wanted
// together, and the count is derived server-side so it can't drift from the rows.
export const getNotifications = (beforeId) =>
  client.get('/notifications', { params: beforeId ? { before_id: beforeId } : {} })

// Mark read — all of the caller's unread ones, or just the ids given. Always scoped to the
// caller server-side. Returns the refreshed list, so no second call to update the badge.
export const markNotificationsRead = (ids) =>
  client.post('/notifications/read', ids ? { ids } : {})

// --- Web Push (#89) -----------------------------------------------------------------------
//
// The device half of the inbox: these three put a NOTIFICATION ON A LOCKED PHONE, which the
// routes above never could. Called from `lib/push.js`, not from components — a page shouldn't
// have to know that a subscription is three opaque strings the browser minted.
//
// The rotate route is deliberately absent from this file: it is called from inside the service
// worker with bare `fetch`, because a worker has no axios, no interceptor and no token.

// The server's public key, plus whether a keypair is configured at all. Unauthenticated.
// `configured: false` is the real answer on a deploy without secrets — subscribe against an
// empty key and the browser cheerfully mints a subscription nothing can ever deliver to.
export const getVapidKey = () => client.get('/notifications/vapid-key')

// Register THIS device. Idempotent on the browser-minted `endpoint`, so re-granting permission
// updates the row instead of adding a duplicate that would double every notification.
export const subscribePush = (subscription) =>
  client.post('/notifications/subscribe', subscription)

// Stop pushing to this device. Scoped to the caller's own row server-side.
export const unsubscribePush = (subscription) =>
  client.delete('/notifications/subscribe', { data: subscription })
