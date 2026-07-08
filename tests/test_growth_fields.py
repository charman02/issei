def test_recipe_response_includes_growth_fields(client, make_user, db_session):
    from app.models.recipe import Recipe
    from app.models.cook_event import CookEvent
    owner, headers = make_user()
    # a root with one child and two cooks (one by owner)
    root = Recipe(user_id=owner.id, name="Adobo", lineage_relation="root")
    db_session.add(root); db_session.commit(); db_session.refresh(root)
    child = Recipe(user_id=owner.id, name="Adobo mine", lineage_relation="remixed", parent_recipe_id=root.id)
    other, _ = make_user()
    db_session.add(child)
    db_session.add(CookEvent(recipe_id=root.id, user_id=owner.id))
    db_session.add(CookEvent(recipe_id=root.id, user_id=other.id))
    db_session.commit()

    body = client.get(f"/recipes/{root.id}", headers=headers).json()
    assert body["cook_count"] == 2
    assert body["owner_cook_count"] == 1
    assert body["child_count"] == 1
    assert body["has_grandchildren"] is False
    assert body["last_cooked_at"] is not None
