"""The feed read-mark (#97) — "new since you last looked".

The gap this closes: GET /posts/feed was a static reverse-chron list with no read state, so
it could not tell "new" from "the thing you scrolled past yesterday". That blocked three
things at once — the divider, a "you're all caught up" moment, and the CONTENT of a push
prompt ("3 friends posted since you last looked", #89), which is the whole reason a prompt
beats a bare "open the app".

THE INVARIANT UNDER TEST, because it is the one that could rot: **seen is not gone.** This is
a boundary, not a filter. The feed returns exactly the same posts either way; only the
`is_new` flag changes. Nothing expires, nothing is hidden — a post is the top of the funnel
to a handoff, so a vanishing post would take the ask with it.
"""

def _post(client, headers, dish="Adobo", visibility="friends"):
    r = client.post(
        "/posts",
        json={"photo_url": "https://res.cloudinary.com/demo/image/upload/a.jpg", "dish_name": dish, "visibility": visibility},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _befriend(client, a, ah, b, bh):
    fid = client.post("/friends/request", json={"to_user_id": b.id}, headers=ah).json()["id"]
    assert client.post(f"/friends/{fid}/accept", headers=bh).status_code == 200


def _seen(client, headers, through=None):
    body = {"through_post_id": through} if through is not None else {}
    r = client.post("/posts/feed/seen", json=body, headers=headers)
    assert r.status_code == 204, r.text


def test_everything_is_new_to_someone_who_has_never_looked(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    _befriend(client, a, ah, b, bh)
    _post(client, bh, dish="Theirs")

    feed = client.get("/posts/feed", headers=ah).json()
    assert [p["is_new"] for p in feed] == [True]


def test_marking_seen_HIDES_NOTHING_it_only_clears_the_flag(client, make_user):
    """The load-bearing test. If a future change turns `is_new` into a filter, the feed will
    start losing posts and this is what catches it."""
    a, ah = make_user()
    b, bh = make_user()
    _befriend(client, a, ah, b, bh)
    p1 = _post(client, bh, dish="First")
    p2 = _post(client, bh, dish="Second")

    before = client.get("/posts/feed", headers=ah).json()
    assert [p["dish_name"] for p in before] == ["Second", "First"]

    _seen(client, ah, through=p2["id"])

    after = client.get("/posts/feed", headers=ah).json()
    # SAME posts, same order — only the flag moved.
    assert [p["dish_name"] for p in after] == ["Second", "First"]
    assert [p["is_new"] for p in after] == [False, False]
    assert {p["id"] for p in after} == {p1["id"], p2["id"]}


def test_a_post_that_arrives_AFTER_the_mark_is_new_again(client, make_user):
    a, ah = make_user()
    b, bh = make_user()
    _befriend(client, a, ah, b, bh)
    old = _post(client, bh, dish="Old")
    _seen(client, ah, through=old["id"])

    fresh = _post(client, bh, dish="Fresh")
    feed = {p["dish_name"]: p["is_new"] for p in client.get("/posts/feed", headers=ah).json()}
    assert feed == {"Fresh": True, "Old": False}


def test_marking_through_a_post_does_not_swallow_newer_ones(client, make_user, db_session):
    """Why the mark is the ID of a post the client actually received, not a wall-clock time:
    with now(), anything published while the feed was on screen would be silently marked seen.

    This also pins the ID-vs-timestamp choice. Both posts here are created in the same second,
    so a `created_at > mark` implementation reports the newer one as already-read — which is
    exactly how the first version of this failed."""
    a, ah = make_user()
    b, bh = make_user()
    _befriend(client, a, ah, b, bh)
    seen_post = _post(client, bh, dish="Read")
    later = _post(client, bh, dish="Published while looking")
    # FORCE the shared second rather than hoping two HTTP calls land inside one — otherwise this
    # flakes at a second boundary, in a suite that gates the prod deploy. Setting them equal is
    # also strictly stronger than observing them equal.
    from app.models.post import Post

    first_row = db_session.query(Post).filter(Post.id == seen_post["id"]).first()
    later_row = db_session.query(Post).filter(Post.id == later["id"]).first()
    later_row.created_at = first_row.created_at
    db_session.commit()
    assert later_row.created_at == first_row.created_at

    _seen(client, ah, through=seen_post["id"])

    feed = {p["dish_name"]: p["is_new"] for p in client.get("/posts/feed", headers=ah).json()}
    assert feed["Read"] is False
    assert feed["Published while looking"] is True


def test_the_mark_only_moves_FORWARD(client, make_user):
    # Two tabs, a retry, or an out-of-order client must not resurface read posts as new.
    a, ah = make_user()
    b, bh = make_user()
    _befriend(client, a, ah, b, bh)
    first = _post(client, bh, dish="First")
    second = _post(client, bh, dish="Second")

    _seen(client, ah, through=second["id"])   # read everything
    _seen(client, ah, through=first["id"])    # a stale call arrives late

    feed = client.get("/posts/feed", headers=ah).json()
    assert [p["is_new"] for p in feed] == [False, False]


def test_your_own_post_is_never_new_to_you(client, make_user):
    a, ah = make_user()
    mine = _post(client, ah, dish="Mine")
    feed = client.get("/posts/feed", headers=ah).json()
    assert [p["id"] for p in feed] == [mine["id"]]
    assert feed[0]["is_new"] is False


def test_is_new_is_None_off_the_feed_where_new_has_no_meaning(client, make_user):
    # None rather than False, so a client can tell "not new" from "this surface has no concept
    # of new". Browse, a permalink and a profile grid are all lists you didn't come to catch up on.
    a, ah = make_user()
    b, bh = make_user()
    p = _post(client, bh, dish="Public", visibility="public")

    assert client.get("/posts/browse", headers=ah).json()[0]["is_new"] is None
    assert client.get(f"/posts/{p['id']}", headers=ah).json()["is_new"] is None
    assert client.get(f"/posts/users/{b.id}", headers=bh).json()[0]["is_new"] is None


def test_seen_requires_auth_and_ignores_an_unknown_post_id(client, make_user):
    assert client.post("/posts/feed/seen", json={}).status_code == 401
    _, ah = make_user()
    # No 404: whether a post id exists is not something this bookkeeping call should confirm.
    assert client.post(
        "/posts/feed/seen", json={"through_post_id": 999999}, headers=ah
    ).status_code == 204


def test_seen_with_no_body_does_NOTHING(client, make_user, db_session):
    """Deliberately a no-op rather than "mark everything that exists".

    The tempting version watermarks at MAX(Post.id) — but that spans strangers' and blocked
    users' posts, so it would suppress `is_new` for an entire backlog the caller has never been
    shown. The client always sends an id; there is no legitimate no-id case worth that risk."""
    from app.models.user import User

    a, ah = make_user()
    b, bh = make_user()
    _post(client, bh, dish="Never shown to a")

    assert client.post("/posts/feed/seen", headers=ah).status_code == 204
    row = db_session.query(User).filter(User.id == a.id).first()
    assert row.last_feed_seen_post_id is None


def test_an_oversized_id_is_CLAMPED_not_stored(client, make_user, db_session):
    """Two problems in one, both reachable by any authenticated caller, and neither catchable on
    SQLite: the column is int4 on Postgres, so a value above 2^31 is a NumericValueOutOfRange
    500 in prod only. And since the mark is forward-only BY DESIGN, one such call would leave
    that account permanently unable to see anything as new — no product path could rewind it.

    Clamping keeps the deliberate no-404 (an out-of-range id still isn't confirmed either way)
    while making the stored value harmless."""
    from app.models.user import User

    a, ah = make_user()
    b, bh = make_user()
    newest = _post(client, bh, dish="Newest")

    assert client.post(
        "/posts/feed/seen", json={"through_post_id": 3_000_000_000}, headers=ah
    ).status_code == 204
    row = db_session.query(User).filter(User.id == a.id).first()
    assert row.last_feed_seen_post_id == newest["id"]  # clamped, not 3e9


def test_a_zero_or_negative_id_is_rejected_at_the_boundary(client, make_user):
    _, ah = make_user()
    for bad in (0, -1):
        r = client.post("/posts/feed/seen", json={"through_post_id": bad}, headers=ah)
        assert r.status_code == 422, bad


def test_the_everyone_tab_has_no_is_new_at_all(client, make_user):
    """`is_new` is measured against the FRIENDS watermark, and the client never advances the mark
    from the Everyone tab (it isn't a feed you catch up on). Computing it there would freeze a
    "You're all caught up" divider in one spot forever, in a tab nobody ever caught up on."""
    a, ah = make_user()
    b, bh = make_user()
    _post(client, bh, dish="Stranger public", visibility="public")

    everyone = client.get("/posts/feed?scope=everyone", headers=ah).json()
    assert [p["dish_name"] for p in everyone] == ["Stranger public"]
    assert everyone[0]["is_new"] is None
