"""Every recipe field had a ceiling of NONE until now.

Not "a generous one" — none at all. No `max_length` in the schema, and no length on the column
either (`Mapped[str] = mapped_column()` infers an unlimited VARCHAR), so one request could store
a megabyte in a dish name and then every card in Browse would try to render it. A post's
dish name and description were bounded (120 / 500) and so were user names (80) — but a post's
PHOTO URL was not, which the docs audit caught after the first pass of this file went in.

The caps are deliberately generous. They exist to refuse abuse and protect the layout, not to
edit anyone, so these tests are written as PAIRS: the largest realistic value must be accepted,
and only past the wall is it refused. A test that only asserted the refusal would happily pass
against a cap of 10.
"""

from app.schemas.recipe import MAX_INGREDIENTS, MAX_SECTIONS, MAX_STEPS


def _recipe(**over):
    body = {
        "name": "Adobo",
        "steps": [{"content": "Cook it", "position": 1}],
    }
    body.update(over)
    return body


def _create(client, headers, **over):
    return client.post("/recipes", json=_recipe(**over), headers=headers)


def _at_and_over(client, headers, field, cap, **extra):
    """The cap accepts `cap` chars and refuses `cap + 1`."""
    ok = _create(client, headers, **{field: "x" * cap}, **extra)
    too_long = _create(client, headers, **{field: "x" * (cap + 1)}, **extra)
    return ok.status_code, too_long.status_code


# --- the scalar fields on a recipe ---


def test_dish_name_is_capped_at_120_matching_a_post(client, make_user):
    """120 because a post's `dish_name` is 120 and they name the same thing — a recipe written
    from the meal composer (#81) carries that value straight across, so a tighter cap here would
    reject something the composer had just accepted."""
    _, h = make_user()
    assert _at_and_over(client, h, "name", 120) == (201, 422)


def test_description_is_capped_at_500(client, make_user):
    _, h = make_user()
    assert _at_and_over(client, h, "description", 500) == (201, 422)


def test_the_story_gets_the_most_room_of_anything(client, make_user):
    """4000. This is the field that carries the person — the knowledge an ingredient list can't
    hold — so it is the last place to be stingy."""
    _, h = make_user()
    assert _at_and_over(client, h, "story", 4000) == (201, 422)


def test_notes_are_capped_at_2000(client, make_user):
    _, h = make_user()
    assert _at_and_over(client, h, "notes", 2000) == (201, 422)


def test_source_is_capped_like_a_persons_name(client, make_user):
    """80, the same ceiling as `User.first_name`, because that is what this field holds."""
    _, h = make_user()
    assert _at_and_over(client, h, "source", 80) == (201, 422)


def test_cuisine_and_diet_are_capped_at_60(client, make_user):
    _, h = make_user()
    assert _at_and_over(client, h, "cuisine", 60) == (201, 422)
    assert _at_and_over(client, h, "diet", 60) == (201, 422)


def test_an_image_url_is_bounded(client, make_user):
    """A user-supplied string rendered into an `<img src>` is a place to hide a payload. Real
    Cloudinary URLs are ~120 chars; 500 is slack, not an invitation."""
    _, h = make_user()
    assert _at_and_over(client, h, "cover_photo_url", 500) == (201, 422)


def test_servings_and_prep_time_cannot_be_absurd_or_negative(client, make_user):
    _, h = make_user()
    assert _create(client, h, servings=1000).status_code == 201
    assert _create(client, h, servings=1001).status_code == 422
    assert _create(client, h, servings=-1).status_code == 422
    assert _create(client, h, prep_time_minutes=-5).status_code == 422


# --- children: steps, ingredients, sections ---


def test_a_step_and_its_note_are_capped_at_2000_each(client, make_user):
    _, h = make_user()
    long_step = [{"content": "x" * 2000, "position": 1}]
    assert _create(client, h, steps=long_step).status_code == 201
    assert _create(client, h, steps=[{"content": "x" * 2001, "position": 1}]).status_code == 422
    ok_note = [{"content": "Cook", "position": 1, "voice_note": "x" * 2000}]
    assert _create(client, h, steps=ok_note).status_code == 201
    bad_note = [{"content": "Cook", "position": 1, "voice_note": "x" * 2001}]
    assert _create(client, h, steps=bad_note).status_code == 422


def test_an_ingredient_name_amount_and_unit_are_capped(client, make_user):
    _, h = make_user()

    def ing(**over):
        base = {"name": "Salt", "position": 1}
        base.update(over)
        return _create(client, h, ingredients=[base]).status_code

    assert ing(name="x" * 120) == 201
    assert ing(name="x" * 121) == 422
    # The amount as the person wrote it — "3 soup spoons", "a good splash". Never normalized,
    # so it has to survive verbatim whatever it holds; 60 is roomy for any real one.
    assert ing(quantity_text="x" * 60) == 201
    assert ing(quantity_text="x" * 61) == 422
    assert ing(unit="x" * 40) == 201
    assert ing(unit="x" * 41) == 422
    assert ing(notes="x" * 300) == 201
    assert ing(notes="x" * 301) == 422


