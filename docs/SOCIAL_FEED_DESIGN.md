# Design: "What are your friends making" — the presence feed

> **HISTORICAL DESIGN DRAFT — not a description of the current app.**
> Last reconciled with the code 2026-09-09. Phases 0, 1a, **1b and 2** have all shipped, so
> several things this file frames as open questions or proposals are long since decided in
> code: symmetric friends (not followers), whether there's a public feed (answered twice —
> #70 added a toggle, #94 removed it), and the visibility model, whose three-tier per-recipe
> sketch in "Tension 1" was **superseded by #68's** concrete `public | friends | private`
> value stored literally per item. Comments on a meal are still unbuilt (Phase 3).
>
> Read `POSITIONING.md` for what may be claimed, `README.md` for what the API does, and
> `ARCHITECTURE.md` for how it's put together. This file is kept for the reasoning — the
> tensions and the arguments that produced those decisions — not for its status lines.

## The idea (as proposed)

A BeReal-style feed of what your friends are cooking. A user posts a **photo of a
meal + the dish name** (no obligation to log the full recipe). Friends can **view**,
**comment**, and tap **"Request the recipe."** Recipe-requests — not likes — are the
primary reaction. If a post collects requests, the poster is motivated to add the
recipe *because real people asked*; if it collects none, friends still saw it, and
that quiet connection ("see what they made from afar") is itself the point.

**Explicitly no like button.** Likes optimize for popularity/virality; the request
button optimizes for *usefulness to someone you know*. Keeping likes out is a
positioning choice, not just an omission.

## Why it fits issei (not a betrayal of the product)

- issei today is a **utility you visit on purpose** (cooking, or hunting a recipe).
  It has no reason to open otherwise. This makes it a **place you check on people** —
  the thing that creates a habit — without pressuring anyone to log.
- The request button converts the lonely chore ("why log a recipe I'll cook once?")
  into **answering demand from friends**. That's the motivation the solo-logging
  model lacks.
- It's the same thesis (**food as connection between people**) in a new tense:
  the handoff was one-time and past; the feed is ongoing and present.
- It fulfills, rather than replaces, the existing handoff: **a fulfilled request is
  a handoff to everyone who asked.**

## Decisions locked (from the design review)

- **Symmetric friends**, not followers (both accept, BeReal-style) — chosen for the
  intimate, anti-virality ethos.
- **This is an EXTENSION, not a replacement. Nothing is removed from the codebase.**
  Handoffs stay (they're the "invite to a recipe *and* to the app" mechanism, and
  now also the friend-graph seed). The recipe model, add flow, invite links + OG
  preview, and Cloudinary pipeline are all reused. The feed sits on top.
- **Seed the friend graph from handoffs** — pure upside, solves cold-start, keeps the
  graph made of real relationships.
- **A Post = photo + dish name + optional description.** If the poster later makes the
  recipe in-app, all three auto-seed the recipe (name, description, photo→cover) —
  zero re-entry. Post and recipe share those three fields.
