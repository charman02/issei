"""The inbox reaches a phone — `notify()` wired to `push.send()`.

#89 built the transport and connected ONE sender, the daily nudge. Every person-to-person
notification wrote a row and waited to be noticed, and `User.notify_people` was an API-visible
switch, settable from the Profile page, that nothing in the codebase read. So the app could tell
you "3 friends posted" but not "Ana asked you for your Adobo" — the retention message worked and
the product message didn't.

What is actually risky here, and therefore what these tests are about:

1. **A push cannot be recalled.** So the ordering matters: the row must be committed BEFORE
   anything is sent, or a rolled-back ask buzzes someone's phone about an event that never
   happened. `queue()` reads `.id`, which is None before a commit, and that is load-bearing.
2. **A lock screen is read by whoever is holding the phone.** `recipe_kept` is anonymous by
   decision (#96); leaking the keeper's name into a push is worse than leaking it into the API,
   because it cannot be corrected and it is read by people the account holder never chose.
3. **Every skip must be the one we meant.** Four different conditions suppress a send, and three
   of them look identical from outside (nothing happens). A test per condition is the only way to
   know which one fired.
4. **A missing copy entry ships a silent notification.** The vocabulary lives in
   `services/notifications.py` and the words live in `services/notify_push.py`; the set comparison
   below is what stops them drifting.
"""

import re

import pytest

from app.services import notify_push
from app.services.notifications import ANONYMOUS_TYPES, NOTIFICATION_TYPES
from app.models.notification import Notification
from app.models.push_subscription import PushSubscription


# --- the copy table, with no database in sight -------------------------------------------------


def test_every_notification_type_has_push_copy():
    """The drift guard. A new type added to the producer without a line here would write inbox
    rows that are invisible on a phone — the failure mode #89 spent a whole task removing."""
    assert notify_push.MISSING_COPY == set()
    # And nothing extra: copy for a type the producer would reject is dead code that reads like
    # a feature.
    assert set(notify_push.BODIES) == NOTIFICATION_TYPES


@pytest.mark.parametrize("type", sorted(NOTIFICATION_TYPES))
def test_a_line_reads_when_the_subject_is_gone(type):
    """`what` is None whenever the recipe or post has been deleted since — the FKs SET NULL so a
    notification outlives its subject. Every line has to survive that without printing "None",
    the way the inbox already does."""
    line = notify_push.BODIES[type]("Ana", None)
    assert line and line.endswith(".")
    assert "None" not in line


# The WIDE form, deliberately. POSITIONING records that the phrase came back as "in YOUR own
# words" after a narrow `their`-only guard had been added, and that the narrow version "let it
# through every guard at once" — this file's first version repeated exactly that mistake, and the
# docs gate caught it. Matches the regex the frontend suites use.
BANNED = re.compile(
    r"record|recording|\bvoice\b|audio|in (their|your|his|her)( own)? words|listen",
    re.IGNORECASE,
)


@pytest.mark.parametrize("type", sorted(NOTIFICATION_TYPES))
def test_no_push_line_claims_a_recording(type):
    """POSITIONING's first invariant, on the newest user-facing surface in the app. A per-step
    note is text somebody typed; nothing here may imply audio."""
    for what in (None, "Adobo"):
        assert not BANNED.search(notify_push.BODIES[type]("Ana", what))


def test_the_friend_post_line_does_not_claim_a_recording_either():
    """The one push body with NO `BODIES` entry, so the parametrised sweep above cannot reach it —
    which the docs gate pointed out after I claimed this file swept "every line of push copy". It
    is also the newest user-facing string in the app, which is exactly where POSITIONING says the
    claim arrives by accident."""
    for dish in (None, "Adobo"):
        for has_recipe in (True, False):
            payload = notify_push.friend_post_payload(
                who="Ana", dish=dish, has_recipe=has_recipe, post_id=1
            )
            assert not BANNED.search(payload["body"])
            assert "None" not in payload["body"]


def test_the_friend_post_line_is_presence_not_approval():
    """POSITIONING's no-like-button invariant, applied to copy. "Ana just shared a meal" states
    that something happened; anything scored, liked, wanted or ranked would turn the feed's
    presence into a metric, which is the reading the whole design refuses."""
    body = notify_push.friend_post_payload(
        who="Ana", dish="Adobo", has_recipe=True, post_id=1
    )["body"]
    for banned in ("like", "liked", "love", "popular", "trending", "rating", "score"):
        assert banned not in body.lower()


def test_the_keeper_is_anonymous_even_if_a_name_is_handed_in():
    """The name is suppressed TWICE, independently: `deliver` passes "Someone" for every
    ANONYMOUS_TYPE, and the copy hardcodes it. This test attacks the second layer directly by
    passing a real name in, because the first layer is exactly the kind of thing a refactor
    quietly drops — and on a lock screen there is no taking it back."""
    for what in (None, "Adobo"):
        line = notify_push.BODIES["recipe_kept"]("Grandma Remedios", what)
        assert "Grandma" not in line and "Remedios" not in line
        assert line.startswith("Someone")


def test_an_arrival_does_not_read_like_a_fulfilment():
    """Two types deliver a recipe and the words are the only thing that separates them: one
    answers a question you asked, the other doesn't. #102 made that distinction load-bearing in
    the sender's own message, and it would be undone by wording both "sent you"."""
    arrived = notify_push.BODIES["recipe_arrived"]("Lola", "Adobo")
    fulfilled = notify_push.BODIES["request_fulfilled"]("Lola", "Adobo")
    assert arrived != fulfilled
    assert "wanted you to have" in arrived


def test_a_claim_does_not_borrow_the_word_kept():
    """`recipe_kept` is anonymous and `recipe_claimed` names the person. Using "kept" for both
    would present two different acts as one act with inconsistent privacy — which reads as a
    leak whichever way round you meet it first."""
    assert "kept" not in notify_push.BODIES["recipe_claimed"]("Ben", "Adobo").lower()


