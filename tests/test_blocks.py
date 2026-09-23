"""Blocking (#85) — the safety primitive issei shipped without.

Before this there was no block, mute or report anywhere, while #79 had opened recipe
requests to any signed-in stranger on a public post. Unfriending removed a row and stopped
neither discovery nor asking.

The three decisions under test, all made deliberately:
  1. A block is MUTUALLY INVISIBLE — neither sees the other anywhere. One-way protection
     doesn't work: you'd keep meeting their meals in Browse.
  2. It DELETES the friendship rather than suspending it, so no read rule has to ask two
     questions where it used to ask one.
  3. An accepted handoff GRANT SURVIVES. You gave them that recipe; a block means "no new
     contact", not "unsend".
And the property that makes it protection rather than a signal: every denial is the same 404
a stranger or a deleted account gets. A blocked user must not be able to detect the block.
"""


def _post(client, headers, dish="Adobo", visibility="public", recipe_id=None):
    body = {"photo_url": "https://res.cloudinary.com/demo/image/upload/a.jpg", "dish_name": dish, "visibility": visibility}
    if recipe_id is not None:
        body["recipe_id"] = recipe_id
    r = client.post("/posts", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _recipe(client, headers, name="Adobo", visibility="public"):
    r = client.post(
        "/recipes",
        json={"name": name, "visibility": visibility, "steps": [{"content": "Cook", "position": 1}]},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _befriend(client, a, ah, b, bh):
    fid = client.post("/friends/request", json={"to_user_id": b.id}, headers=ah).json()["id"]
    assert client.post(f"/friends/{fid}/accept", headers=bh).status_code == 200


def _block(client, headers, user_id):
    r = client.post("/friends/blocks", json={"user_id": user_id}, headers=headers)
    assert r.status_code == 204, r.text


# --- the block itself ---


def test_blocking_is_idempotent(client, make_user, db_session):
    from app.models.block import Block

    a, ah = make_user()
    b, _ = make_user()
    _block(client, ah, b.id)
    _block(client, ah, b.id)
    assert db_session.query(Block).count() == 1


def test_cannot_block_yourself(client, make_user):
    a, ah = make_user()
    assert client.post("/friends/blocks", json={"user_id": a.id}, headers=ah).status_code == 400


def test_blocking_an_unknown_user_404s(client, make_user):
    _, ah = make_user()
    assert (
        client.post("/friends/blocks", json={"user_id": 999999}, headers=ah).status_code == 404
    )


def test_your_block_list_is_yours_only(client, make_user):
    """Never "who has blocked me" — that is information you aren't entitled to, and knowing
    it would defeat blocking as protection."""
    a, ah = make_user(first_name="Ana")
    b, bh = make_user(first_name="Ben")
    c, chh = make_user(first_name="Cruz")
    _block(client, ah, b.id)   # Ana blocks Ben
    _block(client, chh, a.id)  # Cruz blocks Ana

    mine = client.get("/friends/blocks", headers=ah).json()
    assert [p["first_name"] for p in mine] == ["Ben"]  # not Cruz
    assert client.get("/friends/blocks", headers=bh).json() == []


def test_blocks_require_auth(client):
    assert client.post("/friends/blocks", json={"user_id": 1}).status_code == 401
    assert client.get("/friends/blocks").status_code == 401
    assert client.delete("/friends/blocks/1").status_code == 401


# --- mutual invisibility ---


def test_a_blocked_pair_cannot_read_each_others_PUBLIC_posts(client, make_user):
    """The ordering that matters: the block check runs BEFORE the `public` short-circuit.
    Otherwise blocking would leave every public post of theirs on your screen."""
    a, ah = make_user()
    b, bh = make_user()
    theirs = _post(client, bh, visibility="public")
    mine = _post(client, ah, visibility="public")
    _block(client, ah, b.id)

    assert client.get(f"/posts/{theirs['id']}", headers=ah).status_code == 404
    # ...and symmetrically, though only ONE of them blocked.
    assert client.get(f"/posts/{mine['id']}", headers=bh).status_code == 404


def test_a_blocked_pair_cannot_read_each_others_PUBLIC_recipes(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    theirs = _recipe(client, bh, visibility="public")
    _block(client, ah, b.id)
    assert client.get(f"/recipes/{theirs['id']}", headers=ah).status_code == 404


def test_the_blocked_person_disappears_from_the_directory_both_ways(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    c, _ = make_user()
    _block(client, ah, b.id)

    a_sees = {p["user_id"] for p in client.get("/friends/discover", headers=ah).json()}
    b_sees = {p["user_id"] for p in client.get("/friends/discover", headers=bh).json()}
    assert b.id not in a_sees and a.id not in b_sees
    assert c.id in a_sees  # everyone else is unaffected


def test_a_blocked_pair_cannot_open_each_others_profile(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    _block(client, ah, b.id)
    assert client.get(f"/friends/profile/{b.id}", headers=ah).status_code == 404
    assert client.get(f"/friends/profile/{a.id}", headers=bh).status_code == 404


def test_blocked_posts_leave_the_browse_and_everyone_surfaces(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    theirs = _post(client, bh, dish="Theirs", visibility="public")
    _block(client, ah, b.id)

    browse = {p["id"] for p in client.get("/posts/browse", headers=ah).json()}
    everyone = {p["id"] for p in client.get("/posts/feed?scope=everyone", headers=ah).json()}
    assert theirs["id"] not in browse
    assert theirs["id"] not in everyone


def test_blocked_recipes_leave_browse(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    theirs = _recipe(client, bh, name="Theirs", visibility="public")
    _block(client, ah, b.id)
    ids = {r["id"] for r in client.get("/recipes/browse", headers=ah).json()}
    assert theirs["id"] not in ids


def test_a_blocked_person_cannot_see_your_posts_on_your_profile_grid(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    _post(client, ah, visibility="public")
    _block(client, ah, b.id)
    assert client.get(f"/posts/users/{a.id}", headers=bh).json() == []


# --- the friendship is deleted, not suspended ---


def test_blocking_deletes_the_friendship(client, make_user, db_session):
    from app.models.friendship import Friendship

    a, ah = make_user()
    b, bh = make_user()
    _befriend(client, a, ah, b, bh)
    assert db_session.query(Friendship).count() == 1

    _block(client, ah, b.id)
    assert db_session.query(Friendship).count() == 0
    assert client.get("/friends", headers=ah).json() == []
    assert client.get("/friends", headers=bh).json() == []


def test_friends_only_content_stops_being_readable_after_a_block(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    _befriend(client, a, ah, b, bh)
    mine = _post(client, ah, visibility="friends")
    assert client.get(f"/posts/{mine['id']}", headers=bh).status_code == 200

    _block(client, ah, b.id)
    assert client.get(f"/posts/{mine['id']}", headers=bh).status_code == 404


def test_unblocking_does_not_restore_the_friendship(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    _befriend(client, a, ah, b, bh)
    _block(client, ah, b.id)
    assert client.delete(f"/friends/blocks/{b.id}", headers=ah).status_code == 204
    # They have to ask again — blocking is not a pause button.
    assert client.get("/friends", headers=ah).json() == []
    # But they ARE discoverable again.
    assert b.id in {p["user_id"] for p in client.get("/friends/discover", headers=ah).json()}


def test_you_can_only_undo_your_own_block(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    _block(client, ah, b.id)
    _block(client, bh, a.id)
    # Ana unblocks Ben, but Ben's block on Ana stands, so they stay invisible.
    assert client.delete(f"/friends/blocks/{b.id}", headers=ah).status_code == 204
    assert b.id not in {p["user_id"] for p in client.get("/friends/discover", headers=ah).json()}


# --- the grant survives (the deliberate asymmetry) ---


def test_a_handed_over_recipe_SURVIVES_a_block(client, make_user):
    """The decision: you genuinely gave them that recipe, it's on their Kept shelf and they
    may have cooked from it. A block means "no new contact", not "unsend" — and revoking
    would be the only place in the app where access is taken back after being given."""
    cook, ch = make_user()
    fan, fh = make_user()
    rec = _recipe(client, ch, name="Lola's adobo", visibility="private")
    h = client.post(
        f"/recipes/{rec['id']}/handoff", json={"to_user_id": fan.id}, headers=ch
    ).json()
    assert client.post(f"/recipes/handoffs/{h['id']}/accept", headers=fh).status_code == 200
    assert client.get(f"/recipes/{rec['id']}", headers=fh).status_code == 200

    _block(client, ch, fan.id)
    # Still readable, and still on their shelf.
    assert client.get(f"/recipes/{rec['id']}", headers=fh).status_code == 200
    kept = client.get("/recipes/kept", headers=fh).json()
    assert rec["id"] in [r["id"] for r in kept["recipes"]]


def test_a_block_still_hides_everything_they_were_NOT_handed(client, make_user):
    # The asymmetry is scoped to the one granted recipe, not a general exemption.
    cook, ch = make_user()
    fan, fh = make_user()
    granted = _recipe(client, ch, name="Given", visibility="private")
    other = _recipe(client, ch, name="Not given", visibility="public")
    h = client.post(
        f"/recipes/{granted['id']}/handoff", json={"to_user_id": fan.id}, headers=ch
    ).json()
    client.post(f"/recipes/handoffs/{h['id']}/accept", headers=fh)

    _block(client, ch, fan.id)
    assert client.get(f"/recipes/{granted['id']}", headers=fh).status_code == 200
    assert client.get(f"/recipes/{other['id']}", headers=fh).status_code == 404


# --- blocking stops the #79 request loop ---


def test_a_blocked_person_cannot_ask_you_for_a_recipe(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    mine = _post(client, ah, visibility="public")
    _block(client, ah, b.id)
    # 404, not 403 — the post now reads as not existing, exactly like a stranger's private one.
    assert client.post(f"/posts/{mine['id']}/request", headers=bh).status_code == 404


def test_a_blocked_person_gets_the_SAME_404_from_the_retract_route(client, make_user):
    """The one route that answers to a pending row rather than to read access (#98).

    `retract_request` deliberately doesn't require `can_view_post` — otherwise a cook who hides
    a post would trap the asker's ask forever. Its block-safety therefore rests on a property
    enforced somewhere else entirely: `block_user` deletes pending `RecipeRequest` rows in both
    directions, so a blocked person never holds the credential. That's a real dependency across
    two modules with nothing asserting the junction, and if someone later decides a pending ask
    is "history" worth preserving across a block — symmetric to the reasoning already in the
    code for FULFILLED rows — this route silently becomes a 200-vs-404 block oracle.

    The answer must be byte-identical to what an unknown post id gives, because a blocked
    person must never be able to detect the block.
    """
    cook, ch = make_user()
    asker, akh = make_user()
    post = _post(client, ch, visibility="public")
    assert client.post(f"/posts/{post['id']}/request", headers=akh).status_code == 201

    assert client.post("/friends/blocks", json={"user_id": asker.id}, headers=ch).status_code == 204

    blocked = client.delete(f"/posts/{post['id']}/request", headers=akh)
    unknown = client.delete("/posts/999999/request", headers=akh)
    assert blocked.status_code == unknown.status_code == 404
    assert blocked.json() == unknown.json() == {"detail": "Post not found"}


def test_blocking_clears_pending_asks_in_both_directions(client, make_user, db_session):
    from app.models.recipe_request import RecipeRequest

    a, ah = make_user()
    b, bh = make_user()
    mine = _post(client, ah, dish="Mine", visibility="public")
    theirs = _post(client, bh, dish="Theirs", visibility="public")
    client.post(f"/posts/{mine['id']}/request", headers=bh)   # they asked me
    client.post(f"/posts/{theirs['id']}/request", headers=ah)  # I asked them
    assert db_session.query(RecipeRequest).count() == 2

    _block(client, ah, b.id)
    # Neither is left holding an ask that can never be answered.
    assert db_session.query(RecipeRequest).count() == 0
    assert client.get("/posts/requests/incoming", headers=ah).json() == []


def test_a_blocked_person_cannot_send_a_friend_request(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    _block(client, ah, b.id)
    r = client.post("/friends/request", json={"to_user_id": a.id}, headers=bh)
    assert r.status_code == 404
    # The SAME answer an unknown user gets — no way to tell a block from a deleted account.
    unknown = client.post("/friends/request", json={"to_user_id": 999999}, headers=bh)
    assert r.status_code == unknown.status_code and r.json() == unknown.json()


# --- silence: a block must not be detectable ---


def test_a_block_is_indistinguishable_from_a_private_post(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    stranger, sh = make_user()
    blocked_post = _post(client, ah, visibility="public")
    private_post = _post(client, sh, visibility="private")
    _block(client, ah, b.id)

    r_blocked = client.get(f"/posts/{blocked_post['id']}", headers=bh)
    r_private = client.get(f"/posts/{private_post['id']}", headers=bh)
    assert r_blocked.status_code == r_private.status_code == 404
    assert r_blocked.json() == r_private.json()


def test_blocking_someone_who_already_blocked_you_is_still_204(client, make_user):
    # No distinct answer for prior state — the endpoint leaks nothing.
    a, ah = make_user()
    b, bh = make_user()
    _block(client, bh, a.id)
    assert (
        client.post("/friends/blocks", json={"user_id": b.id}, headers=ah).status_code == 204
    )


# --- everyone else is unaffected ---


def test_a_block_touches_nobody_else(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    c, chh = make_user()
    _befriend(client, a, ah, c, chh)
    mine = _post(client, ah, visibility="friends")
    _block(client, ah, b.id)

    # The unrelated friend still reads the friends-only post and still sees Ana.
    assert client.get(f"/posts/{mine['id']}", headers=chh).status_code == 200
    assert [f["user_id"] for f in client.get("/friends", headers=ah).json()] == [c.id]


# --- gaps the two-account walkthrough and the first 24 tests both missed ---


def test_a_blocked_person_cannot_hand_you_a_NEW_recipe(client, make_user):
    """The grant exemption is for grants that ALREADY EXISTED at block time. Minting one after
    the block is the "new contact" a block exists to stop — and because can_view's grant branch
    waves a grant through regardless of visibility or friendship, it would be an uncapped
    channel for putting arbitrary text (dish name, story, byline, step notes) plus the blocked
    person's own name onto the blocker's Kept shelf."""
    ana, ah = make_user(first_name="Ana")
    ben, bh = make_user(first_name="Ben")
    _block(client, ah, ben.id)

    rec = _recipe(client, bh, name="READ THIS ANA", visibility="private")
    r = client.post(f"/recipes/{rec['id']}/handoff", json={"to_user_id": ana.id}, headers=bh)
    # Same 404 body an unknown user gets, so Ben can't tell a block from a deleted account.
    assert r.status_code == 404
    assert r.json() == {"detail": "User not found"}

    assert client.get("/recipes/kept", headers=ah).json()["recipes"] == []
    assert client.get("/recipes/shared", headers=ah).json() == []
    assert client.get(f"/recipes/{rec['id']}", headers=ah).status_code == 404


def test_the_blocker_cannot_hand_a_recipe_to_someone_they_blocked_either(client, make_user):
    # Symmetric, like every other block effect — otherwise the blocker could re-open a channel
    # they just closed.
    ana, ah = make_user()
    ben, bh = make_user()
    _block(client, ah, ben.id)
    rec = _recipe(client, ah, visibility="private")
    r = client.post(f"/recipes/{rec['id']}/handoff", json={"to_user_id": ben.id}, headers=ah)
    assert r.status_code == 404


def test_a_grant_that_existed_BEFORE_the_block_still_works(client, make_user):
    # The guard above must not retroactively break decision 3. Pinned separately from
    # test_a_handed_over_recipe_SURVIVES_a_block so a regression names which half broke.
    cook, ch = make_user()
    fan, fh = make_user()
    rec = _recipe(client, ch, visibility="private")
    h = client.post(
        f"/recipes/{rec['id']}/handoff", json={"to_user_id": fan.id}, headers=ch
    ).json()
    client.post(f"/recipes/handoffs/{h['id']}/accept", headers=fh)
    _block(client, ch, fan.id)
    assert client.get(f"/recipes/{rec['id']}", headers=fh).status_code == 200


def test_a_blocked_person_is_not_SUGGESTED_as_a_friend_either_way(client, make_user):
    """The one friend endpoint where the block is easy to miss. Suggestions are seeded from the
    handoff graph, and blocking deletes the friendship but deliberately preserves handoffs — so
    the block removes the only thing that was excluding them, and they come back as a suggestion
    BECAUSE you had handed them a recipe. Which is also the likeliest reason you blocked them."""
    ana, ah = make_user(first_name="Ana")
    ben, bh = make_user(first_name="Ben")
    rec = _recipe(client, ah, visibility="private")
    h = client.post(
        f"/recipes/{rec['id']}/handoff", json={"to_user_id": ben.id}, headers=ah
    ).json()
    client.post(f"/recipes/handoffs/{h['id']}/accept", headers=bh)
    assert [s["user_id"] for s in client.get("/friends/suggestions", headers=ah).json()] == [ben.id]

    _block(client, ah, ben.id)
    assert client.get("/friends/suggestions", headers=ah).json() == []
    assert client.get("/friends/suggestions", headers=bh).json() == []


def test_blocking_clears_notifications_between_the_two(client, make_user):
    """The inbox is the one surface where a blocked person's NAME and PHOTO would otherwise keep
    appearing — `list_notifications` resolves the actor directly and has no can_view to lean on,
    so the shipped confirm copy ("you won't see each other anywhere") would be false.

    Deliberately a different call from #79's "retracting an ask keeps the cook's notification":
    there the notification is history the other person is entitled to. Here the recipient has
    explicitly asked never to see this person again."""
    ana, ah = make_user(first_name="Ana")
    ben, bh = make_user(first_name="Ben")
    cruz, chh = make_user(first_name="Cruz")

    mine = _post(client, ah, dish="Mine", visibility="public")
    client.post(f"/posts/{mine['id']}/request", headers=bh)
    client.post(f"/posts/{mine['id']}/request", headers=chh)
    before = client.get("/notifications", headers=ah).json()["notifications"]
    assert sorted(n["actor_first_name"] for n in before) == ["Ben", "Cruz"]

    _block(client, ah, ben.id)

    after = client.get("/notifications", headers=ah).json()
    assert [n["actor_first_name"] for n in after["notifications"]] == ["Cruz"]
    assert after["unread_count"] == 1


def test_blocking_clears_the_notification_it_sent_THEM_too(client, make_user):
    # Symmetric, or "invisible" would hold in only one direction.
    ana, ah = make_user()
    ben, bh = make_user()
    client.post("/friends/request", json={"to_user_id": ben.id}, headers=ah)
    assert client.get("/notifications", headers=bh).json()["unread_count"] == 1
    _block(client, ah, ben.id)
    assert client.get("/notifications", headers=bh).json()["notifications"] == []


def test_a_block_does_not_DELETE_your_bookmarks_of_their_recipes(client, make_user, db_session):
    """The Kept shelf prunes permanently when access is lost, which is right for the cook's own
    doing (restricted, unfriended, deleted) and wrong for a block: a block is the caller's own
    reversible choice, so pruning would make unblocking silently lossy with no warning. The
    recipe leaves the shelf; the save row stays, so unblocking brings it back."""
    from app.models.recipe_save import RecipeSave

    cook, ch = make_user()
    fan, fh = make_user()
    rec = _recipe(client, ch, name="Adobo", visibility="public")
    assert client.post(f"/recipes/{rec['id']}/save", headers=fh).status_code == 201
    assert [r["id"] for r in client.get("/recipes/kept", headers=fh).json()["recipes"]] == [rec["id"]]

    _block(client, fh, cook.id)

    shelf = client.get("/recipes/kept", headers=fh).json()
    assert shelf["recipes"] == []
    # Gone from view, but NOT reported as lost and NOT deleted.
    assert shelf["unreachable_count"] == 0
    assert db_session.query(RecipeSave).filter(RecipeSave.user_id == fan.id).count() == 1

    # ...so unblocking restores it, which is the whole point.
    assert client.delete(f"/friends/blocks/{cook.id}", headers=fh).status_code == 204
    assert [r["id"] for r in client.get("/recipes/kept", headers=fh).json()["recipes"]] == [rec["id"]]


def test_losing_access_for_any_OTHER_reason_still_prunes(client, make_user, db_session):
    # The block carve-out must not soften the existing rule it sits inside.
    from app.models.recipe_save import RecipeSave

    cook, ch = make_user()
    fan, fh = make_user()
    rec = _recipe(client, ch, name="Adobo", visibility="public")
    client.post(f"/recipes/{rec['id']}/save", headers=fh)
    client.patch(f"/recipes/{rec['id']}", json={"visibility": "private"}, headers=ch)

    shelf = client.get("/recipes/kept", headers=fh).json()
    assert shelf["recipes"] == []
    assert shelf["unreachable_count"] == 1
    assert db_session.query(RecipeSave).filter(RecipeSave.user_id == fan.id).count() == 0


def test_a_raced_pending_friend_request_cannot_be_accepted_across_a_block(
    client, make_user, db_session
):
    """`request_friend` refuses across a block and `block_user` deletes pending rows, but the two
    aren't serialized — a request landing between them survives. Without a guard in
    `accept_friend` the blocked person would then appear in GET /friends as an accepted friend.
    Simulated by inserting the row directly, which is what the race produces."""
    from app.models.friendship import Friendship

    ana, ah = make_user()
    ben, bh = make_user()
    _block(client, ah, ben.id)
    raced = Friendship(
        requester_id=ben.id,
        addressee_id=ana.id,
        state="pending",
        # The unordered-pair key the app sets on every insert; NOT NULL at the DB.
        pair_low=min(ana.id, ben.id),
        pair_high=max(ana.id, ben.id),
    )
    db_session.add(raced)
    db_session.commit()

    r = client.post(f"/friends/{raced.id}/accept", headers=ah)
    assert r.status_code == 404
    assert r.json() == {"detail": "Request not found"}
    assert client.get("/friends", headers=ah).json() == []


def test_browse_survives_a_token_with_a_non_numeric_subject(client, make_user):
    """`/recipes/browse` is the app's one anonymous JSON endpoint, so its optional-auth
    dependency must degrade to "no user" rather than 500 on anything it can't read."""
    from jose import jwt

    from app.config import settings

    _, ah = make_user()
    _recipe(client, ah, name="Public one", visibility="public")
    bad = jwt.encode({"sub": "not-a-number"}, settings.jwt_secret, algorithm=settings.algorithm)
    r = client.get("/recipes/browse", headers={"Authorization": f"Bearer {bad}"})
    assert r.status_code == 200
    assert [x["name"] for x in r.json()] == ["Public one"]


# --- the capability line: a token minted BEFORE the block still works (#88, owner call) ---


def test_a_link_only_token_minted_BEFORE_a_block_is_still_claimable(client, make_user):
    """Owner decision (#88, 2026-09-04): yes, claimable. The token IS the capability — the cook
    minted it and chose to share it, so claiming it completes a handoff that was already
    offered, exactly like an accepted grant surviving. A block stops NEW offers
    (`handoff_recipe` 404s across one); it does not retract one already made.

    Pinned because the opposite reading is just as arguable and someone will eventually
    "harden" this: don't, without changing the decision."""
    cook, ch = make_user()
    fan, fh = make_user()
    rec = _recipe(client, ch, name="Lola's adobo", visibility="private")
    # Link-only: no recipient named, so the token is the whole grant.
    token = client.post(f"/recipes/{rec['id']}/handoff", json={}, headers=ch).json()["token"]

    _block(client, ch, fan.id)

    assert client.post(f"/recipes/invite/{token}/claim", headers=fh).status_code == 200
    assert client.get(f"/recipes/{rec['id']}", headers=fh).status_code == 200


def test_an_email_invite_sent_BEFORE_a_block_survives_it(client, make_user):
    # Same #88 rule, the addressed-invite path — and the grant is now ACCEPTED at send time, because
    # the address belongs to an account. It used to be stored `pending` with `to_user_id` NULL, which
    # was the dead-grant bug: unreachable in every surface forever. So what this pins is the half of
    # #88 that still has teeth here — a grant that existed at block time keeps working, because the
    # cook genuinely handed that dish over and a block means "no new contact", not "unsend".
    cook, ch = make_user()
    fan, fh = make_user()
    rec = _recipe(client, ch, name="Given", visibility="private")
    h = client.post(
        f"/recipes/{rec['id']}/handoff", json={"to_email": fan.email}, headers=ch
    ).json()
    assert h["state"] == "accepted" and h["to_user_id"] == fan.id

    _block(client, ch, fan.id)

    # Accept stays idempotent on a grant already bound to the caller, and the read still works.
    assert client.post(f"/recipes/handoffs/{h['id']}/accept", headers=fh).status_code == 200
    assert client.get(f"/recipes/{rec['id']}", headers=fh).status_code == 200


def test_claiming_a_pre_block_token_grants_that_ONE_recipe_and_nothing_more(client, make_user):
    # The capability is per-recipe. Claiming one must not reopen the cook's other work — the
    # same scoping already asserted for an accepted grant, re-asserted on this path because it
    # MINTS a grant rather than reading an existing one.
    cook, ch = make_user()
    fan, fh = make_user()
    shared = _recipe(client, ch, name="Shared", visibility="private")
    other = _recipe(client, ch, name="Not shared", visibility="public")
    token = client.post(f"/recipes/{shared['id']}/handoff", json={}, headers=ch).json()["token"]

    _block(client, ch, fan.id)
    client.post(f"/recipes/invite/{token}/claim", headers=fh)

    assert client.get(f"/recipes/{shared['id']}", headers=fh).status_code == 200
    assert client.get(f"/recipes/{other['id']}", headers=fh).status_code == 404
    # ...and the block otherwise still holds in both directions.
    assert client.get(f"/friends/profile/{cook.id}", headers=fh).status_code == 404
