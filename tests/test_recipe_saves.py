"""Keeping a recipe you did not write (#57) — a bookmark, never a copy.

The design decisions this pins:
  - a save is a POINTER: there is still one Recipe row, owned by the cook, so a keeper
    always reads the cook's CURRENT version and the byline stays the cook's;
  - a save is NOT a permission: every read re-checks can_view, so the cook restricting
    or deleting the recipe genuinely ends access, and it lands in `unreachable_count`;
  - you may only keep what you can already read (otherwise bookmarking would be a
    self-grant on a private recipe);
  - the shelf MERGES handed-to-you grants with your own bookmarks on the server, so
    un-keeping can never hide a recipe someone actually sent you;
  - keeping is owner-scoped and idempotent.
"""


def _recipe(client, headers, name="Adobo", visibility="private"):
    r = client.post(
        "/recipes",
        json={
            "name": name,
            "visibility": visibility,
            "steps": [{"content": "Brown the chicken", "position": 1}],
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _befriend(client, a, ah, b, bh):
    fid = client.post("/friends/request", json={"to_user_id": b.id}, headers=ah).json()["id"]
    assert client.post(f"/friends/{fid}/accept", headers=bh).status_code == 200


def _unfriend(client, a, ah, b):
    fid = next(f["id"] for f in client.get("/friends", headers=ah).json() if f["user_id"] == b.id)
    assert client.delete(f"/friends/{fid}", headers=ah).status_code == 204


# --- keeping what you can read ---


def test_keep_a_public_recipe_puts_it_on_your_shelf(client, make_user):
    owner, oh = make_user()
    keeper, kh = make_user()
    rec = _recipe(client, oh, name="Public adobo", visibility="public")

    r = client.post(f"/recipes/{rec['id']}/save", headers=kh)
    assert r.status_code == 201, r.text
    assert r.json()["kept_by_me"] is True
    # It is the COOK's recipe, not a copy: same id, same owner.
    assert r.json()["id"] == rec["id"]
    assert r.json()["user_id"] == owner.id

    shelf = client.get("/recipes/kept", headers=kh).json()
    assert [x["id"] for x in shelf["recipes"]] == [rec["id"]]
    assert shelf["unreachable_count"] == 0
    # And the keeper's OWN recipe list is untouched — nothing was duplicated into it.
    assert client.get("/recipes", headers=kh).json() == []


def test_keeping_is_idempotent(client, make_user):
    _, oh = make_user()
    _, kh = make_user()
    rec = _recipe(client, oh, visibility="public")
    assert client.post(f"/recipes/{rec['id']}/save", headers=kh).status_code == 201
    assert client.post(f"/recipes/{rec['id']}/save", headers=kh).status_code == 201
    assert len(client.get("/recipes/kept", headers=kh).json()["recipes"]) == 1


def test_a_friend_can_keep_a_friends_visibility_recipe(client, make_user):
    owner, oh = make_user()
    friend, fh = make_user()
    _befriend(client, owner, oh, friend, fh)
    rec = _recipe(client, oh, name="Friends dish", visibility="friends")
    assert client.post(f"/recipes/{rec['id']}/save", headers=fh).status_code == 201
    assert len(client.get("/recipes/kept", headers=fh).json()["recipes"]) == 1


def test_cannot_keep_a_recipe_you_cannot_read(client, make_user):
    """THE self-grant test. A save row is created by the reader, so if keeping were
    allowed on an unreadable recipe — or if can_view consulted saves — anyone could
    bookmark a stranger's private recipe and read it. Both directions are closed."""
    _, oh = make_user()
    _, sh = make_user()
    rec = _recipe(client, oh, name="Private dish")  # private, no relationship

    assert client.post(f"/recipes/{rec['id']}/save", headers=sh).status_code == 404
    # Nothing was created, and the recipe is still unreadable.
    assert client.get("/recipes/kept", headers=sh).json() == {
        "recipes": [],
        "unreachable_count": 0,
    }
    assert client.get(f"/recipes/{rec['id']}", headers=sh).status_code == 404


def test_cannot_keep_your_own_recipe(client, make_user):
    _, oh = make_user()
    rec = _recipe(client, oh, visibility="public")
    r = client.post(f"/recipes/{rec['id']}/save", headers=oh)
    assert r.status_code == 400
    # It stays in Recipes, and the Kept shelf does not double-count your own kitchen.
    assert client.get("/recipes/kept", headers=oh).json()["recipes"] == []


def test_keeping_a_deleted_recipe_404s(client, make_user):
    _, oh = make_user()
    _, kh = make_user()
    rec = _recipe(client, oh, visibility="public")
    assert client.delete(f"/recipes/{rec['id']}", headers=oh).status_code == 204
    assert client.post(f"/recipes/{rec['id']}/save", headers=kh).status_code == 404


# --- a save is not a permission: the cook can still take it away ---


def test_recipe_going_private_removes_it_from_the_shelf_and_is_counted(client, make_user):
    owner, oh = make_user()
    keeper, kh = make_user()
    rec = _recipe(client, oh, name="Now you don't", visibility="public")
    client.post(f"/recipes/{rec['id']}/save", headers=kh)
    assert len(client.get("/recipes/kept", headers=kh).json()["recipes"]) == 1

    # The cook changes their mind.
    assert (
        client.patch(f"/recipes/{rec['id']}", json={"visibility": "private"}, headers=oh).status_code
        == 200
    )

    shelf = client.get("/recipes/kept", headers=kh).json()
    assert shelf["recipes"] == []
    assert shelf["unreachable_count"] == 1  # a number, never the dish name
    assert client.get(f"/recipes/{rec['id']}", headers=kh).status_code == 404


def test_unfriending_removes_a_kept_friends_recipe_from_the_shelf(client, make_user):
    owner, oh = make_user()
    friend, fh = make_user()
    _befriend(client, owner, oh, friend, fh)
    rec = _recipe(client, oh, name="Friends only", visibility="friends")
    client.post(f"/recipes/{rec['id']}/save", headers=fh)
    assert len(client.get("/recipes/kept", headers=fh).json()["recipes"]) == 1

    _unfriend(client, owner, oh, friend)

    shelf = client.get("/recipes/kept", headers=fh).json()
    assert shelf["recipes"] == [] and shelf["unreachable_count"] == 1


def test_deleting_the_recipe_removes_it_from_the_shelf_and_is_counted(client, make_user):
    _, oh = make_user()
    _, kh = make_user()
    rec = _recipe(client, oh, visibility="public")
    client.post(f"/recipes/{rec['id']}/save", headers=kh)
    assert client.delete(f"/recipes/{rec['id']}", headers=oh).status_code == 204

    shelf = client.get("/recipes/kept", headers=kh).json()
    assert shelf["recipes"] == [] and shelf["unreachable_count"] == 1


def test_losing_access_is_permanent_reopening_does_not_restore_the_bookmark(client, make_user):
    """THE product rule: losing access removes the bookmark for good.

    A cook who restricts a recipe and later re-opens it does NOT silently put it back on
    everyone's shelf — they have to share it again. Anything else means a recipe can
    reappear in a stranger's kitchen because of a setting they never see, and it makes
    "I took that back" untrue."""
    owner, oh = make_user()
    keeper, kh = make_user()
    rec = _recipe(client, oh, name="Taken back", visibility="public")
    client.post(f"/recipes/{rec['id']}/save", headers=kh)
    assert len(client.get("/recipes/kept", headers=kh).json()["recipes"]) == 1

    # Restricted → drops off the shelf, reported once.
    client.patch(f"/recipes/{rec['id']}", json={"visibility": "private"}, headers=oh)
    first = client.get("/recipes/kept", headers=kh).json()
    assert first["recipes"] == [] and first["unreachable_count"] == 1
    # Reported ONCE: the bookmark is gone, so a second load is simply empty, not a
    # standing complaint the keeper can never clear.
    second = client.get("/recipes/kept", headers=kh).json()
    assert second == {"recipes": [], "unreachable_count": 0}

    # The cook re-opens it. It must NOT come back.
    client.patch(f"/recipes/{rec['id']}", json={"visibility": "public"}, headers=oh)
    assert client.get("/recipes/kept", headers=kh).json() == {
        "recipes": [],
        "unreachable_count": 0,
    }
    # It is readable again (it's public), so keeping it again is the way back — which is
    # the same deliberate act as the first time.
    assert client.get(f"/recipes/{rec['id']}", headers=kh).status_code == 200
    assert client.post(f"/recipes/{rec['id']}/save", headers=kh).status_code == 201
    assert len(client.get("/recipes/kept", headers=kh).json()["recipes"]) == 1


def test_a_deleted_recipe_is_gone_for_everyone_forever(client, make_user):
    """Deletion is absolute: no keeper, grantee, or anyone else reaches it again."""
    owner, oh = make_user()
    keeper, kh = make_user()
    grantee, gh = make_user()
    rec = _recipe(client, oh, name="Gone", visibility="public")
    client.post(f"/recipes/{rec['id']}/save", headers=kh)
    client.post(f"/recipes/{rec['id']}/handoff", json={"to_user_id": grantee.id}, headers=oh)
    assert client.get(f"/recipes/{rec['id']}", headers=gh).status_code == 200

    assert client.delete(f"/recipes/{rec['id']}", headers=oh).status_code == 204

    # The keeper's bookmark is pruned; the grantee's grant survives as history but the
    # recipe is unreachable through it, and neither can read it.
    keeper_shelf = client.get("/recipes/kept", headers=kh).json()
    assert keeper_shelf["recipes"] == [] and keeper_shelf["unreachable_count"] == 1
    assert client.get("/recipes/kept", headers=kh).json()["unreachable_count"] == 0
    assert client.get("/recipes/kept", headers=gh).json()["recipes"] == []
    for h in (oh, kh, gh):
        assert client.get(f"/recipes/{rec['id']}", headers=h).status_code == 404


def test_unfriending_removes_the_bookmark_permanently(client, make_user):
    """Re-friending doesn't restore it either — same rule, different cause."""
    owner, oh = make_user()
    friend, fh = make_user()
    _befriend(client, owner, oh, friend, fh)
    rec = _recipe(client, oh, name="Friends only", visibility="friends")
    client.post(f"/recipes/{rec['id']}/save", headers=fh)
    assert len(client.get("/recipes/kept", headers=fh).json()["recipes"]) == 1

    _unfriend(client, owner, oh, friend)
    assert client.get("/recipes/kept", headers=fh).json()["unreachable_count"] == 1

    # Friends again — the recipe is readable, but the shelf entry does not return.
    _befriend(client, owner, oh, friend, fh)
    assert client.get(f"/recipes/{rec['id']}", headers=fh).status_code == 200
    assert client.get("/recipes/kept", headers=fh).json() == {
        "recipes": [],
        "unreachable_count": 0,
    }


def test_pruning_one_keepers_shelf_never_touches_another(client, make_user):
    """The prune is scoped to the caller's own rows — loading YOUR shelf must not delete
    anyone else's bookmarks, even for the same recipe."""
    owner, oh = make_user()
    _, k1 = make_user()
    _, k2 = make_user()
    rec = _recipe(client, oh, name="Shared interest", visibility="public")
    client.post(f"/recipes/{rec['id']}/save", headers=k1)
    client.post(f"/recipes/{rec['id']}/save", headers=k2)

    # k1 loads their shelf while everything is still visible: no prune should happen.
    assert client.get("/recipes/kept", headers=k1).json()["unreachable_count"] == 0
    assert len(client.get("/recipes/kept", headers=k2).json()["recipes"]) == 1


def test_the_keeper_always_reads_the_cooks_current_version(client, make_user):
    """The reason a bookmark beats a copy: the cook's correction reaches the keeper."""
    _, oh = make_user()
    _, kh = make_user()
    rec = _recipe(client, oh, name="Adobo", visibility="public")
    client.post(f"/recipes/{rec['id']}/save", headers=kh)

    client.patch(f"/recipes/{rec['id']}", json={"name": "Adobo (1 tsp, not 1 tbsp)"}, headers=oh)

    shelf = client.get("/recipes/kept", headers=kh).json()
    assert shelf["recipes"][0]["name"] == "Adobo (1 tsp, not 1 tbsp)"


# --- un-keeping ---


def test_unkeeping_removes_only_your_own_shelf_row(client, make_user):
    _, oh = make_user()
    _, k1 = make_user()
    _, k2 = make_user()
    rec = _recipe(client, oh, visibility="public")
    client.post(f"/recipes/{rec['id']}/save", headers=k1)
    client.post(f"/recipes/{rec['id']}/save", headers=k2)

    assert client.delete(f"/recipes/{rec['id']}/save", headers=k1).status_code == 204
    assert client.get("/recipes/kept", headers=k1).json()["recipes"] == []
    # The other keeper is unaffected, and so is the cook's recipe.
    assert len(client.get("/recipes/kept", headers=k2).json()["recipes"]) == 1
    assert client.get(f"/recipes/{rec['id']}", headers=oh).status_code == 200


def test_unkeeping_something_you_never_kept_404s(client, make_user):
    _, oh = make_user()
    _, kh = make_user()
    rec = _recipe(client, oh, visibility="public")
    assert client.delete(f"/recipes/{rec['id']}/save", headers=kh).status_code == 404


# --- the shelf merges grants and bookmarks ---


def test_shelf_merges_handed_to_you_with_kept_by_you(client, make_user):
    owner, oh = make_user()
    other, o2h = make_user()
    keeper, kh = make_user()
    handed = _recipe(client, oh, name="Handed to me")  # private + grant
    client.post(f"/recipes/{handed['id']}/handoff", json={"to_user_id": keeper.id}, headers=oh)
    kept = _recipe(client, o2h, name="Kept by me", visibility="public")
    client.post(f"/recipes/{kept['id']}/save", headers=kh)

    shelf = client.get("/recipes/kept", headers=kh).json()
    assert {x["name"] for x in shelf["recipes"]} == {"Handed to me", "Kept by me"}
    assert shelf["unreachable_count"] == 0


def test_unkeeping_cannot_hide_a_recipe_someone_handed_you(client, make_user):
    """Why the merge happens on the server: the grant stands on its own, so removing a
    bookmark must not be able to remove a gift. (Here the same recipe is both.)"""
    owner, oh = make_user()
    keeper, kh = make_user()
    rec = _recipe(client, oh, name="Given and kept", visibility="public")
    client.post(f"/recipes/{rec['id']}/handoff", json={"to_user_id": keeper.id}, headers=oh)
    client.post(f"/recipes/{rec['id']}/save", headers=kh)
    assert len(client.get("/recipes/kept", headers=kh).json()["recipes"]) == 1

    assert client.delete(f"/recipes/{rec['id']}/save", headers=kh).status_code == 204
    # Still there — because it was handed to them, not merely bookmarked.
    shelf = client.get("/recipes/kept", headers=kh).json()
    assert [x["name"] for x in shelf["recipes"]] == ["Given and kept"]
    assert shelf["unreachable_count"] == 0


def test_shelf_never_lists_your_own_recipes(client, make_user):
    _, oh = make_user()
    _recipe(client, oh, name="Mine", visibility="public")
    assert client.get("/recipes/kept", headers=oh).json() == {
        "recipes": [],
        "unreachable_count": 0,
    }


# --- keeping grants nothing beyond reading ---


def test_keeping_does_not_let_you_edit_delete_or_hand_on(client, make_user):
    """Read is not write, and keeping is not owning. A keeper's shelf entry must not
    become a licence to change the cook's record or move it to a third person — the
    latter is why #57 shipped keep-only, with re-sharing left to the cook."""
    owner, oh = make_user()
    keeper, kh = make_user()
    third, _ = make_user()
    rec = _recipe(client, oh, name="Still theirs", visibility="public")
    assert client.post(f"/recipes/{rec['id']}/save", headers=kh).status_code == 201

    assert client.patch(f"/recipes/{rec['id']}", json={"name": "Mine now"}, headers=kh).status_code == 404
    assert client.delete(f"/recipes/{rec['id']}", headers=kh).status_code == 404
    assert (
        client.post(
            f"/recipes/{rec['id']}/handoff", json={"to_user_id": third.id}, headers=kh
        ).status_code
        == 404
    )
    assert client.get(f"/recipes/{rec['id']}", headers=oh).json()["name"] == "Still theirs"


def test_kept_by_me_is_only_ever_about_the_caller(client, make_user):
    """`kept_by_me` says whether YOU keep it and nothing about anyone else."""
    _, oh = make_user()
    _, k1 = make_user()
    _, k2 = make_user()
    rec = _recipe(client, oh, visibility="public")
    client.post(f"/recipes/{rec['id']}/save", headers=k1)

    assert client.get(f"/recipes/{rec['id']}", headers=k1).json()["kept_by_me"] is True
    assert client.get(f"/recipes/{rec['id']}", headers=k2).json()["kept_by_me"] is False
    owner_view = client.get(f"/recipes/{rec['id']}", headers=oh).json()
    assert owner_view["kept_by_me"] is False  # the owner doesn't "keep" their own


def test_the_keeper_count_is_the_COOKS_ALONE(client, make_user):
    """Owner decision (#96, revised): the cook learns HOW MANY people kept a recipe, never WHO.

    This narrowed an older rule that forbade any keeper count at all. What it was protecting
    against was a PUBLIC tally — child_count restored, i.e. a like button. A cook-only number
    doesn't create that: nobody can compare, and it's the only feedback a recipe written WITHOUT
    a post ever gets, since the ask/fulfil loop lives only on posts.

    None, never 0, for everyone else — a client can't render a number it was never given. Same
    discipline as request_count (#79)."""
    _, oh = make_user()
    _, k1 = make_user()
    _, k2 = make_user()
    rec = _recipe(client, oh, visibility="public")
    client.post(f"/recipes/{rec['id']}/save", headers=k1)
    client.post(f"/recipes/{rec['id']}/save", headers=k2)

    assert client.get(f"/recipes/{rec['id']}", headers=oh).json()["keeper_count"] == 2
    # Not 0 — None. A zero would be a number to render; None is an absence of one.
    assert client.get(f"/recipes/{rec['id']}", headers=k1).json()["keeper_count"] is None
    assert client.get(f"/recipes/{rec['id']}", headers=k2).json()["keeper_count"] is None


def test_a_cook_with_no_keepers_gets_zero_not_None(client, make_user):
    # The owner/non-owner distinction has to be about IDENTITY, not about whether the number
    # happens to be zero — otherwise "0 keepers" and "not your recipe" become indistinguishable
    # and the client can't tell whether to hide the line or show nothing.
    _, oh = make_user()
    rec = _recipe(client, oh, visibility="public")
    assert client.get(f"/recipes/{rec['id']}", headers=oh).json()["keeper_count"] == 0


def test_NO_keeper_names_or_list_for_anyone_including_the_cook(client, make_user):
    """The half of the old rule that did NOT change, and the one worth guarding hardest.

    Keeping is a bookmark addressed to nobody — unlike an ask, which is addressed to the cook.
    Naming the keeper would change what keeping means and could chill it, so there is no keeper
    list endpoint and no keeper identity in any payload."""
    _, oh = make_user()
    keeper, kh = make_user(first_name="Zenobia")
    rec = _recipe(client, oh, visibility="public")
    client.post(f"/recipes/{rec['id']}/save", headers=kh)

    body = client.get(f"/recipes/{rec['id']}", headers=oh)
    assert "Zenobia" not in body.text
    for banned in ("keepers", "kept_by_users", "saved_by", "keeper_ids"):
        assert banned not in body.text


def test_kept_endpoints_require_auth(client, make_user):
    make_user()
    assert client.get("/recipes/kept").status_code == 401
    assert client.post("/recipes/1/save").status_code == 401
    assert client.delete("/recipes/1/save").status_code == 401


# --- the cook is told, anonymously (#96) ---


def test_the_cook_is_notified_when_someone_keeps_their_recipe(client, make_user):
    """The gap this closes: a recipe written WITHOUT a post has no feedback channel at all. The
    ask/fulfil loop lives only on posts, so keeps are the only signal that surface generates —
    a cook could share a link and never learn it landed."""
    owner, oh = make_user()
    _, kh = make_user()
    rec = _recipe(client, oh, name="Adobo", visibility="public")

    assert client.get("/notifications", headers=oh).json()["unread_count"] == 0
    client.post(f"/recipes/{rec['id']}/save", headers=kh)

    inbox = client.get("/notifications", headers=oh).json()
    assert inbox["unread_count"] == 1
    row = inbox["notifications"][0]
    assert row["type"] == "recipe_kept"
    assert row["subject"] == "Adobo"       # which dish, so the line is worth reading
    assert row["recipe_id"] == rec["id"]   # and it opens


def test_the_keep_notification_NEVER_carries_who_did_it(client, make_user):
    """The whole point of the count-only decision, enforced at the API boundary rather than in
    the UI. The row DOES store actor_id — notify() needs it for the never-notify-yourself check
    and for dedupe — so a client that merely declined to render the name would still be
    receiving it. This asserts it never leaves the server."""
    owner, oh = make_user()
    keeper, kh = make_user(first_name="Zenobia", last_name="Quist")
    rec = _recipe(client, oh, visibility="public")
    client.post(f"/recipes/{rec['id']}/save", headers=kh)

    res = client.get("/notifications", headers=oh)
    assert "Zenobia" not in res.text and "Quist" not in res.text
    row = res.json()["notifications"][0]
    assert row["actor_id"] is None
    assert row["actor_first_name"] is None
    assert row["actor_last_name"] is None
    assert row["actor_photo_url"] is None


def test_an_ask_still_names_the_asker(client, make_user):
    # The anonymity is scoped to recipe_kept. An ask is addressed TO the cook, so naming the
    # asker is inherent — and the cook has to know who to hand the recipe to.
    cook, ch = make_user(first_name="Ana")
    fan, fh = make_user(first_name="Ben")
    fid = client.post("/friends/request", json={"to_user_id": fan.id}, headers=ch).json()["id"]
    client.post(f"/friends/{fid}/accept", headers=fh)
    post = client.post(
        "/posts",
        json={"photo_url": "https://img.test/a.jpg", "dish_name": "Adobo", "visibility": "friends"},
        headers=ch,
    ).json()
    client.post(f"/posts/{post['id']}/request", headers=fh)

    row = [
        n
        for n in client.get("/notifications", headers=ch).json()["notifications"]
        if n["type"] == "recipe_request"
    ][0]
    assert row["actor_first_name"] == "Ben"


def test_keep_unkeep_keep_does_not_flood_the_inbox(client, make_user):
    # One tap each way. Without dedupe the cook's inbox fills with the same line — the exact
    # flood already fixed on the ask path (#79).
    owner, oh = make_user()
    _, kh = make_user()
    rec = _recipe(client, oh, visibility="public")

    for _ in range(3):
        client.post(f"/recipes/{rec['id']}/save", headers=kh)
        client.delete(f"/recipes/{rec['id']}/save", headers=kh)
    client.post(f"/recipes/{rec['id']}/save", headers=kh)

    inbox = client.get("/notifications", headers=oh).json()
    assert len([n for n in inbox["notifications"] if n["type"] == "recipe_kept"]) == 1


def test_re_keeping_an_already_kept_recipe_notifies_nothing_new(client, make_user):
    # The endpoint is idempotent, so the notification must be too.
    owner, oh = make_user()
    _, kh = make_user()
    rec = _recipe(client, oh, visibility="public")
    client.post(f"/recipes/{rec['id']}/save", headers=kh)
    client.post("/notifications/read", json={}, headers=oh)  # read it, so dedupe won't apply
    client.post(f"/recipes/{rec['id']}/save", headers=kh)    # re-keep: no new row

    inbox = client.get("/notifications", headers=oh).json()
    assert inbox["unread_count"] == 0
    assert len([n for n in inbox["notifications"] if n["type"] == "recipe_kept"]) == 1


def test_keeping_never_notifies_you_about_your_own_recipe(client, make_user):
    # You can't keep your own (400), but assert the inbox stays empty regardless — notify()
    # refuses a self-notification too, and both guards should hold.
    owner, oh = make_user()
    rec = _recipe(client, oh, visibility="public")
    assert client.post(f"/recipes/{rec['id']}/save", headers=oh).status_code == 400
    assert client.get("/notifications", headers=oh).json()["notifications"] == []


def test_keeping_a_SECOND_recipe_is_reported_too(client, make_user):
    """The Critical this feature shipped with, caught in review.

    `notify()`'s dedupe key was written for `recipe_request`, where `post_id` is the
    discriminator — so it never looked at `recipe_id`. For a keep, post_id is always None, and
    the key collapsed to "this actor, this cook, unread": the same person keeping a SECOND
    recipe produced NO notification at all, with nothing to backfill later.

    That's the exact signal-lost failure #96 exists to prevent, and the likeliest real pattern
    for this feature — one enthusiastic person opening a cook's kitchen and keeping three
    recipes in a sitting, with the cook told about one."""
    owner, oh = make_user()
    _, kh = make_user()
    adobo = _recipe(client, oh, name="Adobo", visibility="public")
    sinigang = _recipe(client, oh, name="Sinigang", visibility="public")

    client.post(f"/recipes/{adobo['id']}/save", headers=kh)
    client.post(f"/recipes/{sinigang['id']}/save", headers=kh)

    inbox = client.get("/notifications", headers=oh).json()
    subjects = sorted(
        n["subject"] for n in inbox["notifications"] if n["type"] == "recipe_kept"
    )
    assert subjects == ["Adobo", "Sinigang"]
    assert inbox["unread_count"] == 2


def test_two_people_keeping_the_SAME_recipe_is_ONE_line(client, make_user):
    """The mirror of the same bug. With actor_id in the key, two different keepers of one recipe
    produced two rows the reader cannot tell apart — "Someone kept your Adobo." twice, both
    anonymous. If the reader can't distinguish them, they aren't distinct, so the dedupe key
    excludes actor_id for ANONYMOUS_TYPES."""
    owner, oh = make_user()
    _, k1 = make_user()
    _, k2 = make_user()
    rec = _recipe(client, oh, name="Adobo", visibility="public")

    client.post(f"/recipes/{rec['id']}/save", headers=k1)
    client.post(f"/recipes/{rec['id']}/save", headers=k2)

    inbox = client.get("/notifications", headers=oh).json()
    assert len([n for n in inbox["notifications"] if n["type"] == "recipe_kept"]) == 1
    # ...and the COUNT still knows there are two. The line says "it happened"; the count says
    # how much.
    assert client.get(f"/recipes/{rec['id']}", headers=oh).json()["keeper_count"] == 2


def test_an_ask_is_still_deduped_PER_ASKER(client, make_user):
    """Excluding actor_id must be scoped to anonymous types. Two different people asking for the
    same recipe are two different obligations, and the cook sees both names."""
    cook, ch = make_user(first_name="Ana")
    a, ah = make_user(first_name="Ben")
    b, bh = make_user(first_name="Cruz")
    post = client.post(
        "/posts",
        json={"photo_url": "https://img.test/a.jpg", "dish_name": "Adobo", "visibility": "public"},
        headers=ch,
    ).json()
    client.post(f"/posts/{post['id']}/request", headers=ah)
    client.post(f"/posts/{post['id']}/request", headers=bh)

    names = sorted(
        n["actor_first_name"]
        for n in client.get("/notifications", headers=ch).json()["notifications"]
        if n["type"] == "recipe_request"
    )
    assert names == ["Ben", "Cruz"]


def test_blocking_does_NOT_delete_an_anonymous_keep_line(client, make_user):
    """Important, caught in review: the block sweep deletes notifications by actor_id, which
    caught `recipe_kept` rows — and DELETING one is what leaks the identity. A cook with one
    unread "Someone kept your Adobo" who blocks a person and watches the line vanish (while
    keeper_count stays put, since the save survives a block by design) has learned who the
    keeper was, by inference, through the server.

    The sweep's own justification is that a lingering NAME would break "you won't see each other
    anywhere" — an anonymous row carries no name, so the rationale doesn't reach it."""
    owner, oh = make_user()
    keeper, kh = make_user()
    rec = _recipe(client, oh, name="Adobo", visibility="public")
    client.post(f"/recipes/{rec['id']}/save", headers=kh)
    assert client.get("/notifications", headers=oh).json()["unread_count"] == 1

    assert client.post(
        "/friends/blocks", json={"user_id": keeper.id}, headers=oh
    ).status_code == 204

    after = client.get("/notifications", headers=oh).json()
    assert after["unread_count"] == 1, "the line must survive, or its absence names the keeper"
    assert after["notifications"][0]["type"] == "recipe_kept"
    assert after["notifications"][0]["actor_id"] is None  # still anonymous


def test_blocking_STILL_deletes_the_named_notifications(client, make_user):
    # The carve-out is scoped to anonymous types; a named line still goes, which is what the
    # sweep was for.
    owner, oh = make_user()
    other, other_h = make_user(first_name="Ben")
    client.post("/friends/request", json={"to_user_id": owner.id}, headers=other_h)
    assert client.get("/notifications", headers=oh).json()["unread_count"] == 1

    client.post("/friends/blocks", json={"user_id": other.id}, headers=oh)
    assert client.get("/notifications", headers=oh).json()["notifications"] == []
