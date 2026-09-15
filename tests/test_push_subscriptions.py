"""Subscription storage and notification preferences (#89).

Two independent axes, and keeping them independent is the design:
  - SUBSCRIPTIONS are per DEVICE (`push_subscriptions`). A phone and a laptop are two rows.
  - PREFERENCES are per PERSON (columns on `users`). Turning the daily nudge off shouldn't
    depend on which device you happen to be holding.

That split makes a legitimate state expressible — preferences on, zero subscriptions — which is
exactly someone who hasn't installed the app anywhere yet.
"""

from app.models.push_subscription import PushSubscription

SUB = {
    "endpoint": "https://fcm.googleapis.com/fcm/send/AAA111",
    "p256dh": "BJxKEp8Nq1pR3T9Zq0F5rQmXwYvL2sN4hK6jD8fG0aB",
    "auth": "k9Lm2nP4qR6sT8uV",
}


def _sub(**over):
    body = dict(SUB)
    body.update(over)
    return body


def _rows(db, **filters):
    q = db.query(PushSubscription)
    for k, v in filters.items():
        q = q.filter(getattr(PushSubscription, k) == v)
    return q.all()


# --- the public key ---


def test_the_vapid_key_is_readable_without_a_token(client):
    """Unauthenticated on purpose: it is the application server's public identity, handed to every
    client by design — and requiring a token would mean the service worker couldn't read it."""
    r = client.get("/notifications/vapid-key")
    assert r.status_code == 200
    assert set(r.json()) == {"public_key", "configured"}


def test_an_unconfigured_deploy_says_so_rather_than_404ing(client):
    """So the client can show "notifications aren't available" instead of subscribing against an
    empty string — which would mint a subscription that can never be delivered to and looks
    perfectly fine from the browser's side."""
    body = client.get("/notifications/vapid-key").json()
    assert body["configured"] is False
    assert body["public_key"] == ""


# --- subscribing ---


def test_subscribing_stores_the_device(client, make_user, db_session):
    user, h = make_user()
    assert client.post("/notifications/subscribe", json=_sub(), headers=h).status_code == 204
    rows = _rows(db_session, user_id=user.id)
    assert len(rows) == 1
    assert rows[0].endpoint == SUB["endpoint"]
    assert rows[0].p256dh == SUB["p256dh"]
    assert rows[0].auth == SUB["auth"]


def test_two_devices_are_two_rows(client, make_user, db_session):
    """The whole reason this is a table and not a column. A `user_id` unique constraint would
    silently mean "only the last device you allowed"."""
    user, h = make_user()
    client.post("/notifications/subscribe", json=_sub(), headers=h)
    client.post(
        "/notifications/subscribe",
        json=_sub(endpoint="https://web.push.apple.com/BBB222"),
        headers=h,
    )
    assert len(_rows(db_session, user_id=user.id)) == 2


def test_resubscribing_the_same_device_UPDATES_rather_than_duplicating(client, make_user, db_session):
    """Idempotent on the endpoint, which the browser mints. Otherwise a user who reinstalls a few
    times receives the same notification several times."""
    user, h = make_user()
    client.post("/notifications/subscribe", json=_sub(), headers=h)
    client.post("/notifications/subscribe", json=_sub(auth="rotatedAuthValue00"), headers=h)
    rows = _rows(db_session, user_id=user.id)
    assert len(rows) == 1
    assert rows[0].auth == "rotatedAuthValue00"


def test_a_shared_device_MOVES_to_whoever_granted_last(client, make_user, db_session):
    """A family phone is a real case — it is close to this app's audience. The browser hands the
    same endpoint to whoever is signed in, so the last person to grant permission is the one who
    should receive it. Refusing would silently deliver one person's notifications to another,
    which is the worse failure by a distance."""
    first, h1 = make_user()
    second, h2 = make_user()
    client.post("/notifications/subscribe", json=_sub(), headers=h1)
    client.post("/notifications/subscribe", json=_sub(), headers=h2)
    assert _rows(db_session, user_id=first.id) == []
    assert len(_rows(db_session, user_id=second.id)) == 1


def test_subscribing_requires_auth(client):
    assert client.post("/notifications/subscribe", json=_sub()).status_code == 401