def test_the_NUMBER_of_ingredients_and_steps_is_capped_too(client, make_user):
    """The other shape of the same abuse, and the one a length cap alone doesn't touch: a
    hundred thousand ingredients of one character each. A recipe with more than a hundred of
    either is not a recipe."""
    _, h = make_user()
    many_ing = [{"name": "Salt", "position": i} for i in range(MAX_INGREDIENTS)]
    assert _create(client, h, ingredients=many_ing).status_code == 201
    assert _create(client, h, ingredients=many_ing + [{"name": "One more", "position": 999}]).status_code == 422

    many_steps = [{"content": "Cook", "position": i} for i in range(MAX_STEPS)]
    assert _create(client, h, steps=many_steps).status_code == 201
    assert _create(client, h, steps=many_steps + [{"content": "More", "position": 999}]).status_code == 422


def test_the_number_of_sections_is_capped(client, make_user):
    _, h = make_user()
    secs = [{"name": f"Part {i}", "position": i} for i in range(MAX_SECTIONS)]
    assert _create(client, h, ingredient_sections=secs).status_code == 201
    assert _create(client, h, ingredient_sections=secs + [{"name": "Extra", "position": 99}]).status_code == 422


def test_a_sections_OWN_ingredient_list_is_capped_too(client, make_user):
    """The nested door. `IngredientSectionCreate` carries its own `ingredients`, so capping only
    the top-level list would leave the same abuse available one level down."""
    _, h = make_user()
    packed = [{"name": "Salt", "position": i} for i in range(MAX_INGREDIENTS)]
    ok = [{"name": "Part 1", "position": 1, "ingredients": packed}]
    assert _create(client, h, ingredient_sections=ok).status_code == 201
    over = [{"name": "Part 1", "position": 1, "ingredients": packed + [{"name": "x", "position": 999}]}]
    assert _create(client, h, ingredient_sections=over).status_code == 422


# --- the edit path has to agree with the create path, field for field ---


def test_editing_accepts_exactly_what_creating_accepts(client, make_user):
    """They have to match. An edit that accepted MORE than a create would be a way in; one that
    accepted LESS would make an already-saved recipe unsavable — you'd open the edit form on your
    own recipe and be unable to submit it."""
    _, h = make_user()
    rid = _create(client, h, name="x" * 120, story="y" * 4000).json()["id"]

    # Re-submitting the values that were accepted at create time must still work.
    assert client.patch(
        f"/recipes/{rid}", json={"name": "x" * 120, "story": "y" * 4000}, headers=h
    ).status_code == 200
    # And the wall is in the same place.
    assert client.patch(f"/recipes/{rid}", json={"name": "x" * 121}, headers=h).status_code == 422
    assert client.patch(f"/recipes/{rid}", json={"story": "y" * 4001}, headers=h).status_code == 422
    assert client.patch(
        f"/recipes/{rid}", json={"steps": [{"content": "x" * 2001, "position": 1}]}, headers=h
    ).status_code == 422


def test_cooking_a_recipe_has_a_bounded_note(client, make_user):
    _, h = make_user()
    rid = _create(client, h).json()["id"]
    assert client.post(f"/recipes/{rid}/cook", json={"note": "x" * 2000}, headers=h).status_code in (200, 201)
    assert client.post(f"/recipes/{rid}/cook", json={"note": "x" * 2001}, headers=h).status_code == 422


def test_the_origin_block_is_bounded_without_becoming_required(client, make_user):
    """`OriginIn.name` accepts "" today and `test_sharing_api` depends on it. Capping a field is
    not the same decision as requiring one, and only the first was asked for."""
    _, h = make_user()
    assert _create(client, h, origin={"name": ""}).status_code == 201
    assert _create(client, h, origin={"name": "x" * 120}).status_code == 201
    assert _create(client, h, origin={"name": "x" * 121}).status_code == 422
    assert _create(client, h, origin={"name": "Lola", "memory": "x" * 2000}).status_code == 201
    assert _create(client, h, origin={"name": "Lola", "memory": "x" * 2001}).status_code == 422


# --- what was already bounded, so a regression there is visible too ---


def test_the_fields_that_already_had_caps_still_do(client, make_user):
    _, h = make_user()
    assert client.post(
        "/posts", json={"photo_url": "https://img.test/a.jpg", "dish_name": "x" * 120}, headers=h
    ).status_code == 201
    assert client.post(
        "/posts", json={"photo_url": "https://img.test/a.jpg", "dish_name": "x" * 121}, headers=h
    ).status_code == 422
    assert client.post(
        "/recipes/parse", json={"text": "x" * 8001}, headers=h
    ).status_code == 422


# --- the two URL fields the first pass missed (caught by the docs audit) ---