def test_a_payload_carries_a_UNIQUE_tag_so_two_people_cannot_collapse_into_one():
    """THE BUG THIS TEST WAS WRITTEN BACKWARDS FOR, first time round.

    A `tag` makes a notification REPLACE any earlier one with the same tag. The daily nudge wants
    that. These must not collapse: "Ben asked for your Adobo" overwriting "Ana asked for your
    Adobo" loses Ana entirely, with nothing on the phone to show she asked.

    So the first version simply OMITTED `tag` — and asserted its absence, which passed while
    achieving the opposite, because `frontend/public/sw.js` defaulted it to the constant `'issei'`
    (`tag: payload.tag || 'issei'`). Every untagged notification therefore collapsed onto every
    other one. The assertion was true and the goal was not met, which is the most expensive kind of
    passing test — found by reading the service worker, not by running anything.

    The fix has to be an explicit unique tag rather than a change to `sw.js` alone, because a
    worker already installed on someone's phone keeps the old default until it updates.
    """
    row = Notification(id=41, user_id=1, type="recipe_request", actor_id=2, post_id=3)
    other = Notification(id=42, user_id=1, type="recipe_request", actor_id=9, post_id=3)
    payload = notify_push.payload_for(row, who="Ana", what="Adobo")
    assert payload["title"] == "issei"
    assert payload["body"] == "Ana asked you for your Adobo."
    assert payload["tag"] == "notification-41"
    # Two different asks on the same post are two notifications, not one.
    assert notify_push.payload_for(other, who="Ben", what="Adobo")["tag"] != payload["tag"]
    # And never the daily nudge's tag, which would let an ask overwrite the nudge or vice versa.
    from app.services.prompt import prompt_payload

    assert payload["tag"] != prompt_payload(3)["tag"]


def test_an_unknown_type_sends_nothing_rather_than_something_generic():
    """None, not "You have a notification". A push that offers nothing is the species people mute
    an app over. (Note `prompt_payload` no longer refuses at zero — since #108 the daily nudge ASKS
    for something rather than reporting something, so it has nothing to be silent about.
    POSITIONING rule 2 draws that line: asking for an action is allowed, asking for attention is
    not.)"""
    row = Notification(user_id=1, type="not_a_real_type")
    assert notify_push.payload_for(row, who="Ana", what=None) is None


@pytest.mark.parametrize(
    "type,fields,expected",
    [
        ("recipe_request", {"post_id": 7}, "/requests"),
        ("recipe_request", {}, "/notifications"),
        ("request_fulfilled", {"recipe_id": 5}, "/recipes/5"),
        ("recipe_arrived", {"recipe_id": 5}, "/recipes/5"),
        ("recipe_claimed", {"recipe_id": 5}, "/recipes/5"),
        ("recipe_kept", {"recipe_id": 5}, "/recipes/5"),
        ("recipe_kept", {}, "/notifications"),
        ("friend_request", {}, "/friends"),
        ("friend_accept", {"actor_id": 9}, "/u/9"),
        ("friend_accept", {}, "/friends"),
        # #78. A ship gate found all three missing from `_url`, so every pass-on push landed on the
        # inbox while the client's `targetFor()` routed them properly: the cook's lock screen said
        # "Ana would like to pass on your Adobo", she tapped, and had to find the row and tap again
        # to reach the screen the push exists to get her to.
        ("pass_on_request", {"recipe_id": 5}, "/requests"),
        ("pass_on_request", {}, "/notifications"),
        ("pass_on_approved", {"recipe_id": 5}, "/recipes/5"),
        ("pass_on_approved", {}, "/notifications"),
        ("recipe_passed_on", {"recipe_id": 5}, "/recipes/5"),
        ("recipe_passed_on", {}, "/notifications"),
    ],
)
def test_where_a_tap_lands(type, fields, expected):
    """Mirrors `targetFor()` in the client. A dropped reference falls back to the inbox rather
    than to a URL with `None` in it — the event still happened, the thing it was about is gone.

    THIS LIST IS HAND-PICKED, which is exactly how #78's three types were added without it
    noticing — `test_every_notification_type_has_push_copy` sweeps `BODIES` but nothing sweeps
    `_url`. If you add a type, add its rows here too."""
    assert notify_push._url(Notification(user_id=1, type=type, **fields)) == expected


@pytest.mark.parametrize(
    "type",
    [
        "request_fulfilled",
        "recipe_kept",
        "recipe_arrived",
        "recipe_claimed",
        # #78 — both recipe-linked pass-on types follow the same soft-delete rule.
        "pass_on_approved",
        "recipe_passed_on",
    ],
)
def test_a_recipe_that_no_longer_resolves_links_to_the_inbox(type):
    """`recipe_ok=False` is how the caller says "the id is still there but the recipe isn't".

    A truthy `recipe_id` is NOT proof the recipe is readable: the FK only `SET NULL`s on a real
    delete, and issei soft-deletes. So every recipe-linked type has to honour this, not just the
    one that happened to be tested."""
    row = Notification(user_id=1, type=type, recipe_id=5, actor_id=2)
    assert notify_push._url(row, recipe_ok=True) == "/recipes/5"
    assert notify_push._url(row, recipe_ok=False) == "/notifications"


# --- deliver(): every reason a send is skipped -------------------------------------------------


@pytest.fixture
def sent(monkeypatch):
    """Capture what would go out, and pretend a keypair is configured.

    `push.send` is replaced rather than mocked at the HTTP layer because its own round-trip
    correctness (the RFC 8291 encryption) is already proven by decrypting in tests/test_push.py.
    What matters here is WHICH payload reaches WHICH endpoint, and whether it is sent at all.
    """
    class Captured(list):
        """A list of what went out, plus the status code the fake push service answers with.

        A subclass rather than a bare list because several tests need to choose that code —
        pruning a dead subscription on 410 and REFUSING to prune on 401 are two different
        behaviours and the second one is the destructive one.
        """

        code = 201

    calls = Captured()

    def _send(endpoint, p256dh, auth, payload):
        calls.append({"endpoint": endpoint, "payload": payload})
        return calls.code

    monkeypatch.setattr(notify_push, "send", _send)
    monkeypatch.setattr(notify_push, "is_configured", lambda: True)
    return calls


