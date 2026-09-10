# Positioning

The answer to the question two rounds of user testing kept asking: *what is this, and
why would I use it instead of anything else?*

Every claim below is checked against the code, with file references. The last section
is the list of things that are **not true** and must not be said — it exists because
this repo has shipped false claims before.

---

## The one-liner

**Someone cooked you something you'd never had before, you asked for the recipe — issei
is how they send it to you.**

That's the whole product in one sentence, and it's the sentence a beta tester should be
able to repeat back. It names the moment (a dish you've never had), the ask (you wanted
it), and what the app is (the thing that carries it to you).

## The short version

Someone cooked you something you'd never had before, and you asked for the recipe.
issei is how they send it to you — not a scrubbed list of grams, but the dish the way
they actually make it, with the parts that are "a good splash" left as "a good splash,"
and their notes on the steps that matter. They write it down once; you get a link and
read the whole thing without making an account. What arrives is the recipe *and* the
knowledge around it — who it came from, why it's cooked this way, and the one warning
that keeps you from ruining it the first time.

## The feed and the handoff: one product

The app now opens on a feed of what your friends cooked. That looks like a second
product; it isn't — the feed exists to manufacture the founding moment. The origin
needed a table: you had to taste the dish to want it. The feed reproduces that trigger
at a distance — you see a friend's dish, it stops you, you ask for it. The pipeline is
**presence → the ask → the handoff.** The feed is the top of the funnel; the handoff is
still the payload.

This is why there is **no like button, and never will be.** A like is a dead end; a
recipe-request turns presence into a handoff — the one thing the rest of the app is
built to carry. A post is deliberately thin — a photo and a dish name, no ingredients,
no steps (`app/models/post.py`) — because a post is not a recipe. It's the "I made
this" that earns the "can I have it?"

