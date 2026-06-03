from app.models.ingredient import Ingredient


def scale_ingredient(ingredient: Ingredient, multiplier: float) -> dict:
    scaled_ing = {
        "id": ingredient.id,
        "name": ingredient.name,
        "quantity_text": ingredient.quantity_text,
        "quantity_value": ingredient.quantity_value,
        "unit": ingredient.unit,
        "quantity_type": ingredient.quantity_type,
        "notes": ingredient.notes,
        "position": ingredient.position
    }
    
    if ingredient.quantity_value is not None:

        # "precise" with a unit (measurable)
        if ingredient.quantity_type == "precise" and ingredient.unit:
            scaled_value = round(ingredient.quantity_value * multiplier, 2)
            scaled_ing["quantity_text"] = f"{scaled_value} {ingredient.unit}"
            scaled_ing["quantity_value"] = scaled_value

        # "precise" without a unit (countable)
        elif ingredient.quantity_type == "precise" and not ingredient.unit:
            scaled_value = round(ingredient.quantity_value * multiplier)
            scaled_ing["quantity_text"] = str(scaled_value)
            scaled_ing["quantity_value"] = scaled_value
        
        # "imprecise" with a value
        elif ingredient.quantity_type == "imprecise":
            scaled_value = round(ingredient.quantity_value * multiplier, 2)
            unit_str = f" {ingredient.unit}" if ingredient.unit else ""
            scaled_ing["quantity_text"] = f"{scaled_value}{unit_str} (approximate)"
            scaled_ing["quantity_value"] = scaled_value
    
    # "imprecise" without value or "unmeasured": return unchanged
    return scaled_ing
    