def _subscribe(db, user, endpoint="https://push.example/abc"):
    sub = PushSubscription(
        user_id=user.id, endpoint=endpoint, p256dh="k" * 20, auth="a" * 16
    )
    db.add(sub)
    db.commit()
    return sub


def _row(db, *, to, type="friend_request", actor=None, recipe_id=None, post_id=None):
    row = Notification(
        user_id=to.id,
        type=type,
        actor_id=(actor.id if actor else None),
        recipe_id=recipe_id,
        post_id=post_id,
    )
    db.add(row)
    db.commit()
    return row


def test_a_subscribed_person_gets_the_push(db_session, make_user, sent):
    ana, _ = make_user(first_name="Ana", last_name="")
    ben, _ = make_user(first_name="Ben")
    _subscribe(db_session, ben)
    row = _row(db_session, to=ben, actor=ana)

    assert notify_push.deliver(db_session, [row.id]) == 1
    assert sent[0]["payload"]["body"] == "Ana wants to be friends."
    assert sent[0]["endpoint"] == "https://push.example/abc"


def test_the_push_uses_a_persons_whole_name_like_the_inbox_does(db_session, make_user, sent):
    """`_display_name` mirrors `nameOf()` in Notifications.jsx — first AND last — so the lock
    screen and the inbox row a tap later name the same person the same way. Worth its own test
    because every other assertion in this file deliberately uses a surname-less user to keep the
    expected sentence readable, which would hide a regression to first-name-only."""
    ana, _ = make_user(first_name="Ana", last_name="Reyes")
    ben, _ = make_user()
    _subscribe(db_session, ben)
    row = _row(db_session, to=ben, actor=ana)

    notify_push.deliver(db_session, [row.id])
    assert sent[0]["payload"]["body"] == "Ana Reyes wants to be friends."


def test_an_actor_the_row_lost_is_Someone_not_a_crash(db_session, make_user, sent):
    """`actor_id` is nullable and the actor's account can be deleted. "Someone" is the same
    fallback the client uses, and it keeps the sentence grammatical."""
    ben, _ = make_user()
    _subscribe(db_session, ben)
    row = _row(db_session, to=ben, actor=None)

    notify_push.deliver(db_session, [row.id])
    assert sent[0]["payload"]["body"] == "Someone wants to be friends."


def test_notify_people_off_means_nothing_is_sent(db_session, make_user, sent):
    """The whole point of the column, and until now nothing read it. A settings toggle that
    changes nothing is the defect two other switches were deleted over."""
    ana, _ = make_user()
    ben, _ = make_user()
    ben.notify_people = False
    db_session.commit()
    _subscribe(db_session, ben)
    row = _row(db_session, to=ben, actor=ana)

    assert notify_push.deliver(db_session, [row.id]) == 0
    assert sent == []


def test_quiet_hours_suppress_the_send(db_session, make_user, sent):
    """Uses the REAL `local_now` and the real `in_quiet_hours`, with the window pinned around
    whatever hour it currently is where the user says they are — so the test is deterministic
    without stubbing the clock, and it exercises the actual predicate the nudge uses."""
    from app.services.prompt import local_now

    ana, _ = make_user()
    ben, _ = make_user()
    ben.timezone = "UTC"
    db_session.commit()
    now_local = local_now(ben)
    assert now_local is not None, "tzdata missing — see tests/test_prompt.py"
    hour = now_local.hour
    ben.quiet_from = hour
    ben.quiet_to = (hour + 1) % 24
    db_session.commit()
    _subscribe(db_session, ben)
    row = _row(db_session, to=ben, actor=ana)

    assert notify_push.deliver(db_session, [row.id]) == 0
    assert sent == []


def test_outside_quiet_hours_it_goes(db_session, make_user, sent):
    """The other half — without this, "quiet hours work" is indistinguishable from "nothing ever
    sends"."""
    from app.services.prompt import local_now

    ana, _ = make_user()
    ben, _ = make_user()
    ben.timezone = "UTC"
    db_session.commit()
    now_local = local_now(ben)
    assert now_local is not None, "tzdata missing — see tests/test_prompt.py"
    hour = now_local.hour
    ben.quiet_from = (hour + 1) % 24
    ben.quiet_to = (hour + 2) % 24
    db_session.commit()
    _subscribe(db_session, ben)
    row = _row(db_session, to=ben, actor=ana)

    assert notify_push.deliver(db_session, [row.id]) == 1


def test_no_timezone_still_sends_unlike_the_daily_nudge(db_session, make_user, sent):
    """A DELIBERATE divergence from `run_daily_prompt`, which skips a user with no timezone.

    The nudge needs a local hour to decide WHEN to fire, so without one there is no answer. This
    is triggered by something a person just did, and the answer to "should it go" is yes. If it
    skipped instead, every account that predates the timezone capture would silently receive no
    person-to-person notifications at all — indistinguishable from the feature being broken, and
    it would be the accounts most likely to be testing it.
    """
    ana, _ = make_user()
    ben, _ = make_user()
    assert ben.timezone is None
    _subscribe(db_session, ben)
    row = _row(db_session, to=ben, actor=ana)

    assert notify_push.deliver(db_session, [row.id]) == 1