**Status (check before claiming):** the friends feed + posts ship in Phase 1a, and **the
request-the-recipe action that closes the loop now ships too** (#79) — ask on a meal, the cook
is notified in an in-app inbox, and answering it mints a handoff grant to everyone who asked,
so a private recipe reaches them without becoming public. What remains unbuilt is **comments**
(Phase 3) and **re-sharing a recipe you don't own**. A post can
*link* a recipe the author owns; the card links through only when the viewer can read
that recipe.

## Who it's for

The person who has **never tasted the dish**, and the person trying to get it to them.

This is the founding case, not a hypothetical: the founder shared food his mom cooked
with a friend, the friend had never had the dish, loved it, and asked for the recipe.
Everything in the product is downstream of "what does that friend actually need?"

The feed widened the front door. You no longer have to be mid-handoff to have a reason
to open the app — a person who doesn't cook is a legitimate user: they stay connected to
what the people they eat with are making, and when a dish stops them, asking costs
nothing. That's an on-ramp, not a redefinition. The job is still getting one dish from
the cook to the person who wants it; we don't tailor the core to people who'll never
cook, we just don't wall them out.

## Why nobody else serves this

The market splits in two, and **both halves assume you already know the dish**:

- **Utility organizers** — Paprika, AnyList, Samsung Food. Built for the cook who
  already has the recipe and wants it filed, scaled, and turned into a grocery list.
  Their model of a recipe is a normalized ingredient table, because that's what
  arithmetic needs. The person is not in the data model.
- **Legacy archives** — StoryWorth, Remento, the "heirloom cookbook" products. Built
  for the family that already eats the food and wants it commemorated. The output is a
  keepsake — a book, an archive — for people who could already cook the dish from
  memory. Nothing is built to be *followed*.
- **Social food feeds** — Instagram, TikTok, the food side of any app. Presence with no
  payload: you see the dish and can applaud it, but you can't *get* it and can't ask the
  person for it. issei's feed is built so the dish is one tap from a request, and the
  request is answered with the real thing.

Neither is built for a first-time cook receiving a dish from a person. That's the
unoccupied space, and it's the one this app sits in.

## What the app actually does that they structurally don't

Four things, each verified in code.

### 1. An imprecise amount stays imprecise — including through scaling

An ingredient carries `quantity_text` verbatim plus a `quantity_type` of `precise` /
`imprecise` / `unmeasured` (`app/schemas/recipe.py`, `app/models/ingredient.py`). The
classifier doesn't just look for hedge words; it recognizes **folk, body and vessel
units** — soup spoons, a pinch, a good splash, fingers of water
(`app/services/folk_units.py`, mirrored at entry time in
`frontend/src/utils/quantity.js`).

The load-bearing part is what happens at scale time (`app/services/scaling.py`). Folk
units split in two:

- **Countable** — the vessel is unknowable but the count is real, so "3 soup spoons"
  doubled is "6 soup spoons", pluralized like a person would write it.
- **Non-linear** — the number is a geometry, not a quantity. "3 fingers of water" is a
  depth in a pot; doubling the rice widens the pot, so the depth barely moves. The
  amount is kept verbatim and the cook is handed the multiplier in `scale_note`
  (`app/schemas/recipe.py`) to apply by feel.

An organizer built on a normalized ingredient table can't do this, because its scaling
is arithmetic on a number. This is the difference between a product that tolerates
"a good splash" and one that is designed around it.

In the UI these amounts are tagged rather than converted — `impreciseLabel()` in
`frontend/src/lib/measures.js` returns "their way", rendered as a pill next to the
amount in `frontend/src/components/RecipeBody.jsx`.

### 2. Per-step knowledge, attached to the step it belongs to

`Step.voice_note` (`app/models/step.py`) is a text column holding the remark for one
step — the thing an ingredient list structurally cannot carry ("wait for the sugar to
go the colour of tea; any darker and it's bitter"). It renders as a labelled callout
under the step it belongs to, headed **"a note on this step"**
(`frontend/src/components/RecipeBody.jsx`).

Read the label literally. It is a typed note, and the app says so — see *What not to
claim*.

### 3. The recipient reads the whole recipe with no account

`GET /recipes/invite/{token}` is unauthenticated (`app/routers/recipes.py`) and returns
the full dish — ingredients, sections, steps, per-step notes, story, servings,
description, cuisine, cover photo (`InvitePreview` in `app/schemas/recipe.py`). The
token is a `secrets.token_urlsafe(32)` capability: holding the link *is* the permission
to read.

This is a product decision with teeth. The person receiving a handoff has never tasted
the dish and wants to cook it, so a signup wall lands exactly at the moment of highest
intent. It used to be a soft wall (name/story/photo only, signup to see an ingredient)
and that inverted the point of the app; the schema comment in `app/schemas/recipe.py`
records the reversal. Signing up is what lets you *keep* it, not what lets you read it.

The recipient's landing page (`frontend/src/pages/InviteLanding.jsx`) renders the same
`RecipeBody` the owner sees, and puts the "keep it" CTA *after* the recipe.

### 4. The recipe is attributed to a person

`Recipe.origin_attribution` (`app/models/recipe.py`) holds who the dish came from as a
display string. The recipe is titled by the **dish**; the person appears as a byline —
"from Lola" — with the name in plum, a colour reserved app-wide for a person's name
(`frontend/src/lib/sourceName.js`, `frontend/src/components/RecipeCard.jsx`).

A story field sits at the top of the recipe as a featured card, headed "{Name}'s story"
when the source is known (`frontend/src/components/RecipeBody.jsx`).

### Supporting, not headline

Real and worth demoing, but not what makes the app different: serving-size scaling,
cover-photo upload with iPhone HEIC → JPEG conversion, private/public visibility, a
public Browse feed, cook logging, and a session-only step check-off on the recipe page
(`doneSteps` in `frontend/src/components/RecipeBody.jsx` — not persisted).

---

## What NOT to claim

Every line here was either false in this repo's docs at some point, or is close enough
to a true thing that it gets overstated. Check against this list before writing copy.

### Never claim audio, voice recording, or verbatim speech

**No audio of a person is ever captured, stored, played back, or transmitted.** No
recording, no voice notes, no playback. The recipe is text end to end.

One exception to state precisely, because dictation now ships (`frontend/src/lib/speech.js`,
`DictateButton.jsx`): the device microphone can be used to *type into a text field* via the
browser's own speech-to-text. The spoken words become characters the user can see and edit;
the utterance itself is never saved, sent to our servers, or replayed. So the claim is not
"no microphone" — it is that issei keeps **no audio and no recording of anyone's voice**.
"Their voice", "a recording", "in their own words" remain false and banned: the microphone
is a keyboard substitute, not a record of a person.

The trap is a column name. `Step.voice_note` (`app/models/step.py`) is a `Text` column
typed into a plain text input by whoever wrote the recipe down
(`frontend/src/components/RecipeForm.jsx`). Calling it "their voice", "their words", "a
recording", or "in their own words" makes two false claims at once: that audio exists,
and that the text is verbatim speech from the source person.

The UI has already been corrected to say **"a note on this step"**, and the story
heading says **"{Name}'s story"** rather than "In {Name}'s words"
(`frontend/src/components/RecipeBody.jsx`). THIRTEEN test files assert no voice/audio claim appears in
the UI: `components/DictateButton.test.jsx` and `components/PasteRecipe.test.jsx` (each via a
`BANNED = /record|recording|voice|audio|in their own words|listen/` regex over the rendered
screen), `components/RecipeBody.test.jsx`, `pages/Login.test.jsx`, `pages/Welcome.test.jsx`
`pages/InviteLanding.test.jsx`, `components/RecipeForm.test.jsx` (both mic states),
`pages/Notifications.test.jsx`, `pages/UserProfile.test.jsx` and — new with #89's PWA shell —
`components/NotificationSettings.test.jsx`, `components/NotifyNudge.test.jsx` and `pwa.test.js`
(the last over the WEB MANIFEST's description, which is app-store-facing copy no rendered-screen
assertion can reach) — plus `lib/inviteMessage.test.js`, which guards the SHARE TEXT rather than a
screen and was missed by three separate recounts of this list. The regex is also WIDER than the
form quoted above: it is `in (their|your|his|her)( own)? words`, because the phrase came back as
"in your own words" on a new surface and the `their`-only version let it through every guard at
once. If you widen it again, widen it in all NINE files that carry the wide form (DictateButton, PasteRecipe, RecipeForm, NotificationSettings, NotifyNudge, Notifications, UserProfile, pwa.test.js and — since #102 — InviteLanding, whose guard was the weakest of the thirteen on the app's highest-traffic first impression: it omitted `voice` and the whole words-family outright) — they are kept in step by hand. (This list previously named `pages/PlantRecipe.test.jsx`,
which asserts nothing of the kind, and has twice undercounted the files that do — verified
by reading each one, not by grepping for the word. Every new user-facing surface tends to
add another; the count is a floor, not a fixed number.)

Internal identifiers (`voice_note`, `soul_count`) may keep their names; **user-facing
and recruiter-facing text may not**.

### A report is silent, and a block never hides anyone from being reported

Two claims that must stay true in copy and in code (#87).

The app never tells someone they have been reported — not in the inbox, not on their profile,
not by any change they could notice. Never write copy that implies otherwise ("we'll let them
know", "they'll be notified"): a report that announces itself is an escalation trigger, and the
person most likely to retaliate is the person most likely to be reported. The confirmation the
REPORTER sees says so explicitly, because "will they find out?" is the first thing anyone
wonders and the answer is the reason they'll use it at all.

And reporting is never gated on blocking. Someone who has blocked you can still be reported by
you; that is the case the feature exists for. See TESTING.md invariant 12.

Also don't describe reporting as moderation. There is no moderation queue, no review SLA and no
automated action — a report is a row in a table that a person reads. "We'll take a look" is
true. "Reviewed within 24 hours" would not be.

### Never claim a lineage, family tree, or generational graph

Removed in commit `8a3b734`. Gone: the tree model, `parent_recipe_id`,
`lineage_relation`, the `ghost_ancestors` table, `GET /recipes/{id}/lineage`, and
`app/services/lineage.py` (now `app/services/sharing.py`). On the frontend,
`api/lineage.js` is now `api/sharing.js` and `lib/lineagePayload.js` is now
`lib/originPayload.js`.

Recipes do not form trees. There are no ancestors, descendants, roots, branches,
subtrees, generations, or child counts. Nothing "attaches to the lineage root" and no
grant "covers a subtree" — a grant is on one recipe (`can_view` in
`app/services/sharing.py`).

`origin_attribution` was deliberately kept and is **not** lineage: it's a byline, a
fact about one recipe, not an edge between two.

The reason matters for positioning. This app is a **bridge between two people** — one
recipe, handed to one person — not a family network. A tree is a different product, and
claiming one invites the question "where is it?"

The friend graph is **not** lineage either. issei now has friendships (symmetric, one
row per unordered pair — `app/models/friendship.py`) and a feed scoped to them. That's a
flat, mutual relation between *people*. It is not recipe ancestry — recipes still form no
trees, and a friendship is not a parent/child edge. "It has a graph now" does not
resurrect the tree language this section bans.

### Never claim the unbuilt social layer

Shipped so far: posts + a friends feed (Phase 1a); the public/private profile setting
with concrete per-item visibility (Phase 1b, #68 — a profile is public or private, and a
recipe or post is public, friends-only, or private); the **post page** (`/posts/:id`, from #71); **keeping** a recipe you
didn't write (#57 — the Kitchen's Kept tab); and the **app-wide people directory** (#80 —
"Everyone on issei" on the Friends page, plus a name search and a permanent Friends button
on Home); **writing a recipe mid-post** (#81 — the meal composer's "Write one" door hands its
draft to the add-a-recipe flow and gets the recipe back attached); and **the recipe-request loop
with an in-app inbox** (#79 — anyone who can see a meal may ask the cook for the recipe; the
cook answers by writing or attaching one; delivery is a handoff grant per requester, so a
PRIVATE recipe reaches the people who asked without its visibility changing); and **blocking**
(#85 — `POST`/`GET`/`DELETE /friends/blocks`); a **feed read-mark** (#97 — the feed marks
what arrived since you last looked and draws a "You're all caught up" line); and **the cook
learning their recipe was kept** (#96 — an anonymous inbox line plus a cook-only count); and
**reporting a person** (#87 — `POST /friends/reports`, behind the ⋯ menu on their profile,
alongside blocking). What reporting is NOT: there is no moderation queue, no review process and
no way for anyone to read a report back from inside the app, so claim the mechanism and never a
response. And you can report only a PERSON, not a post or a recipe — App Store Guideline 1.2
asks for content reporting too, so don't describe the app as meeting that gate yet. Note what the directory means for any privacy
claim: every signed-in user can enumerate every other user's name and photo, with no opt-out —
so do **not** describe the app as private-by-default without qualifying that findability is not
covered by the profile setting (see TECHDEBT's "Auth & permissions").

Two things about **blocking** are easy to overclaim and are false. It is **not "unsend"**: a
recipe you already handed that person stays readable to them forever, because `can_view`'s
grant branch deliberately stays open to a blocked viewer for that one recipe. The canonical
way to say this to a user is the confirm dialog's own line — *"A recipe you already sent them
stays theirs."* — and it should not be reworded into anything that implies revocation. The
line the app draws is at the moment of OFFER, not acceptance: a share link or emailed invite
the cook sent before blocking still works for that person (owner call, #88), because the token
is the capability and they chose to send it. What a block stops is a *new* offer —
`handoff_recipe` refuses across one.) And blocking is **not a mute** — there is still no mute anywhere in the app. Reporting
(#87) now exists and sits beside it in the same ⋯ menu, so "block and report" is finally a true
sentence — but they are different acts and the difference is the point: a block is something you
do FOR YOURSELF and it takes effect instantly, a report goes to whoever runs the app and takes
effect when a human looks. Don't collapse them, and don't imply a report hides anyone: it
changes nothing either party can see. There is still **no moderation queue** — see the section
above on what may and may not be claimed about a report.

Discoverability itself is a DECISION, not an oversight (owner call, 2026-09-04): name and
photo findable by any signed-in user while content stays private is the same model Instagram,
TikTok and X use, and issei matches it. So this is a rule about CLAIMS, not a promise of a
future opt-out — there isn't one planned. Say "your recipes and posts are private until you
share them", never "you are private". Since #85 findability does have a *floor*: you can
block, which removes the two of you from each other's directory, Browse, feed and profile in
both directions. That is the honest qualification to add — a floor, not an opt-out.

**UN-SHIPPED, 2026-09-08 (#94) — do not describe either as a feature:** the feed's
friends/everyone **toggle** (#70) and Browse's **Meals tab** (#71). Both offered strangers'
meals as a place you navigate to, and neither earned it: a toggle asks people to choose between
two things they have no basis for choosing between, and Browse is an INTENT surface — you arrive
wanting a dish, and nobody searches for a photo of someone's dinner. Public posts still exist
and still matter, but only in the COLD-START feed: when nobody you know has posted, Home shows
public meals under "While you find your people". Home is otherwise the people you know, which
is the thesis (presence → the ask → the handoff).

What has **not** shipped: **comments** on a meal (Phase 3), and **re-sharing a recipe you
don't own**.
Write both as direction, never as present features. On #57 specifically, two things are
easy to overclaim and are false: keeping is a **bookmark, not a copy** (there is still one
recipe, the cook's — so their later corrections reach the keeper, and if they make it
private or delete it the keeper genuinely loses access), and **only the cook can hand a
recipe on** — a keeper has no re-share, no edit, and no delete.

Six invariants still hold everywhere and must not be contradicted: the
"everyone"/Browse surfaces show **public** posts only (a friends-only or private post never
leaks into them — enforced in SQL); there is still **no like button** anywhere;
there is **no PUBLIC count of who kept a recipe, and no LIST of keepers anywhere, ever** —
either would be the removed `child_count` wearing a new noun. NARROWED 2026-09-08 (#96), and
the narrowing is precise: the cook, and only the cook, now sees a NUMBER on their own recipe
(`keeper_count`, `None` — never `0` — for every other viewer, hidden at zero even for them).
What that buys is the only feedback a recipe written WITHOUT a post ever gets, since the
ask/fulfil loop lives only on posts; a cook could share a link and never learn it landed. What
it must never become is a keeper's NAME: keeping is a bookmark addressed to nobody, unlike an
ask, which is addressed to the cook, so naming the keeper would change what keeping MEANS and
could chill it. The `recipe_kept` notification is anonymous at the API boundary, not just in
the UI — "Someone kept your Adobo"; **a recipe-request count is the cook's alone** — it renders on the cook's
own feed card and their own post page, hidden at zero, and `request_count` is `None` (never
`0`) for every other viewer, while a requester's NAME appears only on `/requests`; and **a
block is always
silent**. Every "you're not entitled to this" answer stays a 404 with the same body an
unknown user gets — never a 403, never a distinct message, and no UI may ever say "you have
been blocked" or otherwise let someone detect that they were. That is the same reasoning
behind every other authorization denial in the app, and it is a copy rule as much as a code
one. Nor is there any way to learn who has blocked **you**: `GET /friends/blocks` returns
only the people the caller blocked.

And the sixth, new with #97: **nothing in issei expires.** A post does not disappear after a day,
after being seen, or ever — `is_new` is a flag, never a filter, and the feed returns the same
posts before and after a read-mark. BeReal's ephemerality is the one mechanic deliberately NOT
copied: a post is the top of the funnel to a handoff, so a vanishing post takes the ask with it,
and posts are permanent records on their author's profile. Never describe issei as ephemeral, and
never write "stories", "24 hours" or "disappears" as a feature. Recorded here before anyone
proposes it, because arguing it later is more expensive.

The fourth is new with #79, the fifth with #85 and the sixth with #97; the fourth is the
easiest of the six to
break by being helpful.
`PostResponse.request_count` is populated only for the post's author and is `None` for every
other viewer (`app/schemas/post.py`); the requesters' names appear only on
`GET /posts/requests/incoming` (filtered on `Post.user_id`) and the `/requests` page it feeds;
and no surface ever renders a zero. **Do not make the count public.** A visible "N people want
this" is a like count wearing a different noun, and printing "0 asked" under an ordinary
Tuesday meal is the exact discouragement this app exists to remove — the cook's number is a
private nudge, not a score. It is not the keep rule inverted: keeps have no count for *anyone*,
the cook included, whereas an ask count exists for exactly one person. Asking itself is open to
**anyone who can see the post** (`can_view_post`, deliberately not friends-only) — the guard is
on *seeing*, not on *counting*. Two earlier specs recommended the public version
(`docs/SOCIAL_FEED_PLAN.md`, `docs/SOCIAL_FEED_DESIGN.md`); both were corrected, and this file
outranks them. A future "most asked for" surface is permitted only as a **rank** — a Browse row
of dishes that HAVE demand, which never renders an absence and never attaches a number to a
person's post; a per-post tally is not covered by that allowance.

The same allowance and the same three limits extend to a future **"most kept"** row — rank only,
never a per-recipe tally, and never a number attached to a cook's recipe for anyone but the cook.
Written down 2026-09-08, when #96 gave keeps a cook-only count: until then keeps produced no
number for anyone, so the ask-shaped wording above covered everything. It doesn't any more, and
"most kept isn't mentioned, so it isn't forbidden" is an argument that gets much harder to answer
once such a row exists.

Check the code before describing any social capability — this is the area moving fastest
(see `docs/SOCIAL_FEED_PLAN.md`).

### Never claim a recipient can edit, add to, or contribute to a recipe they were sent

`PATCH /recipes/{recipe_id}` filters on `Recipe.user_id == current_user.id`
(`app/routers/recipes.py`), so a non-owner gets a 404. `DELETE` does the same. A
grantee can **read and cook**; they cannot change someone else's record of the dish
(documented in `can_view`, `app/services/sharing.py`).

So: no "families fill in what one person can't remember alone", no "the recipe grows as
people add to it", no collaborative editing, no "enriched by whoever cooks it". A
recipient who signs up gets to keep and cook the recipe — that's the promise, and it's
enough.

### Notifications: what the app may and may not say about them (#89)

A whole new body of user-facing copy arrived with push — permission prompts, install
instructions, a Home nudge, quiet-hours warnings, the notification bodies themselves — and it
sits closer to the product's promises than a settings screen usually does. Five rules:

1. **Never describe an unwired switch as working.** `notify_people` is stored and read by
   nothing, so `NotificationSettings` renders **no switch for it**. A control that changes
   nothing is worse than a missing one: switching it off reads as a promise the app then
   breaks in the other direction. The same applies to any preference added ahead of its
   sender.
2. **The daily nudge counts PEOPLE and only ever says what is true.** "3 friends posted since
   you last looked" is derived from a `can_view_post` re-check, so it excludes a friend's
   private post and a blocked person's post. Zero sends nothing at all — never a generic
   "open issei!", which is the species of notification people mute an app over.
3. **"This browser can't do notifications" is FALSE on an iPhone in Safari.** Push exists
   there, gated on the site being added to the home screen — so the honest copy is an
   instruction ("Add issei to your home screen first"), never a refusal. This matters more
   than it sounds: iPhones are most of this app's audience, and the refusal is a dead end.
4. **A notification is not a metric.** Never push a count that the private-count rules
   elsewhere in this file forbid showing on screen — a recipe-request count is the cook's
   alone, a keeper count has no names, and a lock screen is the most public surface the app
   has.
5. **Don't claim delivery that hasn't been observed.** As of 2026-09-10 every layer we can
   test is verified and no notification has yet arrived on a real device (see TECHDEBT). Until
   one has, the truthful phrasing is "web push is implemented", not "notifications work".

### Never claim a shopping list or unit conversion

Both removed. There is no shopping list and no `app/services/units.py`. `FUTURE.md`
records why the consolidating list was deleted rather than fixed: summing amounts
across recipes requires normalizing them, which is the one thing this app exists to
refuse.

### Never claim a handwritten or script typeface

Five script faces (Caveat, Shantell Sans, Patrick Hand, Architects Daughter, Kalam)
were tried for the story and step notes and all five were cut — see the long note in
`frontend/tailwind.config.js`. Only **Fraunces** (`font-display`) and **Nunito Sans**
(`font-sans`) are loaded (`frontend/index.html`). `font-hand` does not exist, and a test
asserts it never comes back (`frontend/tailwind.config.test.js`).

A person's presence is signalled **structurally** — the saffron card, the quote stamp,
the attributed heading, Fraunces italic — not typographically.

Narrow correction to a claim made elsewhere: a `font-serif` key **does** still exist in
`frontend/tailwind.config.js`, mapped to Cormorant Garamond. It is legacy and
deliberately unloaded (the config test excludes it from the "must be loaded" invariant
and comments it as legacy). Don't say "`font-serif` no longer exists" — say **no
handwritten face exists, and only two families are loaded.**

### Never claim the garden UI

The seed → sprout → sapling → tree plant UI was removed in the kitchen redesign. The
backend still *computes* `growth_stage` / `growth_vitality` / `soul_count`
(`app/services/growth.py`, returned on `RecipeResponse`) but **no frontend surface
displays them**. Don't describe growth stages as a feature a user can see. The garden
UI and its docs were removed once the kitchen design was locked in; they live only in
git history now.

### Don't inflate the numbers — measure them

As measured on this branch (see `README.md` for the method): **65 routes**, **18 models**,
**604 backend tests**, **840 frontend tests in 57 files**. Endpoint and test counts have
each changed several times as features were added and removed; count the `@router` / `@app` decorators
and run the suites rather than repeating a number from an older doc.

### Don't oversell the audience

"Preserving what immigrant elders never wrote down" is the *origin* and the emotional
register, and it's true. But it is not the job the product does. The job is **getting
one dish from the person who cooks it to the person who just tasted it.** Lead with the
job; the heritage framing is the reason it's built with this much care, not the feature.
