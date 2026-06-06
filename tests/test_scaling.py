from app.services.scaling import scale_ingredient
from app.models.ingredient import Ingredient

def test_precise_with_unit():
    ingredient = Ingredient(
        name = "soy sauce",
        quantity_text = "3 tbsp",
        quantity_value = 3,
        unit = "tbsp",
        quantity_type = "precise",
    )
    scaled_ing = scale_ingredient(ingredient, 2)
    assert scaled_ing["quantity_text"] == "6 tbsp"
    assert scaled_ing["quantity_value"] == 6
    
def test_precise_without_unit():
    ingredient = Ingredient(
        name = "eggs",
        quantity_text = "3",
        quantity_value = 3,
        unit = None,
        quantity_type = "precise",
    )
    scaled_ing = scale_ingredient(ingredient, 1.5)
    assert scaled_ing["quantity_value"] == 4  # banker's rounding (rounds to nearest even)
    assert scaled_ing["unit"] is None

def test_imprecise_with_value():
    ingredient = Ingredient(
        name = "olive oil",
        quantity_text = "about 1 tsp",
        quantity_value = 1,
        unit = "tsp",
        quantity_type = "imprecise",
    )
    scaled_ing = scale_ingredient(ingredient, 4)
    assert "approximate" in scaled_ing["quantity_text"]
    assert scaled_ing["quantity_value"] == 4

def test_imprecise_without_value():
    ingredient = Ingredient(
        name = "vinegar",
        quantity_text = "a dash",
        quantity_type = "imprecise",
    )
    scaled_ing = scale_ingredient(ingredient, 3)
    assert scaled_ing["quantity_text"] == "a dash"
    assert scaled_ing["quantity_value"] is None

def test_unmeasured_unchanged():
    ingredient = Ingredient(
        name = "salt",
        quantity_text = "to taste",
        quantity_type = "unmeasured",
    )
    scaled_ing = scale_ingredient(ingredient, 2.5)
    assert scaled_ing["quantity_text"] == "to taste"
    assert scaled_ing["quantity_value"] is None
