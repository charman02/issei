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
