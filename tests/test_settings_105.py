"""The three settings from #105: invite permission, export, and an explicit create-form default.

Each one needed a CONSUMER and a TEST before it went in — the lesson from the two display toggles
that came out of the You page the day before, one of which wrote a key nothing read.
"""


def _befriend(client, a, ah, b, bh):
    """Accepted friendship, the way test_blocks.py does it — there is no shared fixture."""
    fid = client.post("/friends/request", json={"to_user_id": b.id}, headers=ah).json()["id"]
    client.post(f"/friends/{fid}/accept", headers=bh)


def _recipe(client, headers, name="Adobo"):
    return client.post(
        "/recipes",
        json={
            "name": name,
            "visibility": "private",
            # `quantity_type` is sent by the client, which classifies at entry time
            # (frontend/src/utils/quantity.js) — POST /recipes stores what it is given rather than
            # re-deriving it. So the export's job is to round-trip both fields untouched, which is
            # what these tests check; it is not the classifier's test.
            "ingredients": [
                {
                    "name": "pork",
                    "quantity_text": "a good splash",
                    "quantity_type": "imprecise",
                    "position": 0,
                }
            ],
            "steps": [{"content": "Simmer", "position": 0}],
        },
        headers=headers,
    ).json()


# ===========================================================================================
# 1. "Who can send you an invite link" — the safety one, so it goes first.
# ===========================================================================================


def test_default_is_ANYONE_so_nothing_changes_for_an_existing_account(client, make_user):
    """The permissive value is the default, deliberately.

    A migration that silently tightened every existing account would break sends already in
    flight for people who never asked for that. The setting is offered, not imposed.
    """
    _, h = make_user()
    me = client.get("/auth/me", headers=h).json()
    assert me["invite_permission"] == "anyone"


def test_friends_only_REFUSES_a_handoff_addressed_by_email(client, make_user):
    """This is the hole the setting exists to close, and it is an EMAIL hole.

    `POST /recipes/{id}/handoff` takes a `to_email`, and a sender needs no relationship with the
    recipient — not even for their account to exist — to put a recipe, a byline, a story and their
    own name onto that person's shelf. Blocking (#85) cannot help, because there is nobody to
    block until after it has happened.
    """
    ana, ah = make_user()
    ben, bh = make_user()
    client.patch("/auth/me", json={"invite_permission": "friends"}, headers=bh)
    rec = _recipe(client, ah)

    r = client.post(f"/recipes/{rec['id']}/handoff", json={"to_email": ben.email}, headers=ah)

    assert r.status_code == 404
    # Byte-identical to an unknown user, so the refusal never reveals that the setting exists —
    # or, worse, confirms the address belongs to a real person.
    assert r.json()["detail"] == "User not found"


def test_friends_only_refuses_a_handoff_addressed_by_USER_ID_too(client, make_user):
    ana, ah = make_user()
    ben, bh = make_user()
    client.patch("/auth/me", json={"invite_permission": "friends"}, headers=bh)
    rec = _recipe(client, ah)

    r = client.post(f"/recipes/{rec['id']}/handoff", json={"to_user_id": ben.id}, headers=ah)

    assert r.status_code == 404


def test_a_FRIEND_can_still_send_under_friends_only(client, make_user):
    """The setting narrows the channel; it does not close it. Otherwise it is just "off"."""
    ana, ah = make_user()
    ben, bh = make_user()
    client.patch("/auth/me", json={"invite_permission": "friends"}, headers=bh)
    _befriend(client, ana, ah, ben, bh)
    rec = _recipe(client, ah)

    for body in ({"to_user_id": ben.id}, {"to_email": ben.email}):
        rec2 = _recipe(client, ah, name=f"Dish {body}")
        r = client.post(f"/recipes/{rec2['id']}/handoff", json=body, headers=ah)
        assert r.status_code == 201, body


def test_the_email_check_is_CASE_INSENSITIVE(client, make_user):
    """An email address is case-insensitive, and a sender typing the wrong case must not bypass.

    Without this the setting is one shift key away from doing nothing: "Ben@x.com" would resolve
    to nobody, skip both checks, and land as a pending invite that signup then auto-accepts.
    """
    ana, ah = make_user()
    ben, _ = make_user()
    client.patch("/auth/me", json={"invite_permission": "friends"}, headers=ah)
    # Ana restricts herself; Ben sends to her, shouting.
    _, bh = make_user()
    rec = _recipe(client, bh)

    r = client.post(
        f"/recipes/{rec['id']}/handoff",
        json={"to_email": ana.email.upper()},
        headers=bh,
    )
    assert r.status_code == 404


