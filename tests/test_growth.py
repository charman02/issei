from types import SimpleNamespace
from app.services.growth import growth_stage, growth_vitality, soul_count


def _recipe(**kw):
    """A lightweight stand-in with the attrs soul_count reads."""
    base = dict(
        story=None, cover_photo_url=None, origin_attribution=None, notes=None, steps=[]
    )
    base.update(kw)
    return SimpleNamespace(**base)


def _step(voice_note=None):
    return SimpleNamespace(voice_note=voice_note)


def test_soul_counts_person_dimensions():
    # story + photo + origin = 3 soul dimensions
    r = _recipe(story="s", cover_photo_url="u", origin_attribution="Lola · Cebu")
    assert soul_count(r) == 3


def test_soul_counts_step_words():
    # a step with the person's words counts as a soul dimension
    r = _recipe(steps=[_step("don't crowd the pan"), _step(None)])
    assert soul_count(r) == 1
    # blank/whitespace-only voice_notes do NOT count
    assert soul_count(_recipe(steps=[_step("   "), _step("")])) == 0


def test_generic_notes_do_not_count_as_soul():
    # the practical recipe-level `notes` field is NOT soul (2026-07-18 decision)
    assert soul_count(_recipe(notes="use a heavy pot")) == 0


def test_full_soul_is_four_dimensions():
    r = _recipe(
        story="s",
        cover_photo_url="u",
        origin_attribution="Lola",
        steps=[_step("her words")],
    )
    assert soul_count(r) == 4


def test_seed_is_nothing_done():
    assert growth_stage(soul=0, cook_count=0) == "seed"


def test_sprout_from_one_dimension():
    assert growth_stage(soul=1, cook_count=0) == "sprout"  # a memory/photo
    assert growth_stage(soul=0, cook_count=1) == "sprout"  # or first cook


def test_sapling_from_soul_breadth():
    assert growth_stage(soul=3, cook_count=0) == "sapling"


def test_use_advances_to_sapling_but_not_tree():
    # heavy use, no soul → grows UP to sapling, never tree
    assert growth_stage(soul=0, cook_count=50) == "sapling"


def test_tree_requires_soul():
    # rich soul (all 4 dimensions) → tree
    assert growth_stage(soul=4, cook_count=1) == "tree"
    # even huge use can't reach tree without enough soul
    assert growth_stage(soul=1, cook_count=999) != "tree"


def test_vitality_states():
    assert growth_vitality(cook_count=0, share_count=0) == "bare"
    assert growth_vitality(cook_count=3, share_count=0) == "blooming"
    assert growth_vitality(cook_count=30, share_count=2) == "fruiting"
    # caps: 30 and 300 both fruiting (no higher state)
    assert growth_vitality(cook_count=300, share_count=9) == "fruiting"


def test_recipe_response_has_growth_fields(client, make_user):
    _, headers = make_user()
    payload = {
        "name": "Adobo",
        "story": "Lola made it every Sunday",
        "ingredients": [
            {"name": "chicken", "quantity_text": "2 lbs", "quantity_type": "precise", "position": 1}
        ],
        "steps": [{"content": "Cook", "position": 1}],
    }
    r = client.post("/recipes", json=payload, headers=headers)
    body = r.json()
    assert body["growth_stage"] == "sprout"  # 1 soul dimension (story), 0 cooks
    assert body["growth_vitality"] == "bare"
    assert body["soul_count"] == 1


def test_cook_note_is_persisted(client, make_user, db_session):
    from app.models.cook_event import CookEvent

    _, headers = make_user()
    root = client.post(
        "/recipes",
        json={
            "name": "Adobo",
            "ingredients": [
                {"name": "x", "quantity_text": "1", "quantity_type": "precise", "position": 1}
            ],
            "steps": [],
        },
        headers=headers,
    ).json()
    client.post(
        f"/recipes/{root['id']}/cook", json={"note": "I used coconut milk instead"}, headers=headers
    )
    ev = db_session.query(CookEvent).filter_by(recipe_id=root["id"]).one()
    assert ev.note == "I used coconut milk instead"
