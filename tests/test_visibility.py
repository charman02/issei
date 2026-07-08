def _payload(name="Adobo", **extra):
    return {
        "name": name,
        "ingredients": [{"name": "chicken", "quantity_text": "2 lbs",
                         "quantity_type": "precise", "position": 1}],
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
    child = client.post(f"/recipes/{root['id']}/remix",
                        json={"ingredients": [{"name": "lard", "quantity_text": "1 tbsp",
                              "quantity_type": "precise", "position": 1}], "steps": []},
                        headers=owner).json()
    r = client.patch(f"/recipes/{child['id']}", json={"visibility": "public"}, headers=owner)
    assert r.status_code == 400


def test_patch_bad_visibility_rejected(client, make_user):
    _, headers = make_user()
    root = client.post("/recipes", json=_payload(), headers=headers).json()
    r = client.patch(f"/recipes/{root['id']}", json={"visibility": "everyone"}, headers=headers)
    assert r.status_code == 422
