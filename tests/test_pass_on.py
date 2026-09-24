"""Passing a recipe on that you did not write (#78) — the other half of keeping.

THE ONE RULE, and every test here is a face of it: **a resharer may never grant more than they
could cause by other means.**

A `public` recipe is already in Browse and readable by any signed-in person, so passing it on
widens nothing — what the link adds is account-free reading, which is the founding act of this
product rather than a technicality. Anything NARROWER is the cook's to widen, because
`GET /recipes/invite/{token}` returns the WHOLE recipe with no account: if any reader could mint a
token, one trusted recipient could make a `private` recipe world-readable a link at a time and
"Only me" would stop meaning only-me-plus-who-I-chose.

So `friends` and `private` go through an ASK the cook answers. That is also where Google Docs and
Instagram both landed, for the same reason — a viewer cannot grant access, and "Request access"
exists because a reader wanting to widen is common while a reader being allowed to is not.
"""

from app.models.pass_on_request import PassOnRequest
from app.models.handoff import Handoff
from app.models.notification import Notification


def _recipe(client, headers, name="Adobo", visibility="public"):
    r = client.post(
        "/recipes",
        json={
            "name": name,
            "visibility": visibility,
            "ingredients": [{"name": "Soy sauce", "quantity_text": "1/2 cup", "position": 0}],
            "steps": [{"content": "Simmer.", "position": 0}],
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _ask(client, headers, recipe_id):
    return client.post(f"/recipes/{recipe_id}/pass-on-request", headers=headers)


def _answer(client, headers, request_id, decision):
    return client.post(f"/recipes/pass-on-requests/{request_id}/{decision}", headers=headers)


def _notes(db, user_id, type=None):
    q = db.query(Notification).filter(Notification.user_id == user_id)
    if type:
        q = q.filter(Notification.type == type)
    return q.all()


# --- what needs no permission at all ------------------------------------------------------------


def test_a_PUBLIC_recipe_can_be_passed_on_with_no_asking(client, make_user, db_session):
    """The permissive half. A public recipe is in Browse; a link is a shortcut, not a widening."""
    owner, oh = make_user()
    reader, rh = make_user()
    rec = _recipe(client, oh, visibility="public")

    assert client.get(f"/recipes/{rec['id']}", headers=rh).json()["pass_on_state"] == "allowed"
    r = client.post(f"/recipes/{rec['id']}/handoff", json={}, headers=rh)
    assert r.status_code == 201
    row = db_session.query(Handoff).filter(Handoff.token == r.json()["token"]).first()
    assert row.from_user_id == reader.id


def test_asking_about_a_recipe_you_can_ALREADY_pass_on_is_a_400_not_a_silent_ok(client, make_user):
    """A client that gets here has drawn the wrong button, and a silent 204 would hide that."""
    _, oh = make_user()
    _, rh = make_user()
    rec = _recipe(client, oh, visibility="public")
    r = _ask(client, rh, rec["id"])
    assert r.status_code == 400
    assert "already" in r.json()["detail"].lower()


def test_the_OWNER_is_told_to_use_the_send_screen_instead(client, make_user):
    """Asking about your own recipe is meaningless rather than forbidden, so the message says which
    — the owner has a different verb (send) on a different screen."""
    _, oh = make_user()
    rec = _recipe(client, oh, visibility="friends")
    r = _ask(client, oh, rec["id"])
    assert r.status_code == 400
    assert "your recipe" in r.json()["detail"].lower()
    # And `pass_on_state` is None for them, so the client never draws the reader control at all.
    assert client.get(f"/recipes/{rec['id']}", headers=oh).json()["pass_on_state"] is None


# --- the ask, end to end ------------------------------------------------------------------------


def test_a_grantee_asks_the_cook_and_can_pass_it_on_once_approved(client, make_user, db_session):
    """THE WHOLE POINT OF #78, end to end: FUTURE.md's case. Lola's private adobo reached you, your
    sibling asks for it, and routing them back to Lola was the dead end."""
    owner, oh = make_user()
    keeper, kh = make_user()
    rec = _recipe(client, oh, name="Lola's Adobo", visibility="private")
    assert client.post(
        f"/recipes/{rec['id']}/handoff", json={"to_user_id": keeper.id}, headers=oh
    ).status_code == 201

    # Before asking: readable, not passable.
    assert client.get(f"/recipes/{rec['id']}", headers=kh).json()["pass_on_state"] == "ask"
    assert client.post(f"/recipes/{rec['id']}/handoff", json={}, headers=kh).status_code == 404

    assert _ask(client, kh, rec["id"]).status_code == 204
    assert client.get(f"/recipes/{rec['id']}", headers=kh).json()["pass_on_state"] == "pending"

    # The cook sees who asked, and which recipe — the only place the asker's name is returned.
    incoming = client.get("/recipes/pass-on-requests/incoming", headers=oh).json()
    assert len(incoming) == 1
    assert incoming[0]["requester_id"] == keeper.id
    assert incoming[0]["requester_name"] == keeper.first_name
    assert incoming[0]["recipe_name"] == "Lola's Adobo"

    assert _answer(client, oh, incoming[0]["id"], "approve").status_code == 204
    assert client.get(f"/recipes/{rec['id']}", headers=kh).json()["pass_on_state"] == "allowed"

    # ...and now the link works, minted from the KEEPER with a fresh token.
    r = client.post(f"/recipes/{rec['id']}/handoff", json={}, headers=kh)
    assert r.status_code == 201
    row = db_session.query(Handoff).filter(Handoff.token == r.json()["token"]).first()
    assert row.from_user_id == keeper.id
    # The cook's own grant to the keeper is untouched — its token was never echoed.
    cooks = (
        db_session.query(Handoff)
        .filter(Handoff.recipe_id == rec["id"], Handoff.to_user_id == keeper.id)
        .first()
    )
    assert cooks.token != row.token

    # The answered request leaves the cook's to-do list.
    assert client.get("/recipes/pass-on-requests/incoming", headers=oh).json() == []


def test_approving_grants_PERMISSION_not_a_handoff(client, make_user, db_session):
    """The cook's approval mints NOTHING for any third party, and names nobody. It lets the asker
    use the link-only path themselves — which is also what keeps the third person's contact details
    away from a cook who never asked for them."""
    owner, oh = make_user()
    keeper, kh = make_user()
    rec = _recipe(client, oh, visibility="friends")
    client.post(f"/recipes/{rec['id']}/handoff", json={"to_user_id": keeper.id}, headers=oh)
    before = db_session.query(Handoff).filter(Handoff.recipe_id == rec["id"]).count()

    _ask(client, kh, rec["id"])
    req = client.get("/recipes/pass-on-requests/incoming", headers=oh).json()[0]
    _answer(client, oh, req["id"], "approve")

    # No new grant appeared just from approving.
    assert db_session.query(Handoff).filter(Handoff.recipe_id == rec["id"]).count() == before


def test_the_asker_is_notified_on_approval(client, make_user, db_session):
    owner, oh = make_user()
    keeper, kh = make_user()
    rec = _recipe(client, oh, visibility="friends")
    client.post(f"/recipes/{rec['id']}/handoff", json={"to_user_id": keeper.id}, headers=oh)
    _ask(client, kh, rec["id"])
    req = client.get("/recipes/pass-on-requests/incoming", headers=oh).json()[0]
    _answer(client, oh, req["id"], "approve")

    got = _notes(db_session, keeper.id, "pass_on_approved")
    assert len(got) == 1
    assert got[0].actor_id == owner.id


def test_the_cook_is_notified_of_the_ask_BY_NAME(client, make_user, db_session):
    """Named, unlike `recipe_kept`. This one is addressed to the cook and wants an answer, so an
    anonymous version would be unanswerable."""
    owner, oh = make_user()
    keeper, kh = make_user()
    rec = _recipe(client, oh, visibility="friends")
    client.post(f"/recipes/{rec['id']}/handoff", json={"to_user_id": keeper.id}, headers=oh)
    _ask(client, kh, rec["id"])

    got = _notes(db_session, owner.id, "pass_on_request")
    assert len(got) == 1
    assert got[0].actor_id == keeper.id


# --- a decline is silent, and it is not free to re-ask ------------------------------------------


def test_a_DECLINE_tells_the_asker_NOTHING(client, make_user, db_session):
    """THE ASYMMETRY THAT IS THE WHOLE DESIGN. Approving notifies; declining notifies nobody.

    Same reasoning as a silent block (#85) and a report the reported person never hears about: the
    cook said no about a recipe carrying their own family's name, usually to a relative, and "Lola
    declined" on that person's screen turns a quiet boundary into a social event.
    """
    owner, oh = make_user()
    keeper, kh = make_user()
    rec = _recipe(client, oh, visibility="private")
    client.post(f"/recipes/{rec['id']}/handoff", json={"to_user_id": keeper.id}, headers=oh)
    _ask(client, kh, rec["id"])
    req = client.get("/recipes/pass-on-requests/incoming", headers=oh).json()[0]

    assert _answer(client, oh, req["id"], "decline").status_code == 204
    # Not one notification of any kind reached the asker.
    assert _notes(db_session, keeper.id, "pass_on_approved") == []
    assert all(n.type != "pass_on_declined" for n in _notes(db_session, keeper.id))
    # AND THE CONTROL DOES NOT REVERT. It reports "pending", not "ask" — a ship gate showed that
    # reverting to "ask" on reload was a reliable decline ORACLE needing no tooling, and to an
    # ordinary user it reads as "she said no" or "my ask vanished". Either is the social event this
    # rule exists to prevent, arrived at without the word ever being used.
    assert client.get(f"/recipes/{rec['id']}", headers=kh).json()["pass_on_state"] == "pending"
    # Indistinguishable from a genuinely pending ask, which is the point.
    # And it still does not work.
    assert client.post(f"/recipes/{rec['id']}/handoff", json={}, headers=kh).status_code == 404


def test_re_asking_after_a_decline_is_silently_a_NO_OP(client, make_user, db_session):
    """So "no" cannot be worn down by repetition. The asker gets the same 204 as a first ask — they
    are never told they were declined — and the cook's inbox gets nothing and their to-do list
    stays empty."""
    owner, oh = make_user()
    keeper, kh = make_user()
    rec = _recipe(client, oh, visibility="private")
    client.post(f"/recipes/{rec['id']}/handoff", json={"to_user_id": keeper.id}, headers=oh)
    _ask(client, kh, rec["id"])
    req = client.get("/recipes/pass-on-requests/incoming", headers=oh).json()[0]
    _answer(client, oh, req["id"], "decline")
    before = len(_notes(db_session, owner.id, "pass_on_request"))

    for _ in range(4):
        assert _ask(client, kh, rec["id"]).status_code == 204

    assert len(_notes(db_session, owner.id, "pass_on_request")) == before
    assert client.get("/recipes/pass-on-requests/incoming", headers=oh).json() == []
    # Still exactly one row: the UNIQUE constraint and the early return, not two mechanisms.
    rows = db_session.query(PassOnRequest).filter(PassOnRequest.recipe_id == rec["id"]).all()
    assert len(rows) == 1 and rows[0].state == "declined"


def test_an_answer_cannot_be_changed_by_a_second_call(client, make_user, db_session):
    """Idempotent, and deliberately NOT a way to flip a stored answer. Two taps on a slow
    connection must not be a 400; a stale tab must not silently turn a "no" into a "yes"."""
    owner, oh = make_user()
    keeper, kh = make_user()
    rec = _recipe(client, oh, visibility="private")
    client.post(f"/recipes/{rec['id']}/handoff", json={"to_user_id": keeper.id}, headers=oh)
    _ask(client, kh, rec["id"])
    req = client.get("/recipes/pass-on-requests/incoming", headers=oh).json()[0]
    _answer(client, oh, req["id"], "decline")

    assert _answer(client, oh, req["id"], "approve").status_code == 204
    db_session.expire_all()
    row = db_session.query(PassOnRequest).filter(PassOnRequest.id == req["id"]).first()
    assert row.state == "declined"
    assert client.post(f"/recipes/{rec['id']}/handoff", json={}, headers=kh).status_code == 404


def test_asking_twice_while_pending_does_not_notify_twice(client, make_user, db_session):
    """Otherwise a determined asker floods the cook's inbox one tap at a time."""
    owner, oh = make_user()
    keeper, kh = make_user()
    rec = _recipe(client, oh, visibility="friends")
    client.post(f"/recipes/{rec['id']}/handoff", json={"to_user_id": keeper.id}, headers=oh)

    for _ in range(5):
        assert _ask(client, kh, rec["id"]).status_code == 204

    assert len(_notes(db_session, owner.id, "pass_on_request")) == 1
    assert len(client.get("/recipes/pass-on-requests/incoming", headers=oh).json()) == 1


# --- who may not do any of this -----------------------------------------------------------------


def test_someone_who_cannot_READ_it_cannot_ask_about_it(client, make_user):
    """A stranger to a private recipe gets the same 404 they get everywhere else — asking must not
    become a way to learn a recipe exists."""
    _, oh = make_user()
    _, sh = make_user()
    rec = _recipe(client, oh, visibility="private")
    assert _ask(client, sh, rec["id"]).status_code == 404
    assert client.post(f"/recipes/{rec['id']}/handoff", json={}, headers=sh).status_code == 404


def test_a_BLOCKED_grantee_can_still_READ_it_but_cannot_pass_it_on_or_ask(client, make_user):
    """THE CHECK THAT IS NOT REDUNDANT WITH `can_view`, and the reason it has its own test.

    `_resource_is_visible` checks the block FIRST, so a blocked person fails the `public` branch.
    But `can_view`'s GRANT branch deliberately SURVIVES a block (#85 — you genuinely handed them
    that dish, and a block means no new contact rather than unsend). So a blocked grantee still
    reads the recipe and reaches these routes. Reading what you were given is the #85 rule;
    becoming a distributor of it after being blocked is not — and putting a request in the inbox of
    someone who blocked you is exactly the new contact a block refuses.
    """
    owner, oh = make_user()
    keeper, kh = make_user()
    rec = _recipe(client, oh, name="Handed over then blocked", visibility="private")
    client.post(f"/recipes/{rec['id']}/handoff", json={"to_user_id": keeper.id}, headers=oh)
    _ask(client, kh, rec["id"])
    req = client.get("/recipes/pass-on-requests/incoming", headers=oh).json()[0]
    _answer(client, oh, req["id"], "approve")
    # Approved, so it works...
    assert client.post(f"/recipes/{rec['id']}/handoff", json={}, headers=kh).status_code == 201

    assert client.post("/friends/blocks", json={"user_id": keeper.id}, headers=oh).status_code == 204

    # #85: the grant survives, so they can still READ it.
    assert client.get(f"/recipes/{rec['id']}", headers=kh).status_code == 200
    # ...and that is all. No new links, no new asks.
    assert client.post(f"/recipes/{rec['id']}/handoff", json={}, headers=kh).status_code == 404
    assert _ask(client, kh, rec["id"]).status_code == 404


def test_a_blocked_asker_drops_off_the_cooks_list(client, make_user):
    """A block after the ask takes the ask with it, exactly as `POST /friends/blocks` drops pending
    friend requests both ways."""
    owner, oh = make_user()
    keeper, kh = make_user()
    rec = _recipe(client, oh, visibility="friends")
    client.post(f"/recipes/{rec['id']}/handoff", json={"to_user_id": keeper.id}, headers=oh)
    _ask(client, kh, rec["id"])
    assert len(client.get("/recipes/pass-on-requests/incoming", headers=oh).json()) == 1

    client.post("/friends/blocks", json={"user_id": keeper.id}, headers=oh)
    assert client.get("/recipes/pass-on-requests/incoming", headers=oh).json() == []


def test_only_the_COOK_can_answer(client, make_user):
    """404, not 403 — the same body an unknown request id gets, so a stranger poking at ids learns
    nothing about which ones exist."""
    owner, oh = make_user()
    keeper, kh = make_user()
    other, otherh = make_user()
    rec = _recipe(client, oh, visibility="friends")
    client.post(f"/recipes/{rec['id']}/handoff", json={"to_user_id": keeper.id}, headers=oh)
    _ask(client, kh, rec["id"])
    req = client.get("/recipes/pass-on-requests/incoming", headers=oh).json()[0]

    assert _answer(client, otherh, req["id"], "approve").status_code == 404
    assert _answer(client, kh, req["id"], "approve").status_code == 404
    assert _answer(client, oh, 999999, "approve").status_code == 404


def test_an_unknown_decision_word_is_a_404(client, make_user):
    """The path carries the verb, so a typo must not be a silent no-op that looks like success."""
    owner, oh = make_user()
    keeper, kh = make_user()
    rec = _recipe(client, oh, visibility="friends")
    client.post(f"/recipes/{rec['id']}/handoff", json={"to_user_id": keeper.id}, headers=oh)
    _ask(client, kh, rec["id"])
    req = client.get("/recipes/pass-on-requests/incoming", headers=oh).json()[0]
    assert _answer(client, oh, req["id"], "maybe").status_code == 404


def test_the_cook_sees_only_asks_about_THEIR_OWN_recipes(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    asker, askh = make_user()
    ra = _recipe(client, ah, name="A's", visibility="public")
    rb = _recipe(client, bh, name="B's", visibility="friends")
    client.post(f"/recipes/{rb['id']}/handoff", json={"to_user_id": asker.id}, headers=bh)
    _ask(client, askh, rb["id"])

    assert client.get("/recipes/pass-on-requests/incoming", headers=ah).json() == []
    assert len(client.get("/recipes/pass-on-requests/incoming", headers=bh).json()) == 1


# --- the permission is not a copy, and not lineage ----------------------------------------------


def test_approval_does_not_let_the_asker_EDIT_or_DELETE(client, make_user):
    """Read is not write, and neither is pass-on. This is the third question in that family and it
    must not collapse into the other two."""
    owner, oh = make_user()
    keeper, kh = make_user()
    rec = _recipe(client, oh, name="Theirs", visibility="private")
    client.post(f"/recipes/{rec['id']}/handoff", json={"to_user_id": keeper.id}, headers=oh)
    _ask(client, kh, rec["id"])
    req = client.get("/recipes/pass-on-requests/incoming", headers=oh).json()[0]
    _answer(client, oh, req["id"], "approve")

    assert client.patch(
        f"/recipes/{rec['id']}", json={"name": "Mine now"}, headers=kh
    ).status_code == 404
    assert client.delete(f"/recipes/{rec['id']}", headers=kh).status_code == 404
    assert client.get(f"/recipes/{rec['id']}", headers=oh).json()["name"] == "Theirs"


def test_approval_is_per_recipe_and_does_not_generalise(client, make_user):
    """One yes is about one dish. Approving Ana for the adobo says nothing about the sinigang —
    otherwise "yes" would quietly become a standing permission over the cook's whole kitchen."""
    owner, oh = make_user()
    keeper, kh = make_user()
    adobo = _recipe(client, oh, name="Adobo", visibility="private")
    sinigang = _recipe(client, oh, name="Sinigang", visibility="private")
    for r in (adobo, sinigang):
        client.post(f"/recipes/{r['id']}/handoff", json={"to_user_id": keeper.id}, headers=oh)
    _ask(client, kh, adobo["id"])
    req = client.get("/recipes/pass-on-requests/incoming", headers=oh).json()[0]
    _answer(client, oh, req["id"], "approve")

    assert client.post(f"/recipes/{adobo['id']}/handoff", json={}, headers=kh).status_code == 201
    assert client.post(f"/recipes/{sinigang['id']}/handoff", json={}, headers=kh).status_code == 404


def test_the_third_person_reads_the_recipe_attributed_to_the_COOK(client, make_user):
    """Attribution stays pointed at the cook — FUTURE.md required this explicitly, and it is what
    keeps a re-share from being a copy. The invite page is the recipient's whole experience, so this
    is where getting it wrong would show."""
    owner, oh = make_user(first_name="Lola")
    keeper, kh = make_user(first_name="Ana")
    rec = _recipe(client, oh, name="Lola's Adobo", visibility="public")
    r = client.post(f"/recipes/{rec['id']}/handoff", json={}, headers=kh)
    token = r.json()["token"]

    # No account at all — the token is the capability.
    preview = client.get(f"/recipes/invite/{token}")
    assert preview.status_code == 200
    body = preview.json()
    assert body["name"] == "Lola's Adobo"
    # ATTRIBUTION IS `from_name`, AND IT IS THE COOK'S. Asserted against BOTH names, because the
    # first version of this test read `body.get("user_id", owner.id)` — and `InvitePreview` has no
    # `user_id` field at all (deliberately: the recipient gets the dish, not the account ids), so
    # `.get` always returned the default and the assertion could not fail. A ship gate caught it.
    assert body["from_name"].startswith(owner.first_name)
    assert not body["from_name"].startswith(keeper.first_name)


def test_no_chain_is_stored_when_a_recipe_is_passed_on_twice(client, make_user, db_session):
    """NOT LINEAGE. #78's own spec says so: no chain, no ancestry, no "passed through N kitchens".
    Two independent grants exist and neither records the other."""
    owner, oh = make_user()
    first, fh = make_user()
    second, sh = make_user()
    rec = _recipe(client, oh, visibility="public")

    t1 = client.post(f"/recipes/{rec['id']}/handoff", json={}, headers=fh).json()["token"]
    t2 = client.post(f"/recipes/{rec['id']}/handoff", json={}, headers=sh).json()["token"]
    assert t1 != t2

    rows = db_session.query(Handoff).filter(Handoff.recipe_id == rec["id"]).all()
    # Every row points at the RECIPE and at one sender. Nothing points at another handoff.
    assert all(r.recipe_id == rec["id"] for r in rows)
    assert not any(hasattr(r, "parent_handoff_id") for r in rows)
    assert {r.from_user_id for r in rows} == {first.id, second.id}


def test_the_cook_is_told_their_recipe_was_passed_on(client, make_user, db_session):
    """For a PUBLIC recipe this is the only signal the cook gets that it moved — nobody had to ask.
    Named, not anonymous like a keep: somebody created access to their recipe, so who did it is the
    substance rather than a detail."""
    owner, oh = make_user()
    reader, rh = make_user()
    rec = _recipe(client, oh, visibility="public")
    client.post(f"/recipes/{rec['id']}/handoff", json={}, headers=rh)

    got = _notes(db_session, owner.id, "recipe_passed_on")
    assert len(got) == 1
    assert got[0].actor_id == reader.id
    assert got[0].recipe_id == rec["id"]


def test_the_cook_passing_on_their_OWN_recipe_notifies_nobody(client, make_user, db_session):
    owner, oh = make_user()
    rec = _recipe(client, oh, visibility="public")
    client.post(f"/recipes/{rec['id']}/handoff", json={}, headers=oh)
    assert _notes(db_session, owner.id, "recipe_passed_on") == []


def test_a_soft_deleted_recipe_cannot_be_passed_on_or_asked_about(client, make_user):
    """`deleted_at IS NULL` on both routes, per the project-wide rule."""
    owner, oh = make_user()
    keeper, kh = make_user()
    rec = _recipe(client, oh, visibility="public")
    assert client.delete(f"/recipes/{rec['id']}", headers=oh).status_code == 204

    assert client.post(f"/recipes/{rec['id']}/handoff", json={}, headers=kh).status_code == 404
    assert _ask(client, kh, rec["id"]).status_code == 404


def test_the_literal_paths_are_not_read_as_recipe_ids(client, make_user):
    """`/pass-on-requests/incoming` is declared before `/{recipe_id}`. Without that ordering this
    answers 422 for "pass-on-requests" — the same trap `/export` and `/friends/discover` document."""
    _, oh = make_user()
    r = client.get("/recipes/pass-on-requests/incoming", headers=oh)
    assert r.status_code == 200
    assert r.json() == []


# --- the hole the ship gate reproduced, and its fix ---------------------------------------------


def test_a_BLOCKED_person_cannot_CLAIM_a_resharers_link(client, make_user, db_session):
    """THE CRITICAL A SHIP GATE FOUND AND REPRODUCED END TO END.

    #88's locked decision is that a token minted before a block stays claimable — and read its own
    justification: "the token is the capability AND THE COOK CHOSE TO SEND IT". #78 falsified the
    second clause. A resharer mints tokens the cook never chose, can mint them AFTER the block, and
    can mint them without limit.

    What that bought, measured: Lola blocks Ben. Ana (any reader of a public recipe) mints a link.
    Ben claims it and `GET /recipes/{id}` returns 200 IN-APP, permanently, surviving Lola later
    making the recipe private. That is exactly the hole #85 exists to close — "a NEW grant cannot
    cross a block, or the grant branch would be an uncapped channel into a blocker's kitchen" —
    reopened through a third party.

    `handoff_recipe` cannot catch it: a link-only grant has no named recipient, so at mint time there
    is nobody to check the cook against. `claim_invite` is the first moment the claimer is known.
    """
    owner, oh = make_user()
    resharer, rh = make_user()
    blocked, bh = make_user()
    rec = _recipe(client, oh, name="Not for Ben", visibility="public")

    assert client.post("/friends/blocks", json={"user_id": blocked.id}, headers=oh).status_code == 204
    # The block holds on the ordinary read.
    assert client.get(f"/recipes/{rec['id']}", headers=bh).status_code == 404

    token = client.post(f"/recipes/{rec['id']}/handoff", json={}, headers=rh).json()["token"]
    # The unauthenticated READ is deliberately not gated — there is no viewer to check, and the
    # durable grant is the harm rather than the glance.
    assert client.get(f"/recipes/invite/{token}").status_code == 200

    # THE CLAIM IS REFUSED, with the same 404 body an unknown token gets.
    r = client.post(f"/recipes/invite/{token}/claim", headers=bh)
    assert r.status_code == 404
    assert r.json()["detail"] == "Invite not found"
    # No grant was written, so nothing reaches them in-app.
    assert (
        db_session.query(Handoff)
        .filter(Handoff.recipe_id == rec["id"], Handoff.to_user_id == blocked.id)
        .first()
        is None
    )
    assert client.get(f"/recipes/{rec['id']}", headers=bh).status_code == 404


def test_the_COOKS_OWN_token_is_still_claimable_across_a_block(client, make_user):
    """#88 IS UNTOUCHED, and this is the test that proves the fix is narrow rather than a reversal.

    The cook minted this link and chose to send it. Blocking afterwards does not unsend it — that is
    the locked decision, and the whole reason the check above compares `from_user_id` to the owner
    rather than just consulting the block.
    """
    owner, oh = make_user()
    recipient, ph = make_user()
    rec = _recipe(client, oh, visibility="private")
    token = client.post(f"/recipes/{rec['id']}/handoff", json={}, headers=oh).json()["token"]

    assert client.post("/friends/blocks", json={"user_id": recipient.id}, headers=oh).status_code == 204
    assert client.post(f"/recipes/invite/{token}/claim", headers=ph).status_code == 200
    assert client.get(f"/recipes/{rec['id']}", headers=ph).status_code == 200


def test_claiming_a_resharers_link_tells_the_COOK_not_the_resharer(client, make_user, db_session):
    """`recipe_claimed` goes to the recipe's OWNER (#78, ship gate).

    It used to go to `handoff.from_user_id`, which for a resharer's token is the wrong person twice
    over: the copy renders "{claimer} has your {dish} now" and it is not the resharer's dish, and the
    COOK — whose recipe actually moved — learned nothing at all. Before #78 a cook always found out
    when their link was claimed.
    """
    owner, oh = make_user()
    resharer, rh = make_user()
    claimer, ch = make_user()
    rec = _recipe(client, oh, visibility="public")
    token = client.post(f"/recipes/{rec['id']}/handoff", json={}, headers=rh).json()["token"]
    assert client.post(f"/recipes/invite/{token}/claim", headers=ch).status_code == 200

    cooks = _notes(db_session, owner.id, "recipe_claimed")
    assert len(cooks) == 1 and cooks[0].actor_id == claimer.id
    # The resharer is deliberately told nothing — their feedback was the share sheet.
    assert _notes(db_session, resharer.id, "recipe_claimed") == []


def test_blocking_drops_a_pass_on_permission_in_every_state(client, make_user, db_session):
    """A live permission is an ongoing licence to mint links on the other person's recipe, so it ends
    with the relationship — the same reasoning that makes a block DELETE a friendship rather than
    suspend it. Otherwise unblocking would silently restore distribution rights.
    """
    owner, oh = make_user()
    keeper, kh = make_user()
    rec = _recipe(client, oh, visibility="private")
    client.post(f"/recipes/{rec['id']}/handoff", json={"to_user_id": keeper.id}, headers=oh)
    _ask(client, kh, rec["id"])
    req = client.get("/recipes/pass-on-requests/incoming", headers=oh).json()[0]
    _answer(client, oh, req["id"], "approve")
    assert client.post(f"/recipes/{rec['id']}/handoff", json={}, headers=kh).status_code == 201

    client.post("/friends/blocks", json={"user_id": keeper.id}, headers=oh)
    assert db_session.query(PassOnRequest).filter(PassOnRequest.recipe_id == rec["id"]).all() == []

    # ...and unblocking does NOT restore it: they have to ask again.
    client.delete(f"/friends/blocks/{keeper.id}", headers=oh)
    assert client.post(f"/recipes/{rec['id']}/handoff", json={}, headers=kh).status_code == 404
    assert client.get(f"/recipes/{rec['id']}", headers=kh).json()["pass_on_state"] == "ask"


def test_approving_after_blocking_tells_the_blocked_person_nothing(client, make_user, db_session):
    """Only reachable from a stale tab, since the block sweep removes the row — but `notify()` would
    otherwise write a `pass_on_approved` FROM the blocker TO the blocked person and push it to their
    lock screen, which is the exact channel `_notify_cook_of_claim` is hand-gated to close.
    """
    owner, oh = make_user()
    keeper, kh = make_user()
    rec = _recipe(client, oh, visibility="friends")
    client.post(f"/recipes/{rec['id']}/handoff", json={"to_user_id": keeper.id}, headers=oh)
    _ask(client, kh, rec["id"])
    req = client.get("/recipes/pass-on-requests/incoming", headers=oh).json()[0]

    client.post("/friends/blocks", json={"user_id": keeper.id}, headers=oh)
    # The sweep deleted the row, so the stale tab 404s — the strongest available outcome.
    assert _answer(client, oh, req["id"], "approve").status_code == 404
    assert _notes(db_session, keeper.id, "pass_on_approved") == []


def test_a_blocked_grantee_is_shown_no_pass_on_control_at_all(client, make_user):
    """`pass_on_state` returns None rather than a working-looking button that 404s. `get_recipe`
    gates on `can_view`, whose grant branch survives a block (#85), so without this a blocked
    grantee saw "Pass it on" on a recipe visibly on their screen and got a 404 — and since there is
    no revoke, that 404 is explicable only by a block, on a state #85 keeps undetectable.
    """
    owner, oh = make_user()
    keeper, kh = make_user()
    rec = _recipe(client, oh, visibility="private")
    client.post(f"/recipes/{rec['id']}/handoff", json={"to_user_id": keeper.id}, headers=oh)
    client.post("/friends/blocks", json={"user_id": keeper.id}, headers=oh)

    # #85: the grant survives, so they still read it...
    body = client.get(f"/recipes/{rec['id']}", headers=kh)
    assert body.status_code == 200
    # ...and are offered nothing.
    assert body.json()["pass_on_state"] is None
