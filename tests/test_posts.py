"""The presence feed (social feed Phase 1): posts + friends-scoped feed.

Scope is the invariant that matters: the feed shows the caller's friends' posts
(and their own), never a non-friend's. Delete is author-only (read is not write).
"""


def _befriend(client, a, ah, b, bh):
    """Make A and B accepted friends."""
    fid = client.post("/friends/request", json={"to_user_id": b.id}, headers=ah).json()["id"]
    client.post(f"/friends/{fid}/accept", headers=bh)


def _post(client, headers, dish="Adobo", description=None, photo="https://img.test/x.jpg", recipe_id=None):
    body = {"photo_url": photo, "dish_name": dish}
    if description is not None:
        body["description"] = description
    if recipe_id is not None:
        body["recipe_id"] = recipe_id
    r = client.post("/posts", json=body, headers=headers)
    return r


# --- creating ---


def test_create_post_minimal(client, make_user):
    _, h = make_user()
    r = _post(client, h, dish="Sinigang")
    assert r.status_code == 201
    body = r.json()
    assert body["dish_name"] == "Sinigang"
    assert body["recipe_id"] is None
    assert body["author_first_name"]


def test_dish_name_required(client, make_user):
    _, h = make_user()
    r = client.post("/posts", json={"photo_url": "https://img.test/x.jpg"}, headers=h)
    assert r.status_code == 422


def test_whitespace_only_dish_name_rejected(client, make_user):
    # A spaces-only name must fail at the boundary (422), not slip through
    # min_length and get stripped to empty in the router.
    _, h = make_user()
    r = _post(client, h, dish="   ")
    assert r.status_code == 422


def test_dish_name_is_stripped(client, make_user):
    _, h = make_user()
    r = _post(client, h, dish="  Adobo  ")
    assert r.status_code == 201
    assert r.json()["dish_name"] == "Adobo"