def test_an_over_long_endpoint_is_refused(client, make_user):
    """Bounded at 500 because it sits under a UNIQUE index: an unbounded string there raises
    "index row size exceeds maximum" on Postgres for a long Apple endpoint — a prod-only 500
    SQLite will never reproduce."""
    _, h = make_user()
    long_endpoint = "https://push.example/" + "x" * 500
    assert client.post(
        "/notifications/subscribe", json=_sub(endpoint=long_endpoint), headers=h
    ).status_code == 422


# --- unsubscribing ---


def test_unsubscribing_removes_only_this_device(client, make_user, db_session):
    user, h = make_user()
    other = "https://web.push.apple.com/BBB222"
    client.post("/notifications/subscribe", json=_sub(), headers=h)
    client.post("/notifications/subscribe", json=_sub(endpoint=other), headers=h)

    assert client.request(
        "DELETE", "/notifications/subscribe", json=_sub(), headers=h
    ).status_code == 204
    remaining = _rows(db_session, user_id=user.id)
    assert len(remaining) == 1
    assert remaining[0].endpoint == other


def test_you_cannot_unsubscribe_someone_elses_device(client, make_user, db_session):
    """Scoped to user_id as well as endpoint — and 204 either way, so this can't be used to
    discover whether an endpoint belongs to another account."""
    victim, vh = make_user()
    _, ah = make_user()
    client.post("/notifications/subscribe", json=_sub(), headers=vh)
    r = client.request("DELETE", "/notifications/subscribe", json=_sub(), headers=ah)
    assert r.status_code == 204
    assert len(_rows(db_session, user_id=victim.id)) == 1


# --- rotation: the route with no bearer token ---


def test_rotation_works_WITHOUT_a_token(client, make_user, db_session):
    """`pushsubscriptionchange` fires inside the service worker: no page, no localStorage, no JWT —
    the axios interceptor isn't even loaded, because there is no axios. A route that required auth
    would mean a rotated endpoint silently stops receiving anything, forever, with no signal to
    either side."""
    user, h = make_user()
    client.post("/notifications/subscribe", json=_sub(), headers=h)
    new_endpoint = "https://fcm.googleapis.com/fcm/send/ROTATED999"

    r = client.post(
        "/notifications/subscribe/rotate",
        json={"old_endpoint": SUB["endpoint"], "subscription": _sub(endpoint=new_endpoint)},
    )
    assert r.status_code == 204
    rows = _rows(db_session, user_id=user.id)
    assert len(rows) == 1, "the old row is replaced, not added to"
    assert rows[0].endpoint == new_endpoint


def test_rotation_keeps_the_ORIGINAL_owner(client, make_user, db_session):
    """The user_id comes from the row being replaced, never from the request — so this cannot be
    used to attach a device to an arbitrary account."""
    owner, h = make_user()
    client.post("/notifications/subscribe", json=_sub(), headers=h)
    client.post(
        "/notifications/subscribe/rotate",
        json={
            "old_endpoint": SUB["endpoint"],
            "subscription": _sub(endpoint="https://push.example/NEW"),
        },
    )
    assert _rows(db_session, user_id=owner.id)[0].endpoint == "https://push.example/NEW"


def test_rotating_an_unknown_endpoint_is_a_404(client):
    """The same answer as for an endpoint belonging to someone else — nothing here confirms
    whether a given endpoint exists."""
    r = client.post(
        "/notifications/subscribe/rotate",
        json={"old_endpoint": "https://push.example/never-existed", "subscription": _sub()},
    )
    assert r.status_code == 404


def test_rotating_to_the_SAME_endpoint_updates_the_keys_in_place(client, make_user, db_session):
    """A rotation that didn't rotate. The browser may have changed only the keys, and a
    delete-then-insert of the same row would trip its own UNIQUE constraint."""
    user, h = make_user()
    client.post("/notifications/subscribe", json=_sub(), headers=h)
    r = client.post(
        "/notifications/subscribe/rotate",
        json={"old_endpoint": SUB["endpoint"], "subscription": _sub(auth="brandNewAuth000")},
    )
    assert r.status_code == 204
    rows = _rows(db_session, user_id=user.id)
    assert len(rows) == 1
    assert rows[0].auth == "brandNewAuth000"


