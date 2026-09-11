"""The in-app feedback endpoint, and the one property that must never drift:
a person can read their OWN notes and nobody else's.

That property is the reason this endpoint is shaped the way it is. There is no
admin role in this app, so a plain list endpoint would have handed every beta
tester everyone else's candid words — including complaints about each other. The
scoping tests below are not incidental coverage; they are the guard on that
decision, and a change that makes them fail is a privacy regression rather than a
broken test.
"""

import pytest


def _send(client, headers, **overrides):
    payload = {"body": "The save button did nothing on my phone."}
    payload.update(overrides)
    return client.post("/feedback", json=payload, headers=headers)


# --- The happy path ------------------------------------------------------


def test_feedback_is_stored_against_the_sender(client, make_user, db_session):
    from app.models.feedback import Feedback

    user, headers = make_user()
    resp = _send(client, headers)
    assert resp.status_code == 201
    body = resp.json()
    assert body["body"] == "The save button did nothing on my phone."
    assert body["id"] and body["created_at"]

    stored = db_session.query(Feedback).one()
    assert stored.user_id == user.id


def test_context_fields_are_stored_when_the_client_sends_them(client, make_user):
    """path and app_version are what make a report actionable without a follow-up
    conversation — which screen, which build."""
    _, headers = make_user()
    resp = _send(client, headers, path="/recipes/12", app_version="2026.08.03")
    assert resp.status_code == 201
    assert resp.json()["path"] == "/recipes/12"
    assert resp.json()["app_version"] == "2026.08.03"


def test_context_fields_are_optional(client, make_user):
    """A note with no context is still worth having — never reject one for it."""
    _, headers = make_user()
    resp = _send(client, headers)
    assert resp.status_code == 201
    assert resp.json()["path"] is None
    assert resp.json()["app_version"] is None


def test_the_response_does_not_echo_who_wrote_it(client, make_user):
    """FeedbackResponse omits user_id on purpose, so no future endpoint can widen
    the reader set and start leaking authorship just by reusing this model."""
    _, headers = make_user()
    assert "user_id" not in _send(client, headers).json()


# --- Body rules (structural, so they belong to the schema) ---------------


@pytest.mark.parametrize(
    "value",
    [
        "",  # nothing typed
        "   ",  # spacebar only — satisfies a browser's `required`, says nothing
        "\t\n ",  # whitespace that isn't a space
    ],
    ids=["empty", "spaces", "other-whitespace"],
)
def test_blank_body_is_rejected(client, make_user, value):
    _, headers = make_user()
    resp = _send(client, headers, body=value)
    assert resp.status_code == 422
    # The field is named so the client can point at the right input.
    assert any("body" in e["loc"] for e in resp.json()["detail"])


def test_body_is_trimmed_before_storage(client, make_user):
    # A trailing newline off a phone keyboard shouldn't ride into the stored note.
    resp = _send(client, make_user()[1], body="  it crashed  \n")
    assert resp.status_code == 201
    assert resp.json()["body"] == "it crashed"


def test_overlong_body_is_rejected(client, make_user):
    resp = _send(client, make_user()[1], body="x" * 2001)
    assert resp.status_code == 422
    assert any("body" in e["loc"] for e in resp.json()["detail"])


def test_body_at_the_limit_is_accepted(client, make_user):
    # 2000 is the boundary, not one past it: a long, detailed report is the good
    # case, and it must not be the one that gets turned away.
    assert _send(client, make_user()[1], body="x" * 2000).status_code == 201


def test_overlong_context_fields_are_rejected(client, make_user):
    """The caps on path/app_version keep two free-text hint fields from being used
    as general-purpose storage."""
    _, headers = make_user()
    assert _send(client, headers, path="/" + "x" * 200).status_code == 422
    assert _send(client, headers, app_version="v" * 51).status_code == 422


def test_validation_failure_is_the_422_shape_the_frontend_renders(client, make_user):
    """Pins the contract frontend/src/api/client.js normalizes.

    `detail` is an ARRAY OF OBJECTS, not a string — rendering it raw is what put
    "[object Object]" in front of users once already, and this form routes through
    the same normalizer specifically so it can't happen again here.
    """
    _, headers = make_user()
    detail = _send(client, headers, body=" ").json()["detail"]
    assert isinstance(detail, list) and detail
    for entry in detail:
        assert isinstance(entry, dict)
        assert "loc" in entry and "msg" in entry


# --- Auth ---------------------------------------------------------------


def test_sending_feedback_requires_a_signed_in_account(client):
    """Not open to the world: an unauthenticated POST would make this table a
    spam target with no account to attribute anything to."""
    assert client.post("/feedback", json={"body": "hi"}).status_code == 401


def test_reading_feedback_requires_a_signed_in_account(client):
    assert client.get("/feedback").status_code == 401


# --- The read scope: THE property to preserve ---------------------------


def test_read_returns_only_the_callers_own_notes(client, make_user):
    """The whole reason GET /feedback is self-scoped.

    Feedback is where a tester writes candidly, sometimes about another person
    using the app. With no admin role in this app, a list endpoint that returned
    everything would let any signed-in account read every other tester's
    complaints. If this test ever fails, the endpoint is leaking — the fix is the
    filter, not the assertion.
    """
    _, mine = make_user()
    _, theirs = make_user()
    _send(client, mine, body="mine: the photo upload spun forever")
    _send(client, theirs, body="theirs: a private thing about someone else")

    listed = client.get("/feedback", headers=mine).json()
    assert [f["body"] for f in listed] == ["mine: the photo upload spun forever"]

    # And symmetrically, so this can't pass by accident of ordering.
    listed_other = client.get("/feedback", headers=theirs).json()
    assert [f["body"] for f in listed_other] == [
        "theirs: a private thing about someone else"
    ]


