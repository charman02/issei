def test_plant_recipe_with_origin_creates_ghost(client, make_user):
    _, headers = make_user()
    payload = {
        "name": "Grandma's Congee",
        "origin": {"name": "Nonna Lucia", "place": "Abruzzo", "year": "1940s",
                   "memory": "She made it every winter"},
        "ingredients": [{"name": "rice", "quantity_text": "1 cup",
                         "quantity_type": "precise", "position": 1}],
        "steps": [{"content": "Simmer", "position": 1}],
    }
    r = client.post("/recipes", json=payload, headers=headers)
    assert r.status_code == 201
    body = r.json()
    assert body["lineage_relation"] == "root"
    assert body["visibility"] == "private"
    assert "Nonna Lucia" in body["origin_attribution"]