def test_with_no_vapid_keypair_nothing_is_attempted(db_session, make_user, monkeypatch):
    """Same contract as the rest of #89: unconfigured means off, never half-on. A deploy without
    the secret behaves exactly as the app did before push existed."""
    calls = []
    monkeypatch.setattr(notify_push, "send", lambda *a: calls.append(a) or 201)
    monkeypatch.setattr(notify_push, "is_configured", lambda: False)
    ana, _ = make_user()
    ben, _ = make_user()
    _subscribe(db_session, ben)
    row = _row(db_session, to=ben, actor=ana)

    assert notify_push.deliver(db_session, [row.id]) == 0
    assert calls == []


def test_a_person_with_no_device_is_not_an_error(db_session, make_user, sent):
    """"Notifications on, nothing installed" is the normal state of a new account, and the most
    common one in a beta."""
    ana, _ = make_user()
    ben, _ = make_user()
    row = _row(db_session, to=ben, actor=ana)
    assert notify_push.deliver(db_session, [row.id]) == 0


def test_every_device_gets_it(db_session, make_user, sent):
    """Subscriptions are per DEVICE and preferences per PERSON — a phone and a laptop are two
    rows, and both should buzz."""
    ana, _ = make_user()
    ben, _ = make_user()
    _subscribe(db_session, ben, endpoint="https://push.example/phone")
    _subscribe(db_session, ben, endpoint="https://push.example/laptop")
    row = _row(db_session, to=ben, actor=ana)

    assert notify_push.deliver(db_session, [row.id]) == 2
    assert {c["endpoint"] for c in sent} == {
        "https://push.example/phone",
        "https://push.example/laptop",
    }


@pytest.mark.parametrize("code", [404, 410])
def test_a_dead_subscription_is_pruned(db_session, make_user, sent, code):
    """Only these two codes mean the browser has moved on."""
    ana, _ = make_user()
    ben, _ = make_user()
    _subscribe(db_session, ben)
    sent.code = code
    row = _row(db_session, to=ben, actor=ana)

    notify_push.deliver(db_session, [row.id])
    assert db_session.query(PushSubscription).count() == 0


@pytest.mark.parametrize("code", [401, 403, 429, 500])
def test_a_live_subscription_survives_every_other_failure(db_session, make_user, sent, code):
    """THE DESTRUCTIVE MISTAKE this guards. 401/403 mean OUR key is wrong, not that the device is
    gone — pruning on any 4xx would empty the whole table on the first botched key rotation, and a
    subscription can only be recreated by the person re-granting permission on that device. There
    is no recovery path, so this is the one test here whose failure would be unrecoverable in
    production."""
    ana, _ = make_user()
    ben, _ = make_user()
    _subscribe(db_session, ben)
    sent.code = code
    row = _row(db_session, to=ben, actor=ana)

    notify_push.deliver(db_session, [row.id])
    assert db_session.query(PushSubscription).count() == 1


def test_the_keepers_name_never_reaches_a_lock_screen(db_session, make_user, sent):
    """End-to-end through `deliver`, which is where the first of the two suppressions lives:
    the row DOES store actor_id (notify() needs it), so anonymity has to be applied on the way
    out, exactly as `list_notifications` applies it for the API."""
    keeper, _ = make_user(first_name="Grandma", last_name="Remedios")
    cook, _ = make_user()
    _subscribe(db_session, cook)
    row = _row(db_session, to=cook, type="recipe_kept", actor=keeper)

    notify_push.deliver(db_session, [row.id])
    body = sent[0]["payload"]["body"]
    assert "Grandma" not in body and "Remedios" not in body
    assert body.startswith("Someone")
    assert row.type in ANONYMOUS_TYPES  # the property this depends on, stated


def test_the_db_transaction_is_ENDED_before_any_push_goes_out(
    db_session, make_user, monkeypatch
):
    """The pooled connection must not be held across the HTTP calls.

    The first version read, sent, and only then committed — so one background task held a
    `QueuePool` connection (5 + 10, one ECS task) for as long as the push services took. Four
    askers on two devices each, with Apple degraded to `send()`'s 10s timeout, is one connection
    held for 80 seconds; a handful of those and every incoming request blocks 30s then 500s. Which
    would have defeated the whole point of deferring this past the response — the request path
    would still wait on Apple, just through the pool instead of the response. Found by the ship
    gate.

    ASSERTED AS AN ORDERING, because the property itself isn't observable here: the test fixture
    is in-memory SQLite on a `StaticPool`, so nothing about pool exhaustion can be reproduced, and
    a mutation that deletes the `commit()` passes every other test in this file. What CAN be
    checked is that the commit happens before the first `send()`, which is the whole mechanism.
    """
    order = []
    real_commit = db_session.commit

    def spy_commit():
        order.append("commit")
        real_commit()

    monkeypatch.setattr(notify_push, "is_configured", lambda: True)
    monkeypatch.setattr(
        notify_push, "send", lambda *a, **k: (order.append("send"), 201)[1]
    )

    ana, _ = make_user()
    ben, _ = make_user()
    _subscribe(db_session, ben)
    row = _row(db_session, to=ben, actor=ana)

    monkeypatch.setattr(db_session, "commit", spy_commit)
    assert notify_push.deliver(db_session, [row.id]) == 1

    assert "send" in order, "nothing was sent, so this proves nothing"
    assert order[0] == "commit", f"a push went out before the transaction ended: {order}"
    assert order.index("commit") < order.index("send")


def test_deliver_withholds_the_name_even_if_the_copy_would_print_it(
    db_session, make_user, sent, monkeypatch
):
    """The FIRST of the two anonymity layers, isolated.

    Written because a mutation test found it unpinned: deleting the `anon` check in `deliver`
    changed no test result, because the copy for `recipe_kept` hardcodes "Someone" and ignores
    the name it is handed. The redundancy is deliberate — a lock-screen leak cannot be recalled —
    but a layer nothing tests is a layer that gets refactored away, and then the day someone
    rewords that line to interpolate `who`, the last guard is gone with no failing test.

    So this substitutes a copy function that WOULD print the name, and asserts `deliver` never
    gives it one.
    """
    monkeypatch.setitem(
        notify_push.BODIES, "recipe_kept", lambda who, what: f"{who} kept your {what}."
    )
    keeper, _ = make_user(first_name="Grandma", last_name="Remedios")
    cook, _ = make_user()
    _subscribe(db_session, cook)
    row = _row(db_session, to=cook, type="recipe_kept", actor=keeper, recipe_id=None)

    notify_push.deliver(db_session, [row.id])
    assert sent[0]["payload"]["body"] == "Someone kept your None."
    assert "Remedios" not in sent[0]["payload"]["body"]