def test_a_posts_photo_url_is_bounded(client, make_user):
    """The caps landed on `schemas/recipe.py` and this file's URL was left as it was — so a
    recipe's cover was capped while a post's photo, rendered to every friend, was not."""
    _, h = make_user()

    def post_with(url):
        return client.post(
            "/posts", json={"photo_url": url, "dish_name": "Adobo"}, headers=h
        ).status_code

    assert post_with("https://img.test/" + "x" * 470) == 201
    assert post_with("https://img.test/" + "x" * 490) == 422
    # And "" is still refused, as before — a post is a photo plus a name.
    assert post_with("") == 422


def test_an_avatar_url_is_bounded_as_well_as_host_checked(client, make_user):
    """`PATCH /auth/me` pinned the HOST but nothing pinned the LENGTH, so a megabyte of string
    beginning "https://x.cloudinary.com/" passed every check that existed."""
    _, h = make_user()
    ok = "https://res.cloudinary.com/demo/image/upload/" + "a" * 400
    too_long = "https://res.cloudinary.com/demo/image/upload/" + "a" * 500
    assert client.patch("/auth/me", json={"photo_url": ok}, headers=h).status_code == 200
    assert client.patch("/auth/me", json={"photo_url": too_long}, headers=h).status_code == 422
    # Clearing it back to the monogram still works — no min_length was added.
    assert client.patch("/auth/me", json={"photo_url": ""}, headers=h).status_code == 200


# --- the fields the FIRST pass of this file missed, and review proved were storing 500KB ---


def test_quantity_type_is_a_vocabulary_not_a_free_string(client, make_user):
    """It was a bare `str`, so it took 100,000 characters — verified stored, in review.

    A `Literal` closes two holes with one change, which is why this isn't just another Text
    alias: `services/scaling.py` branches on exactly these three values, so an unrecognised one
    silently fell through to whatever the last branch was.
    """
    _, h = make_user()

    def ing(qt):
        return _create(
            client, h, ingredients=[{"name": "Salt", "position": 1, "quantity_type": qt}]
        ).status_code

    for good in ("precise", "imprecise", "unmeasured"):
        assert ing(good) == 201, good
    assert ing("x" * 1000) == 422
    assert ing("approximate") == 422  # plausible, and not one of the three


def test_a_handoff_recipient_email_is_bounded(client, make_user):
    """The handoff route was the other door into the same file, and its fields were bare.

    The `note` half of this test went with the column (#102): the sender's message was stored on
    every handoff and read by nothing, so it is no longer accepted or persisted. An older client
    still sending one gets a 201 rather than a 422 — Pydantic ignores unknown fields by default,
    which matters because Vercel and ECS deploy independently.
    """
    _, h = make_user()
    rid = _create(client, h).json()["id"]

    def handoff(**body):
        return client.post(f"/recipes/{rid}/handoff", json=body, headers=h).status_code

    # A stray `note` from an old build is IGNORED, not rejected.
    assert handoff(note="x" * 5000) in (200, 201)
    # to_email is an address, not any string at all — it is later compared against a signing-up
    # user's email to auto-accept the grant, so 500KB of junk was never meaningful.
    assert handoff(to_email="lola@example.com") in (200, 201)
    assert handoff(to_email="x" * 300) == 422
    assert handoff(to_email="not-an-address") == 422


def test_a_position_cannot_overflow_an_int4(client, make_user):
    """`position: int` accepted 10**19 — a Postgres NumericValueOutOfRange (a 500) that passes
    silently on SQLite. Same shape of prod-only bug as #97's unvalidated `through_post_id`."""
    _, h = make_user()
    assert _create(client, h, steps=[{"content": "Cook", "position": 10**19}]).status_code == 422
    assert _create(
        client, h, ingredients=[{"name": "Salt", "position": 10**19}]
    ).status_code == 422
    assert _create(client, h, steps=[{"content": "Cook", "position": -1}]).status_code == 422


def test_editing_language_to_null_is_a_422_not_a_500(client, make_user):
    """The column is NOT NULL with a server_default, so create can omit it — but an EXPLICIT
    null on update reached setattr and blew up on the IntegrityError."""
    _, h = make_user()
    rid = _create(client, h).json()["id"]
    assert client.patch(f"/recipes/{rid}", json={"language": None}, headers=h).status_code == 422
    # Omitting it entirely still leaves it alone, and a real value still works.
    assert client.patch(f"/recipes/{rid}", json={"name": "Renamed"}, headers=h).status_code == 200
    assert client.patch(f"/recipes/{rid}", json={"language": "tl"}, headers=h).status_code == 200


def test_the_PARSE_response_cannot_hand_back_something_unsubmittable(client, make_user):
    """`POST /recipes/parse` is the app's primary capture route, and its response schema was
    uncapped — so it could return a step the create endpoint then refuses, dead-ending the paste
    flow. The response model carries the same ceilings as the create model now."""
    from app.schemas.recipe import ParsedRecipe, ParsedStep
    import pydantic
    import pytest

    # A ceiling on the RESPONSE model is what makes the round trip safe.
    with pytest.raises(pydantic.ValidationError):
        ParsedStep(content="x" * 2001)
    with pytest.raises(pydantic.ValidationError):
        ParsedRecipe(name="x" * 121)
