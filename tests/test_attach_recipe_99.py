"""#99 — attaching a recipe to a post that is already published, and unlinking it.

The finding that shaped this: `POST /{post_id}/fulfill` ALREADY attached a recipe to an existing
post, because `post.recipe_id = recipe.id` sits outside its pending-requester loop. On a post nobody
had asked about, the loop does nothing and the attach happens on its own. So what #99 needed was a
SURFACE plus a way to unlink — not a new attach mechanism. These tests pin both halves, including
the "nobody asked" path that was never exercised before.
"""


def _post(client, headers, dish="Adobo", visibility="friends"):
    """A meal. `visibility` matters for any test where a NON-FRIEND has to ask: a post defaults to
    `friends`, so a stranger can't see it and `POST /{id}/request` 404s — which silently produces a
    test with no pending ask rather than the one you meant to write."""
    return client.post(
        "/posts",
        json={
            "photo_url": "https://res.cloudinary.com/demo/image/upload/a.jpg",
            "dish_name": dish,
            "visibility": visibility,
        },
        headers=headers,
    ).json()


def _recipe(client, headers, name="Adobo", visibility="private"):
    return client.post(
        "/recipes",
        json={
            "name": name,
            "visibility": visibility,
            "steps": [{"content": "Simmer", "position": 0}],
        },
        headers=headers,
    ).json()


def test_attaching_to_a_post_NOBODY_asked_about_works(client, make_user):
    """The #99 case. It was already possible and never tested — the attach is unconditional."""
    _, h = make_user()
    post = _post(client, h)
    rec = _recipe(client, h)
    assert post["recipe_id"] is None

    r = client.post(f"/posts/{post['id']}/fulfill", json={"recipe_id": rec["id"]}, headers=h)

    assert r.status_code == 200
    assert r.json()["recipe_id"] == rec["id"]
    assert client.get(f"/posts/{post['id']}", headers=h).json()["recipe_id"] == rec["id"]


def test_attaching_with_nobody_waiting_notifies_NOBODY(client, make_user):
    """Zero asks means zero notifications — the loop body never runs.

    Worth pinning because the endpoint is called `fulfill`: someone reading the name could
    reasonably add a "your recipe is attached" notification, and there is nobody to tell.
    """
    _, h = make_user()
    post = _post(client, h)
    rec = _recipe(client, h)

    client.post(f"/posts/{post['id']}/fulfill", json={"recipe_id": rec["id"]}, headers=h)

    assert client.get("/notifications", headers=h).json()["unread_count"] == 0


def test_attaching_a_DIFFERENT_recipe_repoints_the_link(client, make_user):
    """Fixing a wrong attachment, which previously required deleting the post."""
    _, h = make_user()
    post = _post(client, h)
    wrong = _recipe(client, h, name="Wrong")
    right = _recipe(client, h, name="Right")

    client.post(f"/posts/{post['id']}/fulfill", json={"recipe_id": wrong["id"]}, headers=h)
    r = client.post(f"/posts/{post['id']}/fulfill", json={"recipe_id": right["id"]}, headers=h)

    assert r.json()["recipe_id"] == right["id"]


def test_unlinking_clears_the_link(client, make_user):
    _, h = make_user()
    post = _post(client, h)
    rec = _recipe(client, h)
    client.post(f"/posts/{post['id']}/fulfill", json={"recipe_id": rec["id"]}, headers=h)

    r = client.delete(f"/posts/{post['id']}/recipe", headers=h)

    assert r.status_code == 200
    assert r.json()["recipe_id"] is None
    assert client.get(f"/posts/{post['id']}", headers=h).json()["recipe_id"] is None