def test_can_link_own_recipe_but_not_someone_elses(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    mine = client.post(
        "/recipes",
        json={"name": "Mine", "steps": [{"content": "cook", "position": 1}]},
        headers=ah,
    ).json()
    theirs = client.post(
        "/recipes",
        json={"name": "Theirs", "steps": [{"content": "cook", "position": 1}]},
        headers=bh,
    ).json()
    # Linking my own recipe works.
    ok = _post(client, ah, recipe_id=mine["id"])
    assert ok.status_code == 201 and ok.json()["recipe_id"] == mine["id"]
    # Linking someone else's is refused.
    bad = _post(client, ah, recipe_id=theirs["id"])
    assert bad.status_code == 404


def _make_recipe(client, headers, name="Dish", visibility="public"):
    return client.post(
        "/recipes",
        json={
            "name": name,
            "visibility": visibility,
            "steps": [{"content": "cook", "position": 1}],
        },
        headers=headers,
    ).json()


def test_linked_recipe_hidden_from_a_friend_who_cannot_view_it(client, make_user):
    # A post links a recipe the AUTHOR owns, but a friend viewing the feed can only
    # see the link if THEY can read that recipe. A private recipe → the friend's
    # response nulls recipe_id (no dead-end "See the recipe" link), while the author
    # still sees it on their own view.
    author, ah = make_user()
    friend, fh = make_user()
    _befriend(client, author, ah, friend, fh)
    private = _make_recipe(client, ah, name="Secret", visibility="private")
    pid = _post(client, ah, dish="Secret dish", recipe_id=private["id"]).json()["id"]

    # Author sees the link on their own post.
    assert client.get(f"/posts/{pid}", headers=ah).json()["recipe_id"] == private["id"]
    # Friend can see the POST but not the private recipe → recipe_id is nulled.
    assert client.get(f"/posts/{pid}", headers=fh).json()["recipe_id"] is None
    # And it's nulled in the friend's feed too.
    feed = client.get("/posts/feed", headers=fh).json()
    linked = next(p for p in feed if p["id"] == pid)
    assert linked["recipe_id"] is None


def test_public_linked_recipe_visible_to_friend(client, make_user):
    author, ah = make_user()
    friend, fh = make_user()
    _befriend(client, author, ah, friend, fh)
    pub = _make_recipe(client, ah, name="Open", visibility="public")
    pid = _post(client, ah, dish="Open dish", recipe_id=pub["id"]).json()["id"]
    # A public recipe is readable by the friend, so the link stays.
    assert client.get(f"/posts/{pid}", headers=fh).json()["recipe_id"] == pub["id"]


def test_soft_deleted_linked_recipe_link_disappears(client, make_user):
    # Soft-deleting the linked recipe leaves the post standing but drops the link
    # (the recipe is no longer viewable by anyone via get_recipe).
    author, ah = make_user()
    pub = _make_recipe(client, ah, name="Gone", visibility="public")
    pid = _post(client, ah, dish="Gone dish", recipe_id=pub["id"]).json()["id"]
    assert client.get(f"/posts/{pid}", headers=ah).json()["recipe_id"] == pub["id"]
    client.delete(f"/recipes/{pub['id']}", headers=ah)
    # Post still exists; its recipe link is gone.
    resp = client.get(f"/posts/{pid}", headers=ah)
    assert resp.status_code == 200
    assert resp.json()["recipe_id"] is None


# --- the feed: scope is everything ---


def test_feed_shows_friends_posts_and_own_not_strangers(client, make_user):
    me, mh = make_user()
    friend, fh = make_user()
    stranger, sh = make_user()
    _befriend(client, me, mh, friend, fh)

    _post(client, fh, dish="Friend's dish")
    _post(client, sh, dish="Stranger's dish")
    _post(client, mh, dish="My dish")

    feed = client.get("/posts/feed", headers=mh).json()
    dishes = {p["dish_name"] for p in feed}
    assert "Friend's dish" in dishes
    assert "My dish" in dishes  # own posts included
    assert "Stranger's dish" not in dishes  # THE scope guarantee


def test_feed_is_reverse_chron(client, make_user):
    me, mh = make_user()
    _post(client, mh, dish="first")
    _post(client, mh, dish="second")
    _post(client, mh, dish="third")
    feed = client.get("/posts/feed", headers=mh).json()
    assert [p["dish_name"] for p in feed] == ["third", "second", "first"]


def test_feed_cursor_returns_only_posts_older_than_it(client, make_user):
    # The cursor is `id < before_id` — an integer keyset, so it's exact regardless
    # of timestamp granularity. A cursor at the newest post returns the rest; a
    # cursor at the oldest returns nothing.
    _, mh = make_user()
    for i in range(3):
        _post(client, mh, dish=f"dish {i}")
    full = client.get("/posts/feed", headers=mh).json()
    assert len(full) == 3

    newest_id = full[0]["id"]
    after_newest = client.get(f"/posts/feed?before_id={newest_id}", headers=mh).json()
    assert [p["id"] for p in after_newest] == [p["id"] for p in full[1:]]

    oldest_id = full[-1]["id"]
    assert client.get(f"/posts/feed?before_id={oldest_id}", headers=mh).json() == []


def test_feed_keyset_cursor_paginates_without_skipping(client, make_user):
    # Keyset cursor on id: given the last row of a page, the next call returns
    # everything with a smaller id, in feed order. Even when posts share a
    # second-granularity timestamp, an integer cursor can't skip or repeat one at a
    # page boundary. Walk the whole feed one row at a time and assert we see every
    # post exactly once, in order.
    _, mh = make_user()
    for i in range(5):
        _post(client, mh, dish=f"dish {i}")

    full = client.get("/posts/feed", headers=mh).json()
    assert [p["dish_name"] for p in full] == [f"dish {i}" for i in range(4, -1, -1)]

    walked = []
    before_id = None
    for _ in range(len(full) + 2):  # +2 guards against an infinite loop
        url = "/posts/feed"
        if before_id is not None:
            url += f"?before_id={before_id}"
        page = client.get(url, headers=mh).json()
        if not page:
            break
        # Take one row per step to force the boundary to land on every post.
        row = page[0]
        walked.append(row["dish_name"])
        before_id = row["id"]

    assert walked == [f"dish {i}" for i in range(4, -1, -1)]


def test_unfriending_removes_posts_from_feed(client, make_user):
    me, mh = make_user()
    friend, fh = make_user()
    fid = client.post("/friends/request", json={"to_user_id": friend.id}, headers=mh).json()["id"]
    client.post(f"/friends/{fid}/accept", headers=fh)
    _post(client, fh, dish="theirs")
    assert "theirs" in {p["dish_name"] for p in client.get("/posts/feed", headers=mh).json()}
    client.delete(f"/friends/{fid}", headers=mh)
    assert "theirs" not in {p["dish_name"] for p in client.get("/posts/feed", headers=mh).json()}


# --- single post + delete ---


def test_get_post_visible_to_friend_not_stranger(client, make_user):
    author, ah = make_user()
    friend, fh = make_user()
    stranger, sh = make_user()
    _befriend(client, author, ah, friend, fh)
    pid = _post(client, ah, dish="Adobo").json()["id"]

    assert client.get(f"/posts/{pid}", headers=ah).status_code == 200   # author
    assert client.get(f"/posts/{pid}", headers=fh).status_code == 200   # friend
    assert client.get(f"/posts/{pid}", headers=sh).status_code == 404   # stranger


def test_delete_is_author_only(client, make_user):
    author, ah = make_user()
    friend, fh = make_user()
    _befriend(client, author, ah, friend, fh)
    pid = _post(client, ah, dish="Adobo").json()["id"]
    # A friend can see it but not delete it.
    assert client.delete(f"/posts/{pid}", headers=fh).status_code == 404
    # The author can.
    assert client.delete(f"/posts/{pid}", headers=ah).status_code == 204
    assert client.get(f"/posts/{pid}", headers=ah).status_code == 404


def test_user_posts_friend_gated(client, make_user):
    author, ah = make_user()
    friend, fh = make_user()
    stranger, sh = make_user()
    _befriend(client, author, ah, friend, fh)
    _post(client, ah, dish="Adobo")
    # Own + friend see the posts; a stranger sees an empty list (profile is public,
    # posts are not).
    assert len(client.get(f"/posts/users/{author.id}", headers=ah).json()) == 1
    assert len(client.get(f"/posts/users/{author.id}", headers=fh).json()) == 1
    assert client.get(f"/posts/users/{author.id}", headers=sh).json() == []


# --- the friends/everyone toggle (#70) ---
#
# 'everyone' scope is discovery: PUBLIC posts from people you're NOT friends with (and
# not your own). The privacy invariant is that ONLY visibility=='public' posts surface —
# a stranger's 'friends' post must never leak into your everyone feed.


def _post_vis(client, headers, visibility, dish="Dish"):
    r = client.post(
        "/posts",
        json={"photo_url": "https://img.test/x.jpg", "dish_name": dish, "visibility": visibility},
        headers=headers,
    )
    assert r.status_code == 201
    return r.json()


def test_everyone_scope_shows_strangers_public_posts(client, make_user):
    _, mh = make_user()
    _, sh = make_user()  # a stranger (not a friend)
    _post_vis(client, sh, "public", dish="Stranger public")
    feed = client.get("/posts/feed?scope=everyone", headers=mh).json()
    assert {p["dish_name"] for p in feed} == {"Stranger public"}


def test_everyone_scope_hides_a_strangers_non_public_posts(client, make_user):
    # THE privacy test: a stranger's 'friends' and 'private' posts must NOT appear in the
    # everyone feed — only their 'public' ones. can_view_post grants a non-friend public
    # only, and the SQL predicate enforces exactly that.
    _, mh = make_user()
    _, sh = make_user()
    _post_vis(client, sh, "public", dish="Public one")
    _post_vis(client, sh, "friends", dish="Friends only")  # must not leak
    _post_vis(client, sh, "private", dish="Private")       # must not leak
    dishes = {p["dish_name"] for p in client.get("/posts/feed?scope=everyone", headers=mh).json()}
    assert dishes == {"Public one"}


def test_everyone_scope_excludes_own_and_friends_posts(client, make_user):
    # No overlap with the friends scope: your own public posts and your friends' public
    # posts stay in 'friends'; 'everyone' is strangers only.
    me, mh = make_user()
    friend, fh = make_user()
    _, sh = make_user()
    _befriend(client, me, mh, friend, fh)
    _post_vis(client, mh, "public", dish="My public")
    _post_vis(client, fh, "public", dish="Friend public")
    _post_vis(client, sh, "public", dish="Stranger public")
    everyone = {p["dish_name"] for p in client.get("/posts/feed?scope=everyone", headers=mh).json()}
    assert everyone == {"Stranger public"}  # not mine, not my friend's


def test_friends_scope_unchanged_by_the_new_param(client, make_user):
    # The default scope (and explicit ?scope=friends) is the Phase-1a behavior: friends'
    # + own posts, never a stranger's — regardless of the stranger's post being public.
    me, mh = make_user()
    friend, fh = make_user()
    _, sh = make_user()
    _befriend(client, me, mh, friend, fh)
    _post_vis(client, fh, "friends", dish="Friend dish")
    _post_vis(client, mh, "friends", dish="My dish")
    _post_vis(client, sh, "public", dish="Stranger public")
    for url in ("/posts/feed", "/posts/feed?scope=friends"):
        dishes = {p["dish_name"] for p in client.get(url, headers=mh).json()}
        assert dishes == {"Friend dish", "My dish"}
        assert "Stranger public" not in dishes


def test_feed_rejects_an_unknown_scope(client, make_user):
    _, mh = make_user()
    # The Literal enum makes a bogus scope a 422, not a silent fallback to friends.
    assert client.get("/posts/feed?scope=nonsense", headers=mh).status_code == 422


# --- Browse posts (#71): public discovery ---
#
# GET /posts/browse surfaces PUBLIC posts for discovery. Unlike the feed it doesn't scope
# to friends — but it's still public-only, so a friends/private post never appears.


def test_browse_shows_only_public_posts(client, make_user):
    _, ah = make_user()
    _, vh = make_user()  # a stranger
    _post_vis(client, ah, "public", dish="Public meal")
    _post_vis(client, ah, "friends", dish="Friends meal")
    _post_vis(client, ah, "private", dish="Private meal")
    dishes = {p["dish_name"] for p in client.get("/posts/browse", headers=vh).json()}
    assert dishes == {"Public meal"}  # friends/private never surface


def test_browse_includes_own_and_friends_public_posts(client, make_user):
    # Unlike the everyone-FEED scope, Browse is discovery of what's public — it does NOT
    # exclude your own or your friends' public posts.
    me, mh = make_user()
    friend, fh = make_user()
    _befriend(client, me, mh, friend, fh)
    _post_vis(client, mh, "public", dish="Mine public")
    _post_vis(client, fh, "public", dish="Friend public")
    dishes = {p["dish_name"] for p in client.get("/posts/browse", headers=mh).json()}
    assert dishes == {"Mine public", "Friend public"}


def test_browse_returns_all_public_posts_uncapped(client, make_user):
    # Browse loads EVERY public post (newest first) and lets the client filter/search —
    # same shape as GET /recipes/browse. A cap here would silently hide older public meals
    # from the Meals-tab search (the #71 review caught exactly that), so there's no LIMIT.
    _, ah = make_user()
    _, vh = make_user()
    # 35 > the 30 feed-page size, so a LIMIT would drop the oldest 5.
    made = [_post_vis(client, ah, "public", dish=f"Dish {i}") for i in range(35)]
    got = client.get("/posts/browse", headers=vh).json()
    # All of them come back — more than one feed page — newest first.
    assert len(got) == len(made) == 35
    assert [p["id"] for p in got] == sorted((p["id"] for p in made), reverse=True)


def test_browse_is_reverse_chron(client, make_user):
    _, ah = make_user()
    _, vh = make_user()
    _post_vis(client, ah, "public", dish="older")
    _post_vis(client, ah, "public", dish="newer")
    dishes = [p["dish_name"] for p in client.get("/posts/browse", headers=vh).json()]
    assert dishes == ["newer", "older"]


def test_all_post_endpoints_require_auth(client, make_user):
    make_user()
    assert client.get("/posts/feed").status_code == 401
    assert client.get("/posts/browse").status_code == 401
    assert client.post("/posts", json={"photo_url": "x", "dish_name": "y"}).status_code == 401
    assert client.patch("/posts/1", json={"dish_name": "y"}).status_code == 401
    assert client.delete("/posts/1").status_code == 401


# --- editing your own meal (PATCH /posts/{id}) ---


def _own(client, headers, **over):
    body = {"photo_url": "https://img.test/a.jpg", "dish_name": "Adobo", "visibility": "friends"}
    body.update(over)
    r = client.post("/posts", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def test_the_author_can_edit_their_meal(client, make_user):
    _, ah = make_user()
    post = _own(client, ah, description="first go")

    r = client.patch(
        f"/posts/{post['id']}",
        json={"dish_name": "Chicken adobo", "description": "second go", "visibility": "public"},
        headers=ah,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dish_name"] == "Chicken adobo"
    assert body["description"] == "second go"
    assert body["visibility"] == "public"
    # And it persisted, not just echoed.
    assert client.get(f"/posts/{post['id']}", headers=ah).json()["dish_name"] == "Chicken adobo"


def test_a_partial_edit_leaves_everything_else_alone(client, make_user):
    _, ah = make_user()
    post = _own(client, ah, description="keep me", visibility="public")
    client.patch(f"/posts/{post['id']}", json={"dish_name": "Renamed"}, headers=ah)
    body = client.get(f"/posts/{post['id']}", headers=ah).json()
    assert body["description"] == "keep me"
    assert body["visibility"] == "public"
    assert body["photo_url"] == "https://img.test/a.jpg"


def test_an_empty_description_CLEARS_it_but_null_does_not(client, make_user):
    """The cost of a partial update: `None` has to mean "unchanged", so clearing needs `""`."""
    _, ah = make_user()
    post = _own(client, ah, description="a line")

    client.patch(f"/posts/{post['id']}", json={"description": None}, headers=ah)
    assert client.get(f"/posts/{post['id']}", headers=ah).json()["description"] == "a line"

    client.patch(f"/posts/{post['id']}", json={"description": "   "}, headers=ah)
    assert client.get(f"/posts/{post['id']}", headers=ah).json()["description"] is None


def test_READ_IS_NOT_WRITE_a_friend_cannot_edit_your_meal(client, make_user):
    """A friend can SEE this post. Editing is a different question, answered by ownership."""
    a, ah = make_user()
    b, bh = make_user()
    fid = client.post("/friends/request", json={"to_user_id": b.id}, headers=ah).json()["id"]
    client.post(f"/friends/{fid}/accept", headers=bh)
    post = _own(client, ah)
    assert client.get(f"/posts/{post['id']}", headers=bh).status_code == 200  # can read

    r = client.patch(f"/posts/{post['id']}", json={"dish_name": "Hijacked"}, headers=bh)
    assert r.status_code == 404  # not 403 — don't confirm it exists to someone not entitled
    assert r.json() == {"detail": "Post not found"}
    assert client.get(f"/posts/{post['id']}", headers=ah).json()["dish_name"] == "Adobo"


def test_editing_requires_auth_and_404s_on_an_unknown_post(client, make_user):
    assert client.patch("/posts/1", json={"dish_name": "x"}).status_code == 401
    _, ah = make_user()
    assert client.patch("/posts/999999", json={"dish_name": "x"}, headers=ah).status_code == 404


def test_an_edit_CAN_replace_the_photo_but_only_with_one_of_OUR_uploads(client, make_user):
    """#106 reversed #98 on the photo, and the reversal keeps #98's actual objection.

    #98 removed `photo_url` for two reasons and only one of them was about product meaning. The
    product reason ("a different photo is a different meal, so re-shoot it as a new post")
    described what a post MEANS but answered the wrong question: the common case is a photo that
    came out badly, and delete-and-repost was the only remedy — which loses the post's date, its
    place in every feed, and any recipe asks already on it. The owner reversed that.

    The SECURITY reason has not been reversed. The field carried no host validation, so an author
    could repoint their own post's image at any third-party URL that then loaded in every friend's
    browser — every viewer's IP arriving in a log they never chose to contact. `update_post` now
    runs it through `services/media.require_our_image_url`, the same rule `PATCH /auth/me` applies.
    """
    _, ah = make_user()
    post = _own(client, ah)

    # A Cloudinary URL — one of ours — replaces it.
    good = "https://res.cloudinary.com/demo/image/upload/v1/issei/new.jpg"
    r = client.patch(f"/posts/{post['id']}", json={"photo_url": good}, headers=ah)
    assert r.status_code == 200
    assert r.json()["photo_url"] == good
    assert client.get(f"/posts/{post['id']}", headers=ah).json()["photo_url"] == good

    # Anything else is refused, with copy a person can read rather than a field name.
    r = client.patch(
        f"/posts/{post['id']}",
        json={"photo_url": "https://evil.test/tracker.gif"},
        headers=ah,
    )
    assert r.status_code == 422
    assert "uploaded through issei" in r.json()["detail"]
    # And the refusal changed nothing.
    assert client.get(f"/posts/{post['id']}", headers=ah).json()["photo_url"] == good


def test_an_edit_cannot_REMOVE_the_photo_a_post_is_its_photo(client, make_user):
    """`Post.photo_url` is `nullable=False`, so a blank value is a 422, not a delete.

    A post carries no ingredients and no steps — the photo IS the post. Letting a blank through
    would either violate the column or leave a row that renders as an empty card in every feed.
    Deleting the post is how you have no photo. Both the empty string and whitespace fail, and
    they fail by the same rule.
    """
    _, ah = make_user()
    post = _own(client, ah)

    for blank in ("", "   "):
        r = client.patch(f"/posts/{post['id']}", json={"photo_url": blank}, headers=ah)
        # "" is refused by the schema's min_length, "   " by the router's host check. Different
        # layers, same answer to the person: 422.
        assert r.status_code == 422, blank
    assert client.get(f"/posts/{post['id']}", headers=ah).json()["photo_url"] == post["photo_url"]


def test_an_edit_still_CANNOT_attach_a_recipe(client, make_user):
    """The other omission from #98 stands, and for a reason the photo never had.

    Attaching a recipe to a post people ASKED about is answering them, and `POST /{id}/fulfill`
    is what answers: it mints a grant per pending requester, marks the asks fulfilled and
    notifies them. A quiet `recipe_id` here would attach the recipe and leave every ask pending
    underneath it — the cook's own card still reading "1 person asked for this" about a recipe
    already sitting on the post. `recipe_id` is dropped from the schema rather than rejected, so
    Pydantic ignores it; the assertion that matters is that nothing moved.
    """
    _, ah = make_user()
    post = _own(client, ah)
    rec = client.post(
        "/recipes",
        json={"name": "Adobo", "visibility": "private", "steps": [{"content": "Cook", "position": 1}]},
        headers=ah,
    ).json()

    r = client.patch(
        f"/posts/{post['id']}",
        json={"dish_name": "Renamed", "recipe_id": rec["id"]},
        headers=ah,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["dish_name"] == "Renamed"   # the field that IS editable moved
    assert body["recipe_id"] is None
    assert client.get(f"/posts/{post['id']}", headers=ah).json()["recipe_id"] is None


def test_a_non_author_cannot_replace_someone_elses_photo(client, make_user):
    """Read is not write, and #106 widened what write MEANS — so re-pin it on the new field.

    The ownership filter runs before any field is looked at, so this is 404 (not 403, and not a
    422 about the URL): the same answer an unknown id gets, which is what stops a probe from
    confirming the post exists.
    """
    _, ah = make_user()
    _, bh = make_user()
    post = _own(client, ah)

    r = client.patch(
        f"/posts/{post['id']}",
        json={"photo_url": "https://res.cloudinary.com/demo/image/upload/v1/x.jpg"},
        headers=bh,
    )
    assert r.status_code == 404
    assert client.get(f"/posts/{post['id']}", headers=ah).json()["photo_url"] == post["photo_url"]


def test_hiding_a_post_does_not_TRAP_the_ask_of_someone_who_can_no_longer_see_it(client, make_user):
    """Withdrawing your own ask must not depend on still being able to read the post.

    Ana asks on Ben's public meal; Ben makes it private (one tap now that PATCH exists, and
    already reachable before it via the profile-wide visibility sweep). Ana can no longer see the
    post — correct — but if the retract route also demanded read access, her ask would be
    permanent: 404 on the post AND 404 on withdrawing it, with Ben looking at her name on
    /requests forever and `fulfill` still ready to hand her a grant. A row you created is yours
    to delete; it isn't a read of someone else's content.
    """
    _, ah = make_user()   # Ben, the cook
    _, bh = make_user()   # Ana, who asks
    post = _own(client, ah, visibility="public")
    assert client.post(f"/posts/{post['id']}/request", headers=bh).status_code == 201
    assert len(client.get("/posts/requests/incoming", headers=ah).json()) == 1

    assert client.patch(
        f"/posts/{post['id']}", json={"visibility": "private"}, headers=ah
    ).status_code == 200
    assert client.get(f"/posts/{post['id']}", headers=bh).status_code == 404  # hidden, as it should be

    # 204, not 200: she withdrew an ask on a post she can no longer see, so there is no body
    # to hand back. The tempting 200-with-body is a disclosure — Ben can rename the dish and
    # rewrite the description in the SAME call that hides it, so the body would be content that
    # was never on her screen.
    r = client.delete(f"/posts/{post['id']}/request", headers=bh)
    assert r.status_code == 204
    assert r.content == b""
    assert client.get("/posts/requests/incoming", headers=ah).json() == []


def test_retracting_on_a_post_you_can_STILL_see_returns_the_post(client, make_user):
    """The ordinary case keeps its body — both clients read `requested_by_me` off it."""
    _, ah = make_user()
    _, bh = make_user()
    post = _own(client, ah, visibility="public")
    client.post(f"/posts/{post['id']}/request", headers=bh)
    r = client.delete(f"/posts/{post['id']}/request", headers=bh)
    assert r.status_code == 200
    assert r.json()["requested_by_me"] is False


def test_the_retract_route_is_not_a_PEEPHOLE_into_a_private_post(client, make_user):
    """The other half of the rule above: a pending ask is the credential, not nothing at all.

    Without that, DELETE /posts/{id}/request would let anyone poll any id and read a private
    post's dish name, photo and author straight out of the response body.
    """
    _, ah = make_user()
    _, bh = make_user()
    post = _own(client, ah, visibility="private")
    r = client.delete(f"/posts/{post['id']}/request", headers=bh)
    assert r.status_code == 404
    assert r.json()["detail"] == "Post not found"


def test_editing_does_not_make_a_post_NEW_again(client, make_user):
    """An edit is not a new post. `is_new` keys on the post's id (#97), which an edit doesn't
    move, so a friend who already read the feed must not see it resurface above the divider."""
    a, ah = make_user()
    b, bh = make_user()
    fid = client.post("/friends/request", json={"to_user_id": b.id}, headers=ah).json()["id"]
    client.post(f"/friends/{fid}/accept", headers=bh)
    post = _own(client, ah)

    # b reads the feed, marking it seen through this post.
    assert client.get("/posts/feed", headers=bh).json()[0]["is_new"] is True
    client.post("/posts/feed/seen", json={"through_post_id": post["id"]}, headers=bh)
    assert client.get("/posts/feed", headers=bh).json()[0]["is_new"] is False

    client.patch(f"/posts/{post['id']}", json={"dish_name": "Edited"}, headers=ah)
    feed = client.get("/posts/feed", headers=bh).json()
    assert feed[0]["dish_name"] == "Edited"
    assert feed[0]["is_new"] is False, "an edit must not resurface as unread"


def test_editing_notifies_nobody(client, make_user):
    # Nobody asked to hear that a caption changed.
    a, ah = make_user()
    b, bh = make_user()
    fid = client.post("/friends/request", json={"to_user_id": b.id}, headers=ah).json()["id"]
    client.post(f"/friends/{fid}/accept", headers=bh)
    client.post("/notifications/read", json={}, headers=bh)
    post = _own(client, ah)

    client.patch(f"/posts/{post['id']}", json={"dish_name": "Edited"}, headers=ah)
    assert client.get("/notifications", headers=bh).json()["unread_count"] == 0


def test_an_edit_cannot_blank_the_dish_name(client, make_user):
    _, ah = make_user()
    post = _own(client, ah)
    for bad in ("", "   "):
        assert client.patch(
            f"/posts/{post['id']}", json={"dish_name": bad}, headers=ah
        ).status_code == 422
