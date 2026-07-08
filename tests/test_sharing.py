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


def test_grantee_can_view_shared_root_and_descendant(client, make_user):
    owner, oheaders = make_user()
    grantee, gheaders = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()  # private
    child = client.post(f"/recipes/{root['id']}/remix",
                        json={"ingredients": [{"name": "x", "quantity_text": "1",
                              "quantity_type": "precise", "position": 1}], "steps": []},
                        headers=oheaders).json()
    # before sharing: grantee 404 on both
    assert client.get(f"/recipes/{root['id']}", headers=gheaders).status_code == 404
    # share the root with the grantee
    client.post(f"/recipes/{root['id']}/handoff", json={"to_user_id": grantee.id}, headers=oheaders)
    # now grantee sees the root AND the descendant (root-binds)
    assert client.get(f"/recipes/{root['id']}", headers=gheaders).status_code == 200
    assert client.get(f"/recipes/{child['id']}", headers=gheaders).status_code == 200
    assert client.get(f"/recipes/{root['id']}/lineage", headers=gheaders).status_code == 200


def test_non_grantee_still_404(client, make_user):
    owner, oheaders = make_user()
    stranger, sheaders = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()
    assert client.get(f"/recipes/{root['id']}", headers=sheaders).status_code == 404


def test_email_invite_auto_accepts_on_signup(client, make_user, db_session):
    from app.models.handoff import Handoff
    owner, oheaders = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()
    client.post(f"/recipes/{root['id']}/handoff",
                json={"to_email": "newmom@example.com"}, headers=oheaders)
    # new user signs up with that email
    client.post("/auth/signup", json={"email": "newmom@example.com", "password": "password123",
                                      "first_name": "Mom", "last_name": "X"})
    h = db_session.query(Handoff).filter_by(recipe_id=root["id"], to_email="newmom@example.com").one()
    assert h.state == "accepted"
    assert h.to_user_id is not None


def test_shared_with_me_lists_accepted_only(client, make_user):
    owner, oheaders = make_user()
    grantee, gheaders = make_user()
    root = client.post("/recipes", json=_payload(name="Shared Dish"), headers=oheaders).json()
    other_root = client.post("/recipes", json=_payload(name="Not Shared"), headers=oheaders).json()
    client.post(f"/recipes/{root['id']}/handoff", json={"to_user_id": grantee.id}, headers=oheaders)  # accepted
    listing = client.get("/recipes/shared", headers=gheaders).json()
    names = [r["name"] for r in listing]
    assert "Shared Dish" in names
    assert "Not Shared" not in names
    # excludes the grantee's own recipes
    mine = client.post("/recipes", json=_payload(name="My Own"), headers=gheaders).json()
    assert "My Own" not in [r["name"] for r in client.get("/recipes/shared", headers=gheaders).json()]


def test_accept_endpoint_activates_pending_for_recipient(client, make_user, db_session):
    from app.models.handoff import Handoff
    owner, oheaders = make_user()
    # pending email invite, then a user with that email exists and accepts by id
    grantee, gheaders = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()
    # create a pending grant targeted at the grantee's email (simulate mismatched/link flow)
    h = Handoff(recipe_id=root["id"], from_user_id=owner.id,
                to_email=None, to_user_id=grantee.id, state="pending")
    db_session.add(h); db_session.commit(); db_session.refresh(h)
    r = client.post(f"/recipes/handoffs/{h.id}/accept", headers=gheaders)
    assert r.status_code == 200
    db_session.refresh(h)
    assert h.state == "accepted"


def test_recipe_response_has_shared_with_count(client, make_user):
    owner, oheaders = make_user()
    grantee, _ = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()
    client.post(f"/recipes/{root['id']}/handoff", json={"to_user_id": grantee.id}, headers=oheaders)
    body = client.get(f"/recipes/{root['id']}", headers=oheaders).json()
    assert body["shared_with_count"] == 1


# --- Final-review security fixes: read-authorization holes ---

def _remix_body():
    return {"ingredients": [{"name": "x", "quantity_text": "1",
                             "quantity_type": "precise", "position": 1}], "steps": []}


def test_stranger_cannot_forge_grant_via_remix_handoff(client, make_user):
    # Fix 3 entry point: a stranger cannot even remix a private root they can't view.
    owner, oheaders = make_user()
    stranger, sheaders = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()  # private
    r = client.post(f"/recipes/{root['id']}/remix", json=_remix_body(), headers=sheaders)
    assert r.status_code == 404


def test_handoff_requires_root_ownership(client, make_user, db_session):
    # Fix 1 in isolation (data-layer construction, in case remix policy ever changes):
    # S owns a child whose parent is A's private root; S cannot hand off → normalize
    # a grant onto A's root.
    from app.models.recipe import Recipe
    from app.models.handoff import Handoff
    owner, oheaders = make_user()
    stranger, sheaders = make_user()
    target, _ = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()

    child = Recipe(user_id=stranger.id, name="Forged child",
                   parent_recipe_id=root["id"], lineage_relation="remixed")
    db_session.add(child); db_session.commit(); db_session.refresh(child)

    r = client.post(f"/recipes/{child.id}/handoff",
                    json={"to_user_id": target.id}, headers=sheaders)
    assert r.status_code == 404
    # No grant created for T on the root (or anywhere).
    assert db_session.query(Handoff).filter_by(to_user_id=target.id).count() == 0


def test_scale_gated_by_can_view(client, make_user):
    # Fix 2: scaling a private root leaks its full body to any logged-in user.
    owner, oheaders = make_user()
    stranger, sheaders = make_user()
    root = client.post("/recipes", json=_payload(servings=4), headers=oheaders).json()
    assert client.get(f"/recipes/{root['id']}/scale?servings=2",
                      headers=sheaders).status_code == 404
    assert client.get(f"/recipes/{root['id']}/scale?servings=2",
                      headers=oheaders).status_code == 200


def test_cook_gated_by_can_view(client, make_user):
    # Fix 3: cooking a private root by a stranger.
    owner, oheaders = make_user()
    stranger, sheaders = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()
    assert client.post(f"/recipes/{root['id']}/cook", headers=sheaders).status_code == 404


def test_grantee_can_still_remix_and_cook_shared(client, make_user):
    # Guard against over-blocking: accepted grantees retain cook + remix rights.
    owner, oheaders = make_user()
    grantee, gheaders = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()  # private
    client.post(f"/recipes/{root['id']}/handoff",
                json={"to_user_id": grantee.id}, headers=oheaders)  # accepted
    assert client.post(f"/recipes/{root['id']}/remix", json=_remix_body(),
                       headers=gheaders).status_code == 201
    assert client.post(f"/recipes/{root['id']}/cook", headers=gheaders).status_code == 200


def test_browse_hides_shared_with_count(client, make_user):
    # Fix 4: shared_with_count must be zeroed on the unauthenticated public feed.
    owner, oheaders = make_user()
    grantee, _ = make_user()
    root = client.post("/recipes", json=_payload(visibility="public"),
                       headers=oheaders).json()
    client.post(f"/recipes/{root['id']}/handoff",
                json={"to_user_id": grantee.id}, headers=oheaders)  # accepted grant
    feed = client.get("/recipes/browse").json()
    match = [r for r in feed if r["id"] == root["id"]]
    assert match, "public recipe should appear on browse feed"
    assert match[0]["shared_with_count"] == 0