def test_rotating_ONTO_an_existing_endpoint_replaces_it(client, make_user, db_session):
    """A race, or a browser that pre-registered the new endpoint. Colliding with the UNIQUE
    constraint here would be a 500 on a route with no user to show it to."""
    user, h = make_user()
    second = "https://push.example/SECOND"
    client.post("/notifications/subscribe", json=_sub(), headers=h)
    client.post("/notifications/subscribe", json=_sub(endpoint=second), headers=h)

    r = client.post(
        "/notifications/subscribe/rotate",
        json={"old_endpoint": SUB["endpoint"], "subscription": _sub(endpoint=second)},
    )
    assert r.status_code == 204
    rows = _rows(db_session, user_id=user.id)
    assert len(rows) == 1
    assert rows[0].endpoint == second


def test_deleting_an_account_takes_its_subscriptions(client, make_user, db_session):
    """CASCADE. A device registered to a deleted account would otherwise keep a row nothing owns,
    and the next person to sign in on that device would collide with it."""
    user, h = make_user()
    client.post("/notifications/subscribe", json=_sub(), headers=h)
    assert len(_rows(db_session)) == 1
    db_session.delete(user)
    db_session.commit()
    assert _rows(db_session) == []


# --- preferences: on the PERSON, and server-owned ---


def test_the_defaults_are_on_with_quiet_hours(client, make_user):
    """Default ON because the notification IS the retention mechanism and a default-off switch
    means it never happens. Bounded by quiet hours, which is what makes that defensible."""
    _, h = make_user()
    me = client.get("/auth/me", headers=h).json()
    assert me["notify_posts"] == "daily"
    assert me["notify_people"] is True
    assert me["notify_hour"] == 18
    assert me["quiet_from"] == 22
    assert me["quiet_to"] == 8
    assert me["timezone"] is None, "no backfill can invent one"


