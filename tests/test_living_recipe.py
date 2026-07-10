def test_step_voice_note_roundtrips(client, make_user):
    _, headers = make_user()
    payload = {"name": "Adobo",
               "ingredients": [{"name": "chicken", "quantity_text": "2 lbs",
                                "quantity_type": "precise", "position": 1}],
               "steps": [{"content": "Brown the chicken", "position": 1,
                          "voice_note": "Don't crowd the pan — let it get a real color."}]}
    r = client.post("/recipes", json=payload, headers=headers)
    assert r.status_code == 201
    rid = r.json()["id"]
    body = client.get(f"/recipes/{rid}", headers=headers).json()
    step = body["steps"][0]
    assert step["voice_note"] == "Don't crowd the pan — let it get a real color."
