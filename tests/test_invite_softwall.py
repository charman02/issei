def _payload(name="Adobo", **extra):
    return {"name": name,
            "ingredients": [{"name": "secret-ingredient", "quantity_text": "2 lbs",
                             "quantity_type": "precise", "position": 1}],
            "steps": [{"content": "secret-step", "position": 1}], **extra}


def _handoff(client, owner_headers, email="mom@example.com", **extra):
    root = client.post("/recipes", json=_payload(story="Lola made this every Sunday.",
                       origin={"name": "Lola Remedios", "place": "Cebu"}, **extra),
                       headers=owner_headers).json()
    r = client.post(f"/recipes/{root['id']}/handoff",
                    json={"to_email": email}, headers=owner_headers)
    return root, r.json()["token"]


def test_preview_is_unauthenticated_and_limited(client, make_user):
    owner, oheaders = make_user()
    root, token = _handoff(client, oheaders)
    # NO auth header — preview must be public
    r = client.get(f"/recipes/invite/{token}")
    assert r.status_code == 200
    body = r.json()
    # Exposed: name, who-it's-from, story, plant
    assert body["name"] == "Adobo"
    assert body["story"] == "Lola made this every Sunday."
    assert body["from_name"]  # the owner's name
    assert "Lola Remedios" in (body["origin_attribution"] or "")
    assert body["growth_stage"] in {"seed", "sprout", "sapling", "tree"}
    # LOCKED OUT: no body content whatsoever
    assert "ingredients" not in body
    assert "steps" not in body
    assert "secret-ingredient" not in r.text
    assert "secret-step" not in r.text


def test_preview_unknown_token_404(client, make_user):
    make_user()
    r = client.get("/recipes/invite/not-a-real-token")
    assert r.status_code == 404


def test_claim_grants_view_even_on_email_mismatch(client, make_user, db_session):
    from app.services.lineage import can_view
    from app.models.recipe import Recipe
    owner, oheaders = make_user()
    # invite addressed to one email…
    root, token = _handoff(client, oheaders, email="aunt@example.com")
    # …but claimed by a DIFFERENT signed-in user (the mismatched-email orphan case)
    claimer, cheaders = make_user()
    r = client.post(f"/recipes/invite/{token}/claim", headers=cheaders)
    assert r.status_code == 200
    assert r.json()["state"] == "accepted"
    # claimer can now view the (private) root
    root_obj = db_session.query(Recipe).filter_by(id=root["id"]).one()
    assert can_view(root_obj, claimer, db_session) is True


def test_claim_requires_auth(client, make_user):
    owner, oheaders = make_user()
    _root, token = _handoff(client, oheaders)
    r = client.post(f"/recipes/invite/{token}/claim")
    assert r.status_code == 401