def test_a_LINK_ONLY_handoff_is_never_gated(client, make_user):
    """The token IS the capability, and that is the product.

    Gating this would break the founding case — someone who asked for the dish at the table —
    and there is no recipient to have a preference in the first place.
    """
    _, ah = make_user()
    rec = _recipe(client, ah)

    r = client.post(f"/recipes/{rec['id']}/handoff", json={}, headers=ah)

    assert r.status_code == 201
    assert r.json()["token"]


def test_the_EMAIL_path_now_also_honours_a_BLOCK(client, make_user):
    """A pre-existing hole the #105 lookup closes as a side effect.

    The block check fired on a resolved user, and an email-addressed handoff was never resolved —
    so anyone who knew a blocker's address could keep minting grants onto their Kept shelf, once
    per recipe, with #85 doing nothing about it.
    """
    ana, ah = make_user()
    ben, bh = make_user()
    client.post("/friends/blocks", json={"user_id": ana.id}, headers=bh)  # Ben blocks Ana
    rec = _recipe(client, ah)

    r = client.post(f"/recipes/{rec['id']}/handoff", json={"to_email": ben.email}, headers=ah)

    assert r.status_code == 404


def test_an_email_with_NO_account_is_still_deliverable(client, make_user):
    """Nobody exists to hold a preference, so this stays a pending invite exactly as before.

    That also keeps #88's rule intact: an invite minted BEFORE a restriction stays claimable,
    because the sender chose to send it.
    """
    _, ah = make_user()
    rec = _recipe(client, ah)

    r = client.post(
        f"/recipes/{rec['id']}/handoff",
        json={"to_email": "nobody-here-yet@example.com"},
        headers=ah,
    )

    assert r.status_code == 201
    assert r.json()["state"] == "pending"


def test_an_unknown_invite_permission_value_is_REFUSED(client, make_user):
    """A Literal, not a free string — so a typo is a 422 rather than a setting that fails OPEN."""
    _, h = make_user()
    r = client.patch("/auth/me", json={"invite_permission": "anythin"}, headers=h)
    assert r.status_code == 422
    assert client.get("/auth/me", headers=h).json()["invite_permission"] == "anyone"


def test_changing_invite_permission_needs_no_password(client, make_user):
    """It only narrows what reaches you and is instantly reversible — like a name edit."""
    _, h = make_user()
    r = client.patch("/auth/me", json={"invite_permission": "friends"}, headers=h)
    assert r.status_code == 200
    assert r.json()["invite_permission"] == "friends"


# ===========================================================================================
# 2. Export your recipes.
# ===========================================================================================


def test_export_returns_the_callers_own_recipes(client, make_user):
    _, h = make_user()
    _recipe(client, h, name="Adobo")
    _recipe(client, h, name="Sinigang")

    r = client.get("/recipes/export", headers=h)

    assert r.status_code == 200
    body = r.json()
    assert body["recipe_count"] == 2
    assert {x["name"] for x in body["recipes"]} == {"Adobo", "Sinigang"}
    assert body["exported_at"]


def test_export_PRESERVES_an_imprecise_amount_verbatim(client, make_user):
    """The whole reason this endpoint is JSON and not a PDF.

    A recipe whose "a good splash" is kept verbatim inside the app has to leave it that way, or
    the fidelity promise stops at the door: an export that helpfully rendered "1 tbsp" would be
    the shopping-list mistake, in a file someone keeps.
    """
    _, h = make_user()
    _recipe(client, h)

    exported = client.get("/recipes/export", headers=h).json()["recipes"][0]

    ing = exported["ingredients"][0]
    assert ing["quantity_text"] == "a good splash"
    assert ing["quantity_type"] == "imprecise"


def test_export_EXCLUDES_someone_elses_recipe_even_one_handed_to_you(client, make_user):
    """A kept recipe is someone else's record of their dish, held by a grant to READ.

    Exporting it would make "keep" mean the copy it has never meant, and hand over text that stops
    being yours the moment they delete it.
    """
    ana, ah = make_user()
    ben, bh = make_user()
    rec = _recipe(client, ah, name="Ana's Adobo")
    client.post(f"/recipes/{rec['id']}/handoff", json={"to_user_id": ben.id}, headers=ah)
    # Ben can read it...
    assert client.get(f"/recipes/{rec['id']}", headers=bh).status_code == 200

    body = client.get("/recipes/export", headers=bh).json()

    assert body["recipe_count"] == 0
    assert body["recipes"] == []


