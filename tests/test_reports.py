"""Reporting a person for review (#87) — issei's second safety primitive.

The invariant that matters most here is the one that looks like an oversight: a BLOCK MUST NOT
GATE A REPORT. Every other people-returning route in `routers/friends.py` consults `is_blocked`,
so the natural thing is to add it here too — and that would make a harasser unreportable the
moment they block their victim.
"""

from app.models.report import Report


def _report(client, headers, user_id, reason="harassment", note=None, **subject):
    # **subject carries post_id / recipe_id (#87 part two). Kept as kwargs so every existing caller
    # is unchanged and a subject-less report stays the default shape.
    body = {"user_id": user_id, "reason": reason, **subject}
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


def test_a_second_report_APPENDS_to_the_open_one_instead_of_vanishing(client, make_user, db_session):
    """Still one row — but nothing the reporter typed is thrown away.

    The first version of this discarded the second submission, which is worse than it sounds:
    with no way to close a report, a genuinely NEW incident weeks later was dropped while the UI
    answered "Thanks — we'll take a look" about it. In the one flow where trust in the response
    is the whole reason someone uses it.
    """
    _, rh = make_user()
    target, _ = make_user()
    assert _report(client, rh, target.id, reason="spam", note="same link over and over").status_code == 204
    assert _report(client, rh, target.id, reason="harassment", note="now he's messaging me").status_code == 204

    rows = _rows(db_session, reported_user_id=target.id)
    assert len(rows) == 1, "still ONE case for whoever reads it, not a thread"
    note = rows[0].note
    # The original account survives, first...
    assert note.startswith("same link over and over")
    # ...and the escalation is recorded after it, with the newer reason stamped inline, because
    # spam becoming harassment is the most important thing a second report can say.
    assert "now he's messaging me" in note
    assert "harassment" in note
    # The row's own `reason` stays the first one; the escalation lives in the note.
    assert rows[0].reason == "spam"


def test_a_duplicate_with_NO_new_words_changes_nothing(client, make_user, db_session):
    """A double-tap, as opposed to a second account of something. Nothing to add, nothing to do."""
    _, rh = make_user()
    target, _ = make_user()
    _report(client, rh, target.id, note="first")
    _report(client, rh, target.id)  # no note
    rows = _rows(db_session, reported_user_id=target.id)
    assert len(rows) == 1
    assert rows[0].note == "first"


def test_the_accumulating_note_is_BOUNDED(client, make_user, db_session):
    """Appending is exactly the flooding the dedupe existed to stop, so it has a ceiling — and
    past it the EARLIEST accounts are the ones kept."""
    _, rh = make_user()
    target, _ = make_user()
    for i in range(12):
        assert _report(client, rh, target.id, note=f"{i}-" + "x" * 990).status_code == 204
    note = _rows(db_session, reported_user_id=target.id)[0].note
    assert len(note) <= 8000
    assert note.startswith("0-")


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


# --- naming the thing it is about (#87 part two) ---
#
# Guideline 1.2 asks for a way to report objectionable CONTENT as well as the people posting it, and
# these are the properties that make a content report worth having: the subject is recorded, it
# survives the content being deleted, it cannot be two things at once, and it opens its own case so a
# second bad post is not buried under an older complaint.


