"""Recipe requests → the fulfill loop, and the notification inbox (#79).

The product rules under test are as much about what is NOT exposed as what is:

- the request COUNT is the cook's alone — never returned to anyone else, and never as 0
  (a public tally of wants is a like count with a different noun, and a visible zero under
  an ordinary meal is the thing this design exists to avoid);
- WHO asked is returned only to the cook;
- asking is allowed for anyone who can SEE the post, including a stranger on a public one;
- a post whose recipe the caller can't read is indistinguishable from one with no recipe,
  so the request path must behave identically for both and leak nothing either way;
- fulfilling delivers through the EXISTING handoff grant, so a private recipe reaches the
  requesters without its visibility changing.
"""

import pytest


def _post(client, headers, dish="Adobo", visibility="friends", recipe_id=None):
    body = {"photo_url": "https://res.cloudinary.com/demo/image/upload/a.jpg", "dish_name": dish, "visibility": visibility}
    if recipe_id is not None:
        body["recipe_id"] = recipe_id
    r = client.post("/posts", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _recipe(client, headers, name="Adobo", visibility="private"):
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


# --- who may ask ---


def test_a_friend_can_ask_for_the_recipe(client, make_user):
    cook, ch = make_user(first_name="Cook")
    fan, fh = make_user(first_name="Fan")
    _befriend(client, cook, ch, fan, fh)
    post = _post(client, ch)

    r = client.post(f"/posts/{post['id']}/request", headers=fh)
    assert r.status_code == 201
    assert r.json()["requested_by_me"] is True


def test_a_stranger_can_ask_on_a_PUBLIC_post(client, make_user):
    """Deliberately not friends-only. #71 put public meals in Browse so a stranger could
    find the dish; a dead end there would undo that."""
    cook, ch = make_user()
    stranger, sh = make_user()
    post = _post(client, ch, visibility="public")
    assert client.post(f"/posts/{post['id']}/request", headers=sh).status_code == 201


def test_a_stranger_cannot_ask_on_a_FRIENDS_post(client, make_user):
    # Not a new rule — it's can_view_post, and the 404 never confirms the post exists.
    cook, ch = make_user()
    stranger, sh = make_user()
    post = _post(client, ch, visibility="friends")
    assert client.post(f"/posts/{post['id']}/request", headers=sh).status_code == 404


def test_cannot_ask_yourself(client, make_user):
    cook, ch = make_user()
    post = _post(client, ch)
    assert client.post(f"/posts/{post['id']}/request", headers=ch).status_code == 400


def test_asking_twice_is_one_request(client, make_user, db_session):
    from app.models.recipe_request import RecipeRequest

    cook, ch = make_user()
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    post = _post(client, ch)
    client.post(f"/posts/{post['id']}/request", headers=fh)
    client.post(f"/posts/{post['id']}/request", headers=fh)
    assert db_session.query(RecipeRequest).count() == 1


def test_cannot_ask_when_you_can_already_read_the_recipe(client, make_user):
    """Nothing to ask for — and a request here could never be satisfied by fulfilment."""
    cook, ch = make_user()
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    rec = _recipe(client, ch, visibility="public")
    post = _post(client, ch, recipe_id=rec["id"])
    r = client.post(f"/posts/{post['id']}/request", headers=fh)
    assert r.status_code == 400


def test_CAN_ask_when_the_post_links_a_recipe_you_may_not_read(client, make_user):
    """The load-bearing privacy case. The post links a PRIVATE recipe, so the feed nulls
    recipe_id for this viewer — making it identical to "no recipe written". The request must
    therefore be allowed, and nothing in the response may reveal that a recipe exists."""
    cook, ch = make_user()
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    rec = _recipe(client, ch, visibility="private")
    post = _post(client, ch, recipe_id=rec["id"])

    seen = client.get(f"/posts/{post['id']}", headers=fh).json()
    assert seen["recipe_id"] is None  # indistinguishable from having none
    assert client.post(f"/posts/{post['id']}/request", headers=fh).status_code == 201


# --- the count is the cook's alone ---


def test_the_count_goes_to_the_cook_and_to_nobody_else(client, make_user):
    cook, ch = make_user()
    fan, fh = make_user()
    other, oh = make_user()
    _befriend(client, cook, ch, fan, fh)
    _befriend(client, cook, ch, other, oh)
    post = _post(client, ch)
    client.post(f"/posts/{post['id']}/request", headers=fh)
    client.post(f"/posts/{post['id']}/request", headers=oh)

    assert client.get(f"/posts/{post['id']}", headers=ch).json()["request_count"] == 2
    # Not 0 — None. A viewer must not be handed a number it could render as a tally.
    for headers in (fh, oh):
        body = client.get(f"/posts/{post['id']}", headers=headers).json()
        assert body["request_count"] is None
        assert body["requested_by_me"] is True


def test_a_viewer_never_learns_that_someone_else_asked(client, make_user):
    cook, ch = make_user()
    fan, fh = make_user()
    other, oh = make_user()
    _befriend(client, cook, ch, fan, fh)
    _befriend(client, cook, ch, other, oh)
    post = _post(client, ch)
    client.post(f"/posts/{post['id']}/request", headers=fh)

    body = client.get(f"/posts/{post['id']}", headers=oh).json()
    assert body["request_count"] is None
    assert body["requested_by_me"] is False  # only ever about yourself


def test_the_feed_carries_the_same_rule(client, make_user):
    cook, ch = make_user()
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    post = _post(client, ch)
    client.post(f"/posts/{post['id']}/request", headers=fh)

    mine = client.get("/posts/feed", headers=ch).json()
    assert [p["request_count"] for p in mine if p["id"] == post["id"]] == [1]
    theirs = client.get("/posts/feed", headers=fh).json()
    row = next(p for p in theirs if p["id"] == post["id"])
    assert row["request_count"] is None and row["requested_by_me"] is True


# --- retracting ---


def test_you_can_take_back_your_own_ask_only(client, make_user):
    cook, ch = make_user()
    fan, fh = make_user()
    other, oh = make_user()
    _befriend(client, cook, ch, fan, fh)
    _befriend(client, cook, ch, other, oh)
    post = _post(client, ch)
    client.post(f"/posts/{post['id']}/request", headers=fh)
    client.post(f"/posts/{post['id']}/request", headers=oh)

    r = client.delete(f"/posts/{post['id']}/request", headers=fh)
    assert r.status_code == 200 and r.json()["requested_by_me"] is False
    # The other person's ask is untouched.
    assert client.get(f"/posts/{post['id']}", headers=ch).json()["request_count"] == 1
    assert client.get(f"/posts/{post['id']}", headers=oh).json()["requested_by_me"] is True


# --- the cook's requests page ---


def test_the_cook_sees_who_asked(client, make_user):
    cook, ch = make_user()
    fan, fh = make_user(first_name="Ana")
    _befriend(client, cook, ch, fan, fh)
    post = _post(client, ch, dish="Sinigang")
    client.post(f"/posts/{post['id']}/request", headers=fh)

    rows = client.get("/posts/requests/incoming", headers=ch).json()
    assert len(rows) == 1
    assert rows[0]["post"]["dish_name"] == "Sinigang"
    assert [r["first_name"] for r in rows[0]["requesters"]] == ["Ana"]


def test_the_requests_page_shows_only_your_own_posts(client, make_user):
    cook, ch = make_user()
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    post = _post(client, ch)
    client.post(f"/posts/{post['id']}/request", headers=fh)
    # The requester's own incoming list is empty — it's the COOK's surface.
    assert client.get("/posts/requests/incoming", headers=fh).json() == []


def test_requests_incoming_resolves_as_its_own_path(client, make_user):
    # NOT an ordering test, despite looking like one: /posts/requests/incoming is two path
    # segments and /posts/{post_id} is one, so declaration order is irrelevant here and this
    # would pass either way. Kept as a plain smoke test that the literal path resolves — the
    # ordering discipline still matters for one-segment literals, just not for this route.
    _, ch = make_user()
    assert client.get("/posts/requests/incoming", headers=ch).status_code == 200


# --- fulfilling ---


def test_fulfilling_delivers_a_PRIVATE_recipe_without_making_it_public(client, make_user):
    """The heart of the design: delivery is the existing handoff grant, which is orthogonal
    to visibility in can_view. So the cook can answer an ask without publishing anything."""
    cook, ch = make_user()
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    post = _post(client, ch)
    client.post(f"/posts/{post['id']}/request", headers=fh)

    rec = _recipe(client, ch, name="Lola's adobo", visibility="private")
    r = client.post(f"/posts/{post['id']}/fulfill", json={"recipe_id": rec["id"]}, headers=ch)
    assert r.status_code == 200

    # The requester can now read it...
    got = client.get(f"/recipes/{rec['id']}", headers=fh)
    assert got.status_code == 200 and got.json()["name"] == "Lola's adobo"
    # ...and it is STILL private.
    assert got.json()["visibility"] == "private"
    # ...and it arrived on their Kept shelf.
    kept = client.get("/recipes/kept", headers=fh).json()
    assert rec["id"] in [x["id"] for x in kept["recipes"]]


def test_fulfilling_grants_only_the_people_who_asked(client, make_user):
    cook, ch = make_user()
    asker, ah = make_user()
    quiet, qh = make_user()
    _befriend(client, cook, ch, asker, ah)
    _befriend(client, cook, ch, quiet, qh)
    post = _post(client, ch)
    client.post(f"/posts/{post['id']}/request", headers=ah)

    rec = _recipe(client, ch, visibility="private")
    client.post(f"/posts/{post['id']}/fulfill", json={"recipe_id": rec["id"]}, headers=ch)

    assert client.get(f"/recipes/{rec['id']}", headers=ah).status_code == 200
    # A friend who never asked gets nothing — fulfilment is not a broadcast.
    assert client.get(f"/recipes/{rec['id']}", headers=qh).status_code == 404


def test_fulfilling_is_idempotent(client, make_user, db_session):
    from app.models.handoff import Handoff

    cook, ch = make_user()
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    post = _post(client, ch)
    client.post(f"/posts/{post['id']}/request", headers=fh)
    rec = _recipe(client, ch, visibility="private")

    client.post(f"/posts/{post['id']}/fulfill", json={"recipe_id": rec["id"]}, headers=ch)
    client.post(f"/posts/{post['id']}/fulfill", json={"recipe_id": rec["id"]}, headers=ch)
    grants = db_session.query(Handoff).filter(Handoff.recipe_id == rec["id"]).all()
    assert len(grants) == 1


def test_the_same_recipe_answering_TWO_posts_does_not_stack_grants(client, make_user, db_session):
    """The path the idempotency test above does NOT reach: replaying fulfil finds nothing
    pending and returns early, so the `already` dedupe set is never exercised. Two different
    posts asked by the SAME person, answered with the SAME recipe, is what tests it."""
    from app.models.handoff import Handoff

    cook, ch = make_user()
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    first = _post(client, ch, dish="Adobo Monday")
    second = _post(client, ch, dish="Adobo Friday")
    client.post(f"/posts/{first['id']}/request", headers=fh)
    client.post(f"/posts/{second['id']}/request", headers=fh)

    rec = _recipe(client, ch, visibility="private")
    client.post(f"/posts/{first['id']}/fulfill", json={"recipe_id": rec["id"]}, headers=ch)
    client.post(f"/posts/{second['id']}/fulfill", json={"recipe_id": rec["id"]}, headers=ch)

    grants = db_session.query(Handoff).filter(Handoff.recipe_id == rec["id"]).all()
    assert len(grants) == 1  # one person, one grant, however many posts asked
    assert client.get(f"/recipes/{rec['id']}", headers=fh).status_code == 200


def test_only_the_author_can_fulfil_their_post(client, make_user):
    cook, ch = make_user()
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    post = _post(client, ch)
    client.post(f"/posts/{post['id']}/request", headers=fh)
    theirs = _recipe(client, fh, visibility="public")
    # Read is not write: a requester can't answer the ask on someone else's post.
    assert (
        client.post(
            f"/posts/{post['id']}/fulfill", json={"recipe_id": theirs["id"]}, headers=fh
        ).status_code
        == 404
    )


def test_cannot_fulfil_with_a_recipe_that_is_not_yours(client, make_user):
    cook, ch = make_user()
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    post = _post(client, ch)
    client.post(f"/posts/{post['id']}/request", headers=fh)
    not_mine = _recipe(client, fh, visibility="public")
    assert (
        client.post(
            f"/posts/{post['id']}/fulfill", json={"recipe_id": not_mine["id"]}, headers=ch
        ).status_code
        == 404
    )


def test_after_fulfilment_the_ask_is_gone_and_the_link_is_there(client, make_user):
    cook, ch = make_user()
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    post = _post(client, ch)
    client.post(f"/posts/{post['id']}/request", headers=fh)
    rec = _recipe(client, ch, visibility="private")
    client.post(f"/posts/{post['id']}/fulfill", json={"recipe_id": rec["id"]}, headers=ch)

    # The cook's pending count drops to 0 and the requests page empties.
    assert client.get(f"/posts/{post['id']}", headers=ch).json()["request_count"] == 0
    assert client.get("/posts/requests/incoming", headers=ch).json() == []
    # The requester now sees the recipe link instead of an ask.
    seen = client.get(f"/posts/{post['id']}", headers=fh).json()
    assert seen["recipe_id"] == rec["id"] and seen["requested_by_me"] is False


# --- the inbox ---


def test_the_cook_is_notified_of_an_ask_and_the_requester_of_delivery(client, make_user):
    cook, ch = make_user()
    fan, fh = make_user(first_name="Ana")
    _befriend(client, cook, ch, fan, fh)
    post = _post(client, ch, dish="Sinigang")
    client.post(f"/posts/{post['id']}/request", headers=fh)

    inbox = client.get("/notifications", headers=ch).json()
    asks = [n for n in inbox["notifications"] if n["type"] == "recipe_request"]
    assert len(asks) == 1
    assert asks[0]["actor_first_name"] == "Ana"
    assert asks[0]["subject"] == "Sinigang"
    assert asks[0]["read"] is False

    rec = _recipe(client, ch, name="Lola's sinigang", visibility="private")
    client.post(f"/posts/{post['id']}/fulfill", json={"recipe_id": rec["id"]}, headers=ch)
    theirs = client.get("/notifications", headers=fh).json()
    done = [n for n in theirs["notifications"] if n["type"] == "request_fulfilled"]
    assert len(done) == 1
    assert done[0]["recipe_id"] == rec["id"]
    assert done[0]["subject"] == "Lola's sinigang"


def test_a_notification_is_only_ever_the_recipients(client, make_user):
    cook, ch = make_user()
    fan, fh = make_user()
    nosy, nh = make_user()
    _befriend(client, cook, ch, fan, fh)
    post = _post(client, ch)
    client.post(f"/posts/{post['id']}/request", headers=fh)
    # Neither the actor nor an unrelated third party sees the cook's ask notification.
    # (fh's inbox is NOT empty — befriending legitimately notified them — so assert on the
    # type rather than emptiness, which would pass for the wrong reason.)
    fan_types = [n["type"] for n in client.get("/notifications", headers=fh).json()["notifications"]]
    assert "recipe_request" not in fan_types
    assert client.get("/notifications", headers=nh).json()["notifications"] == []


def test_you_are_never_notified_about_your_own_action(client, make_user):
    # request_friend notifies the addressee; the sender must not get a copy.
    a, ah = make_user()
    b, bh = make_user()
    client.post("/friends/request", json={"to_user_id": b.id}, headers=ah)
    assert client.get("/notifications", headers=ah).json()["notifications"] == []
    assert client.get("/notifications", headers=bh).json()["unread_count"] == 1


def test_friend_requests_and_accepts_land_in_the_same_inbox(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    fid = client.post("/friends/request", json={"to_user_id": b.id}, headers=ah).json()["id"]
    assert [n["type"] for n in client.get("/notifications", headers=bh).json()["notifications"]] == [
        "friend_request"
    ]
    client.post(f"/friends/{fid}/accept", headers=bh)
    assert [n["type"] for n in client.get("/notifications", headers=ah).json()["notifications"]] == [
        "friend_accept"
    ]


def test_marking_read_clears_the_badge_and_is_idempotent(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    client.post("/friends/request", json={"to_user_id": b.id}, headers=ah)
    assert client.get("/notifications", headers=bh).json()["unread_count"] == 1

    after = client.post("/notifications/read", headers=bh).json()
    assert after["unread_count"] == 0
    assert all(n["read"] for n in after["notifications"])
    # Second call changes nothing (and doesn't rewrite timestamps).
    assert client.post("/notifications/read", headers=bh).json()["unread_count"] == 0


def test_marking_read_cannot_touch_someone_elses_notifications(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    c, chh = make_user()
    client.post("/friends/request", json={"to_user_id": b.id}, headers=ah)
    target = client.get("/notifications", headers=bh).json()["notifications"][0]["id"]
    # C names B's notification id. Scoping is by user_id, so nothing happens.
    client.post("/notifications/read", json={"ids": [target]}, headers=chh)
    assert client.get("/notifications", headers=bh).json()["unread_count"] == 1


def test_notifications_require_auth(client):
    assert client.get("/notifications").status_code == 401
    assert client.post("/notifications/read").status_code == 401


def test_a_notification_survives_its_post_being_deleted(client, make_user):
    """SET NULL, not CASCADE: the ask still happened, so the line stays — it just stops
    being a link. A deleted reference must never 404 the whole inbox."""
    cook, ch = make_user()
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    post = _post(client, ch)
    client.post(f"/posts/{post['id']}/request", headers=fh)
    assert client.delete(f"/posts/{post['id']}", headers=ch).status_code == 204

    inbox = client.get("/notifications", headers=ch).json()
    asks = [n for n in inbox["notifications"] if n["type"] == "recipe_request"]
    assert len(asks) == 1
    assert asks[0]["post_id"] is None  # no dead link


# --- re-asking after a fulfilment (the silent dead-end) ---


def test_you_can_ask_AGAIN_after_a_fulfilment(client, make_user, db_session):
    """The bug this pins: the unique (post, requester) row survives delivery as
    state='fulfilled', and treating that as "already asked" made the button permanently
    dead — 201 with requested_by_me false, no row, no notification, no error, forever.

    Reachable purely through the UI: ask → cook fulfils → the cook later answers the same
    post with a DIFFERENT recipe you can't read → your card offers the ask again."""
    from app.models.recipe_request import RecipeRequest

    cook, ch = make_user()
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    post = _post(client, ch)
    client.post(f"/posts/{post['id']}/request", headers=fh)

    first = _recipe(client, ch, name="First try", visibility="private")
    client.post(f"/posts/{post['id']}/fulfill", json={"recipe_id": first["id"]}, headers=ch)

    # The cook answers the post again with a recipe this fan has no grant for.
    other, oh = make_user()
    _befriend(client, cook, ch, other, oh)
    client.post(f"/posts/{post['id']}/request", headers=oh)
    second = _recipe(client, ch, name="Second try", visibility="private")
    client.post(f"/posts/{post['id']}/fulfill", json={"recipe_id": second["id"]}, headers=ch)

    # The first fan can no longer read the post's linked recipe, so the ask is offered again.
    seen = client.get(f"/posts/{post['id']}", headers=fh).json()
    assert seen["recipe_id"] is None and seen["requested_by_me"] is False

    r = client.post(f"/posts/{post['id']}/request", headers=fh)
    assert r.status_code == 201
    # It ACTUALLY took: the row is pending again and the cook can see the ask.
    assert r.json()["requested_by_me"] is True
    rows = db_session.query(RecipeRequest).filter(
        RecipeRequest.post_id == post["id"], RecipeRequest.requester_id == fan.id
    ).all()
    assert len(rows) == 1 and rows[0].state == "pending"
    assert client.get(f"/posts/{post['id']}", headers=ch).json()["request_count"] >= 1


def test_re_asking_does_not_create_a_second_row(client, make_user, db_session):
    from app.models.recipe_request import RecipeRequest

    cook, ch = make_user()
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    post = _post(client, ch)
    client.post(f"/posts/{post['id']}/request", headers=fh)
    client.delete(f"/posts/{post['id']}/request", headers=fh)
    client.post(f"/posts/{post['id']}/request", headers=fh)
    assert db_session.query(RecipeRequest).count() == 1


# --- the inbox can't be flooded ---


def test_ask_retract_looping_does_not_flood_the_cooks_inbox(client, make_user):
    """Asking and retracting are both deliberately free, and retracting deliberately keeps
    the cook's notification (they were told something true). Without dedupe that combination
    is an unbounded inbox flood — available to any signed-in stranger on any public post,
    with no rate limiting anywhere in the app."""
    cook, ch = make_user()
    fan, fh = make_user()
    post = _post(client, ch, visibility="public")

    for _ in range(6):
        client.post(f"/posts/{post['id']}/request", headers=fh)
        client.delete(f"/posts/{post['id']}/request", headers=fh)

    inbox = client.get("/notifications", headers=ch).json()
    asks = [n for n in inbox["notifications"] if n["type"] == "recipe_request"]
    assert len(asks) == 1, f"6 cycles produced {len(asks)} notifications"


def test_a_fresh_ask_after_the_cook_has_READ_the_last_one_is_news_again(client, make_user):
    # Dedupe suppresses only while UNREAD. Once the cook has seen and cleared it, asking
    # again is genuinely new information and must reach them.
    cook, ch = make_user()
    fan, fh = make_user()
    post = _post(client, ch, visibility="public")

    client.post(f"/posts/{post['id']}/request", headers=fh)
    client.post("/notifications/read", headers=ch)
    client.delete(f"/posts/{post['id']}/request", headers=fh)
    client.post(f"/posts/{post['id']}/request", headers=fh)

    inbox = client.get("/notifications", headers=ch).json()
    assert inbox["unread_count"] == 1
    asks = [n for n in inbox["notifications"] if n["type"] == "recipe_request"]
    assert len(asks) == 2


def test_dedupe_is_per_post_not_per_person(client, make_user):
    # Two different meals from the same cook are two different asks.
    cook, ch = make_user()
    fan, fh = make_user()
    a = _post(client, ch, dish="Adobo", visibility="public")
    b = _post(client, ch, dish="Sinigang", visibility="public")
    client.post(f"/posts/{a['id']}/request", headers=fh)
    client.post(f"/posts/{b['id']}/request", headers=fh)
    inbox = client.get("/notifications", headers=ch).json()
    assert len([n for n in inbox["notifications"] if n["type"] == "recipe_request"]) == 2
