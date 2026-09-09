"""Reporting a person for review (#87) — issei's second safety primitive.

The invariant that matters most here is the one that looks like an oversight: a BLOCK MUST NOT
GATE A REPORT. Every other people-returning route in `routers/friends.py` consults `is_blocked`,
so the natural thing is to add it here too — and that would make a harasser unreportable the
moment they block their victim.
"""

from app.models.report import Report


def _report(client, headers, user_id, reason="harassment", note=None):
    body = {"user_id": user_id, "reason": reason}
    if note is not None:
        body["note"] = note
    return client.post("/friends/reports", json=body, headers=headers)


def _rows(db, **filters):
    q = db.query(Report)
    for k, v in filters.items():
        q = q.filter(getattr(Report, k) == v)
    return q.all()


# --- the happy path ---


def test_reporting_someone_stores_one_row(client, make_user, db_session):
    reporter, rh = make_user()
    target, _ = make_user()
    r = _report(client, rh, target.id, reason="spam", note="  posting the same link over and over  ")
    assert r.status_code == 204
    assert r.content == b""

    rows = _rows(db_session, reported_user_id=target.id)
    assert len(rows) == 1
    assert rows[0].reporter_id == reporter.id
    assert rows[0].reason == "spam"
    # The note is stripped, like every other free-text field in the app.
    assert rows[0].note == "posting the same link over and over"
    assert rows[0].state == "open"


def test_a_reason_alone_is_a_valid_report(client, make_user, db_session):
    """No note required. Demanding an explanation is friction in front of someone upset."""
    _, rh = make_user()
    target, _ = make_user()
    assert _report(client, rh, target.id).status_code == 204
    assert _rows(db_session, reported_user_id=target.id)[0].note is None


def test_a_blank_note_is_stored_as_NULL_not_as_spaces(client, make_user, db_session):
    _, rh = make_user()
    target, _ = make_user()
    assert _report(client, rh, target.id, note="   ").status_code == 204
    assert _rows(db_session, reported_user_id=target.id)[0].note is None


def test_every_reason_in_the_vocabulary_is_accepted(client, make_user):
    from app.schemas.report import REPORT_REASONS

    _, rh = make_user()
    for reason in REPORT_REASONS:
        target, _ = make_user()
        assert _report(client, rh, target.id, reason=reason).status_code == 204, reason


def test_an_unknown_reason_is_refused_at_the_boundary(client, make_user):
    """A Literal, so a typo is a 422 rather than a mystery string a moderator has to decode."""
    _, rh = make_user()
    target, _ = make_user()
    assert _report(client, rh, target.id, reason="i_just_dont_like_them").status_code == 422


def test_a_too_long_note_is_refused(client, make_user):
    _, rh = make_user()
    target, _ = make_user()
    assert _report(client, rh, target.id, note="x" * 1001).status_code == 422
    assert _report(client, rh, target.id, note="x" * 1000).status_code == 204


# --- THE invariant: a block cannot hide someone from being reported ---


def test_you_can_report_someone_who_has_BLOCKED_YOU(client, make_user, db_session):
    """The case this endpoint exists for, and the one a stray `is_blocked` call would break.

    Someone harasses you, blocks you, and — if a block gated this route — becomes permanently
    unreportable. The block would have turned into cover for the person who earned it.
    """
    harasser, hh = make_user()
    victim, vh = make_user()
    assert client.post("/friends/blocks", json={"user_id": victim.id}, headers=hh).status_code == 204
    # The victim can no longer even see their profile...
    assert client.get(f"/friends/profile/{harasser.id}", headers=vh).status_code == 404
    # ...but can absolutely still report them.
    assert _report(client, vh, harasser.id, note="wouldn’t leave me alone").status_code == 204
    assert len(_rows(db_session, reported_user_id=harasser.id)) == 1


def test_you_can_report_someone_YOU_have_blocked(client, make_user, db_session):
    """The other order, which is the common one: block to make it stop, then report."""
    _, mine = make_user()
    them, _ = make_user()
    assert client.post("/friends/blocks", json={"user_id": them.id}, headers=mine).status_code == 204
    assert _report(client, mine, them.id).status_code == 204
    assert len(_rows(db_session, reported_user_id=them.id)) == 1


