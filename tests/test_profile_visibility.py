"""The visibility model (issei #68): profile public/private + CONCRETE per-item
visibility ("public" | "friends" | "private"), applied to BOTH recipes and posts.

The invariant that matters: `can_view` (recipes) and `can_view_post` (posts) share one
truth table, so a recipe and a post with the same visibility + viewer relationship
always give the same answer. Item visibility is concrete — the owner's profile setting is
NOT consulted at read time; it only picks the create default and drives the bulk sweep.
So a flip of the profile changes nothing already stored (these tests pin that), and the
only way to bulk-rescope existing items is the explicit sweep (apply_visibility_to_all).
"""


def _recipe_payload(name="Adobo", visibility="friends"):
    return {
        "name": name,
        "visibility": visibility,
        "ingredients": [
            {"name": "x", "quantity_text": "1", "quantity_type": "precise", "position": 1}
        ],
        "steps": [{"content": "cook", "position": 1}],
    }


def _make_post(client, headers, dish="Sinigang", visibility="friends"):
    return client.post(
        "/posts",
        json={"photo_url": "https://res.cloudinary.com/demo/image/upload/x.jpg", "dish_name": dish, "visibility": visibility},
        headers=headers,
    )


def _set_profile(client, headers, value):
    r = client.patch("/auth/me", json={"profile_visibility": value}, headers=headers)
    assert r.status_code == 200
    assert r.json()["profile_visibility"] == value


def _befriend(client, a_headers, b, b_headers):
    fid = client.post("/friends/request", json={"to_user_id": b.id}, headers=a_headers).json()["id"]
    client.post(f"/friends/{fid}/accept", headers=b_headers)


# --- defaults ---


def test_profile_defaults_private(client, make_user):
    _, h = make_user()
    assert client.get("/auth/me", headers=h).json()["profile_visibility"] == "private"


def test_post_defaults_friends(client, make_user):
    _, h = make_user()
    assert _make_post(client, h).json()["visibility"] == "friends"


def test_recipe_visibility_rejects_bad_value(client, make_user):
    _, h = make_user()
    r = client.post("/recipes", json=_recipe_payload(visibility="inherit"), headers=h)
    assert r.status_code == 422


# --- recipe visibility truth table (via GET /recipes/{id}, which gates on can_view) ---


def test_recipe_friends_hidden_from_stranger(client, make_user):
    _, oh = make_user()
    rid = client.post("/recipes", json=_recipe_payload(visibility="friends"), headers=oh).json()["id"]
    _, sh = make_user()
    assert client.get(f"/recipes/{rid}", headers=sh).status_code == 404


def test_recipe_friends_visible_to_friend(client, make_user):
    owner, oh = make_user()
    friend, fh = make_user()
    _befriend(client, oh, friend, fh)
    rid = client.post("/recipes", json=_recipe_payload(visibility="friends"), headers=oh).json()["id"]
    assert client.get(f"/recipes/{rid}", headers=fh).status_code == 200


def test_recipe_public_visible_to_stranger(client, make_user):
    _, oh = make_user()  # private profile — irrelevant, the recipe is concretely public
    rid = client.post("/recipes", json=_recipe_payload(visibility="public"), headers=oh).json()["id"]
    _, sh = make_user()
    assert client.get(f"/recipes/{rid}", headers=sh).status_code == 200


def test_recipe_private_hidden_even_from_friend(client, make_user):
    owner, oh = make_user()
    friend, fh = make_user()
    _befriend(client, oh, friend, fh)
    rid = client.post("/recipes", json=_recipe_payload(visibility="private"), headers=oh).json()["id"]
    assert client.get(f"/recipes/{rid}", headers=fh).status_code == 404


def test_recipe_visibility_ignores_owner_profile(client, make_user):
    # Concrete: a friends-only recipe stays friends-only even on a PUBLIC profile.
    owner, oh = make_user()
    _set_profile(client, oh, "public")
    rid = client.post("/recipes", json=_recipe_payload(visibility="friends"), headers=oh).json()["id"]
    _, sh = make_user()  # stranger, not a friend
    assert client.get(f"/recipes/{rid}", headers=sh).status_code == 404


# --- post visibility truth table (via GET /posts/{id}, gating on can_view_post) ---


def test_post_friends_hidden_from_stranger(client, make_user):
    _, oh = make_user()
    pid = _make_post(client, oh, visibility="friends").json()["id"]
    _, sh = make_user()
    assert client.get(f"/posts/{pid}", headers=sh).status_code == 404


def test_post_friends_visible_to_friend(client, make_user):
    owner, oh = make_user()
    friend, fh = make_user()
    _befriend(client, oh, friend, fh)
    pid = _make_post(client, oh, visibility="friends").json()["id"]
    assert client.get(f"/posts/{pid}", headers=fh).status_code == 200


def test_post_public_visible_to_stranger(client, make_user):
    # A post can be public even from a private profile — anyone can see it.
    _, oh = make_user()  # private profile
    pid = _make_post(client, oh, visibility="public").json()["id"]
    _, sh = make_user()
    assert client.get(f"/posts/{pid}", headers=sh).status_code == 200


def test_post_private_hidden_from_friend(client, make_user):
    owner, oh = make_user()
    friend, fh = make_user()
    _befriend(client, oh, friend, fh)
    pid = _make_post(client, oh, visibility="private").json()["id"]
    assert client.get(f"/posts/{pid}", headers=fh).status_code == 404


# --- a profile flip does NOT change existing items (values are concrete) ---


