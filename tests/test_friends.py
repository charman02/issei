"""The friend graph (social feed Phase 0).

Symmetric friends, both-accept. SCOPE + AUTHORIZATION is the whole story here, same
as sharing: only the addressee may accept; a non-party can't touch or probe a
friendship; suggestions come only from the handoff graph, never strangers.
"""


def _recipe(client, headers, name="Adobo", visibility="private"):
    r = client.post(
        "/recipes",
        json={"name": name, "visibility": visibility, "steps": [{"content": "Cook", "position": 1}]},
        headers=headers,
    )
    assert r.status_code == 201
    return r.json()


def _handoff(client, owner_headers, recipe_id, to_user_id):
    r = client.post(
        f"/recipes/{recipe_id}/handoff", json={"to_user_id": to_user_id}, headers=owner_headers
    )
    assert r.status_code == 201
    return r.json()


# --- requesting + accepting ---


def test_request_then_accept_makes_friends(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    r = client.post("/friends/request", json={"to_user_id": b.id}, headers=ah)
    assert r.status_code == 201
    fid = r.json()["id"]
    assert r.json()["state"] == "pending"
    assert r.json()["outgoing"] is True
    assert r.json()["user_id"] == b.id  # the OTHER person, from A's view

    # B sees it as an incoming request they can accept.
    reqs = client.get("/friends/requests", headers=bh).json()
    assert len(reqs) == 1 and reqs[0]["user_id"] == a.id and reqs[0]["outgoing"] is False

    acc = client.post(f"/friends/{fid}/accept", headers=bh)
    assert acc.status_code == 200 and acc.json()["state"] == "accepted"

    # Both now list each other as a friend.
    assert [f["user_id"] for f in client.get("/friends", headers=ah).json()] == [b.id]
    assert [f["user_id"] for f in client.get("/friends", headers=bh).json()] == [a.id]


def test_cannot_friend_yourself(client, make_user):
    a, ah = make_user()
    r = client.post("/friends/request", json={"to_user_id": a.id}, headers=ah)
    assert r.status_code == 400


def test_request_to_unknown_user_404(client, make_user):
    _, ah = make_user()
    r = client.post("/friends/request", json={"to_user_id": 999999}, headers=ah)
    assert r.status_code == 404


def test_only_the_addressee_may_accept(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    stranger, sh = make_user()
    fid = client.post("/friends/request", json={"to_user_id": b.id}, headers=ah).json()["id"]
    # The requester can't accept their own request...
    assert client.post(f"/friends/{fid}/accept", headers=ah).status_code == 404
    # ...nor can an unrelated user.
    assert client.post(f"/friends/{fid}/accept", headers=sh).status_code == 404
    # The addressee can.
    assert client.post(f"/friends/{fid}/accept", headers=bh).status_code == 200


def test_reverse_request_accepts_the_pending_one(client, make_user):
    # A requests B; then B requests A back — that mutual intent should resolve to
    # accepted without a second row.
    a, ah = make_user()
    b, bh = make_user()
    client.post("/friends/request", json={"to_user_id": b.id}, headers=ah)
    r = client.post("/friends/request", json={"to_user_id": a.id}, headers=bh)
    assert r.status_code == 201 and r.json()["state"] == "accepted"
    assert [f["user_id"] for f in client.get("/friends", headers=ah).json()] == [b.id]


def test_duplicate_request_returns_existing_not_a_second_row(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    first = client.post("/friends/request", json={"to_user_id": b.id}, headers=ah).json()
    second = client.post("/friends/request", json={"to_user_id": b.id}, headers=ah).json()
    assert first["id"] == second["id"]


def test_one_row_per_unordered_pair(client, make_user, db_session):
    # The DB-level guard: uq_friendship_pair is on the NORMALIZED (low, high) pair,
    # so no direction of requesting can create a second row for the same two people.
    from app.models.friendship import Friendship

    a, ah = make_user()
    b, bh = make_user()
    client.post("/friends/request", json={"to_user_id": b.id}, headers=ah)
    client.post("/friends/request", json={"to_user_id": a.id}, headers=bh)  # reverse
    client.post("/friends/request", json={"to_user_id": b.id}, headers=ah)  # dup
    rows = db_session.query(Friendship).all()
    assert len(rows) == 1
    # pair_low/pair_high are normalized (min, max) regardless of who requested.
    row = rows[0]
    assert row.pair_low == min(a.id, b.id)
    assert row.pair_high == max(a.id, b.id)


# --- removing ---


def test_either_party_can_unfriend(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    fid = client.post("/friends/request", json={"to_user_id": b.id}, headers=ah).json()["id"]
    client.post(f"/friends/{fid}/accept", headers=bh)
    assert client.delete(f"/friends/{fid}", headers=bh).status_code == 204
    assert client.get("/friends", headers=ah).json() == []
    assert client.get("/friends", headers=bh).json() == []


def test_non_party_cannot_delete_a_friendship(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    stranger, sh = make_user()
    fid = client.post("/friends/request", json={"to_user_id": b.id}, headers=ah).json()["id"]
    assert client.delete(f"/friends/{fid}", headers=sh).status_code == 404


# --- suggestions: handoff graph only ---


def test_suggestions_come_from_the_handoff_graph(client, make_user):
    a, ah = make_user()      # cooks
    b, b_obj = make_user()   # A hands a recipe TO them
    c, c_obj = make_user()   # hands a recipe to A
    stranger, sh = make_user()  # no handoff either way

    # A → B (A owns a recipe, hands it to B)
    rec_a = _recipe(client, ah, "A's dish")
    _handoff(client, ah, rec_a["id"], b.id)
    # C → A (C owns a recipe, hands it to A)
    rec_c = _recipe(client, c_obj, "C's dish")
    _handoff(client, c_obj, rec_c["id"], a.id)

    sugg = client.get("/friends/suggestions", headers=ah).json()
    by_id = {s["user_id"]: s for s in sugg}
    assert b.id in by_id and by_id[b.id]["reason"] == "sent"
    assert c.id in by_id and by_id[c.id]["reason"] == "received"
    # A stranger with no handoff to/from A is never suggested.
    assert stranger.id not in by_id


def test_suggestions_exclude_existing_friends_and_pending(client, make_user):
    a, ah = make_user()
    b, b_obj = make_user()
    rec = _recipe(client, ah, "shared")
    _handoff(client, ah, rec["id"], b.id)
    # Before any friendship, B is suggested.
    assert b.id in {s["user_id"] for s in client.get("/friends/suggestions", headers=ah).json()}
    # Once a request exists, B drops out of suggestions.
    client.post("/friends/request", json={"to_user_id": b.id}, headers=ah)
    assert b.id not in {s["user_id"] for s in client.get("/friends/suggestions", headers=ah).json()}


# --- profile ---


def test_profile_shows_friend_state_and_public_recipe_count(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    _recipe(client, bh, "B public", visibility="public")
    _recipe(client, bh, "B private", visibility="private")

    prof = client.get(f"/friends/profile/{b.id}", headers=ah).json()
    assert prof["user_id"] == b.id
    assert prof["friend_state"] is None
    # Only B's PUBLIC recipe is counted for a non-friend — private isn't leaked.
    assert prof["recipe_count"] == 1


def test_profile_counts_all_own_recipes(client, make_user):
    a, ah = make_user()
    _recipe(client, ah, "mine public", visibility="public")
    _recipe(client, ah, "mine private", visibility="private")
    prof = client.get(f"/friends/profile/{a.id}", headers=ah).json()
    assert prof["recipe_count"] == 2  # own profile sees all


def test_profile_reports_friend_count(client, make_user):
    # friend_count is a public, symmetric fact — not gated by the caller. Powers the
    # "You" page identity-box counts.
    a, ah = make_user()
    b, bh = make_user()
    c, ch = make_user()
    # a befriends both b and c.
    for other, oh in [(b, bh), (c, ch)]:
        fid = client.post("/friends/request", json={"to_user_id": other.id}, headers=ah).json()["id"]
        client.post(f"/friends/{fid}/accept", headers=oh)
    # A's own profile reports 2 friends...
    assert client.get(f"/friends/profile/{a.id}", headers=ah).json()["friend_count"] == 2
    # ...and a stranger sees the same count (it's not gated).
    stranger, sh = make_user()
    assert client.get(f"/friends/profile/{a.id}", headers=sh).json()["friend_count"] == 2
    # B has just the one friend (a).
    assert client.get(f"/friends/profile/{b.id}", headers=bh).json()["friend_count"] == 1


def test_profile_reports_pending_acceptability(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    client.post("/friends/request", json={"to_user_id": b.id}, headers=ah)
    # From B's side, the pending request is acceptable.
    prof_from_b = client.get(f"/friends/profile/{a.id}", headers=bh).json()
    assert prof_from_b["friend_state"] == "pending" and prof_from_b["friend_can_accept"] is True
    # From A's side (the requester), it's pending but NOT acceptable by them.
    prof_from_a = client.get(f"/friends/profile/{b.id}", headers=ah).json()
    assert prof_from_a["friend_state"] == "pending" and prof_from_a["friend_can_accept"] is False


def test_all_friends_endpoints_require_auth(client, make_user):
    make_user()
    assert client.get("/friends").status_code == 401
    assert client.get("/friends/requests").status_code == 401
    assert client.get("/friends/suggestions").status_code == 401
    assert client.post("/friends/request", json={"to_user_id": 1}).status_code == 401


# --- GET /friends?order=active (the Feed presence strip, #75) ---
#
# The strip re-sorts the SAME accepted-friends list by who posted most recently. The
# privacy invariant is the point: a friend's PRIVATE post must not move them up the
# caller's strip, because that would leak that a hidden post exists.


def _accept(client, ah, bh, b):
    """Make the caller (ah) and b accepted friends; return nothing."""
    fid = client.post("/friends/request", json={"to_user_id": b.id}, headers=ah).json()["id"]
    client.post(f"/friends/{fid}/accept", headers=bh)


def _post(client, headers, visibility="friends", dish="Dish"):
    r = client.post(
        "/posts",
        json={"photo_url": "https://res.cloudinary.com/demo/image/upload/x.jpg", "dish_name": dish, "visibility": visibility},
        headers=headers,
    )
    assert r.status_code == 201
    return r.json()


def test_default_order_is_not_reshuffled_by_posting(client, make_user):
    # The Friends management page (default order) is friendship-based and must NOT
    # reshuffle when a friend posts — only the Feed's ?order=active does that. Asserted
    # as stability (query the default before and after a post, expect the same list)
    # rather than a fixed sequence: two friendships created in the same test share a
    # second-granularity created_at, so their tie-break is the DB's to decide, not ours.
    _, mh = make_user()
    a, ah = make_user()
    b, bh = make_user()
    _accept(client, mh, ah, a)
    _accept(client, mh, bh, b)
    before = [f["user_id"] for f in client.get("/friends", headers=mh).json()]
    _post(client, ah)  # a friend posts
    after = [f["user_id"] for f in client.get("/friends", headers=mh).json()]
    assert after == before  # default order is unmoved by the post
    # ...whereas the active order now leads with the poster.
    active = [f["user_id"] for f in client.get("/friends?order=active", headers=mh).json()]
    assert active[0] == a.id


def test_order_active_surfaces_recent_posters_first(client, make_user):
    _, mh = make_user()
    a, ah = make_user()
    b, bh = make_user()
    c, ch = make_user()
    _accept(client, mh, ah, a)
    _accept(client, mh, bh, b)
    _accept(client, mh, ch, c)
    # B posts, then A posts (A is now the most-recent poster). C never posts.
    _post(client, bh)
    _post(client, ah)
    order = [f["user_id"] for f in client.get("/friends?order=active", headers=mh).json()]
    # A (latest post) then B (older post) then C (never posted, falls to the back).
    assert order == [a.id, b.id, c.id]
    # And it's still the whole friend list — quiet friends aren't dropped.
    assert set(order) == {a.id, b.id, c.id}


def test_order_active_ignores_a_friends_private_post(client, make_user):
    # THE PRIVACY TEST. A posts PUBLICLY (old); B posts PRIVATELY (new). If the private
    # post counted, B would jump ahead of A and reveal to `me` that B posted something
    # hidden. It must not: only visible posts (public/friends) order the strip.
    _, mh = make_user()
    a, ah = make_user()
    b, bh = make_user()
    _accept(client, mh, ah, a)
    _accept(client, mh, bh, b)
    _post(client, ah, visibility="public")   # A's visible post, older
    _post(client, bh, visibility="private")  # B's private post, newer — must not count
    order = [f["user_id"] for f in client.get("/friends?order=active", headers=mh).json()]
    # A leads on their visible post; B has no visible post, so falls behind by friendship
    # recency — exactly as if B had never posted.
    assert order == [a.id, b.id]


def test_order_active_counts_a_friends_only_post(client, make_user):
    # The mirror of the privacy test: a "friends" post IS visible to an accepted friend,
    # so it legitimately orders the strip.
    _, mh = make_user()
    a, ah = make_user()
    b, bh = make_user()
    _accept(client, mh, ah, a)
    _accept(client, mh, bh, b)
    _post(client, ah, visibility="friends")  # A older
    _post(client, bh, visibility="friends")  # B newer → leads
    order = [f["user_id"] for f in client.get("/friends?order=active", headers=mh).json()]
    assert order == [b.id, a.id]


def test_order_active_with_no_friends_is_empty(client, make_user):
    _, mh = make_user()
    assert client.get("/friends?order=active", headers=mh).json() == []


def test_order_rejects_an_unknown_value(client, make_user):
    _, mh = make_user()
    # The Literal enum makes a bogus order a 422, not a silent fallback.
    assert client.get("/friends?order=nonsense", headers=mh).status_code == 422


# --- the app-wide directory (#80) ---
#
# The find-friends fix for a real user who couldn't work out how to add anyone. The
# suggestions list above is the HANDOFF graph, so a user with no handoffs saw nothing;
# this endpoint answers "who else is here?". What matters in tests: it excludes exactly
# the people an Add button would be wrong for, the search reaches past the on-screen
# page, and it never becomes an address book.


def test_discover_lists_everyone_else(client, make_user):
    a, ah = make_user(first_name="Ana")
    b, _ = make_user(first_name="Ben")
    c, _ = make_user(first_name="Cruz")
    rows = client.get("/friends/discover", headers=ah).json()
    # Literal path, not swallowed by /profile/{user_id} (which would 422 on "discover").
    assert {p["user_id"] for p in rows} == {b.id, c.id}
    # Never yourself — an Add button pointing at you is a 400 waiting to happen.
    assert a.id not in {p["user_id"] for p in rows}


def test_discover_never_returns_email(client, make_user):
    _, ah = make_user()
    make_user()
    rows = client.get("/friends/discover", headers=ah).json()
    assert rows and all("email" not in p for p in rows)
    # Pinned as an exact set on purpose: a directory row is the app's widest disclosure
    # surface, so a field ARRIVING here should have to be a deliberate edit to this line.
    assert set(rows[0]) == {
        "user_id",
        "first_name",
        "last_name",
        "photo_url",
        "friend_state",
    }


def test_discover_excludes_accepted_friends(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    c, _ = make_user()
    fid = client.post("/friends/request", json={"to_user_id": b.id}, headers=ah).json()["id"]
    client.post(f"/friends/{fid}/accept", headers=bh)
    rows = client.get("/friends/discover", headers=ah).json()
    assert {p["user_id"] for p in rows} == {c.id}  # b is already a friend


def test_discover_KEEPS_someone_YOU_asked_and_labels_them_requested(client, make_user):
    """Your own OUTGOING request must NOT remove someone from the directory. Reported by a real
    user: tapping Add made the person vanish, which reads as "did that work, or did I just
    delete them?" The row stays and carries `friend_state="requested"` instead.

    An INCOMING request is different and stays hidden: it already has a home in
    GET /friends/requests, which the Friends page renders above this section with
    Accept/Ignore. Listing it here too put one request on screen twice with two live Accept
    buttons. So the rule is the same one accepted friends get — if it lives in another
    endpoint, it isn't duplicated here."""
    a, ah = make_user()
    b, _ = make_user()
    c, ch = make_user()
    d, _ = make_user()
    client.post("/friends/request", json={"to_user_id": b.id}, headers=ah)  # a → b (outgoing)
    client.post("/friends/request", json={"to_user_id": a.id}, headers=ch)  # c → a (incoming)

    rows = {p["user_id"]: p for p in client.get("/friends/discover", headers=ah).json()}
    assert set(rows) == {b.id, d.id}  # b stays and is labelled; c is in /friends/requests
    assert rows[b.id]["friend_state"] == "requested"
    assert rows[d.id]["friend_state"] == "none"
    # ...and c really is reachable there, so nothing is lost by hiding them here.
    assert [r["user_id"] for r in client.get("/friends/requests", headers=ah).json()] == [c.id]


def test_someone_you_asked_is_exempt_from_the_discover_cap(client, make_user):
    """The cap and the "Requested" label would otherwise fight each other past 50 users:
    spending cap slots on un-addable rows, or letting the cap drop them and reintroducing the
    disappearance the label exists to prevent. So the cap applies only to addable strangers.

    Built with DISCOVER_LIMIT + 1 strangers so the cap is genuinely binding, then a request to
    the OLDEST of them — the one guaranteed to be off the newest-first page."""
    from app.routers.friends import DISCOVER_LIMIT

    a, ah = make_user(first_name="Ana")
    others = [make_user()[0] for _ in range(DISCOVER_LIMIT + 1)]
    oldest = others[0]

    # Before asking: the cap is binding and the oldest is off the page.
    rows = client.get("/friends/discover", headers=ah).json()
    assert len(rows) == DISCOVER_LIMIT
    assert oldest.id not in {r["user_id"] for r in rows}

    client.post("/friends/request", json={"to_user_id": oldest.id}, headers=ah)

    rows = client.get("/friends/discover", headers=ah).json()
    by_id = {r["user_id"]: r for r in rows}
    # Now present DESPITE being past the cap, and labelled.
    assert by_id[oldest.id]["friend_state"] == "requested"
    # ...and the cap still spends its full allowance on addable strangers, so asking someone
    # doesn't cost you a stranger slot.
    assert sum(1 for r in rows if r["friend_state"] == "none") == DISCOVER_LIMIT


def test_the_cap_exemption_still_honours_the_search_term(client, make_user):
    # The exempt half runs through the same filtered query, so ?q= can't be bypassed by it.
    a, ah = make_user(first_name="Ana")
    b, _ = make_user(first_name="Zebedee")
    client.post("/friends/request", json={"to_user_id": b.id}, headers=ah)
    assert [r["user_id"] for r in client.get("/friends/discover?q=zeb", headers=ah).json()] == [b.id]
    assert client.get("/friends/discover?q=nobodyhere", headers=ah).json() == []


def test_discover_offers_no_friendship_id_at_all(client, make_user):
    # There is no action on a directory row that needs one — every state is either "Add"
    # (by user id) or a label. Asserted so a future "Accept from here" doesn't quietly
    # reintroduce the duplicate-row bug along with the field.
    a, ah = make_user()
    b, _ = make_user()
    client.post("/friends/request", json={"to_user_id": b.id}, headers=ah)
    rows = client.get("/friends/discover", headers=ah).json()
    assert rows and all("friendship_id" not in r for r in rows)


def test_discover_drops_someone_only_once_the_friendship_is_ACCEPTED(client, make_user):
    # The other half of the rule above: "requested" is a label, "accepted" is a departure.
    a, ah = make_user()
    b, bh = make_user()
    fid = client.post(
        "/friends/request", json={"to_user_id": b.id}, headers=ah
    ).json()["id"]
    assert [p["friend_state"] for p in client.get("/friends/discover", headers=ah).json()] == [
        "requested"
    ]

    client.post(f"/friends/{fid}/accept", headers=bh)
    assert client.get("/friends/discover", headers=ah).json() == []
    assert client.get("/friends/discover", headers=bh).json() == []


def test_discover_search_matches_either_name_part_case_insensitively(client, make_user):
    _, ah = make_user(first_name="Zed")
    ana, _ = make_user(first_name="Ana", last_name="Cruz")
    ben, _ = make_user(first_name="Ben", last_name="Tan")

    for term in ("ana", "ANA", "Ana ", "cruz", "CRUZ"):
        rows = client.get("/friends/discover", params={"q": term}, headers=ah).json()
        assert [p["user_id"] for p in rows] == [ana.id], term

    # It's a CONTAINS match, not a prefix one, and it spans both name parts — so "an"
    # legitimately finds Ana AND Ben Tan. That's the right behaviour for a directory
    # search box (you type what you half-remember); pinned so nobody "fixes" it into
    # startswith and breaks searching by surname.
    loose = client.get("/friends/discover", params={"q": "an"}, headers=ah).json()
    assert {p["user_id"] for p in loose} == {ana.id, ben.id}


def test_discover_search_does_not_match_email(client, make_user):
    """Email is deliberately unsearchable: a directory you can probe by address is an
    address-book oracle ("is bob@corp.com on here?"). make_user emails are
    user{n}@example.com, so these terms would match if email were included."""
    _, ah = make_user(first_name="Zed")
    make_user(first_name="Ana")
    for term in ("example.com", "user2", "@example"):
        assert client.get("/friends/discover", params={"q": term}, headers=ah).json() == [], term


def test_discover_blank_search_is_the_full_list(client, make_user):
    _, ah = make_user()
    b, _ = make_user()
    for term in ("", "   "):
        rows = client.get("/friends/discover", params={"q": term}, headers=ah).json()
        assert [p["user_id"] for p in rows] == [b.id], repr(term)


def test_discover_newest_accounts_first(client, make_user):
    _, ah = make_user()
    b, _ = make_user()
    c, _ = make_user()
    rows = client.get("/friends/discover", headers=ah).json()
    # created_at can tie at SQLite's one-second granularity, so id desc is the tiebreak
    # that makes this deterministic — newest signup leads either way.
    assert [p["user_id"] for p in rows] == [c.id, b.id]


def test_discover_is_capped(client, make_user, monkeypatch):
    """The cap is a real ceiling, not decoration — pinned by shrinking it rather than
    creating 50+ users. The search box is what makes a longer list navigable."""
    from app.routers import friends as friends_router

    monkeypatch.setattr(friends_router, "DISCOVER_LIMIT", 2)
    _, ah = make_user()
    for _ in range(4):
        make_user()
    rows = client.get("/friends/discover", headers=ah).json()
    assert len(rows) == 2


def test_discover_requires_auth(client):
    assert client.get("/friends/discover").status_code == 401


def test_discover_search_treats_like_wildcards_as_literal_text(client, make_user):
    """A typed % or _ is TEXT, not a pattern. Unescaped, `%` would read as "match
    everything" (so a stray keystroke looks like the box ignoring you) and `_` would match
    any single character. Not an injection issue — the term is a bound parameter either
    way — but it makes search behave unpredictably."""
    _, ah = make_user(first_name="Zed")
    make_user(first_name="Ana", last_name="Cruz")
    odd, _ = make_user(first_name="A_B", last_name="Percent%")

    def ids(term):
        return [p["user_id"] for p in
                client.get("/friends/discover", params={"q": term}, headers=ah).json()]

    # `%` matches only the person whose name literally CONTAINS one — not everybody.
    assert ids("%") == [odd.id]
    # `_` doesn't stand in for the "n" in "Ana": it matches the literal underscore.
    assert ids("A_") == [odd.id]
    assert ids("A_B") == [odd.id]
    # A backslash is literal too — it's the escape character we introduce, so a naive
    # implementation would either match everything or raise.
    assert ids("\\") == []
    # Sanity: ordinary text still searches normally alongside all of the above.
    assert ids("Cruz") and ids("percent") == [odd.id]
