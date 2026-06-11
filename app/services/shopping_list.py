from typing import Optional
from app.schemas.shopping_list import ShoppingListItem
from app.services.units import convert


def make_breakdown(value: Optional[float], unit: Optional[str], recipe_name: Optional[str]):
    if value is not None:
        if unit:
            return f"{value} {unit} ({recipe_name})"
        return f"{value} ({recipe_name})"
    return f"? ({recipe_name})"            


def consolidate_ingredients(recipes_with_names: list[dict]) -> list[ShoppingListItem]:
    
    # key: normalized ingredient name, value: ShoppingListItem being built
    groups: dict[str, ShoppingListItem] = {}

    for recipe in recipes_with_names:
        ingredient = recipe["ingredient"]
        recipe_name = recipe["recipe_name"]
        ing_name = ingredient.name.strip().lower()
        ing_breakdown = make_breakdown(ingredient.quantity_value, ingredient.unit, recipe_name)

        if ing_name not in groups:
            # first time seeing this ingredient
            groups[ing_name] = ShoppingListItem(
                name=ingredient.name,
                quantity_text=ingredient.quantity_text or "",
                quantity_value=ingredient.quantity_value,
                unit=ingredient.unit,
                quantity_type=ingredient.quantity_type,
                breakdown=ing_breakdown
            )
        else:
            # ingredient already seen - try to consolidate
            existing = groups[ing_name]
            existing.breakdown += f" + {ing_breakdown}"

            if ingredient.quantity_value is not None and existing.quantity_value is not None:
                # both have numeric values - try to sum
                if ingredient.unit is None and existing.unit is None:
                    # both are countable - sum directly
                    existing.quantity_value = existing.quantity_value + ingredient.quantity_value
                    existing.quantity_text = str(int(existing.quantity_value)) if existing.quantity_value == int(existing.quantity_value) else str(existing.quantity_value)
                else:
                    converted = convert(
                        ingredient.quantity_value,
                        ingredient.unit,
                        existing.unit,
                        ing_name
                    )
                    if converted is not None:
                        # conversion succeeded - sum the values
                        existing.quantity_value = round(existing.quantity_value + converted, 2)
                        unit_str = f" {existing.unit}" if existing.unit else ""
                        existing.quantity_text = f"{existing.quantity_value}{unit_str}"
                    else:
                        # conversion failed - append text, clear numeric value
                        existing.quantity_text += f" + {ingredient.quantity_text}"
                        existing.quantity_value = None
                        existing.unit = None
            else:
                # one or both are non-numeric - append text only
                if ingredient.quantity_text:
                    existing.quantity_text += f" + {ingredient.quantity.text}"

            # if quantity types differ, mark as imprecise
            if existing.quantity_type != ingredient.quantity_type:
                existing.quantity_type = "imprecise"

    return list(groups.values())
