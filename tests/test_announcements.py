"""Announcement emails (#107) — the one message the app sends without being asked.

Everything else SES carries is a REPLY to something a person did: a password reset answers a reset
request, and the feedback notification goes to the owner's own inbox. This is the only broadcast, so
it is the only place an opt-out has teeth, and these tests exist to pin that the opt-out is honoured
and that the header carrying the unsubscribe control is actually on the message.

No test here sends mail. `send_announcement` is exercised only for its refusal path; the SES call
itself is the one thing no test on this machine can reach (no IAM role, and the account is still in
the SES sandbox), which is recorded rather than faked.
"""

import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import text

from app.services.email import (
    AnnouncementUnavailable,
    announcement_bytes,
    announcement_sender,
    build_announcement,
    looks_unmonitored,
    send_announcement,
    unsubscribe_address,
)

# The send script, loaded by path: `scripts/` is not a package. Its recipient query is imported
# rather than paraphrased for the same reason the migration repair test imports its statement — a
# copy of the WHERE clause is a copy that can drift from the one that actually mails people.
_SCRIPT = (
    Path(__file__).resolve().parents[1] / "scripts" / "send_announcement.py"
)
_spec = importlib.util.spec_from_file_location("_send_announcement_script", _SCRIPT)
_script = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_script)


# --- the column and its default ---