def test_deliver_ignores_ids_that_no_longer_exist(db_session, make_user, sent):
    """A notification can be deleted between the commit and the background task — blocking
    someone clears the notifications between the two people, in one transaction. A missing row
    must be a no-op, not a crash in a task nobody is waiting on."""
    ana, _ = make_user()
    ben, _ = make_user()
    _subscribe(db_session, ben)
    assert notify_push.deliver(db_session, [999_999]) == 0
    assert sent == []


# --- queue(): the ordering that cannot be got wrong --------------------------------------------


def test_queue_drops_suppressed_notifications(db_session, make_user):
    """`notify()` returns None for a self-notify or a deduped repeat, and every call site passes
    its return value in verbatim. If `queue` didn't filter, seven call sites would each need the
    same guard and the one that forgot would crash a background task."""
    scheduled = []

    class FakeBackground:
        def add_task(self, fn, *args):
            scheduled.append(args)

    notify_push.queue(FakeBackground(), [None, None])
    assert scheduled == []


def test_queue_before_a_commit_would_send_nothing(db_session, make_user):
    """The ordering, stated as a test rather than only as a comment.

    An un-flushed row has `id` None, so calling `queue` before `db.commit()` silently schedules
    nothing — the notification would sit in the inbox and never reach a phone, with no error
    anywhere. This documents WHY every call site puts `queue` after its commit, and it is the
    failure a reviewer would otherwise have to spot by eye at seven sites.
    """
    ben, _ = make_user()
    scheduled = []

    class FakeBackground:
        def add_task(self, fn, *args):
            scheduled.append(args)

    unsaved = Notification(user_id=ben.id, type="friend_request", actor_id=ben.id)
    assert unsaved.id is None
    notify_push.queue(FakeBackground(), [unsaved])
    assert scheduled == []

    db_session.add(unsaved)
    db_session.commit()
    notify_push.queue(FakeBackground(), [unsaved])
    assert scheduled == [([unsaved.id],)]


def test_the_background_task_swallows_its_own_failures(monkeypatch):
    """Nothing can reach the user by then — the response has already been sent — so an escaping
    exception would surface as an unexplained traceback with no request attached to it. It must
    log and stop."""
    closed = []

    class FakeSession:
        def rollback(self):
            closed.append("rollback")

        def close(self):
            closed.append("close")

    def boom(db, ids):
        raise RuntimeError("push service on fire")

    monkeypatch.setattr(notify_push, "SessionLocal", lambda: FakeSession())
    monkeypatch.setattr(notify_push, "deliver", boom)
    notify_push._deliver_in_new_session([1, 2, 3])  # must not raise
    assert closed == ["rollback", "close"]


# --- end to end, through the API ---------------------------------------------------------------


@pytest.fixture
def live_push(monkeypatch, db_session, sent):
    """Run the background task against the test session.

    `_deliver_in_new_session` opens its own `SessionLocal` because the request's session is gone
    by the time it runs in production — which is right, and is also the one line that cannot work
    against an in-memory SQLite fixture whose schema lives on a single shared connection. So only
    that line is substituted; `queue` (id extraction, task scheduling) and `deliver` (every rule
    above) are the real ones. FastAPI's TestClient runs background tasks after the response, so
    asserting on `sent` after a request is asserting on real ordering.
    """
    monkeypatch.setattr(
        notify_push,
        "_deliver_in_new_session",
        lambda ids: notify_push.deliver(db_session, ids),
    )
    monkeypatch.setattr(
        notify_push,
        "_deliver_friend_post_in_new_session",
        lambda post_id: notify_push.deliver_friend_post(db_session, post_id),
    )
    return sent


