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
    assert (scaled_ing["quantity_text"] == "6 tbsp" and
            scaled_ing["quantity_value"] == 6)

def test_imprecise_without_value():
    ingredient = Ingredient(
        name = "vinegar",
        quantity_text = "a dash",
        quantity_type = "imprecise",
    )
    scaled_ing = scale_ingredient(ingredient, 3)
    assert (scaled_ing["quantity_text"] == "a dash" and
            scaled_ing["quantity_value"] is None)
