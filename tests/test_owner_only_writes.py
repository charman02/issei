"""Read is not write, asserted directly.

POSITIONING.md and TESTING.md's invariant 2 both rest on one promise: someone who can
READ a recipe they don't own can never CHANGE it. Until now no committed test asserted
it — patch_recipe/delete_recipe filtering on user_id was covered only by inspection. The
promise is load-bearing for #57 (keeping other people's recipes), so it gets real
assertions here, exercised as all three kinds of legitimate reader:

  - a stranger (no relationship at all),
  - an accepted FRIEND reading a friends-visibility recipe,
  - an accepted HANDOFF GRANTEE reading a private recipe.

Each of them proves it can read (200) and then fails to write (404) — a test that only
asserted the 404 would also pass if the reader simply couldn't see the recipe at all,
which would make it vacuous.

Also covers two exposures on the same surface: the owner's private `notes` scratchpad
must not ride along on any read, and an already-claimed handoff grant must not be
stealable.
"""


def _recipe(client, headers, name="Adobo", visibility="private", notes=None, servings=None):
    payload = {
        "name": name,
        "visibility": visibility,
        "steps": [{"content": "Brown the chicken", "position": 1}],
    }
    if notes is not None:
        payload["notes"] = notes
    if servings is not None:
        payload["servings"] = servings
    r = client.post("/recipes", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _befriend(client, a, ah, b, bh):
    fid = client.post("/friends/request", json={"to_user_id": b.id}, headers=ah).json()["id"]
    assert client.post(f"/friends/{fid}/accept", headers=bh).status_code == 200


def _grant(client, owner_headers, recipe_id, to_user_id):
    r = client.post(
        f"/recipes/{recipe_id}/handoff", json={"to_user_id": to_user_id}, headers=owner_headers
    )
    assert r.status_code == 201, r.text
    return r.json()


# --- a reader can never write ---


def test_stranger_can_neither_read_nor_write_a_private_recipe(client, make_user):
    _, oh = make_user()
    _, sh = make_user()
    rec = _recipe(client, oh, name="Owner's dish")
    # A stranger can't even read a private recipe, let alone write it.
    assert client.get(f"/recipes/{rec['id']}", headers=sh).status_code == 404
    assert client.patch(f"/recipes/{rec['id']}", json={"name": "Hijacked"}, headers=sh).status_code == 404
    assert client.delete(f"/recipes/{rec['id']}", headers=sh).status_code == 404


def test_friend_who_can_read_a_friends_recipe_still_cannot_patch_or_delete_it(client, make_user):
    owner, oh = make_user()
    friend, fh = make_user()
    _befriend(client, owner, oh, friend, fh)
    rec = _recipe(client, oh, name="Friends dish", visibility="friends")

    # Reading works — this is what makes the write assertions meaningful.
    assert client.get(f"/recipes/{rec['id']}", headers=fh).status_code == 200
    # Writing does not.
    assert client.patch(f"/recipes/{rec['id']}", json={"name": "Hijacked"}, headers=fh).status_code == 404
    assert client.delete(f"/recipes/{rec['id']}", headers=fh).status_code == 404
    # And the owner's row is untouched.
    assert client.get(f"/recipes/{rec['id']}", headers=oh).json()["name"] == "Friends dish"


def test_handoff_grantee_who_can_read_still_cannot_patch_or_delete(client, make_user):
    owner, oh = make_user()
    grantee, gh = make_user()
    rec = _recipe(client, oh, name="Handed dish")  # private
    _grant(client, oh, rec["id"], grantee.id)

    # The grant is what lets them read a private recipe...
    assert client.get(f"/recipes/{rec['id']}", headers=gh).status_code == 200
    # ...and it grants nothing else. A grantee can cook it, never change the owner's record.
    assert client.patch(f"/recipes/{rec['id']}", json={"name": "Hijacked"}, headers=gh).status_code == 404
    assert client.delete(f"/recipes/{rec['id']}", headers=gh).status_code == 404
    assert client.get(f"/recipes/{rec['id']}", headers=oh).json()["name"] == "Handed dish"


def test_no_reader_can_hand_off_someone_elses_recipe(client, make_user):
    """Handing on is the owner's act. #57 ships keep-only for exactly this reason:
    a reader passing a recipe onward would move it to a third person with the cook
    doing nothing. handoff_recipe's query requires ownership, so every non-owner 404s."""
    owner, oh = make_user()
    friend, fh = make_user()
    grantee, gh = make_user()
    stranger, sh = make_user()
    _befriend(client, owner, oh, friend, fh)
    rec = _recipe(client, oh, name="Not yours to send", visibility="friends")
    _grant(client, oh, rec["id"], grantee.id)

    for headers in (fh, gh, sh):
        r = client.post(
            f"/recipes/{rec['id']}/handoff", json={"to_user_id": stranger.id}, headers=headers
        )
        assert r.status_code == 404, r.text


# --- the owner's private notes never ride along on a read ---


def test_owner_private_notes_never_reach_any_reader(client, make_user):
    """`notes` is the owner's scratchpad. InvitePreview always withheld it, but it sat on
    RecipeResponse — the shape EVERY reader gets — so it shipped to friends, grantees, the
    unauthenticated browse feed, and the scale endpoint (which is gated on read permission,
    not ownership). It is now absent from the read surface entirely."""
    owner, oh = make_user()
    friend, fh = make_user()
    _befriend(client, owner, oh, friend, fh)
    secret = "PRIVATE-SCRATCHPAD: ask mom about the vinegar"
    rec = _recipe(client, oh, name="Public dish", visibility="public", notes=secret, servings=2)

    # Not even on the owner's own read — the field is off the response shape, not gated.
    for label, resp in (
        ("owner GET", client.get(f"/recipes/{rec['id']}", headers=oh)),
        ("friend GET", client.get(f"/recipes/{rec['id']}", headers=fh)),
        ("owner scale", client.get(f"/recipes/{rec['id']}/scale?servings=4", headers=oh)),
        ("friend scale", client.get(f"/recipes/{rec['id']}/scale?servings=4", headers=fh)),
        ("own list", client.get("/recipes", headers=oh)),
        ("browse (unauthenticated)", client.get("/recipes/browse")),
    ):
        assert resp.status_code == 200, f"{label}: {resp.text}"
        # Assert on the recipe object's KEYS, not the raw body: an ingredient carries its
        # own legitimate `notes` field, so a substring check would fail for the wrong
        # reason the moment this fixture grows an ingredient.
        body = resp.json()
        for item in body if isinstance(body, list) else [body]:
            assert "notes" not in item, f"{label} exposed a recipe-level notes field"
        assert secret not in resp.text, f"{label} leaked the notes content"


# --- an already-claimed grant cannot be stolen ---


def test_accept_cannot_steal_a_grant_someone_else_already_claimed(
    client, make_user, db_session
):
    """POST /recipes/handoffs/{id}/accept used to OR "your user id" with "your email
    matches to_email" and then overwrite to_user_id unconditionally. claim_invite binds
    to_user_id to whichever signed-in user holds the token — deliberately, to fix the
    mismatched-email orphan — so a link addressed to one email but claimed by someone else
    could afterwards be taken over by the addressee, silently revoking the claimer.

    THE ROW IS BUILT BY HAND, and that is the honest way to reach this now. The grant-binding fix
    means an email-addressed handoff to an address that HAS an account is accepted and bound at send
    time, so the route no longer writes the unbound shape this takeover needs — and a third party
    claiming the token gets their own separate grant instead (`claim_invite`'s else branch), which
    makes the theft structurally impossible on that path. Rows written before the fix still have the
    old shape and `accept_handoff` still serves them, so the guard has to stay; going through the
    route instead would test a shape nothing writes and quietly stop covering the takeover.
    """
    from app.models.handoff import Handoff

    owner, oh = make_user()  # user1
    addressee, ah = make_user()  # user2 — the email the invite names
    claimer, ch = make_user()  # user3 — actually holds and claims the link
    rec = _recipe(client, oh, name="Contested dish")

    h_row = Handoff(
        recipe_id=rec["id"],
        from_user_id=owner.id,
        to_user_id=None,
        to_email=addressee.email,
        state="pending",
        token="legacy-unbound-addressed-invite",
    )
    db_session.add(h_row)
    db_session.commit()
    h = {"id": h_row.id, "token": h_row.token}

    # Someone else holding the link claims it — the token is the capability.
    claimed = client.post(f"/recipes/invite/{h['token']}/claim", headers=ch).json()
    assert claimed["to_user_id"] == claimer.id and claimed["state"] == "accepted"
    assert client.get(f"/recipes/{rec['id']}", headers=ch).status_code == 200

    # The addressee now tries to accept the same grant. It is no longer theirs to take.
    assert client.post(f"/recipes/handoffs/{h['id']}/accept", headers=ah).status_code == 404
    # The claimer still has it, and the addressee gained nothing.
    assert client.get(f"/recipes/{rec['id']}", headers=ch).status_code == 200
    assert client.get(f"/recipes/{rec['id']}", headers=ah).status_code == 404


def test_addressee_can_still_accept_an_unclaimed_email_invite(client, make_user):
    """The narrowing must not break the legitimate path: while the grant is still unbound,
    the addressee accepting by email is exactly how an email invite is meant to resolve."""
    owner, oh = make_user()
    addressee, ah = make_user()
    rec = _recipe(client, oh, name="Yours to accept")
    h = client.post(
        f"/recipes/{rec['id']}/handoff", json={"to_email": addressee.email}, headers=oh
    ).json()

    r = client.post(f"/recipes/handoffs/{h['id']}/accept", headers=ah)
    assert r.status_code == 200, r.text
    assert r.json()["to_user_id"] == addressee.id and r.json()["state"] == "accepted"
    assert client.get(f"/recipes/{rec['id']}", headers=ah).status_code == 200
