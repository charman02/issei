"""Regression tests for the final-review fixes:
- remix forwards edited scalars (name/notes/...) instead of always inheriting;
- unauthenticated browse does NOT leak per-owner activity.
"""


def _make_root(client, headers, name="Grandma's Adobo"):
    payload = {
        "name": name,
        "notes": "cane vinegar",
        "cuisine": "Filipino",
        "visibility": "public",
        "ingredients": [{"name": "chicken", "quantity_text": "2 lbs",
                         "quantity_type": "precise", "position": 1}],
        "steps": [{"content": "Brown the chicken", "position": 1}],
    }
    return client.post("/recipes", json=payload, headers=headers).json()


def test_remix_uses_edited_scalars_when_provided(client, make_user):
    _, owner = make_user()
    root = _make_root(client, owner)
    _, remixer = make_user()
    body = {
        "name": "My Adobo",          # edited
        "notes": "less salt",        # edited
        "ingredients": [{"name": "lard", "quantity_text": "2 tbsp",
                         "quantity_type": "precise", "position": 1}],
        "steps": [{"content": "Brown the chicken", "position": 1}],
        "prompt_answer": "Mom used lard",
    }
    r = client.post(f"/recipes/{root['id']}/remix", json=body, headers=remixer)
    assert r.status_code == 201
    child = r.json()
    assert child["name"] == "My Adobo"          # edited value used
    assert child["notes"] == "less salt"
    assert child["parent_recipe_id"] == root["id"]


def test_remix_inherits_scalars_when_omitted(client, make_user):
    _, owner = make_user()
    root = _make_root(client, owner)
    _, remixer = make_user()
    body = {  # no name/notes → inherit from parent
        "ingredients": [{"name": "lard", "quantity_text": "2 tbsp",
                         "quantity_type": "precise", "position": 1}],
        "steps": [{"content": "Brown the chicken", "position": 1}],
    }
    child = client.post(f"/recipes/{root['id']}/remix", json=body, headers=remixer).json()
    assert child["name"] == "Grandma's Adobo"   # inherited
    assert child["notes"] == "cane vinegar"     # inherited


def test_browse_does_not_leak_owner_activity(client, make_user, db_session):
    from app.models.recipe import Recipe

    _, owner = make_user()
    root = _make_root(client, owner)
    # Make it public directly (the create API has no visibility field yet — the
    # public-visibility path is deferred work; here we set the row to exercise browse).
    db_session.query(Recipe).filter(Recipe.id == root["id"]).update({"visibility": "public"})
    db_session.commit()
    # owner cooks their own recipe a few times
    for _ in range(3):
        client.post(f"/recipes/{root['id']}/cook", json={}, headers=owner)

    # browse is unauthenticated
    rows = client.get("/recipes/browse").json()
    row = next(r for r in rows if r["id"] == root["id"])
    # public feed must not expose per-owner activity
    assert row["owner_cook_count"] == 0
    assert row["last_cooked_at"] is None
    # but the aggregate cook_count (used by the growth badge) is still present
    assert row["cook_count"] == 3