def _make_post(client, headers, dish="Adobo", visibility="public"):
    r = client.post(
        "/posts",
        json={
            "dish_name": dish,
            "photo_url": "https://res.cloudinary.com/demo/image/upload/a.jpg",
            "visibility": visibility,
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _make_recipe(client, headers, name="Adobo", visibility="public"):
    r = client.post(
        "/recipes",
        json={"name": name, "visibility": visibility, "steps": [{"content": "Cook", "position": 1}]},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_a_report_can_name_a_POST(client, make_user, db_session):
    reporter, rh = make_user()
    author, ah = make_user()
    post = _make_post(client, ah)

    assert _report(client, rh, author.id, reason="inappropriate", post_id=post["id"]).status_code == 204

    rows = _rows(db_session, reporter_id=reporter.id)
    assert len(rows) == 1
    assert rows[0].post_id == post["id"]
    assert rows[0].recipe_id is None
    # Still a report about a PERSON. The subject is why, not instead of who.
    assert rows[0].reported_user_id == author.id


def test_a_report_can_name_a_RECIPE(client, make_user, db_session):
    reporter, rh = make_user()
    author, ah = make_user()
    recipe = _make_recipe(client, ah)

    assert _report(client, rh, author.id, recipe_id=recipe["id"]).status_code == 204

    rows = _rows(db_session, reporter_id=reporter.id)
    assert len(rows) == 1
    assert rows[0].recipe_id == recipe["id"]
    assert rows[0].post_id is None


def test_a_report_naming_BOTH_a_post_and_a_recipe_is_refused(client, make_user):
    """422 at the boundary, not a router branch. "Which thing is this about" has to have an answer,
    and the person reading these has no interface in which to disambiguate two subjects."""
    reporter, rh = make_user()
    author, ah = make_user()
    post = _make_post(client, ah)
    recipe = _make_recipe(client, ah)

    r = _report(client, rh, author.id, post_id=post["id"], recipe_id=recipe["id"])
    assert r.status_code == 422, r.text


def test_a_subject_that_does_not_exist_is_refused(client, make_user):
    """Existence IS checked, because a report pointing at a row that never existed is noise in the one
    table a human reads. The 404 names the subject rather than the person: unlike the person case
    there is nothing to hide, since the reporter just tapped it."""
    reporter, rh = make_user()
    author, ah = make_user()

    assert _report(client, rh, author.id, post_id=999999).status_code == 404
    assert _report(client, rh, author.id, recipe_id=999999).status_code == 404


def test_visibility_is_NOT_checked_so_a_hidden_post_can_still_be_reported(
    client, make_user, db_session
):
    """THE RULE THAT LOOKS LIKE AN OVERSIGHT, which is why it has its own test — the same shape as the
    no-block-gate rule above, applied to content.

    A report is not a read. Someone sees a post in the feed, it is objectionable, and the author makes
    it private (or blocks the reporter) the moment after. `can_view_post` would then refuse, and the
    thing they saw would be permanently unreportable — the author's own action becoming cover. So no
    `can_view`, no `can_view_post`, no block filter: the id is recorded whether or not it still
    resolves for the reporter.
    """
    reporter, rh = make_user()
    author, ah = make_user()
    post = _make_post(client, ah, visibility="private")
    # Confirm the premise: the reporter genuinely cannot read it.
    assert client.get(f"/posts/{post['id']}", headers=rh).status_code == 404

    assert _report(client, rh, author.id, post_id=post["id"]).status_code == 204
    assert _rows(db_session, reporter_id=reporter.id)[0].post_id == post["id"]


def test_deleting_the_post_leaves_the_report_STANDING(client, make_user, db_session):
    """`SET NULL`, not CASCADE, and this is the decision the column shape exists for.

    Deleting the post is exactly what a person does when they have been reported for it. Under CASCADE
    the subject of a report would hold a delete button for the report itself. The reporter's words and
    the reported person both survive; only the pointer goes, leaving a report about a person — which is
    what every report on this table was before these columns existed.
    """
    reporter, rh = make_user()
    author, ah = make_user()
    post = _make_post(client, ah)
    assert _report(client, rh, author.id, note="this is vile", post_id=post["id"]).status_code == 204

    assert client.delete(f"/posts/{post['id']}", headers=ah).status_code in (200, 204)

    db_session.expire_all()
    rows = _rows(db_session, reporter_id=reporter.id)
    assert len(rows) == 1, "the report must outlive its subject"
    assert rows[0].post_id is None
    assert rows[0].note == "this is vile"
    assert rows[0].reported_user_id == author.id


# --- the dedupe key now includes the subject ---


def test_two_DIFFERENT_posts_by_the_same_person_are_two_cases(client, make_user, db_session):
    """THE CHANGE #87 part two made to the dedupe key, and the reason for it. Under the old key —
    (reporter, target) — the second report folded into the first and its subject survived only as
    prose in an appended note, so a fresh bad post was buried under an older unrelated complaint."""
    reporter, rh = make_user()
    author, ah = make_user()
    first = _make_post(client, ah, dish="One")
    second = _make_post(client, ah, dish="Two")

    assert _report(client, rh, author.id, post_id=first["id"]).status_code == 204
    assert _report(client, rh, author.id, post_id=second["id"]).status_code == 204

    rows = sorted(_rows(db_session, reporter_id=reporter.id), key=lambda r: r.id)
    assert len(rows) == 2
    assert [r.post_id for r in rows] == [first["id"], second["id"]]


def test_the_SAME_post_reported_twice_still_appends_to_one_case(client, make_user, db_session):
    """The flooding guard is unchanged for the case it was written for. Repeated taps on one thing
    accumulate into a single row; only a DIFFERENT subject opens a new one."""
    reporter, rh = make_user()
    author, ah = make_user()
    post = _make_post(client, ah)

    assert _report(client, rh, author.id, note="first account", post_id=post["id"]).status_code == 204
    assert (
        _report(
            client, rh, author.id, reason="harassment", note="it happened again", post_id=post["id"]
        ).status_code
        == 204
    )

    rows = _rows(db_session, reporter_id=reporter.id)
    assert len(rows) == 1
    assert "first account" in rows[0].note
    assert "it happened again" in rows[0].note
    # The later reason is stamped inline, which is the most important thing a second report can say.
    assert "[later — harassment]" in rows[0].note


def test_reporting_the_PERSON_is_its_own_case_separate_from_their_post(
    client, make_user, db_session
):
    """A person-report and a post-report are different grievances, so `post_id IS NULL` has to be part
    of the key rather than ignored. Getting this wrong in the obvious direction — skipping the NULL
    comparison when no subject is sent — would make a person-report append to whichever post-report
    happened to be open."""
    reporter, rh = make_user()
    author, ah = make_user()
    post = _make_post(client, ah)

    assert _report(client, rh, author.id, post_id=post["id"]).status_code == 204
    assert _report(client, rh, author.id, note="generally awful").status_code == 204

    rows = sorted(_rows(db_session, reporter_id=reporter.id), key=lambda r: r.id)
    assert len(rows) == 2
    assert rows[0].post_id == post["id"]
    assert rows[1].post_id is None
    assert rows[1].note == "generally awful"


def test_a_post_and_a_recipe_by_the_same_person_are_two_cases(client, make_user, db_session):
    reporter, rh = make_user()
    author, ah = make_user()
    post = _make_post(client, ah)
    recipe = _make_recipe(client, ah)

    assert _report(client, rh, author.id, post_id=post["id"]).status_code == 204
    assert _report(client, rh, author.id, recipe_id=recipe["id"]).status_code == 204

    rows = _rows(db_session, reporter_id=reporter.id)
    assert len(rows) == 2
    assert {r.post_id for r in rows} == {post["id"], None}
    assert {r.recipe_id for r in rows} == {recipe["id"], None}


def test_a_content_report_still_tells_the_author_NOTHING(client, make_user):
    """Decision 2, re-asserted on the new path. Telling someone they were reported turns a safety
    mechanism into an escalation trigger, and naming the specific post would be worse than naming
    nothing — it identifies exactly which of their things somebody objected to."""
    reporter, rh = make_user()
    author, ah = make_user()
    post = _make_post(client, ah)

    assert _report(client, rh, author.id, post_id=post["id"]).status_code == 204
    inbox = client.get("/notifications", headers=ah).json()
    assert inbox["notifications"] == []
    assert inbox["unread_count"] == 0


def test_a_BLOCK_still_does_not_gate_a_content_report(client, make_user, db_session):
    """Decision 1, on the new path. A harasser who posts something vile and then blocks their victim
    must not thereby make that post unreportable."""
    reporter, rh = make_user()
    author, ah = make_user()
    post = _make_post(client, ah)
    assert client.post("/friends/blocks", json={"user_id": reporter.id}, headers=ah).status_code in (
        201,
        204,
    )

    assert _report(client, rh, author.id, post_id=post["id"]).status_code == 204
    assert _rows(db_session, reporter_id=reporter.id)[0].post_id == post["id"]
