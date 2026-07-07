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