# --- silence ---


def test_reporting_notifies_NOBODY(client, make_user):
    """Telling the reported person turns a safety mechanism into an escalation trigger."""
    _, rh = make_user()
    target, th = make_user()
    _report(client, rh, target.id)
    assert client.get("/notifications", headers=th).json()["notifications"] == []
    assert client.get("/notifications", headers=rh).json()["notifications"] == []


def test_nothing_the_reported_person_can_read_changes(client, make_user):
    """No visible trace at all — a report is not a block and doesn't hide anyone from anyone."""
    reporter, rh = make_user()
    target, th = make_user()
    before = client.get(f"/friends/profile/{reporter.id}", headers=th).json()
    _report(client, rh, target.id)
    after = client.get(f"/friends/profile/{reporter.id}", headers=th).json()
    assert before == after
    # And the reporter still sees them exactly as before, too: reporting isn't blocking.
    assert client.get(f"/friends/profile/{target.id}", headers=rh).status_code == 200


# --- dedupe ---


def test_a_second_report_while_the_first_is_OPEN_is_not_stored(client, make_user, db_session):
    """Repeated taps must not flood the table; a moderator sees one row per grievance."""
    _, rh = make_user()
    target, _ = make_user()
    assert _report(client, rh, target.id, note="first").status_code == 204
    assert _report(client, rh, target.id, note="second").status_code == 204
    rows = _rows(db_session, reported_user_id=target.id)
    assert len(rows) == 1
    # The FIRST account is kept. A later duplicate must not overwrite what they originally said.
    assert rows[0].note == "first"


def test_the_caller_cannot_tell_a_duplicate_from_a_first_report(client, make_user):
    """Same 204 either way. "You already reported this person" makes someone doubt the first."""
    _, rh = make_user()
    target, _ = make_user()
    first = _report(client, rh, target.id)
    second = _report(client, rh, target.id)
    assert first.status_code == second.status_code == 204
    assert first.content == second.content == b""


def test_a_report_after_the_first_was_CLOSED_is_a_new_report(client, make_user, db_session):
    """It happened again. That's a new case, not a duplicate of a settled one."""
    _, rh = make_user()
    target, _ = make_user()
    _report(client, rh, target.id, note="round one")
    row = _rows(db_session, reported_user_id=target.id)[0]
    row.state = "closed"
    db_session.commit()

    assert _report(client, rh, target.id, note="round two").status_code == 204
    rows = _rows(db_session, reported_user_id=target.id)
    assert len(rows) == 2
    assert {r.note for r in rows} == {"round one", "round two"}


def test_two_different_people_reporting_the_same_person_are_two_rows(client, make_user, db_session):
    """The dedupe is per REPORTER. Three people reporting one account is the signal."""
    _, ah = make_user()
    _, bh = make_user()
    target, _ = make_user()
    _report(client, ah, target.id)
    _report(client, bh, target.id)
    assert len(_rows(db_session, reported_user_id=target.id)) == 2


# --- refusals ---


def test_you_cannot_report_yourself(client, make_user, db_session):
    """400, not 404: there's nothing to hide about your own existence, and a silent success
    would be a worse answer than an honest refusal."""
    me, mh = make_user()
    r = _report(client, mh, me.id)
    assert r.status_code == 400
    assert _rows(db_session) == []


def test_an_unknown_user_is_a_404(client, make_user, db_session):
    _, mh = make_user()
    assert _report(client, mh, 999999).status_code == 404
    assert _rows(db_session) == []


def test_reporting_requires_auth(client, make_user):
    target, _ = make_user()
    assert client.post(
        "/friends/reports", json={"user_id": target.id, "reason": "spam"}
    ).status_code == 401


def test_there_is_no_way_to_READ_reports_back(client, make_user):
    """No moderation endpoint, deliberately: it would need an admin role this app has no
    concept of, and inventing one so nobody has to open a database console is the larger
    mistake. If this ever 200s, someone added an endpoint without deciding who may call it."""
    _, mh = make_user()
    target, _ = make_user()
    _report(client, mh, target.id)
    assert client.get("/friends/reports", headers=mh).status_code in (404, 405)
