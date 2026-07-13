def _payload(name="Adobo", **extra):
    return {
        "name": name,
        "ingredients": [
            {"name": "chicken", "quantity_text": "2 lbs", "quantity_type": "precise", "position": 1}
        ],
        "steps": [{"content": "Cook", "position": 1}],
        **extra,
    }


def test_create_defaults_private(client, make_user):
    _, headers = make_user()
    r = client.post("/recipes", json=_payload(), headers=headers)
    assert r.status_code == 201
    assert r.json()["visibility"] == "private"


def test_create_public_when_requested(client, make_user):
    _, headers = make_user()
    r = client.post("/recipes", json=_payload(visibility="public"), headers=headers)
    assert r.status_code == 201
    assert r.json()["visibility"] == "public"


def test_create_rejects_bad_visibility(client, make_user):
    _, headers = make_user()
    r = client.post("/recipes", json=_payload(visibility="secret"), headers=headers)
    assert r.status_code == 422


def test_patch_root_toggles_visibility(client, make_user):
    _, headers = make_user()
    root = client.post("/recipes", json=_payload(), headers=headers).json()
    r = client.patch(f"/recipes/{root['id']}", json={"visibility": "public"}, headers=headers)
    assert r.status_code == 200
    assert r.json()["visibility"] == "public"
    # reversible
    r2 = client.patch(f"/recipes/{root['id']}", json={"visibility": "private"}, headers=headers)
    assert r2.json()["visibility"] == "private"


def test_patch_visibility_on_branch_is_rejected(client, make_user):
    _, owner = make_user()
    root = client.post("/recipes", json=_payload(), headers=owner).json()
    child = client.post(
        f"/recipes/{root['id']}/remix",
        json={
            "ingredients": [
                {
                    "name": "lard",
                    "quantity_text": "1 tbsp",
                    "quantity_type": "precise",
                    "position": 1,
                }
            ],
            "steps": [],
        },
        headers=owner,
    ).json()
    r = client.patch(f"/recipes/{child['id']}", json={"visibility": "public"}, headers=owner)
    assert r.status_code == 400


def test_patch_bad_visibility_rejected(client, make_user):
    _, headers = make_user()
    root = client.post("/recipes", json=_payload(), headers=headers).json()
    r = client.patch(f"/recipes/{root['id']}", json={"visibility": "everyone"}, headers=headers)
    assert r.status_code == 422


def test_public_root_visible_to_non_owner_and_in_browse(client, make_user, db_session):
    _, owner = make_user()
    root = client.post("/recipes", json=_payload(visibility="public"), headers=owner).json()
    _, other = make_user()
    # non-owner can view a public recipe
    assert client.get(f"/recipes/{root['id']}", headers=other).status_code == 200
    # appears in the (unauthenticated) browse feed
    assert any(r["id"] == root["id"] for r in client.get("/recipes/browse").json())


def test_private_root_hidden_from_non_owner_and_browse(client, make_user):
    _, owner = make_user()
    root = client.post("/recipes", json=_payload(), headers=owner).json()  # private
    _, other = make_user()
    assert client.get(f"/recipes/{root['id']}", headers=other).status_code == 404
    assert all(r["id"] != root["id"] for r in client.get("/recipes/browse").json())


def test_branch_of_private_root_stays_hidden(client, make_user):
    _, owner = make_user()
    root = client.post("/recipes", json=_payload(), headers=owner).json()  # private
    child = client.post(
        f"/recipes/{root['id']}/remix",
        json={
            "ingredients": [
                {"name": "x", "quantity_text": "1", "quantity_type": "precise", "position": 1}
            ],
            "steps": [],
        },
        headers=owner,
    ).json()
    _, other = make_user()
    # child inherits private root → not publicly visible even though child row default is private
    assert client.get(f"/recipes/{child['id']}", headers=other).status_code == 404


def test_branch_of_public_root_is_visible_to_non_owner(client, make_user):
    # A remix child's OWN row is private-by-default, but its PUBLIC root must make it
    # visible to a non-owner via effective_visibility (root-binds). This fails if the
    # root-walk is dropped and the child's own (private) visibility is used.
    _, owner = make_user()
    root = client.post("/recipes", json=_payload(visibility="public"), headers=owner).json()
    child = client.post(
        f"/recipes/{root['id']}/remix",
        json={
            "ingredients": [
                {
                    "name": "lard",
                    "quantity_text": "1 tbsp",
                    "quantity_type": "precise",
                    "position": 1,
                }
            ],
            "steps": [],
        },
        headers=owner,
    ).json()
    _, other = make_user()
    # child inherits the PUBLIC root → visible to a non-owner even though its own row is private
    assert client.get(f"/recipes/{child['id']}", headers=other).status_code == 200
