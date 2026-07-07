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


def test_ghost_cook_handoff_models(db_session):
    from app.models.user import User
    from app.models.ghost_ancestor import GhostAncestor
    from app.models.cook_event import CookEvent
    from app.models.handoff import Handoff
    from app.auth import hash_password

    u = User(first_name="A", last_name="B", email="g@b.com",
             hashed_password=hash_password("x"))
    db_session.add(u); db_session.commit()
    r = Recipe(user_id=u.id, name="Adobo")
    db_session.add(r); db_session.commit(); db_session.refresh(r)

    ghost = GhostAncestor(recipe_id=r.id, name="Lola", place="Cebu", year="1960s",
                          memory="Made it every Sunday")
    cook = CookEvent(recipe_id=r.id, user_id=u.id)
    pass_ = Handoff(recipe_id=r.id, from_user_id=u.id, to_email="mom@example.com",
                    state="pending", note="Mom, your adobo")
    db_session.add_all([ghost, cook, pass_]); db_session.commit()

    assert db_session.query(GhostAncestor).filter_by(recipe_id=r.id).one().name == "Lola"
    assert db_session.query(CookEvent).filter_by(recipe_id=r.id).count() == 1
    assert db_session.query(Handoff).filter_by(recipe_id=r.id).one().state == "pending"
