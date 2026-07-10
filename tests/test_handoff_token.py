def _payload(name="Adobo", **extra):
    return {"name": name,
            "ingredients": [{"name": "chicken", "quantity_text": "2 lbs",
                             "quantity_type": "precise", "position": 1}],
            "steps": [{"content": "Cook", "position": 1}], **extra}


def test_handoff_gets_a_unique_token(client, make_user, db_session):
    from app.models.handoff import Handoff
    owner, oheaders = make_user()
    root = client.post("/recipes", json=_payload(), headers=oheaders).json()
    r = client.post(f"/recipes/{root['id']}/handoff",
                    json={"to_email": "mom@example.com"}, headers=oheaders)
    assert r.status_code == 201
    h = db_session.query(Handoff).filter_by(recipe_id=root["id"]).one()
    assert h.token and len(h.token) >= 20  # token_urlsafe(32) → ~43 chars
    # owner sees the token in the response (needed to build the invite link)
    assert r.json()["token"] == h.token
