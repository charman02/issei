from app.services.growth import growth_stage, growth_vitality


def test_seed_is_nothing_done():
    assert growth_stage(soul=0, cook_count=0) == "seed"


def test_sprout_from_one_dimension():
    assert growth_stage(soul=1, cook_count=0) == "sprout"   # a memory/photo
    assert growth_stage(soul=0, cook_count=1) == "sprout"   # or first cook


def test_sapling_from_soul_breadth():
    assert growth_stage(soul=3, cook_count=0) == "sapling"


def test_use_advances_to_sapling_but_not_tree():
    # heavy use, no soul → grows UP to sapling, never tree
    assert growth_stage(soul=0, cook_count=50) == "sapling"


def test_tree_requires_soul():
    # rich soul (all 4 dimensions) → tree
    assert growth_stage(soul=4, cook_count=1) == "tree"
    # even huge use can't reach tree without enough soul
    assert growth_stage(soul=1, cook_count=999) != "tree"


def test_vitality_states():
    assert growth_vitality(cook_count=0, share_count=0) == "bare"
    assert growth_vitality(cook_count=3, share_count=0) == "blooming"
    assert growth_vitality(cook_count=30, share_count=2) == "fruiting"
    # caps: 30 and 300 both fruiting (no higher state)
    assert growth_vitality(cook_count=300, share_count=9) == "fruiting"


def test_recipe_response_has_growth_fields(client, make_user):
    _, headers = make_user()
    payload = {"name": "Adobo",
               "story": "Lola made it every Sunday",
               "ingredients": [{"name": "chicken", "quantity_text": "2 lbs",
                                "quantity_type": "precise", "position": 1}],
               "steps": [{"content": "Cook", "position": 1}]}
    r = client.post("/recipes", json=payload, headers=headers)
    body = r.json()
    assert body["growth_stage"] == "sprout"   # 1 soul dimension (story), 0 cooks
    assert body["growth_vitality"] == "bare"
    assert body["soul_count"] == 1
