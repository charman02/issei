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


def test_an_EMAIL_addressed_handoff_notifies_nobody_because_nobody_could_open_it(
    client, make_user, db_session
):
    """A pending email invite is not a delivery, and must not be announced as one.

    `handoff_recipe` leaves an email-addressed grant `pending` with `to_user_id` NULL, and
    `can_view`'s grant branch requires BOTH accepted and a matching `to_user_id`. So the person
    cannot read the recipe yet, and a "wanted you to have Adobo" line linking to a 404 would be
    worse than silence.

    THIS TEST ALSO DOCUMENTS A REAL BUG IT IS NOT FIXING: the grant below is unreachable in-app
    forever for an address that ALREADY has an account, because `GET /recipes/shared` filters on
    `to_user_id` and the signup auto-accept in `routers/auth.py` ran at their signup, long before
    this row existed. The only way in is the sender texting the invite link. Fixing that means
    changing what `handoff_recipe` STORES, which is deliberately fenced off in its own comments —
    see TECHDEBT. If that fix lands, this test SHOULD flip to expecting a notification.
    """
    cook, ch = make_user()
    other, oh = make_user()
    recipe = _recipe(client, ch)

    r = client.post(
        f"/recipes/{recipe['id']}/handoff", json={"to_email": other.email}, headers=ch
    )
    assert r.status_code == 201, r.text
    assert r.json()["state"] == "pending"
    assert _inbox(client, oh, "recipe_arrived") == []
    # The half of the claim that is the bug, pinned so the fix is visible when it happens.
    assert client.get("/recipes/shared", headers=oh).json() == []


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


def test_accepting_an_emailed_invite_tells_the_cook_once(client, make_user, db_session):
    """The `accept_handoff` path. Reached here by signing up with the invited address, which is
    the auto-accept in routers/auth.py — so this also covers the case where the recipient did
    not exist when the recipe was sent, the founding shape of the whole product."""
    from app.models.handoff import Handoff

    cook, ch = make_user(first_name="Lola")
    guest, gh = make_user(first_name="Ben")
    recipe = _recipe(client, ch, name="Kare-kare")
    client.post(f"/recipes/{recipe['id']}/handoff", json={"to_email": guest.email}, headers=ch)
    handoff = db_session.query(Handoff).filter(Handoff.to_email == guest.email).first()
    assert handoff is not None and handoff.state == "pending"

    for _ in range(3):
        assert client.post(f"/recipes/handoffs/{handoff.id}/accept", headers=gh).status_code == 200

    rows = _inbox(client, ch, "recipe_claimed")
    assert len(rows) == 1
    assert rows[0]["actor_first_name"] == "Ben"
    assert rows[0]["subject"] == "Kare-kare"


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
    """The `accept_handoff` path — the second of the three claim sites."""
    from app.models.handoff import Handoff

    cook, ch = make_user()
    guest, gh = make_user(first_name="Bruno")
    recipe = _recipe(client, ch)
    client.post(f"/recipes/{recipe['id']}/handoff", json={"to_email": guest.email}, headers=ch)
    handoff = db_session.query(Handoff).filter(Handoff.to_email == guest.email).first()
    assert handoff is not None
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