def test_export_excludes_a_DELETED_recipe(client, make_user):
    """A soft-deleted row is one the person chose to remove; resurrecting it would be a surprise."""
    _, h = make_user()
    keep = _recipe(client, h, name="Keep")
    gone = _recipe(client, h, name="Gone")
    client.delete(f"/recipes/{gone['id']}", headers=h)

    body = client.get("/recipes/export", headers=h).json()

    assert body["recipe_count"] == 1
    assert body["recipes"][0]["name"] == "Keep"
    assert keep["id"] == body["recipes"][0]["id"]


def test_export_requires_an_account(client):
    assert client.get("/recipes/export").status_code == 401


def test_export_is_not_read_as_a_recipe_id(client, make_user):
    """Declared before `get_recipe`, like /shared and /kept — else the path is captured."""
    _, h = make_user()
    r = client.get("/recipes/export", headers=h)
    assert r.status_code == 200
    assert "recipe_count" in r.json()


def test_export_of_an_empty_kitchen_is_an_empty_document_not_an_error(client, make_user):
    _, h = make_user()
    body = client.get("/recipes/export", headers=h).json()
    assert body["recipe_count"] == 0
    assert body["recipes"] == []


# ===========================================================================================
# 3. Default visibility for a new recipe, stated rather than inferred.
# ===========================================================================================


def test_the_default_default_is_FRIENDS(client, make_user):
    """Which is what a private profile already produced — the value that had no name."""
    _, h = make_user()
    assert client.get("/auth/me", headers=h).json()["default_recipe_visibility"] == "friends"


def test_all_THREE_values_are_settable_including_the_one_the_old_model_could_not_express(
    client, make_user
):
    _, h = make_user()
    for value in ("public", "friends", "private"):
        r = client.patch("/auth/me", json={"default_recipe_visibility": value}, headers=h)
        assert r.status_code == 200
        assert r.json()["default_recipe_visibility"] == value


def test_it_is_NOT_a_fourth_visibility_value(client, make_user):
    """An item's visibility is stored LITERALLY (#68). This only picks what a form starts on."""
    _, h = make_user()
    r = client.patch(
        "/auth/me", json={"default_recipe_visibility": "follows_profile"}, headers=h
    )
    assert r.status_code == 422


def test_changing_it_moves_NOTHING_already_saved(client, make_user):
    """The #68 guarantee, re-pinned on the new setting: a label means what it says, permanently."""
    _, h = make_user()
    rec = _recipe(client, h)  # created "private"
    assert rec["visibility"] == "private"

    client.patch("/auth/me", json={"default_recipe_visibility": "public"}, headers=h)

    assert client.get(f"/recipes/{rec['id']}", headers=h).json()["visibility"] == "private"


def test_it_is_INDEPENDENT_of_profile_visibility(client, make_user):
    """Two different fields with two different jobs, and the two-valued one is not retired.

    `profile_visibility` still drives the bulk sweep, so setting one must not quietly move the
    other — which is exactly what an implementation that kept deriving would do.
    """
    _, h = make_user()
    client.patch("/auth/me", json={"default_recipe_visibility": "public"}, headers=h)

    me = client.get("/auth/me", headers=h).json()
    assert me["default_recipe_visibility"] == "public"
    assert me["profile_visibility"] == "private"  # untouched

    client.patch("/auth/me", json={"profile_visibility": "public"}, headers=h)
    client.patch("/auth/me", json={"default_recipe_visibility": "private"}, headers=h)
    me = client.get("/auth/me", headers=h).json()
    assert me["profile_visibility"] == "public"
    assert me["default_recipe_visibility"] == "private"


def test_login_returns_both_settings_so_the_cached_user_is_honest(client, make_user):
    """The hand-built login dict has silently omitted a new field twice.

    It fails only between login and the first `reconcile()`, so it passes every backend test with
    a seeded cache — and the create form renders in exactly that window.
    """
    user, h = make_user()
    client.patch(
        "/auth/me",
        json={"default_recipe_visibility": "public", "invite_permission": "friends"},
        headers=h,
    )

    body = client.post(
        "/auth/login", data={"username": user.email, "password": "password123"}
    ).json()

    assert body["user"]["default_recipe_visibility"] == "public"
    assert body["user"]["invite_permission"] == "friends"


def test_another_persons_invite_permission_is_never_disclosed(client, make_user):
    """Leaking it would tell a sender in advance whether an address accepts unsolicited recipes.

    That is the thing `handoff_recipe`'s uniform 404 exists to hide, so the field must not appear
    on any route that describes someone else.
    """
    ana, ah = make_user()
    ben, bh = make_user()
    client.patch("/auth/me", json={"invite_permission": "friends"}, headers=bh)

    profile = client.get(f"/friends/profile/{ben.id}", headers=ah).json()

    assert "invite_permission" not in profile
    assert "default_recipe_visibility" not in profile