def test_read_is_empty_for_someone_who_has_sent_nothing(client, make_user):
    _, mine = make_user()
    _, theirs = make_user()
    _send(client, theirs, body="something")
    assert client.get("/feedback", headers=mine).json() == []


def test_read_returns_newest_first(client, make_user):
    """Newest first because the useful question is "did the thing I just sent
    land?" — and same-second timestamps are the norm in SQLite, so the id
    tiebreaker in the query is what actually makes this deterministic."""
    _, headers = make_user()
    _send(client, headers, body="first")
    _send(client, headers, body="second")
    _send(client, headers, body="third")
    assert [f["body"] for f in client.get("/feedback", headers=headers).json()] == [
        "third",
        "second",
        "first",
    ]


def test_a_person_can_send_more_than_one_note(client, make_user):
    """Deliberately unlimited: rate-limiting a beta of a handful of people would
    cost a real report to prevent a problem nobody has."""
    _, headers = make_user()
    for _ in range(3):
        assert _send(client, headers).status_code == 201
    assert len(client.get("/feedback", headers=headers).json()) == 3


# --- The owner finds out (#101) -----------------------------------------------------------------
#
# Feedback had been live since #9 and produced a beta's worth of notes nobody read, because reading
# them meant remembering to open a database console. The read path is deliberately still self-only
# (the scoping tests above are the guard on that); what changed is that a new note now announces
# itself by email. These tests pin the two properties that make that safe.


def test_a_new_note_emails_the_owner(client, make_user, monkeypatch):
    sent = {}

    def fake_send(body, *, from_name, from_email, path, app_version):
        sent.update(
            body=body, from_name=from_name, from_email=from_email, path=path, app_version=app_version
        )
        return True

    monkeypatch.setattr("app.routers.feedback.send_feedback_notification", fake_send)
    user, h = make_user(first_name="Mia", last_name="Tan")

    r = _send(client, h, body="the save button did nothing", path="/add/recipe", app_version="abc123")

    assert r.status_code == 201
    # The owner needs to know WHO, on WHICH screen, and on WHICH build — "which build was this?" is
    # the first question a bug report raises.
    assert sent["body"] == "the save button did nothing"
    assert sent["from_name"] == "Mia Tan"
    assert sent["from_email"] == user.email
    assert sent["path"] == "/add/recipe"
    assert sent["app_version"] == "abc123"


def test_a_FAILED_email_never_fails_the_feedback(client, make_user, db_session, monkeypatch):
    """The most self-defeating error message this app could produce is "your feedback failed" on
    feedback that saved perfectly. `email.py` swallows its own errors, and the router wraps the call
    anyway — this pins the belt AND the braces by raising from the notification itself.
    """
    def boom(*a, **kw):
        raise RuntimeError("SES is having a day")

    monkeypatch.setattr("app.routers.feedback.send_feedback_notification", boom)
    _, h = make_user()

    r = _send(client, h, body="still worth saying")

    assert r.status_code == 201
    assert r.json()["body"] == "still worth saying"
    # And it is really in the table, not just echoed back.
    from app.models.feedback import Feedback

    assert db_session.query(Feedback).filter(Feedback.body == "still worth saying").count() == 1


def test_with_no_recipient_configured_it_is_a_no_op_not_an_error(client, make_user, monkeypatch):
    """Unconfigured means OFF, never broken — the same rule as push.is_configured() and the cron
    secret. A deploy with no SES address behaves exactly as it did before this existed.
    """
    monkeypatch.setattr("app.config.settings.sender_email", "")
    monkeypatch.setattr("app.config.settings.feedback_notify_email", "")

    import app.services.email as email_mod

    monkeypatch.setattr(email_mod, "_WARNED_NO_RECIPIENT", False)
    assert email_mod.feedback_recipient() == ""
    # Returns False rather than raising, and never touches boto3.
    assert email_mod.send_feedback_notification(
        "x", from_name="A", from_email="a@b.com", path=None, app_version=None
    ) is False

    # And the endpoint still succeeds with no recipient at all.
    _, h = make_user()
    assert _send(client, h).status_code == 201


def test_the_off_warning_is_emitted_ONCE_not_per_note(monkeypatch, caplog):
    """An INFO line here was invisible under uvicorn's default root level, so "it's logged" was a
    claim with nothing behind it. WARNING surfaces it; once-per-process keeps it from repeating,
    because being unconfigured is a property of the deploy rather than of the note.
    """
    import logging

    import app.services.email as email_mod

    monkeypatch.setattr("app.config.settings.sender_email", "")
    monkeypatch.setattr("app.config.settings.feedback_notify_email", "")
    monkeypatch.setattr(email_mod, "_WARNED_NO_RECIPIENT", False)

    with caplog.at_level(logging.WARNING, logger=email_mod.__name__):
        for _ in range(3):
            email_mod.send_feedback_notification(
                "x", from_name="A", from_email="a@b.com", path=None, app_version=None
            )

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    # And it points at the way to read them anyway.
    assert "read_feedback.py" in warnings[0].getMessage()



def test_the_recipient_falls_back_to_the_verified_sender(monkeypatch):
    """No new secret needed. SES requires the sender to be verified and — in the sandbox — the
    recipient too, so the one address certain to be verified is the one already configured.
    """
    from app.services.email import feedback_recipient

    monkeypatch.setattr("app.config.settings.sender_email", "noreply@issei.app")
    monkeypatch.setattr("app.config.settings.feedback_notify_email", "")
    assert feedback_recipient() == "noreply@issei.app"

    # An explicit override wins.
    monkeypatch.setattr("app.config.settings.feedback_notify_email", "me@example.com")
    assert feedback_recipient() == "me@example.com"
