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


def test_handoff_to_user_is_instant_accepted_and_root_normalized(client, make_user, db_session):
    from app.models.handoff import Handoff
    from app.models.recipe import Recipe
    owner, oheaders = make_user()
    grantee, _ = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()
    # pass the ROOT to the grantee (by user id)
    r = client.post(f"/recipes/{root['id']}/handoff",
                    json={"to_user_id": grantee.id}, headers=oheaders)
    assert r.status_code == 201
    h = db_session.query(Handoff).filter_by(recipe_id=root["id"], to_user_id=grantee.id).one()
    assert h.state == "accepted"


def test_handoff_normalizes_branch_to_root(client, make_user, db_session):
    from app.models.handoff import Handoff
    owner, oheaders = make_user()
    grantee, _ = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()
    child = client.post(f"/recipes/{root['id']}/remix",
                        json={"ingredients": [{"name": "x", "quantity_text": "1",
                              "quantity_type": "precise", "position": 1}], "steps": []},
                        headers=oheaders).json()
    # owner passes the CHILD → grant must attach to the ROOT
    client.post(f"/recipes/{child['id']}/handoff",
                json={"to_user_id": grantee.id}, headers=oheaders)
    assert db_session.query(Handoff).filter_by(recipe_id=root["id"], to_user_id=grantee.id).count() == 1
    assert db_session.query(Handoff).filter_by(recipe_id=child["id"]).count() == 0


def test_handoff_email_is_pending(client, make_user, db_session):
    from app.models.handoff import Handoff
    owner, oheaders = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()
    client.post(f"/recipes/{root['id']}/handoff",
                json={"to_email": "mom@example.com"}, headers=oheaders)
    h = db_session.query(Handoff).filter_by(recipe_id=root["id"], to_email="mom@example.com").one()
    assert h.state == "pending" and h.to_user_id is None


def test_handoff_idempotent_per_grantee(client, make_user, db_session):
    from app.models.handoff import Handoff
    owner, oheaders = make_user()
    grantee, _ = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()
    client.post(f"/recipes/{root['id']}/handoff", json={"to_user_id": grantee.id}, headers=oheaders)
    client.post(f"/recipes/{root['id']}/handoff", json={"to_user_id": grantee.id}, headers=oheaders)
    assert db_session.query(Handoff).filter_by(recipe_id=root["id"], to_user_id=grantee.id).count() == 1