def test_a_new_account_is_opted_IN(client):
    """Default TRUE, because this is an opt-OUT. These accounts joined a beta and "the thing you
    signed up for has changed" is mail they are owed; defaulting to off would ship a feature that
    reaches nobody and look like it worked."""
    r = client.post(
        "/auth/signup",
        json={
            "email": "fresh@example.com",
            "password": "pw123456",
            "first_name": "Fresh",
            "last_name": "Account",
        },
    )
    assert r.status_code == 201, r.text
    login = client.post(
        "/auth/login",
        data={"username": "fresh@example.com", "password": "pw123456"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert login.json()["user"]["announcement_emails"] is True


def test_the_switch_needs_no_password_and_takes_effect(client, make_user, db_session):
    """Like every other notification switch: it only narrows what reaches the person, exposes
    nothing to anyone else, and is instantly reversible. `PATCH /auth/me` requires the current
    password for email and password changes only."""
    user, headers = make_user()
    r = client.patch("/auth/me", json={"announcement_emails": False}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["announcement_emails"] is False

    db_session.expire_all()
    assert db_session.get(type(user), user.id).announcement_emails is False

    # And back on, because a switch that only turns off is a trap.
    again = client.patch("/auth/me", json={"announcement_emails": True}, headers=headers)
    assert again.json()["announcement_emails"] is True


def test_login_returns_it_so_a_settings_screen_can_render_the_switch(client, make_user):
    """`login` carries the notification prefs for exactly this reason — without it the switch reads
    as `undefined` (i.e. off) for one page load, between login and the first `reconcile()`. That is
    the bug #90 was, and it looks like the app having forgotten a choice."""
    user, headers = make_user()
    client.patch("/auth/me", json={"announcement_emails": False}, headers=headers)
    login = client.post(
        "/auth/login",
        data={"username": user.email, "password": "password123"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert login.status_code == 200, login.text
    assert login.json()["user"]["announcement_emails"] is False


# --- the recipient query: the only thing that honours the opt-out ---


def test_the_send_scripts_query_EXCLUDES_anyone_who_opted_out(db_session, make_user):
    """THE PROMISE OF THE WHOLE FEATURE, and it lives in one SQL string. Imported from the script
    rather than rewritten here, because a paraphrase that drifted would pass while the thing that
    mails people did something else."""
    keep_a, _ = make_user()
    keep_b, _ = make_user()
    out, _ = make_user()
    db_session.execute(
        text("UPDATE users SET announcement_emails = false WHERE id = :i"), {"i": out.id}
    )
    db_session.commit()

    rows = [dict(r._mapping) for r in db_session.execute(_script.RECIPIENTS_SQL)]
    addresses = {r["email"] for r in rows}
    assert keep_a.email in addresses
    assert keep_b.email in addresses
    assert out.email not in addresses
    assert db_session.execute(_script.OPTED_OUT_SQL).scalar() == 1


def test_the_query_is_not_secretly_filtering_on_anything_else(db_session, make_user):
    """A guard against the query quietly acquiring a second condition — "only users with posts",
    "only verified", anything. The opt-out is the ONLY thing that removes someone from a broadcast;
    any other filter would mean an announcement silently skipping people the owner believes it
    reached, which is the failure mode this whole file is about."""
    made = [make_user()[0] for _ in range(4)]
    rows = [dict(r._mapping) for r in db_session.execute(_script.RECIPIENTS_SQL)]
    assert {u.email for u in made} <= {r["email"] for r in rows}


# --- the message itself ---


def test_every_announcement_carries_the_unsubscribe_header():
    """WHY `send_raw_email` EXISTS IN THIS FEATURE. SES's simple `send_email` takes a subject and a
    body and nothing else, so there is no way to attach this. Gmail and Yahoo expect
    `List-Unsubscribe` from bulk senders and filter harder without it — so the header is
    deliverability, not manners, and an announcement in spam is the feature not working.
    """
    message = build_announcement(
        to_email="ana@example.com",
        subject="issei: what's new",
        body="We shipped a thing.",
        from_email="noreply@issei.app",
        unsubscribe_to="hello@issei.app",
    )
    assert message["List-Unsubscribe"] == "<mailto:hello@issei.app?subject=unsubscribe>"
    assert message["To"] == "ana@example.com"
    assert message["From"] == "noreply@issei.app"
    assert message["Subject"] == "issei: what's new"
    # A reply to a broadcast is the most engaged response a beta gets; the first version aimed it at
    # whatever `SENDER_EMAIL` was, i.e. at `noreply@`.
    assert message["Reply-To"] == "hello@issei.app"
    # `Date` is mandatory under RFC 5322 and its absence is a spam signal. SES may add one; two lines
    # here mean we do not have to find out.
    assert message["Date"]
    assert message["Message-ID"]


def test_it_does_NOT_claim_ONE_CLICK():
    """THE CORRECTION BOTH SHIP GATES FOUND. The first version paired `List-Unsubscribe-Post:
    List-Unsubscribe=One-Click` with a `mailto:`-only target. RFC 8058's one-click flow specifies an
    **https:** URI, so that pairing is outside the spec — a conforming client ignores the header — and
    worse, it advertises an automation nothing here performs: the mailto goes to a human inbox.

    Claiming one-click while delivering a manual mailto is the shape of promise this project refuses
    everywhere else (an unwired switch, a "sent ✓" on a grant that delivered nothing). The plain
    header stays, because the deliverability argument for it is real.
    """
    message = build_announcement(
        to_email="ana@example.com",
        subject="s",
        body="b",
        from_email="noreply@issei.app",
        unsubscribe_to="hello@issei.app",
    )
    assert message["List-Unsubscribe-Post"] is None


def test_the_unsubscribe_header_survives_SERIALISATION():
    """THE ASSERTION THE FIRST VERSION'S TESTS ONLY LOOKED LIKE THEY MADE.

    They read `message["List-Unsubscribe"]` back off the in-memory object, which round-trips whatever
    the wire format does, and the raw-bytes test asserted only that the header NAME appeared. A ship
    gate measured the real hazard: past a 48-character header value the default policy emits the whole
    thing as an RFC 2047 encoded-word (`=?utf-8?q?=3Cmailto=3A...?=`), which no RFC 2369 parser reads
    as a URI — so the unsubscribe control silently vanishes while both old assertions still passed.
    `noreply@issei.app` is short enough that it cannot fire today; adding an https: URI beside the
    mailto, the obvious next change, crosses the threshold immediately.
    """
    long_inbox = "unsubscribe-requests-for-announcements@issei-app-example.com"
    assert len(long_inbox) > 49
    message = build_announcement(
        to_email="ana@example.com",
        subject="s",
        body="b",
        from_email="noreply@issei.app",
        unsubscribe_to=long_inbox,
    )
    raw = announcement_bytes(message)
    # The URI, on the wire, unencoded — not merely the header name.
    assert b"<mailto:" + long_inbox.encode() in raw.replace(b"\r\n ", b"")
    assert b"=?utf-8?q?" not in raw
    # `policy.SMTP` also gives the CRLF line endings the wire format calls for.
    assert b"\r\n" in raw


def test_the_body_says_how_to_stop_them_without_needing_the_header():
    """The header is invisible to anyone whose mail client doesn't surface it, so "how do I stop
    these" must have an answer inside the message. It names the in-app switch, which is the primary
    control and the one that actually writes the column."""
    message = build_announcement(
        to_email="ana@example.com",
        subject="s",
        body="Body.",
        from_email="hello@issei.app",
    )
    content = message.get_content()
    assert "Body." in content
    assert "Notifications" in content
    assert "issei account" in content


def test_the_body_survives_punctuation_people_actually_type():
    """An em dash, a curly quote and an emoji all appear in this app's own copy. The email is UTF-8
    so they travel fine — this pins that nothing in the builder mangles or drops them, since the
    announcement body is the one string here the owner writes freehand."""
    body = "Update — with a curly ’ and the \U0001f49b from the invite."
    message = build_announcement(
        to_email="ana@example.com", subject="s", body=body, from_email="hello@issei.app"
    )
    assert body in message.get_content()
    # And it can actually be serialised for SES, which is the step that would fail on a bad charset.
    assert b"Update" in message.as_bytes()


# --- refusing, rather than pretending ---


def test_the_unsubscribe_target_is_the_FEEDBACK_inbox_not_the_sender(monkeypatch):
    """THE DEFECT BOTH GATES FOUND, pinned so it cannot come back.

    The header pointed at `SENDER_EMAIL`, and prod sets that to `noreply@issei.app` — so a person
    tapping their mail client's Unsubscribe mailed a box nobody reads, stayed on the list, and
    believed they had left it. The single promise this feature makes, failing silently, for the only
    person who used the mechanism the whole `send_raw_email` path exists for.

    It now points at `feedback_recipient()`: the address #101 already sends real user feedback to,
    i.e. one there is a reason to read. That fixes the VARIABLE — the deployed VALUE is a separate
    problem, which the next test covers.
    """
    from app.services import email as email_service

    monkeypatch.setattr(email_service.settings, "sender_email", "noreply@issei.app")
    monkeypatch.setattr(email_service.settings, "feedback_notify_email", "hello@issei.app")
    assert unsubscribe_address() == "hello@issei.app"
    assert announcement_sender() == "noreply@issei.app"


def test_a_noreply_address_is_recognised_as_unmonitored():
    """What the send script refuses on. A heuristic, used only to REFUSE — never to rewrite an
    address — because the alternative to a heuristic here is nothing, and nothing is how the first
    version shipped a `noreply@` unsubscribe target with a comment explaining why that was wrong.

    `FEEDBACK_NOTIFY_EMAIL` is ABSENT from the prod task definition, so `unsubscribe_address()` falls
    back to `SENDER_EMAIL` and lands on `noreply@` regardless of the fix above. The refusal is what
    stops a broadcast going out on a promise it cannot keep.
    """
    for bad in ("noreply@issei.app", "no-reply@issei.app", "NoReply@issei.app", "do.not.reply@x.com"):
        assert looks_unmonitored(bad), bad
    for good in ("hello@issei.app", "charlie@example.com", "feedback@issei.app"):
        assert not looks_unmonitored(good), good


def test_it_RAISES_with_no_sender_configured_rather_than_no_opping(monkeypatch):
    """DELIBERATELY THE OPPOSITE of `send_feedback_notification`, which degrades to a logged no-op.

    The difference is the caller. That one runs inside a user-facing write, where a silent skip is
    the kind thing to do — a note that saved fine must not surface as an error. This one is called
    by a script whose entire output is "who did this reach", and a script reporting "sent to 14
    people" having sent to nobody is worse than a script that stops. Same reasoning `services/push.py`
    records for why IT degrades and `email.py` does not.
    """
    from app.services import email as email_service

    monkeypatch.setattr(email_service.settings, "sender_email", "")
    assert announcement_sender() == ""
    with pytest.raises(AnnouncementUnavailable):
        send_announcement(to_email="ana@example.com", subject="s", body="b")


def test_a_single_recipient_failure_returns_False_instead_of_raising(monkeypatch):
    """One bad address must not strand the rest of the list. In the SES sandbox EVERY unverified
    recipient fails this way, so this is the normal case until production access is granted — the
    script counts these and reports them at the end rather than aborting on the first."""
    from botocore.exceptions import ClientError

    from app.services import email as email_service

    monkeypatch.setattr(email_service.settings, "sender_email", "hello@issei.app")

    class _Refusing:
        def send_raw_email(self, **kwargs):
            raise ClientError(
                {"Error": {"Code": "MessageRejected", "Message": "not verified"}}, "SendRawEmail"
            )

    email_service._ses_client.cache_clear()
    monkeypatch.setattr(email_service.boto3, "client", lambda *a, **k: _Refusing())
    assert send_announcement(to_email="ana@example.com", subject="s", body="b") is False


def test_a_successful_send_reports_True_and_passes_the_raw_message(monkeypatch):
    """The one shape of the SES call itself that a test can reach: that it goes through
    `send_raw_email` with the built MIME bytes, not `send_email`. If someone "simplifies" this back
    to `send_email` the unsubscribe headers vanish silently — the mail still sends, so nothing else
    would notice."""
    from app.services import email as email_service

    monkeypatch.setattr(email_service.settings, "sender_email", "noreply@issei.app")
    monkeypatch.setattr(email_service.settings, "feedback_notify_email", "hello@issei.app")
    email_service._ses_client.cache_clear()
    captured = {}

    class _Accepting:
        def send_raw_email(self, **kwargs):
            captured.update(kwargs)
            return {"MessageId": "m-1"}

    monkeypatch.setattr(email_service.boto3, "client", lambda *a, **k: _Accepting())
    assert send_announcement(to_email="ana@example.com", subject="s", body="b") is True
    assert captured["Source"] == "noreply@issei.app"
    assert captured["Destinations"] == ["ana@example.com"]
    raw = captured["RawMessage"]["Data"]
    # The URI, not just the header name — see the serialisation test above for why that distinction
    # is the whole point.
    assert b"<mailto:" in raw
    assert b"List-Unsubscribe-Post" not in raw
