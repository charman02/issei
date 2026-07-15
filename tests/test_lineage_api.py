from app.models.ghost_ancestor import GhostAncestor


def test_plant_recipe_with_origin_creates_ghost(client, make_user, db_session):
    _, headers = make_user()
    payload = {
        "name": "Grandma's Congee",
        "origin": {
            "name": "Nonna Lucia",
            "place": "Abruzzo",
            "year": "1940s",
            "memory": "She made it every winter",
        },
        "ingredients": [
            {"name": "rice", "quantity_text": "1 cup", "quantity_type": "precise", "position": 1}
        ],
        "steps": [{"content": "Simmer", "position": 1}],
    }
    r = client.post("/recipes", json=payload, headers=headers)
    assert r.status_code == 201
    body = r.json()
    assert body["lineage_relation"] == "root"
    assert body["visibility"] == "private"
    assert "Nonna Lucia" in body["origin_attribution"]
    assert db_session.query(GhostAncestor).filter_by(recipe_id=body["id"]).count() == 1


def _make_root(client, headers):
    payload = {
        "name": "Adobo",
        "ingredients": [
            {"name": "butter", "quantity_text": "2 tbsp", "quantity_type": "precise", "position": 1}
        ],
        "steps": [{"content": "Brown the meat", "position": 1}],
    }
    return client.post("/recipes", json=payload, headers=headers).json()


def _make_child(db_session, user_id, parent_id, name="Child"):
    """Build a lineage child directly via the ORM. The parent-child edge has no
    dedicated write endpoint anymore (remix was cut), so tests that exercise the
    lineage substrate construct descendants at the data layer."""
    from app.models.recipe import Recipe

    child = Recipe(
        user_id=user_id, name=name, parent_recipe_id=parent_id, lineage_relation="remixed"
    )
    db_session.add(child)
    db_session.commit()
    db_session.refresh(child)
    return child


def test_cook_increments_count_no_node(client, make_user):
    _, owner = make_user()
    root = _make_root(client, owner)

    r1 = client.post(f"/recipes/{root['id']}/cook", json={}, headers=owner)
    assert r1.status_code == 200
    assert r1.json()["cook_count"] == 1

    # A second, different cook must be able to view the recipe first (cook is
    # now read-gated). Share the private root with them via an accepted grant.
    cook2_user, cook2 = make_user()
    client.post(f"/recipes/{root['id']}/handoff", json={"to_user_id": cook2_user.id}, headers=owner)
    r2 = client.post(f"/recipes/{root['id']}/cook", json={"note": "yum"}, headers=cook2)
    assert r2.json()["cook_count"] == 2

    # No new recipe nodes were created by cooking.
    mine = client.get("/recipes", headers=cook2).json()
    assert mine == []


def test_handoff_creates_pending(client, make_user):
    _, owner = make_user()
    root = _make_root(client, owner)
    r = client.post(
        f"/recipes/{root['id']}/handoff",
        json={"to_email": "mom@example.com", "note": "your adobo"},
        headers=owner,
    )
    assert r.status_code == 201
    body = r.json()
    assert body["state"] == "pending"
    assert body["to_email"] == "mom@example.com"


def test_handoff_requires_a_recipient(client, make_user):
    _, owner = make_user()
    root = _make_root(client, owner)
    r = client.post(f"/recipes/{root['id']}/handoff", json={"note": "x"}, headers=owner)
    assert r.status_code == 422


def test_lineage_endpoint_returns_spine(client, make_user, db_session):
    user, owner = make_user()
    root = _make_root(client, owner)
    child = _make_child(db_session, user.id, root["id"])
    r = client.get(f"/recipes/{child.id}/lineage", headers=owner)
    assert r.status_code == 200
    view = r.json()
    assert [n["id"] for n in view["spine"]] == [root["id"], child.id]
    assert view["counts"]["versions"] == 2


def test_private_recipe_hidden_from_non_owner(client, make_user):
    _, owner = make_user()
    root = _make_root(client, owner)  # private by default
    _, other = make_user()
    assert client.get(f"/recipes/{root['id']}", headers=other).status_code == 404
    assert client.get(f"/recipes/{root['id']}", headers=owner).status_code == 200


def test_browse_only_shows_public(client, make_user):
    _, owner = make_user()
    _make_root(client, owner)  # private by default
    # /browse is unauthenticated (browse_recipes takes no current_user) — call it plainly.
    assert client.get("/recipes/browse").json() == []


def test_lineage_hidden_from_non_owner(client, make_user):
    _, owner = make_user()
    root = _make_root(client, owner)  # private by default
    _, other = make_user()
    assert client.get(f"/recipes/{root['id']}/lineage", headers=other).status_code == 404
    assert client.get(f"/recipes/{root['id']}/lineage", headers=owner).status_code == 200


def test_handoff_non_owner_404(client, make_user):
    _, owner = make_user()
    root = _make_root(client, owner)
    _, other = make_user()
    r = client.post(
        f"/recipes/{root['id']}/handoff", json={"to_email": "x@example.com"}, headers=other
    )
    assert r.status_code == 404