def test_unlinking_is_IDEMPOTENT(client, make_user):
    """A post with no recipe is a 200, not a 404 — the 404s here are about the POST.

    A double-tap on a slow connection should be harmless rather than an error the client has to
    explain away.
    """
    _, h = make_user()
    post = _post(client, h)

    first = client.delete(f"/posts/{post['id']}/recipe", headers=h)
    second = client.delete(f"/posts/{post['id']}/recipe", headers=h)

    assert (first.status_code, second.status_code) == (200, 200)
    assert first.json()["recipe_id"] is None


def test_unlinking_does_NOT_take_back_a_grant_already_given(client, make_user):
    """The rule that makes DELETE the right shape: detaching answers nobody and unsends nothing.

    Ben asked, Ana answered — Ben genuinely received that dish. Ana unlinking the post is her
    tidying her own feed, not an unsend. `can_view`'s grant branch carries Ben's access, never the
    post's link, which is the same reasoning blocking follows (#85).
    """
    ana, ah = make_user()
    ben, bh = make_user()
    post = _post(client, ah, visibility="public")
    rec = _recipe(client, ah, visibility="private")
    client.post(f"/posts/{post['id']}/request", headers=bh)
    client.post(f"/posts/{post['id']}/fulfill", json={"recipe_id": rec["id"]}, headers=ah)
    assert client.get(f"/recipes/{rec['id']}", headers=bh).status_code == 200

    client.delete(f"/posts/{post['id']}/recipe", headers=ah)

    # Still readable, and still on his shelf.
    assert client.get(f"/recipes/{rec['id']}", headers=bh).status_code == 200
    kept = client.get("/recipes/kept", headers=bh).json()
    assert rec["id"] in [x["id"] for x in kept["recipes"]]


def test_unlinking_does_not_REOPEN_a_fulfilled_ask(client, make_user):
    """They were answered. Re-opening would put a name back on /requests for a settled ask."""
    ana, ah = make_user()
    ben, bh = make_user()
    post = _post(client, ah, visibility="public")
    rec = _recipe(client, ah)
    client.post(f"/posts/{post['id']}/request", headers=bh)
    client.post(f"/posts/{post['id']}/fulfill", json={"recipe_id": rec["id"]}, headers=ah)

    client.delete(f"/posts/{post['id']}/recipe", headers=ah)

    assert client.get("/posts/requests/incoming", headers=ah).json() == []
    assert client.get(f"/posts/{post['id']}", headers=ah).json()["request_count"] == 0


def test_a_NON_AUTHOR_cannot_unlink(client, make_user):
    """Read is not write. 404, not 403 — the same answer an unknown id gets."""
    ana, ah = make_user()
    _, bh = make_user()
    post = _post(client, ah)
    rec = _recipe(client, ah, visibility="public")
    client.post(f"/posts/{post['id']}/fulfill", json={"recipe_id": rec["id"]}, headers=ah)

    r = client.delete(f"/posts/{post['id']}/recipe", headers=bh)

    assert r.status_code == 404
    assert client.get(f"/posts/{post['id']}", headers=ah).json()["recipe_id"] == rec["id"]


def test_unlinking_an_unknown_post_is_404(client, make_user):
    _, h = make_user()
    assert client.delete("/posts/999999/recipe", headers=h).status_code == 404


def test_unlinking_requires_an_account(client, make_user):
    _, h = make_user()
    post = _post(client, h)
    assert client.delete(f"/posts/{post['id']}/recipe").status_code == 401


def test_attaching_still_refuses_someone_elses_recipe(client, make_user):
    """The pre-existing rule, re-pinned because #99 gives this endpoint a second caller.

    You can only hand over what is yours — a `user_id` filter, not `can_view`.
    """
    ana, ah = make_user()
    _, bh = make_user()
    post = _post(client, bh)
    ana_recipe = _recipe(client, ah, visibility="public")

    r = client.post(f"/posts/{post['id']}/fulfill", json={"recipe_id": ana_recipe["id"]}, headers=bh)

    assert r.status_code == 404
    assert client.get(f"/posts/{post['id']}", headers=bh).json()["recipe_id"] is None