def _recipe(client, headers, name="Adobo"):
    r = client.post(
        "/recipes",
        json={"name": name, "visibility": "private", "steps": [{"content": "Cook", "position": 1}]},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_asking_for_a_recipe_reaches_the_cooks_phone(
    client, make_user, db_session, live_push
):
    cook, ch = make_user(first_name="Lola")
    fan, fh = make_user(first_name="Ana", last_name="")
    _subscribe(db_session, cook)
    post = client.post(
        "/posts",
        json={
            "photo_url": "https://res.cloudinary.com/demo/image/upload/a.jpg",
            "dish_name": "Adobo",
            "visibility": "public",
        },
        headers=ch,
    ).json()

    assert client.post(f"/posts/{post['id']}/request", headers=fh).status_code == 201

    assert len(live_push) == 1
    assert live_push[0]["payload"]["body"] == "Ana asked you for your Adobo."
    assert live_push[0]["payload"]["url"] == "/requests"


def test_asking_twice_reaches_the_phone_once(client, make_user, db_session, live_push):
    """notify()'s dedupe is what bounds this, and it now bounds the phone too: ask → retract →
    ask is free by design, and without the dedupe it would be an unmetered way for any signed-in
    stranger to buzz a cook's phone on any public post."""
    cook, ch = make_user()
    fan, fh = make_user()
    _subscribe(db_session, cook)
    post = client.post(
        "/posts",
        json={
            "photo_url": "https://res.cloudinary.com/demo/image/upload/a.jpg",
            "dish_name": "Adobo",
            "visibility": "public",
        },
        headers=ch,
    ).json()

    for _ in range(3):
        client.post(f"/posts/{post['id']}/request", headers=fh)
        client.delete(f"/posts/{post['id']}/request", headers=fh)

    assert len(live_push) == 1


def test_handing_a_recipe_over_reaches_the_recipients_phone(
    client, make_user, db_session, live_push
):
    """The signature act, all the way to a lock screen — which before this task produced no
    notification of any kind."""
    cook, ch = make_user(first_name="Lola", last_name="")
    friend, fh = make_user()
    _subscribe(db_session, friend)
    recipe = _recipe(client, ch, name="Adobo")

    client.post(f"/recipes/{recipe['id']}/handoff", json={"to_user_id": friend.id}, headers=ch)

    assert len(live_push) == 1
    assert live_push[0]["payload"]["body"] == "Lola wanted you to have Adobo."
    assert live_push[0]["payload"]["url"] == f"/recipes/{recipe['id']}"


def test_claiming_the_link_reaches_the_cooks_phone(client, make_user, db_session, live_push):
    cook, ch = make_user()
    guest, gh = make_user(first_name="Ben", last_name="")
    _subscribe(db_session, cook)
    recipe = _recipe(client, ch, name="Sinigang")
    token = client.post(f"/recipes/{recipe['id']}/handoff", json={}, headers=ch).json()["token"]

    client.post(f"/recipes/invite/{token}/claim", headers=gh)

    assert len(live_push) == 1
    assert live_push[0]["payload"]["body"] == "Ben has your Sinigang now."


def test_answering_four_asks_at_once_reaches_four_phones(
    client, make_user, db_session, live_push
):
    """The fan-out call site. `fulfill_post` answers every pending asker in one request, so this
    is where doing the sends inline would have made a cook wait on four round trips to Apple and
    Google before their screen moved."""
    cook, ch = make_user(first_name="Lola")
    post = client.post(
        "/posts",
        json={
            "photo_url": "https://res.cloudinary.com/demo/image/upload/a.jpg",
            "dish_name": "Adobo",
            "visibility": "public",
        },
        headers=ch,
    ).json()
    for i in range(4):
        asker, ah = make_user(first_name=f"Fan{i}")
        _subscribe(db_session, asker, endpoint=f"https://push.example/{i}")
        client.post(f"/posts/{post['id']}/request", headers=ah)
    live_push.clear()  # the cook has no device; drop anything the asks themselves produced

    recipe = _recipe(client, ch, name="Adobo")
    r = client.post(
        f"/posts/{post['id']}/fulfill", json={"recipe_id": recipe["id"]}, headers=ch
    )
    assert r.status_code == 200, r.text

    assert len(live_push) == 4
    assert all("sent you Adobo" in c["payload"]["body"] for c in live_push)


def test_a_friend_request_and_its_acceptance_both_reach_a_phone(
    client, make_user, db_session, live_push
):
    ana, ah = make_user(first_name="Ana", last_name="")
    ben, bh = make_user(first_name="Ben", last_name="")
    _subscribe(db_session, ana, endpoint="https://push.example/ana")
    _subscribe(db_session, ben, endpoint="https://push.example/ben")

    fid = client.post("/friends/request", json={"to_user_id": ben.id}, headers=ah).json()["id"]
    assert live_push[-1]["payload"]["body"] == "Ana wants to be friends."
    assert live_push[-1]["endpoint"] == "https://push.example/ben"

    client.post(f"/friends/{fid}/accept", headers=bh)
    assert live_push[-1]["payload"]["body"] == "Ben is now your friend."
    assert live_push[-1]["endpoint"] == "https://push.example/ana"


def test_your_own_action_never_reaches_your_own_phone(client, make_user, db_session, live_push):
    """notify() suppresses a self-notify, so there is no row and therefore nothing to push. Worth
    asserting end-to-end because a push is the one notification you cannot miss: getting this
    wrong means the app buzzes you about your own tap."""
    cook, ch = make_user()
    _subscribe(db_session, cook)
    recipe = _recipe(client, ch)
    client.post(f"/recipes/{recipe['id']}/handoff", json={"to_user_id": cook.id}, headers=ch)
    token = client.post(f"/recipes/{recipe['id']}/handoff", json={}, headers=ch).json()["token"]
    client.post(f"/recipes/invite/{token}/claim", headers=ch)

    assert live_push == []


# --- "a friend posted": a push with no inbox row ------------------------------------------------
#
# The one notification in the app that writes nothing down. Its persistent half is the FEED's
# #97 read-mark, so what these tests guard is the interruption: who gets it, and — mostly — who
# doesn't. The failure mode here isn't a missing notification, it's a stranger being told about
# somebody's dinner.


def _post(client, headers, dish="Adobo", visibility="friends", recipe_id=None):
    body = {
        "photo_url": "https://res.cloudinary.com/demo/image/upload/a.jpg",
        "dish_name": dish,
        "visibility": visibility,
    }
    if recipe_id is not None:
        body["recipe_id"] = recipe_id
    r = client.post("/posts", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _befriend(client, a, ah, b, bh):
    fid = client.post("/friends/request", json={"to_user_id": b.id}, headers=ah).json()["id"]
    assert client.post(f"/friends/{fid}/accept", headers=bh).status_code == 200


def _instant(db_session, user):
    """Opt in to hearing about friends' posts. On by DEFAULT now, so this is belt-and-braces for
    tests that want to be explicit about which switch they depend on."""
    user.notify_friend_posts = True
    db_session.commit()


def test_a_friend_on_instant_hears_about_a_new_post(client, make_user, db_session, live_push):
    cook, ch = make_user(first_name="Lola", last_name="")
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    _instant(db_session, fan)
    _subscribe(db_session, fan)
    live_push.clear()  # the friendship itself pushed; this test is about the post

    _post(client, ch, dish="Adobo")

    assert len(live_push) == 1
    assert live_push[0]["payload"]["body"] == "Lola just shared a meal — Adobo."
    # The FEED, not the permalink: this says "there is something new", and the feed is where
    # everything else that landed while the phone was face-down is too.
    assert live_push[0]["payload"]["url"] == "/"
    # Tagged per POST, so two friends cooking are two notifications. Omitting the tag would NOT
    # mean "don't collapse" — sw.js used to default it to a constant. See the payload test above.
    assert live_push[0]["payload"]["tag"].startswith("post-")


def test_the_recipe_claim_is_answered_PER_PERSON_not_per_post(
    client, make_user, db_session, live_push
):
    """A post links a recipe the AUTHOR owns, and the recipe's visibility is independent of the
    post's — `Recipe`'s DB server_default is literally `private`. So a friend can legitimately see
    the meal and not the recipe, and `_to_response` already nulls `recipe_id` for that viewer "so
    a 'See the recipe' link is only shown when it would resolve".

    The first version built the payload once, outside the recipient loop, from
    `post.recipe_id is not None` — so it promised "…, with the recipe" to someone whose card then
    offered no recipe link at all. The push is the one surface that makes the claim and the one
    that cannot be corrected. Found by the ship gate.
    """
    cook, ch = make_user(first_name="Lola", last_name="")
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    _instant(db_session, fan)
    _subscribe(db_session, fan)
    # A PRIVATE recipe attached to a post the friend CAN see.
    recipe = _recipe(client, ch, name="Adobo")
    live_push.clear()

    _post(client, ch, dish="Adobo", visibility="friends", recipe_id=recipe["id"])

    assert len(live_push) == 1
    body = live_push[0]["payload"]["body"]
    assert "with the recipe" not in body, body
    assert body == "Lola just shared a meal — Adobo."


def test_a_friend_who_CAN_read_the_recipe_is_told_it_is_there(
    client, make_user, db_session, live_push
):
    """The other half. Same post shape, but the recipe is `friends`-visible, so the claim is true
    and worth making — a photo is a glimpse, a photo with the recipe is what this app is for."""
    cook, ch = make_user(first_name="Lola", last_name="")
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    _instant(db_session, fan)
    _subscribe(db_session, fan)
    r = client.post(
        "/recipes",
        json={
            "name": "Adobo",
            "visibility": "friends",
            "steps": [{"content": "Cook", "position": 1}],
        },
        headers=ch,
    )
    assert r.status_code == 201, r.text
    live_push.clear()

    _post(client, ch, dish="Adobo", visibility="friends", recipe_id=r.json()["id"])

    assert live_push[0]["payload"]["body"] == "Lola just shared a meal — Adobo, with the recipe."


def test_two_friends_can_get_DIFFERENT_answers_about_the_same_post(
    client, make_user, db_session, live_push
):
    """The reason the payload has to be built inside the loop rather than gated once: the same
    post can legitimately carry a readable recipe for one friend and not another. Here the recipe
    is `private`, and one of the two friends holds a handoff grant for it — which `can_view` honours
    orthogonally to visibility, so exactly one of them should be told the recipe is there."""
    cook, ch = make_user(first_name="Lola", last_name="")
    granted, g1 = make_user()
    plain, g2 = make_user()
    _befriend(client, cook, ch, granted, g1)
    _befriend(client, cook, ch, plain, g2)
    _instant(db_session, granted)
    _instant(db_session, plain)
    _subscribe(db_session, granted, endpoint="https://push.example/granted")
    _subscribe(db_session, plain, endpoint="https://push.example/plain")
    recipe = _recipe(client, ch, name="Adobo")  # private
    client.post(
        f"/recipes/{recipe['id']}/handoff", json={"to_user_id": granted.id}, headers=ch
    )
    live_push.clear()

    _post(client, ch, dish="Adobo", visibility="friends", recipe_id=recipe["id"])

    bodies = {c["endpoint"]: c["payload"]["body"] for c in live_push}
    assert "with the recipe" in bodies["https://push.example/granted"]
    assert "with the recipe" not in bodies["https://push.example/plain"]


def test_a_soft_deleted_recipe_is_never_named_or_linked(db_session, make_user, sent):
    """`deleted_at` is a soft delete, so the notification's FK is NOT nulled — only a real DELETE
    does that. Without filtering, a push would name a recipe whose tap 404s. `list_notifications`
    is careful about this and the push path has to be too."""
    from datetime import datetime, timezone as dt_timezone

    from app.models.recipe import Recipe as R

    ana, _ = make_user(first_name="Ana", last_name="")
    ben, _ = make_user()
    recipe = R(user_id=ana.id, name="Adobo", visibility="private")
    db_session.add(recipe)
    db_session.commit()
    _subscribe(db_session, ben)
    row = _row(db_session, to=ben, type="recipe_arrived", actor=ana, recipe_id=recipe.id)
    recipe.deleted_at = datetime.now(dt_timezone.utc).replace(tzinfo=None)
    db_session.commit()

    notify_push.deliver(db_session, [row.id])
    body = sent[0]["payload"]["body"]
    assert "Adobo" not in body
    assert body == "Ana sent you a recipe."
    assert sent[0]["payload"]["url"] == "/notifications"


def test_declining_friend_posts_silences_them(client, make_user, db_session, live_push):
    """`notify_friend_posts` is the gate, and it is now a switch of its own rather than one value of
    a three-way cadence — because the daily nudge became a prompt to post, which is about YOU, so
    the two stopped being alternatives and became different notifications about different
    subjects."""
    cook, ch = make_user()
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    fan.notify_friend_posts = False
    db_session.commit()
    _subscribe(db_session, fan)
    live_push.clear()

    _post(client, ch)
    assert live_push == []


def test_hearing_about_friends_posts_is_ON_BY_DEFAULT(client, make_user, db_session, live_push):
    """It used to be opt-in, buried as one value of a three-way control. This is the
    Instagram-shaped behaviour people already expect from an app of this shape, and the owner's
    call was that it should be the default rather than something to go and find."""
    cook, ch = make_user(first_name="Lola", last_name="")
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    assert fan.notify_friend_posts is True, "the default, straight from the column"
    _subscribe(db_session, fan)
    live_push.clear()

    _post(client, ch, dish="Adobo")
    assert len(live_push) == 1
    assert live_push[0]["payload"]["body"] == "Lola just shared a meal — Adobo."


def test_declining_the_daily_PROMPT_does_not_silence_friend_posts(
    client, make_user, db_session, live_push
):
    """The independence, from the other side. Someone who doesn't want to be nagged to post can
    still want to know when a friend cooks — the old cadence could not express that at all."""
    cook, ch = make_user()
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    fan.notify_prompt_me = False
    db_session.commit()
    _subscribe(db_session, fan)
    live_push.clear()

    _post(client, ch)
    assert len(live_push) == 1


def test_two_friends_cooking_are_two_notifications_not_one(
    client, make_user, db_session, live_push
):
    """The friend-post counterpart of the unique-tag rule. Two posts from two people must not
    overwrite each other on the lock screen — which is what a shared tag does, and what the old
    sw.js default silently produced for any payload that didn't set one."""
    ana, ah = make_user(first_name="Ana", last_name="")
    ben, bh = make_user(first_name="Ben", last_name="")
    fan, fh = make_user()
    _befriend(client, ana, ah, fan, fh)
    _befriend(client, ben, bh, fan, fh)
    _instant(db_session, fan)
    _subscribe(db_session, fan)
    live_push.clear()

    _post(client, ah, dish="Adobo")
    _post(client, bh, dish="Sinigang")

    assert len(live_push) == 2
    tags = {c["payload"]["tag"] for c in live_push}
    assert len(tags) == 2


def test_a_stranger_hears_nothing_even_about_a_PUBLIC_post(
    client, make_user, db_session, live_push
):
    """Friends only, ALWAYS — never everyone who can technically see a public post. Pushing a
    stranger about a public meal would be the app volunteering someone's dinner to people who
    never asked, which is the thing the whole setting exists to keep bounded."""
    cook, ch = make_user()
    stranger, sh = make_user()
    _instant(db_session, stranger)
    _subscribe(db_session, stranger)
    live_push.clear()

    _post(client, ch, visibility="public")
    assert live_push == []


def test_a_PRIVATE_post_reaches_nobody(client, make_user, db_session, live_push):
    """`can_view_post` is consulted rather than re-implemented, so "only me" means only me here
    too. Without that check a private post — the thing someone marks private ON PURPOSE — would
    be announced to every friend's lock screen, which is the worst possible place to leak it."""
    cook, ch = make_user()
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    _instant(db_session, fan)
    _subscribe(db_session, fan)
    live_push.clear()

    _post(client, ch, visibility="private")
    assert live_push == []


def test_the_author_never_hears_about_their_own_post(client, make_user, db_session, live_push):
    """`friend_ids` doesn't include you, which is what makes this true — worth pinning because
    the author is the one person guaranteed to be subscribed and testing."""
    cook, ch = make_user()
    _instant(db_session, cook)
    _subscribe(db_session, cook)
    live_push.clear()

    _post(client, ch)
    assert live_push == []


def test_editing_a_post_notifies_nobody(client, make_user, db_session, live_push):
    """Only on CREATE. `PATCH /posts/{id}` already refuses to move the #97 read-mark so an edit
    can't resurface as unread; a push on edit would undo that from the outside. Someone fixing a
    typo, or widening an old post's visibility, has not cooked anything."""
    cook, ch = make_user()
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    _instant(db_session, fan)
    _subscribe(db_session, fan)
    post = _post(client, ch, visibility="private")
    live_push.clear()

    r = client.patch(
        f"/posts/{post['id']}",
        json={"dish_name": "Chicken Adobo", "visibility": "friends"},
        headers=ch,
    )
    assert r.status_code == 200, r.text
    assert live_push == []


def test_quiet_hours_apply_here_too(client, make_user, db_session, live_push):
    """The friend-post path has its OWN copy of the quiet-hours check — a separate loop from
    `deliver` — so it needs its own test. Deleting one of the two would leave the other passing."""
    from app.services.prompt import local_now

    cook, ch = make_user()
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    _instant(db_session, fan)
    fan.timezone = "UTC"
    db_session.commit()
    now_local = local_now(fan)
    assert now_local is not None, "tzdata missing — see tests/test_prompt.py"
    fan.quiet_from = now_local.hour
    fan.quiet_to = (now_local.hour + 1) % 24
    db_session.commit()
    _subscribe(db_session, fan)
    live_push.clear()

    _post(client, ch)
    assert live_push == []


def test_notify_people_does_not_gate_a_friends_post(client, make_user, db_session, live_push):
    """Two settings, two meanings, and conflating them would make one of them unusable: someone
    who wants to know when a friend asks for their Adobo must still be able to decline the
    ambient stream, and vice versa."""
    cook, ch = make_user(first_name="Lola", last_name="")
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    _instant(db_session, fan)
    fan.notify_people = False
    db_session.commit()
    _subscribe(db_session, fan)
    live_push.clear()

    _post(client, ch, dish="Adobo")
    assert len(live_push) == 1


def test_a_friend_post_carries_no_inbox_row(client, make_user, db_session, live_push):
    """THE DESIGN, asserted rather than only described. The inbox is for things addressed to you;
    "Ana posted Adobo" is ambient and already has a home in the feed. A row per friend post would
    turn the inbox into a second feed and bury the asks — the only thing in there with a deadline.
    """
    cook, ch = make_user()
    fan, fh = make_user()
    _befriend(client, cook, ch, fan, fh)
    _instant(db_session, fan)
    _subscribe(db_session, fan)
    client.post("/notifications/read", headers=fh)  # clear the friend_accept row

    _post(client, ch)

    rows = client.get("/notifications", headers=fh).json()
    assert [n for n in rows["notifications"] if not n["read"]] == []
