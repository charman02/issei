def _payload(name="Adobo", **extra):
    return {"name": name,
            "ingredients": [{"name": "chicken", "quantity_text": "2 lbs",
                             "quantity_type": "precise", "position": 1}],
            "steps": [{"content": "Cook", "position": 1}], **extra}


def test_root_of_walks_to_root(db_session, make_user):
    from app.models.recipe import Recipe
    from app.services.lineage import root_of
    u, _ = make_user()
    root = Recipe(user_id=u.id, name="R", lineage_relation="root")
    db_session.add(root); db_session.commit(); db_session.refresh(root)
    child = Recipe(user_id=u.id, name="C", parent_recipe_id=root.id, lineage_relation="remixed")
    db_session.add(child); db_session.commit(); db_session.refresh(child)
    assert root_of(child, db_session).id == root.id
    assert root_of(root, db_session).id == root.id


def test_can_view_owner_public_and_grant(db_session, make_user):
    from app.models.recipe import Recipe
    from app.models.handoff import Handoff
    from app.services.lineage import can_view
    owner, _ = make_user()
    other, _ = make_user()
    root = Recipe(user_id=owner.id, name="R", lineage_relation="root", visibility="private")
    db_session.add(root); db_session.commit(); db_session.refresh(root)

    assert can_view(root, owner, db_session) is True         # owner
    assert can_view(root, other, db_session) is False        # private, no grant
    # accepted grant on the root → other can view
    db_session.add(Handoff(recipe_id=root.id, from_user_id=owner.id,
                           to_user_id=other.id, state="accepted"))
    db_session.commit()
    assert can_view(root, other, db_session) is True
    # a pending grant does NOT grant view
    other2, _ = make_user()
    db_session.add(Handoff(recipe_id=root.id, from_user_id=owner.id,
                           to_user_id=other2.id, state="pending"))
    db_session.commit()
    assert can_view(root, other2, db_session) is False
