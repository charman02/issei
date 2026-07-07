from types import SimpleNamespace
from app.services.lineage import diff_recipes


def ing(name, qty=None):
    return SimpleNamespace(name=name, quantity_text=qty)


def step(content):
    return SimpleNamespace(content=content)


def test_diff_detects_ingredient_swap():
    parent_ings = [ing("butter"), ing("flour")]
    child_ings = [ing("lard"), ing("flour")]
    d = diff_recipes(parent_ings, [], child_ings, [])
    assert d["changed"] is True
    assert d["prompt_key"] == "ingredient_swap"
    assert "lard" in d["summary"]


def test_diff_detects_added_step():
    d = diff_recipes([ing("rice")], [step("Rinse")],
                     [ing("rice")], [step("Rinse"), step("Toast the rice")])
    assert d["changed"] is True
    assert d["prompt_key"] in ("step_change", "general_change")


def test_diff_no_change():
    ings = [ing("rice"), ing("water")]
    steps = [step("Boil")]
    d = diff_recipes(ings, steps, ings, steps)
    assert d["changed"] is False
    assert d["prompt_key"] == "general_change"


def test_effective_visibility_follows_root(db_session):
    from app.models.user import User
    from app.models.recipe import Recipe
    from app.services.lineage import effective_visibility
    from app.auth import hash_password

    u = User(first_name="A", last_name="B", email="v@b.com",
             hashed_password=hash_password("x"))
    db_session.add(u); db_session.commit()

    root = Recipe(user_id=u.id, name="Root", visibility="public",
                  lineage_relation="root")
    db_session.add(root); db_session.commit(); db_session.refresh(root)

    # Child stored 'private' but descends from a PUBLIC root -> effective is public.
    child = Recipe(user_id=u.id, name="Child", visibility="private",
                   lineage_relation="remixed", parent_recipe_id=root.id)
    db_session.add(child); db_session.commit(); db_session.refresh(child)

    assert effective_visibility(root, db_session) == "public"
    assert effective_visibility(child, db_session) == "public"


def test_build_lineage_view_spine_and_counts(db_session):
    from app.models.user import User
    from app.models.recipe import Recipe
    from app.models.cook_event import CookEvent
    from app.services.lineage import build_lineage_view
    from app.auth import hash_password

    u = User(first_name="A", last_name="B", email="l@b.com",
             hashed_password=hash_password("x"))
    db_session.add(u); db_session.commit()

    root = Recipe(user_id=u.id, name="Root", lineage_relation="root")
    db_session.add(root); db_session.commit(); db_session.refresh(root)
    child = Recipe(user_id=u.id, name="Child", lineage_relation="remixed",
                   parent_recipe_id=root.id)
    db_session.add(child); db_session.commit(); db_session.refresh(child)
    db_session.add(CookEvent(recipe_id=root.id, user_id=u.id))
    db_session.add(CookEvent(recipe_id=child.id, user_id=u.id))
    db_session.commit()

    view = build_lineage_view(child, db_session)
    assert [n["id"] for n in view["spine"]] == [root.id, child.id]
    assert view["focus"]["id"] == child.id
    assert view["counts"]["versions"] == 2
    assert view["counts"]["cooks"] == 2
