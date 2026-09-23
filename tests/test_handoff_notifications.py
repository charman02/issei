"""The handoff finally tells someone — both halves of it.

Until this shipped, `handoff_recipe`, `accept_handoff` and `claim_invite` called `notify()` a
combined ZERO times. The app's signature act — one person sending one recipe to one person — was
the only act in the product with no notification at all: the grant appeared on a Kept shelf and
nothing said so, and the sender never learned whether it landed.

Two types, addressed in opposite directions:

  recipe_arrived   → the RECIPIENT: someone wanted you to have this.
  recipe_claimed   → the COOK: the person you sent it to has it now.

What these tests are really guarding is the ONCE-NESS of each. Three code paths claim a grant and
all of them are idempotent by design, so the interesting failures are not "no notification" but
"a notification every time someone re-opens the link", which would turn the app's warmest signal
into its most annoying one.
"""


def _recipe(client, headers, name="Adobo", visibility="private"):
    r = client.post(
        "/recipes",
        json={"name": name, "visibility": visibility, "steps": [{"content": "Cook", "position": 1}]},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _inbox(client, headers, type=None):
    rows = client.get("/notifications", headers=headers).json()["notifications"]
    return [n for n in rows if type is None or n["type"] == type]


# --- the recipient learns it arrived ---


def test_handing_a_recipe_to_a_person_tells_them(client, make_user):
    cook, ch = make_user(first_name="Lola")
    friend, fh = make_user(first_name="Ana")
    recipe = _recipe(client, ch, name="Adobo")

    r = client.post(
        f"/recipes/{recipe['id']}/handoff", json={"to_user_id": friend.id}, headers=ch
    )
    assert r.status_code == 201, r.text

    rows = _inbox(client, fh, "recipe_arrived")
    assert len(rows) == 1
    assert rows[0]["actor_first_name"] == "Lola"
    assert rows[0]["subject"] == "Adobo"
    # The recipient holds an ACCEPTED grant, so the notification's link is openable. This is the
    # reason the arrival is only written on this path — see the next test.
    assert rows[0]["recipe_id"] == recipe["id"]
    assert client.get(f"/recipes/{recipe['id']}", headers=fh).status_code == 200


def test_an_email_addressed_handoff_REACHES_an_address_that_already_has_an_account(
    client, make_user, db_session
):
    """THE FIX. This test previously asserted the opposite, and the thing it asserted was a bug.

    An email-addressed handoff used to be stored `pending` with `to_user_id` NULL no matter who
    the address belonged to. For an address with NO account that is right — signup's auto-accept
    claims it later. For an address that ALREADY has an account it was a dead row: `GET
    /recipes/shared` filters on `to_user_id`, `can_view`'s grant branch requires both `accepted`
    and a matching `to_user_id`, and the auto-accept ran at their signup, long before this row
    existed. So the app's signature act silently delivered nothing, and #107 correctly declined to
    notify about it because the notification would have linked to a 404.

    The address now resolves to the account and the grant is bound and accepted, which is exactly
    what the `to_user_id` path has always done — the sender addressed a person, and the app knows
    who that is.
    """
    cook, ch = make_user()
    other, oh = make_user()
    recipe = _recipe(client, ch)

    r = client.post(
        f"/recipes/{recipe['id']}/handoff", json={"to_email": other.email}, headers=ch
    )
    assert r.status_code == 201, r.text
    assert r.json()["state"] == "accepted"
    # It arrives in all three places a handed-over recipe is supposed to arrive.
    assert [r["id"] for r in client.get("/recipes/shared", headers=oh).json()] == [recipe["id"]]
    assert client.get(f"/recipes/{recipe['id']}", headers=oh).status_code == 200
    assert len(_inbox(client, oh, "recipe_arrived")) == 1


def test_an_email_addressed_handoff_to_a_STRANGER_still_waits_for_their_signup(
    client, make_user
):
    """The other half, unchanged, and the reason the fix is a resolution rather than a rewrite.

    An address with no account behind it has nobody to bind to, so it stays a pending invite and
    `routers/auth.py` claims it at signup (#88's rule: an invite minted before a restriction stays
    claimable). And nobody is notified, because there is no inbox yet — which is the case #107's
    silence was actually written for.
    """
    cook, ch = make_user()
    recipe = _recipe(client, ch)

    r = client.post(
        f"/recipes/{recipe['id']}/handoff",
        json={"to_email": "nobody-here-yet@example.com"},
        headers=ch,
    )
    assert r.status_code == 201, r.text
    assert r.json()["state"] == "pending"
    assert r.json()["to_user_id"] is None


def test_the_address_is_matched_case_INSENSITIVELY_on_both_halves(client, make_user):
    """A second defect in the same family, found reading the fix into `routers/auth.py`.

    `handoff_recipe` already lower-cased the address for its permission checks (#105 — otherwise
    "Only friends can send me recipes" was one shift key from doing nothing), but signup's
    auto-accept compared `Handoff.to_email == new_user.email` exactly. So a sender who typed
    "Ana@x.com" for "ana@x.com" minted a row no signup would ever claim: the same dead grant by a
    different route. An email address is case-insensitive in the part that matters here, and the
    two halves of one feature must not disagree about it.
    """
    cook, ch = make_user()
    other, oh = make_user()
    recipe = _recipe(client, ch)

    r = client.post(
        f"/recipes/{recipe['id']}/handoff",
        json={"to_email": other.email.upper()},
        headers=ch,
    )
    assert r.status_code == 201, r.text
    assert r.json()["state"] == "accepted"
    assert len(_inbox(client, oh, "recipe_arrived")) == 1


def test_re_sending_to_the_same_address_returns_the_SAME_grant(client, make_user):
    """The dedupe key moved with the fix, and this is what stops that becoming a duplicate.

    The idempotency check used to look for a row matching `to_email` on this path and now looks for
    one matching the resolved `to_user_id`. A sender who hands the same recipe to the same address
    twice must still get one grant and the recipient one notification — the same guarantee the
    `to_user_id` path has.
    """
    cook, ch = make_user()
    other, oh = make_user()
    recipe = _recipe(client, ch)

    first = client.post(
        f"/recipes/{recipe['id']}/handoff", json={"to_email": other.email}, headers=ch
    )
    second = client.post(
        f"/recipes/{recipe['id']}/handoff", json={"to_email": other.email}, headers=ch
    )
    assert first.json()["id"] == second.json()["id"]
    assert len(_inbox(client, oh, "recipe_arrived")) == 1


def test_an_ALREADY_PENDING_email_row_is_still_deduped_after_the_fix(
    client, make_user, db_session
):
    """THE MIGRATION HAZARD, pinned as a test rather than trusted to a migration.

    Rows minted before this fix sit in the database `pending` with `to_email` set and `to_user_id`
    NULL. The new idempotency lookup keys on `to_user_id`, so on its own it would miss such a row
    and mint a SECOND grant for the same (recipe, person) — two rows where the whole route promises
    one. So the check looks for either shape.
    """
    from app.models.handoff import Handoff

    cook, ch = make_user()
    other, oh = make_user()
    recipe = _recipe(client, ch)
    # Exactly the shape the old code wrote.
    db_session.add(
        Handoff(
            recipe_id=recipe["id"],
            from_user_id=cook.id,
            to_user_id=None,
            to_email=other.email,
            state="pending",
            token="legacy-token-for-a-pre-fix-row",
        )
    )
    db_session.commit()

    r = client.post(
        f"/recipes/{recipe['id']}/handoff", json={"to_email": other.email}, headers=ch
    )
    assert r.status_code == 201, r.text
    rows = (
        db_session.query(Handoff)
        .filter(Handoff.recipe_id == recipe["id"], Handoff.from_user_id == cook.id)
        .all()
    )
    assert len(rows) == 1, "a pre-fix pending row must be found, not duplicated"


def test_handing_a_recipe_to_YOURSELF_notifies_nobody(client, make_user):
    """notify()'s self-guard, exercised through the one route that can reach it: a cook is
    allowed to hand their own recipe to themselves, and must not be told about it."""
    cook, ch = make_user()
    recipe = _recipe(client, ch)
    assert (
        client.post(
            f"/recipes/{recipe['id']}/handoff", json={"to_user_id": cook.id}, headers=ch
        ).status_code
        == 201
    )
    assert _inbox(client, ch, "recipe_arrived") == []


def test_re_sending_the_same_recipe_does_not_notify_twice(client, make_user):
    """The endpoint is idempotent per (recipe, grantee) — it returns the existing grant. The
    notification has to be idempotent with it, or a sender tapping twice doubles the message."""
    cook, ch = make_user()
    friend, fh = make_user()
    recipe = _recipe(client, ch)
    for _ in range(3):
        client.post(
            f"/recipes/{recipe['id']}/handoff", json={"to_user_id": friend.id}, headers=ch
        )
    assert len(_inbox(client, fh, "recipe_arrived")) == 1


# --- the cook learns it landed ---


def test_claiming_an_invite_link_tells_the_cook(client, make_user):
    cook, ch = make_user(first_name="Lola")
    guest, gh = make_user(first_name="Ben")
    recipe = _recipe(client, ch, name="Sinigang")
    token = client.post(
        f"/recipes/{recipe['id']}/handoff", json={}, headers=ch
    ).json()["token"]

    assert client.post(f"/recipes/invite/{token}/claim", headers=gh).status_code == 200

    rows = _inbox(client, ch, "recipe_claimed")
    assert len(rows) == 1
    assert rows[0]["actor_first_name"] == "Ben"
    assert rows[0]["subject"] == "Sinigang"


def test_re_claiming_the_same_link_does_not_tell_the_cook_again(client, make_user):
    """`claim_invite` is idempotent, and its first branch serves BOTH the first claim and a
    re-claim by the same person. The notification hangs off `to_user_id is None`, which is the
    only thing that distinguishes them — if that test regresses, every re-open of the link
    pings the cook again."""
    cook, ch = make_user()
    guest, gh = make_user()
    recipe = _recipe(client, ch)
    token = client.post(f"/recipes/{recipe['id']}/handoff", json={}, headers=ch).json()["token"]

    for _ in range(4):
        assert client.post(f"/recipes/invite/{token}/claim", headers=gh).status_code == 200
    assert len(_inbox(client, ch, "recipe_claimed")) == 1


def test_a_second_person_on_the_same_link_is_a_second_notification(client, make_user):
    """One link shared with several people works for all of them (each gets their own grant),
    and the cook hears about each — that is information, not noise: they put the link into the
    world and these are the people who took it up."""
    cook, ch = make_user()
    first, fh = make_user(first_name="Ana")
    second, sh = make_user(first_name="Ben")
    recipe = _recipe(client, ch)
    token = client.post(f"/recipes/{recipe['id']}/handoff", json={}, headers=ch).json()["token"]

    client.post(f"/recipes/invite/{token}/claim", headers=fh)
    client.post(f"/recipes/invite/{token}/claim", headers=sh)

    names = {n["actor_first_name"] for n in _inbox(client, ch, "recipe_claimed")}
    assert names == {"Ana", "Ben"}


def test_SIGNING_UP_on_an_emailed_invite_tells_the_cook_once(client, make_user, db_session):
    """THE FOUNDING SHAPE: you send a recipe to someone who is not on issei, and they join for that
    dish. Its docstring used to claim this and its setup did something else.

    It called `make_user` for the recipient FIRST and then reached `accept_handoff` explicitly —
    which only worked BECAUSE of the grant-binding bug. With that fixed, an address that already has
    an account is granted instantly and there is nothing left to accept, so the only way a pending
    email invite is ever claimed is signup's auto-accept. Which did not notify anyone, so fixing the
    send side would have silently taken the cook's "it landed" signal away. This is that path, for
    real: no account, then a signup.
    """
    from app.models.handoff import Handoff

    cook, ch = make_user(first_name="Lola")
    recipe = _recipe(client, ch, name="Kare-kare")
    client.post(
        f"/recipes/{recipe['id']}/handoff", json={"to_email": "ben@example.com"}, headers=ch
    )
    handoff = db_session.query(Handoff).filter(Handoff.to_email == "ben@example.com").first()
    assert handoff is not None and handoff.state == "pending"

    r = client.post(
        "/auth/signup",
        json={
            "email": "ben@example.com",
            "password": "pw123456",
            "first_name": "Ben",
            "last_name": "Cruz",
        },
    )
    assert r.status_code == 201, r.text

    rows = _inbox(client, ch, "recipe_claimed")
    assert len(rows) == 1
    assert rows[0]["actor_first_name"] == "Ben"
    assert rows[0]["subject"] == "Kare-kare"
    # And the recipe genuinely reached them, which is the point of the claim.
    db_session.expire_all()
    claimed = db_session.query(Handoff).filter(Handoff.id == handoff.id).first()
    assert claimed.state == "accepted" and claimed.to_user_id is not None


def test_claiming_your_OWN_invite_tells_nobody(client, make_user):
    """A cook opening their own link — notify()'s self-guard again, on the other type."""
    cook, ch = make_user()
    recipe = _recipe(client, ch)
    token = client.post(f"/recipes/{recipe['id']}/handoff", json={}, headers=ch).json()["token"]
    assert client.post(f"/recipes/invite/{token}/claim", headers=ch).status_code == 200
    assert _inbox(client, ch, "recipe_claimed") == []


# --- a block, which these two routes deliberately do not check ---
#
# #88's locked decision is that a token minted BEFORE a block stays CLAIMABLE — the token is the
# capability and the cook chose to send it — so `claim_invite` and `accept_handoff` carry no block
# check at all. That was harmless while they called `notify()` zero times. Making them producers
# turned the exemption into a channel from a blocked person into the blocker's inbox, carrying
# their name and photo, and onto their lock screen where nothing can take it back. Reproduced by
# the ship gate, which is the only reason these tests exist.
#
# The claim still succeeds. Only the telling is suppressed.


def _block(client, headers, user_id):
    r = client.post("/friends/blocks", json={"user_id": user_id}, headers=headers)
    assert r.status_code in (201, 204), r.text


def test_a_blocked_person_claiming_a_link_does_NOT_reach_the_cooks_inbox(client, make_user):
    cook, ch = make_user()
    guest, gh = make_user(first_name="Bruno")
    recipe = _recipe(client, ch, name="Kare-kare")
    token = client.post(f"/recipes/{recipe['id']}/handoff", json={}, headers=ch).json()["token"]
    _block(client, ch, guest.id)

    # #88: the pre-block token still works. That must not change.
    assert client.post(f"/recipes/invite/{token}/claim", headers=gh).status_code == 200
    # ...but the cook is not told, and their name does not appear anywhere the cook can see.
    assert _inbox(client, ch, "recipe_claimed") == []
    assert "Bruno" not in str(client.get("/notifications", headers=ch).json())


def test_a_blocked_person_accepting_an_emailed_invite_does_NOT_reach_the_cooks_inbox(
    client, make_user, db_session
):
    """The `accept_handoff` path — the second of the three claim sites, and now reachable only for a
    LEGACY row, which is why this sets one up by hand rather than through the route.

    `handoff_recipe` no longer leaves a grant pending for an address that has an account, and a
    brand-new account cannot be blocked by anyone, so nothing the app writes today can produce
    "blocked person accepts a pending email invite". Rows written before that fix still can, and the
    route still serves them — so the #88 exemption it carries (a pre-block invite stays claimable)
    and the #107 suppression on top of it both still need pinning. Constructing the row directly is
    the honest way to reach the case; going through the route would test a shape the route no longer
    writes and quietly stop covering the block.
    """
    from app.models.handoff import Handoff

    cook, ch = make_user()
    guest, gh = make_user(first_name="Bruno")
    recipe = _recipe(client, ch)
    handoff = Handoff(
        recipe_id=recipe["id"],
        from_user_id=cook.id,
        to_user_id=None,
        to_email=guest.email,
        state="pending",
        token="legacy-pending-row-for-an-existing-account",
    )
    db_session.add(handoff)
    db_session.commit()
    _block(client, ch, guest.id)

    assert client.post(f"/recipes/handoffs/{handoff.id}/accept", headers=gh).status_code == 200
    assert _inbox(client, ch, "recipe_claimed") == []


def test_the_block_works_in_the_OTHER_direction_too(client, make_user):
    """`is_blocked` matches either order, and it has to here: the harassment shape is a blocked
    person reaching the blocker, and either of them may have been the one to block."""
    cook, ch = make_user()
    guest, gh = make_user(first_name="Bruno")
    recipe = _recipe(client, ch)
    token = client.post(f"/recipes/{recipe['id']}/handoff", json={}, headers=ch).json()["token"]
    # The GUEST blocks the cook this time.
    _block(client, gh, cook.id)

    assert client.post(f"/recipes/invite/{token}/claim", headers=gh).status_code == 200
    assert _inbox(client, ch, "recipe_claimed") == []


def test_an_unblocked_claim_still_tells_the_cook(client, make_user):
    """The other half — without this, "the block suppresses it" is indistinguishable from "the
    notification never fires"."""
    cook, ch = make_user()
    guest, gh = make_user(first_name="Ben")
    recipe = _recipe(client, ch, name="Adobo")
    token = client.post(f"/recipes/{recipe['id']}/handoff", json={}, headers=ch).json()["token"]

    assert client.post(f"/recipes/invite/{token}/claim", headers=gh).status_code == 200
    assert len(_inbox(client, ch, "recipe_claimed")) == 1


# --- the two types are not each other, and neither is `recipe_kept` ---


def test_an_arrival_is_not_a_fulfilment_and_a_claim_is_not_a_keep(client, make_user):
    """Four types now put a recipe in front of somebody, and the vocabulary only earns its keep
    if the rows are distinguishable. `request_fulfilled` answers an ask; `recipe_arrived` is
    unprompted. `recipe_kept` is an anonymous bookmark by a stranger; `recipe_claimed` names the
    person who accepted something you chose to send them."""
    from app.services.notifications import ANONYMOUS_TYPES, NOTIFICATION_TYPES

    assert {"recipe_arrived", "recipe_claimed"} <= NOTIFICATION_TYPES
    # Neither new type is anonymous — both are addressed acts between two people who know
    # which act it was.
    assert ANONYMOUS_TYPES == {"recipe_kept"}


# --- the two shapes a ship gate found the fix got wrong, at the ROUTE level ---


def test_an_AMBIGUOUS_address_delivers_to_NOBODY_rather_than_to_a_guess(
    client, make_user, db_session
):
    """THE WORST DEFECT THE FIX INTRODUCED, before this: a PRIVATE recipe delivered to the wrong
    account.

    `users.email` has a plain case-SENSITIVE unique index, signup's duplicate check is `==`, and
    `EmailStr` normalises only the domain — so `ANA@x.com` and `ana@x.com` are two independently
    loginable accounts. Binding the grant to a `.first()` over a `lower()` predicate meant the winner
    followed physical row order, and a gate reproduced the dish name, byline, story, per-step notes
    and photos landing on the case twin's shelf with a `recipe_arrived` naming the cook, while the
    person actually addressed got nothing and the sender saw "sent ✓".

    A tie now binds to nobody and stays a pending invite: the cook still holds the token, and
    delivering to a coin flip is the one outcome worse than not delivering.
    """
    from app.models.handoff import Handoff

    cook, ch = make_user()
    # NEITHER twin matches the typed address EXACTLY, which is what makes this a genuine tie. An
    # exact hit is unambiguous by definition (the column is unique) and is preferred — the test below
    # covers that path, and it is why this pair is spelled with two different mixed cases.
    twin_a, ah = make_user(email="TWIN@example.com")
    twin_b, bh = make_user(email="TwIn@example.com")
    recipe = _recipe(client, ch)

    r = client.post(
        f"/recipes/{recipe['id']}/handoff",
        json={"to_email": "twin@example.com"},
        headers=ch,
    )
    assert r.status_code == 201, r.text
    assert r.json()["state"] == "pending"
    assert r.json()["to_user_id"] is None
    # NEITHER account can read it, and neither was told anything.
    for headers in (ah, bh):
        assert client.get(f"/recipes/{recipe['id']}", headers=headers).status_code == 404
        assert client.get("/recipes/shared", headers=headers).json() == []
        assert _inbox(client, headers, "recipe_arrived") == []
    row = db_session.query(Handoff).filter(Handoff.recipe_id == recipe["id"]).one()
    assert row.to_user_id is None


def test_an_EXACT_address_match_wins_over_a_case_twin(client, make_user):
    """And the twin pair must not break the honest case. `users.email` is unique, so an exact match
    is by definition one account — preferring it makes the common path deterministic even when a twin
    exists, instead of falling into the tie above."""
    cook, ch = make_user()
    twin_upper, uh = make_user(email="ANA@example.com")
    ana, anah = make_user(email="ana@example.com")
    recipe = _recipe(client, ch)

    r = client.post(
        f"/recipes/{recipe['id']}/handoff", json={"to_email": "ana@example.com"}, headers=ch
    )
    assert r.status_code == 201, r.text
    assert r.json()["state"] == "accepted"
    assert r.json()["to_user_id"] == ana.id
    assert client.get(f"/recipes/{recipe['id']}", headers=anah).status_code == 200
    # The twin gained nothing.
    assert client.get(f"/recipes/{recipe['id']}", headers=uh).status_code == 404


def test_re_sending_does_NOT_hand_back_a_grant_bound_to_SOMEONE_ELSE(
    client, make_user, db_session
):
    """The dedupe's second disjunct must be constrained to UNBOUND rows.

    `claim_invite` sets `to_user_id` without clearing `to_email`, so a row can be accepted, bound to
    whoever actually held the link, and still carry the address it was sent to — the documented
    mismatched-email orphan flow, live in production. Matching on the stale address alone made a
    re-send return the CLAIMER's grant: the addressee got a 201 and nothing else, permanently, for
    that (recipe, address) pair — the exact defect this branch exists to remove, one shape over, with
    no in-app workaround since the client only ever sends `to_email`.
    """
    from app.models.handoff import Handoff

    cook, ch = make_user()
    claimer, clh = make_user()
    ben, bh = make_user()
    recipe = _recipe(client, ch)

    # A row bound to the claimer but still carrying Ben's address — what claim_invite leaves behind.
    db_session.add(
        Handoff(
            recipe_id=recipe["id"],
            from_user_id=cook.id,
            to_user_id=claimer.id,
            to_email=ben.email,
            state="accepted",
            token="tok-orphan-route",
        )
    )
    db_session.commit()

    r = client.post(
        f"/recipes/{recipe['id']}/handoff", json={"to_email": ben.email}, headers=ch
    )
    assert r.status_code == 201, r.text
    # Ben gets his OWN grant, and it actually works.
    assert r.json()["to_user_id"] == ben.id
    assert r.json()["state"] == "accepted"
    assert client.get(f"/recipes/{recipe['id']}", headers=bh).status_code == 200
    assert len(_inbox(client, bh, "recipe_arrived")) == 1
    # The claimer keeps theirs.
    assert client.get(f"/recipes/{recipe['id']}", headers=clh).status_code == 200


def test_accepting_a_legacy_invite_TWICE_tells_the_cook_once(client, make_user, db_session):
    """Coverage the rewrite dropped: nothing called `/recipes/handoffs/{id}/accept` twice any more,
    so its `was_unaccepted` guard had no repeat-call test. The route only serves pre-fix rows now, so
    the row is built by hand — but a double tap on a slow connection is exactly the case the guard
    exists for, and a second `recipe_claimed` would be the flood `dedupe` is meant to prevent."""
    from app.models.handoff import Handoff

    cook, ch = make_user(first_name="Lola")
    guest, gh = make_user(first_name="Ben")
    recipe = _recipe(client, ch, name="Kare-kare")
    row = Handoff(
        recipe_id=recipe["id"],
        from_user_id=cook.id,
        to_user_id=None,
        to_email=guest.email,
        state="pending",
        token="tok-legacy-repeat",
    )
    db_session.add(row)
    db_session.commit()

    for _ in range(3):
        assert client.post(f"/recipes/handoffs/{row.id}/accept", headers=gh).status_code == 200

    rows = _inbox(client, ch, "recipe_claimed")
    assert len(rows) == 1
    assert rows[0]["actor_first_name"] == "Ben"