- **An in-app notification center is required** — **BUILT (#79)**: `Notification` + `services/notifications.py` + `GET /notifications`.
- **Native iOS app: later, not now.** Build web-first (see Tension 2); native is a
  later amplifier, not a prerequisite.

## The load-bearing decisions (detail)

### 1. The social graph — symmetric friends [LOCKED]
issei has **no social graph today** — this is the biggest new primitive.
- **Reciprocal friends** (both accept), BeReal-style.
- **Seed the graph from handoffs.** The people you've sent recipes to / received
  from are already a trust graph. Turning a handoff into a friend suggestion solves
  the cold-start problem *and* keeps the graph made of real relationships.

### 2. The request → fulfill loop — reuse the handoff machinery
This is the heart of the feature. Flow:
1. Post photo + dish name (no recipe yet).
2. Friend taps **Request recipe**.
3. Poster sees **"N people asked for this"** — *people*, not friends (a requester need not be one), and **only the poster sees any number**.
4. Poster adds it via the existing add flow — **pre-seeded with the dish name and
   the post's photo as the cover** (low friction, the whole point).
5. On save, it **auto-delivers to every requester** — this is a handoff grant to
   each, reusing the invite/grant system you just polished.
6. Requesters are notified — shipped copy is **"{Name} sent you {dish}."** (#79)
- Design requests to be **idempotent per user** (like handoff grants) and to
  **persist** as a "pending pull" that converts to a grant on fulfillment.

### 3. Post ↔ recipe — a Post is its own entity, recipe attaches later [LOCKED]
A **Post = photo + dish name + optional description.** New `Post` model with a
**nullable `recipe_id`**. Keeps posting lightweight; the recipe attaches whenever.
Three states: (a) never has a recipe, (b) gets one later, (c) attached to a recipe
you already have. **The three post fields auto-seed the recipe** on conversion —
dish name → name, description → description, photo → cover — so "make the recipe"
is near-zero re-entry. Post and recipe deliberately share those three fields.

### 4. Profiles + the relational layer fold into this [LOCKED]
A feed *requires* tapping a friend to see their posts (**profiles — backlog #8**) and
*is* the "close the loop back to the sender" idea (**backlog #32**). This feature is
the organizing frame those were waiting for — build them as part of this, not
separately.

## New primitives this introduces (scope reality)

This is a large, multi-part feature. It adds, roughly in dependency order:
- **Friend graph** (request/accept, list) + **profiles** (a user's posts + public kitchen)
- **Post** model (photo, dish name, optional caption, optional recipe_id) + a **feed**
- **RecipeRequest** model + the fulfill→grant→notify loop
- **Comment** model
- **A notification system** — **BUILT (#79)** as an in-app inbox, and **PUSH SHIPPED 2026-09-09/10
  (#89) on the WEB, with no native app** — see the correction under Tension 2. Requests and comments
  both need one. Given no push infra and the "we don't email users" stance, this likely starts
  as an **in-app notification center**. (Cross-cutting; flag as its own sub-project.)

## Two tensions the design review surfaced (open product calls)

### Tension 1 — visibility becomes a THREE-tier model [RESOLVED]
**Decision:** visibility goes from `private | public` to **`private | friends | public`,
with `friends` as the new default** when posting a recipe. This resolves the
two-axes tension by unifying them: a recipe's audience *is* a visibility tier.
- **Scope this introduces (all part of the social renovation, since "friends" is
  meaningless without the friend graph):**
  - `Recipe.visibility` enum + column default `private → friends` (migration).
  - `can_view` gains a **friends** branch: viewable if public, OR owner, OR an
    accepted grant, OR **the viewer is a friend of the owner AND visibility=friends**.
  - `effective_visibility` / browse gating: **Browse shows only `public`** now, so a
    friends-default recipe does NOT leak to the public feed.
  - `VisibilityChoice` (create) + the edit-form control (backlog #61) become 3-way.
  - This **partially reverses the recent public-by-default decision** (made to seed
    Browse). That's intended: friends-first replaces public-first as the sharing
    default. Public remains an explicit opt-in.
- **Sequencing:** do NOT ship the 3-tier model before the friend graph exists, or
  "friends" visibility has no one to resolve against. It lands in Phase 0/1.

### Tension 2 — the "open it even when not cooking" magic leans on push (≈ native)

> **RESOLVED 2026-09-09/10, and the premise below was wrong.** Push shipped on the web (#89): RFC
> 8292 VAPID + RFC 8291 encryption on `cryptography` and `httpx`, a daily nudge at a
> fixed hour in each person's local time, and a PWA shell. (That nudge originally read "N friends
> posted since you last looked"; #108 corrected it to a PROMPT — "What did you cook today?" — after
> the digest version proved circular, since it could only fire once people were already posting.) Web push was
> not weak — but the iOS caveat is real and specific rather than general: **Safari grants Web Push
> only to a site added to the home screen**, so the manifest and service worker were the
> precondition, not the native app. "push ≈ native" was the one inference that didn't hold, and it
> is the reason the iOS app sat at #1 on the roadmap for months. The remaining native case is
> performance, camera and an App Store listing.
>
> Observed on 2026-09-17: a production daily prompt arrived on an installed iOS home-screen app
> and its tap opened the composer, so the transport is proven end to end. **The honest gap is now
> narrower and differently shaped:** no notification OTHER than the daily prompt has been watched
> arriving (each of the seven types and the friend-post push has its own copy and its own URL over
> that same transport), and Android has not been observed at all. Neither can be closed on this
> machine — headless Chromium refuses `pushManager.subscribe`, since there is no push service
> behind it — so both need a real device. See TECHDEBT.

BeReal's habit loop is *"your friends just posted" → you open the app*. That pull needs
push notifications, and web push (even iOS 16.4+) is weak/unreliable.
- **Everything is buildable web-first** — posts, feed, requests, the fulfill loop,
  comments, and the in-app notification center all work in the current stack, and the
  **backend is identical** whether the client is web or native, so no work is wasted.
- **What web-first does NOT give you** is the push that pulls people back: the
  notification center works on *open* (pull), not as a tap-on-the-shoulder (push).
  *(Superseded — it did. See the note at the top of this tension.)*
- **Plan:** build web-first through the phases to validate cheaply; treat **native iOS
  as a later amplifier, not a prerequisite** (user's call: not now). Nothing here
  blocks the native leap, and shipping web-first de-risks that investment by proving
  demand first.

## Positioning impact — the thing to get right

`POSITIONING.md` currently frames issei tightly around the person-to-person handoff
and explicitly disclaims being a social network / feed. **This feature changes the
product's identity** and POSITIONING must be deliberately reworked (not quietly
edited). The defensible evolution: *the honest handoff, now with a reason to stay* —
presence and connection, demand-driven (no likes, symmetric friends), never virality.
Note backlog #32 ("POST-BETA: relational social") means social was always a
post-beta contemplation, so this is consistent, not a reversal.

## Cold-start risk (the #1 way social features die)

You open the feed and it's empty because no friends have joined or posted. Mitigations:
- Seed friend suggestions from the **handoff graph** (people you've already cooked for).
- Make posting **one photo + one name** — dead simple, no recipe required.
- A gentle "invite the people you've cooked for" prompt.
- The feed itself is a distinct surface, but it **replaced Home at `/`** rather than becoming
  another bottom-nav tab (see the "likely its own tab" line below — that's how it was drafted, not
  how it shipped).
- *Avoid* a public community feed as the empty-state filler — it reintroduces the
  virality dynamic you're trying to keep out. *(Overruled, then narrowed: #70 shipped a
  friends/everyone toggle, #94 removed the toggle and kept `everyone` as the COLD-START source
  only — public posts appear under "While you find your people" and vanish the moment a friend
  posts. The advice was right about a standing public feed and wrong about an empty screen.)*

## Suggested phasing (MVP first, ship value early)

- **Phase 0 (prereq):** friend graph + minimal profiles. No feed without it.
- **Phase 1 (MVP):** post (photo + dish name) + friends' feed (reverse-chron) + view.
  *This alone delivers the "stay connected / see from afar" value.* Ship it, learn.
- **Phase 2:** recipe requests → the fulfill loop (demand engine; reuses handoff) +
  the in-app notification center.
- **Phase 3:** comments; notification polish.

Comments are cheap and high-connection-value; could move to Phase 2 if desired. The
request loop is the harder, higher-payoff build.

## Relationship to existing surfaces

- **Browse** (public recipes) stays separate — it's discovery of *recipes*; the feed
  is friends' *moments*. Don't merge them.
- **Home** already aggregates "passed down lately"; the feed is a distinct, friends-only
  surface (likely its own bottom-nav tab).

## Open questions for the build session

1. Friends (symmetric) vs followers (asymmetric) — **decision needed** (rec: friends).
2. Notification delivery — **RESOLVED: in-app first (#79), then WEB PUSH (#89) — not native.**
3. Is there any public/global feed, or strictly friends-only? (rec: friends-only.)
4. Does posting a photo ever become the *primary* way recipes enter the app (demand-
   pulled), demoting the current add-first flow? Or do they coexist? (Big product call.)
5. Photo storage: reuse the Cloudinary pipeline (yes — already built).