def test_profile_flip_does_not_change_existing_items(client, make_user):
    owner, oh = make_user()  # private profile
    rid = client.post("/recipes", json=_recipe_payload(visibility="friends"), headers=oh).json()["id"]
    _, sh = make_user()
    assert client.get(f"/recipes/{rid}", headers=sh).status_code == 404  # friends-only
    # Flip the profile public — the existing friends-only recipe stays friends-only.
    _set_profile(client, oh, "public")
    assert client.get(f"/recipes/{rid}", headers=sh).status_code == 404


# --- the bulk sweep (apply_visibility_to_all) ---


def test_sweep_everything_public(client, make_user):
    # "Make everything public": one action sets every recipe + post to public.
    owner, oh = make_user()
    r_priv = client.post("/recipes", json=_recipe_payload(visibility="private"), headers=oh).json()["id"]
    r_friends = client.post("/recipes", json=_recipe_payload(visibility="friends"), headers=oh).json()["id"]
    p_priv = _make_post(client, oh, dish="secret", visibility="private").json()["id"]

    client.patch(
        "/auth/me",
        json={"profile_visibility": "public", "apply_visibility_to_all": "public"},
        headers=oh,
    )
    _, sh = make_user()
    assert client.get(f"/recipes/{r_priv}", headers=sh).status_code == 200
    assert client.get(f"/recipes/{r_friends}", headers=sh).status_code == 200
    assert client.get(f"/posts/{p_priv}", headers=sh).status_code == 200


def test_sweep_everything_friends(client, make_user):
    # "Make everything friends-only" (chosen when going private): a public recipe
    # becomes friends-only, so a stranger loses access but a friend keeps it.
    owner, oh = make_user()
    _set_profile(client, oh, "public")
    rid = client.post("/recipes", json=_recipe_payload(visibility="public"), headers=oh).json()["id"]
    friend, fh = make_user()
    _befriend(client, oh, friend, fh)

    client.patch(
        "/auth/me",
        json={"profile_visibility": "private", "apply_visibility_to_all": "friends"},
        headers=oh,
    )
    _, sh = make_user()  # stranger
    assert client.get(f"/recipes/{rid}", headers=sh).status_code == 404  # no longer public
    assert client.get(f"/recipes/{rid}", headers=fh).status_code == 200  # friend still sees it


def test_flip_without_sweep_leaves_items(client, make_user):
    # Flipping the profile WITHOUT apply_visibility_to_all leaves items untouched.
    owner, oh = make_user()
    _set_profile(client, oh, "public")
    rid = client.post("/recipes", json=_recipe_payload(visibility="public"), headers=oh).json()["id"]
    client.patch("/auth/me", json={"profile_visibility": "private"}, headers=oh)
    _, sh = make_user()
    # The recipe is still concretely public — the profile flip alone didn't touch it.
    assert client.get(f"/recipes/{rid}", headers=sh).status_code == 200


def test_sweep_rejects_bad_target(client, make_user):
    _, oh = make_user()
    r = client.patch(
        "/auth/me",
        json={"profile_visibility": "public", "apply_visibility_to_all": "inherit"},
        headers=oh,
    )
    assert r.status_code == 422


# --- handoff grant stays orthogonal ---


def test_handoff_grant_reads_recipe_regardless_of_visibility(client, make_user):
    owner, oh = make_user()
    grantee, gh = make_user()  # not a friend
    rid = client.post("/recipes", json=_recipe_payload(visibility="private"), headers=oh).json()["id"]
    assert client.get(f"/recipes/{rid}", headers=gh).status_code == 404
    # Handing it off grants read regardless of the private visibility / no friendship.
    client.post(f"/recipes/{rid}/handoff", json={"to_user_id": grantee.id}, headers=oh)
    assert client.get(f"/recipes/{rid}", headers=gh).status_code == 200


# --- profile visibility edit rules ---


def test_profile_visibility_edit_needs_no_password(client, make_user):
    _, h = make_user()
    r = client.patch("/auth/me", json={"profile_visibility": "public"}, headers=h)
    assert r.status_code == 200 and r.json()["profile_visibility"] == "public"


def test_profile_visibility_rejects_bad_value(client, make_user):
    _, h = make_user()
    r = client.patch("/auth/me", json={"profile_visibility": "friends"}, headers=h)
    assert r.status_code == 422


def test_login_response_carries_profile_visibility(client, make_user):
    # The cached issei_user is hydrated ONLY from the login response (no /auth/me
    # refetch on the client). If it omitted profile_visibility, a re-login would drop
    # it and the create default would silently revert. make_user's password is fixed.
    user, h = make_user()
    client.patch("/auth/me", json={"profile_visibility": "public"}, headers=h)
    resp = client.post(
        "/auth/login",
        data={"username": user.email, "password": "password123"},
    )
    assert resp.status_code == 200
    assert resp.json()["user"]["profile_visibility"] == "public"


# --- feed + profile grid honor the model ---


def test_feed_excludes_a_friends_private_post(client, make_user):
    me, mh = make_user()
    friend, fh = make_user()
    _befriend(client, mh, friend, fh)
    _make_post(client, fh, dish="shown", visibility="friends")
    _make_post(client, fh, dish="secret", visibility="private")
    dishes = {p["dish_name"] for p in client.get("/posts/feed", headers=mh).json()}
    assert "shown" in dishes
    assert "secret" not in dishes


def test_profile_grid_shows_public_post_to_stranger(client, make_user):
    owner, oh = make_user()  # private profile
    _make_post(client, oh, dish="public one", visibility="public")
    _make_post(client, oh, dish="friends one", visibility="friends")
    stranger, sh = make_user()
    dishes = {p["dish_name"] for p in client.get(f"/posts/users/{owner.id}", headers=sh).json()}
    assert "public one" in dishes  # public shows to a non-friend
    assert "friends one" not in dishes  # friends-only hidden from a stranger
