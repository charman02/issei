from app.models.recipe import Recipe


def test_recipe_has_lineage_defaults(db_session):
    from app.models.user import User
    from app.auth import hash_password
    u = User(first_name="A", last_name="B", email="a@b.com",
             hashed_password=hash_password("x"))
    db_session.add(u); db_session.commit()

    root = Recipe(user_id=u.id, name="Congee")
    db_session.add(root); db_session.commit(); db_session.refresh(root)

    assert root.parent_recipe_id is None
    assert root.lineage_relation == "root"
    assert root.visibility == "private"
    assert root.origin_attribution is None

    child = Recipe(user_id=u.id, name="Congee (mine)",
                   parent_recipe_id=root.id, lineage_relation="remixed")
    db_session.add(child); db_session.commit(); db_session.refresh(child)

    assert child.parent.id == root.id
    assert [c.id for c in root.children] == [child.id]