def test_preferences_are_editable_without_a_password(client, make_user):
    """They change nothing anyone else can see and nothing that can't be undone — the same
    reasoning that lets a name or a photo be edited without one."""
    _, h = make_user()
    r = client.patch(
        "/auth/me",
        json={"notify_posts": "off", "notify_hour": 9, "timezone": "Asia/Manila"},
        headers=h,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["notify_posts"] == "off"
    assert body["notify_hour"] == 9
    assert body["timezone"] == "Asia/Manila"
    # Untouched fields stay put — `None` means unchanged, as everywhere else.
    assert body["notify_people"] is True
    assert body["quiet_from"] == 22


def test_an_out_of_range_hour_is_refused(client, make_user):
    """Not a validation nicety: the scheduler compares `notify_hour` against a real clock hour, so
    an out-of-range value is a user who is never due again — a silent opt-out they didn't ask for."""
    _, h = make_user()
    for bad in (-1, 24, 99):
        assert client.patch("/auth/me", json={"notify_hour": bad}, headers=h).status_code == 422
    for bad in (-1, 24):
        assert client.patch("/auth/me", json={"quiet_from": bad}, headers=h).status_code == 422
        assert client.patch("/auth/me", json={"quiet_to": bad}, headers=h).status_code == 422


def test_equal_quiet_bounds_are_accepted_not_refused(client, make_user):
    """`quiet_from == quiet_to` means "no quiet hours", not a 24-hour blackout — see
    `services/push.in_quiet_hours`. Refusing it would be the app second-guessing a coherent
    choice."""
    _, h = make_user()
    r = client.patch("/auth/me", json={"quiet_from": 9, "quiet_to": 9}, headers=h)
    assert r.status_code == 200


def test_LOGIN_returns_the_preferences_too(client, make_user):
    """The login payload is a HAND-BUILT dict, separate from `UserResponse`, and the identical
    omission has shipped twice. It fails only in the window between login and the first
    `reconcile()` — so a settings switch would render as `undefined` (reading as off) for exactly
    one page load, passing every backend test and every component test with a seeded cache."""
    user, h = make_user()
    client.patch("/auth/me", json={"notify_posts": "off", "timezone": "Europe/London"}, headers=h)

    r = client.post(
        "/auth/login", data={"username": user.email, "password": "password123"}
    )
    assert r.status_code == 200
    cached = r.json()["user"]
    for field in (
        "timezone",
        "notify_hour",
        "notify_posts",
        "notify_people",
        "quiet_from",
        "quiet_to",
    ):
        assert field in cached, f"login dropped {field}"
    assert cached["notify_posts"] == "off"
    assert cached["timezone"] == "Europe/London"


def test_a_preference_is_NOT_stored_client_side(client, make_user):
    """The distinction that matters. Every other settings toggle in this app lives in the client's
    `issei_prefs` localStorage bag; these cannot, because a push is delivered with the browser
    closed by a server that can't read localStorage. A preference stored there would look correct
    in every test and in local use while a user who switched notifications OFF kept receiving
    them. Asserted here by proving the value survives on the SERVER, independent of any client."""
    user, h = make_user()
    client.patch("/auth/me", json={"notify_people": False}, headers=h)
    # A brand-new client with no storage at all still sees the stored preference.
    fresh = client.get("/auth/me", headers=h).json()
    assert fresh["notify_people"] is False


# --- the cron endpoint: authenticated by a shared secret, not a user ---


def test_the_cron_route_is_DISABLED_when_no_secret_is_set(client):
    """The part worth being deliberate about. The tempting shape is
    `if settings.cron_secret and given != settings.cron_secret: raise` — which reads fine until you
    notice it leaves the route WIDE OPEN on any deploy where the secret is missing. Unconfigured
    means off, never unguarded. Same rule as push.is_configured()."""
    assert client.post("/notifications/run-daily-prompt").status_code == 404
    assert client.post(
        "/notifications/run-daily-prompt", headers={"X-Issei-Cron-Key": "anything"}
    ).status_code == 404


def test_a_wrong_key_is_a_404_not_a_401(client, monkeypatch):
    """404 for a wrong key AND for an unset one, so probing tells you nothing about whether this
    route exists on this deploy."""
    from app.config import settings

    monkeypatch.setattr(settings, "cron_secret", "the-real-secret", raising=False)
    r = client.post(
        "/notifications/run-daily-prompt", headers={"X-Issei-Cron-Key": "wrong"}
    )
    assert r.status_code == 404
    assert r.json()["detail"] == "Not found"


def test_the_right_key_runs_it_and_returns_a_summary(client, monkeypatch):
    """A summary rather than 204, because the caller is a log: a cron run that says
    "candidates 40, sent 12, skipped 28" is diagnosable, and one that says nothing is not."""
    from app.config import settings
    from app.services import prompt

    monkeypatch.setattr(settings, "cron_secret", "the-real-secret", raising=False)
    monkeypatch.setattr(
        prompt, "run_daily_prompt", lambda db: {"candidates": 2, "sent": 1, "skipped": 1, "failed": 0}
    )
    r = client.post(
        "/notifications/run-daily-prompt", headers={"X-Issei-Cron-Key": "the-real-secret"}
    )
    assert r.status_code == 200
    assert r.json()["sent"] == 1


def test_a_signed_in_USER_cannot_trigger_it(client, make_user, monkeypatch):
    """Not a user route. A bearer token is not the credential here and must not be mistaken for
    one — this acts on behalf of everybody, so it needs the operator's secret, not a person's."""
    from app.config import settings

    monkeypatch.setattr(settings, "cron_secret", "the-real-secret", raising=False)
    _, h = make_user()
    assert client.post("/notifications/run-daily-prompt", headers=h).status_code == 404


# --- the two review findings on this surface ---


def test_an_endpoint_must_be_an_https_PUBLIC_url(client, make_user):
    """`endpoint` is not like the two keys beside it: it is a URL the server DIALS from inside the
    VPC, on an hourly schedule. Review confirmed the unvalidated version accepted the cloud metadata
    address, loopback and file:// — an authenticated SSRF primitive.

    The repo already set the opposite precedent: PATCH /auth/me validates an avatar down to a
    Cloudinary HTTPS host.
    """
    _, h = make_user()
    hostile = [
        "http://169.254.169.254/latest/meta-data/",  # cloud metadata
        "http://127.0.0.1:8000/health",
        "https://127.0.0.1/x",
        "file:///etc/passwd",
        "not-a-url",
        "https://localhost/x",  # single-label host
        "https://10.0.0.5/x",
        "https://192.168.1.1/x",
        "https://172.17.0.1/x",
    ]
    for url in hostile:
        assert (
            client.post(
                "/notifications/subscribe", json=_sub(endpoint=url), headers=h
            ).status_code
            == 422
        ), url

    # And every real push service still works — a check that rejected a browser's own host would
    # break the feature rather than protect it.
    for url in [
        "https://fcm.googleapis.com/fcm/send/abc123",
        "https://web.push.apple.com/QQAA-Bcdef",
        "https://updates.push.services.mozilla.com/wpush/v2/xyz",
        "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ]:
        assert (
            client.post(
                "/notifications/subscribe", json=_sub(endpoint=url), headers=h
            ).status_code
            == 204
        ), url


def test_a_non_ascii_cron_key_is_a_404_not_a_500(monkeypatch):
    """`compare_digest` on two `str` raises TypeError the moment either holds a non-ASCII character,
    and Starlette latin-1-decodes header bytes — so one 0x80-0xFF byte in this header was an
    unauthenticated 500 on demand. Worse: a 500 where a wrong key gives 404 is exactly the oracle
    this route's docstring claims does not exist. It revealed that the deploy HAS a cron secret.

    CALLED DIRECTLY rather than through the TestClient, and that is not laziness — httpx refuses to
    encode a non-ASCII header value on the CLIENT side, so no test routed through TestClient can
    reproduce this at all, while curl or any raw socket sends the byte happily. Reaching for the
    handler is the only way to pin behaviour a real caller can actually reach.
    """
    from fastapi import HTTPException

    from app.config import settings
    from app.routers.notifications import run_daily_prompt_endpoint

    monkeypatch.setattr(settings, "cron_secret", "the-real-secret", raising=False)

    # A latin-1-decoded high byte is exactly what Starlette hands the handler.
    non_ascii = bytes([0x73, 0xE9, 0x63]).decode("latin-1")
    for key in (non_ascii, "wrong-but-ascii", ""):
        try:
            run_daily_prompt_endpoint(x_issei_cron_key=key, db=None)
        except HTTPException as exc:
            assert exc.status_code == 404, repr(key)
            assert exc.detail == "Not found", repr(key)
        else:
            raise AssertionError("accepted: %r" % key)

    # Unset secret: the same input gets the same answer, so there is no oracle in either direction.
    monkeypatch.setattr(settings, "cron_secret", "", raising=False)
    try:
        run_daily_prompt_endpoint(x_issei_cron_key=non_ascii, db=None)
    except HTTPException as exc:
        assert exc.status_code == 404
    else:
        raise AssertionError("accepted with no secret configured")


# --- the cadence, and the alias that carries an older client through the deploy window ---


def test_the_three_cadences_are_settable_and_nothing_else_is(client, make_user):
    """A Literal, so a typo is a 422 rather than a stored value matching no branch — which would
    read as "notifications mysteriously stopped" rather than as an error."""
    _, h = make_user()
    for value in ("instant", "daily", "off"):
        r = client.patch("/auth/me", json={"notify_posts": value}, headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["notify_posts"] == value
    assert client.patch("/auth/me", json={"notify_posts": "hourly"}, headers=h).status_code == 422
    assert client.patch("/auth/me", json={"notify_posts": True}, headers=h).status_code == 422


def test_an_older_client_sending_notify_prompt_is_still_honoured(client, make_user):
    """THE DEPLOY WINDOW, and why the deprecated alias exists at all.

    Vercel and ECS deploy independently, so a frontend build that predates this rename can be
    live against a backend that has already renamed the column. Pydantic ignores unknown fields,
    so simply dropping `notify_prompt` would answer 200 and change nothing — telling someone their
    "stop nudging me" worked when it didn't. For a note on a handoff that trade was acceptable
    (#102); for an interruption preference it is not.
    """
    _, h = make_user()
    r = client.patch("/auth/me", json={"notify_prompt": False}, headers=h)
    assert r.status_code == 200
    assert r.json()["notify_posts"] == "off"

    r = client.patch("/auth/me", json={"notify_prompt": True}, headers=h)
    assert r.json()["notify_posts"] == "daily"


def test_the_new_field_wins_when_a_client_sends_both(client, make_user):
    """A client mid-migration could send both. The alias is only consulted when `notify_posts` is
    absent, so "instant" can't be silently downgraded to "daily" by a stale boolean travelling
    alongside it."""
    _, h = make_user()
    r = client.patch(
        "/auth/me", json={"notify_posts": "instant", "notify_prompt": True}, headers=h
    )
    assert r.json()["notify_posts"] == "instant"
