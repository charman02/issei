from typing import Optional

VOLUME_TO_ML = {
    "ml": 1,
    "tsp": 5,
    "tbsp": 15,
    "cup": 240,
    "l": 1000
}

WEIGHT_TO_G = {
    "g": 1,
    "kg": 1000,
    "oz": 28.35,
    "lb": 453.59
}

DENSITY_TABLE = {
    "flour": 0.5,   # g/ml
    "sugar": 0.85,
    "butter": 0.91,
    "water": 1.0,
    "milk": 1.03,
    "rice": 0.85,
    "salt": 1.2,
    "honey": 1.42
}

def convert(
        value: float,
        from_unit: Optional[str],
        to_unit: Optional[str],
        ingredient_name: Optional[str] = None
) -> Optional[float]:
    from_unit = from_unit.lower().strip() if from_unit else None
    to_unit = to_unit.lower().strip() if to_unit else None

    # volume conversion
    if from_unit in VOLUME_TO_ML and to_unit in VOLUME_TO_ML:
        from_ml, to_ml = VOLUME_TO_ML[from_unit], VOLUME_TO_ML[to_unit]
        unit_ratio = to_ml / from_ml
        return value * unit_ratio
    
    # weight conversion
    elif from_unit in WEIGHT_TO_G and to_unit in WEIGHT_TO_G:
        from_g, to_g = WEIGHT_TO_G[from_unit], WEIGHT_TO_G[to_unit]
        unit_ratio = to_g / from_g
        return value * unit_ratio
    
    # volume to weight
    elif from_unit in VOLUME_TO_ML and to_unit in WEIGHT_TO_G:
        value_ml = value * VOLUME_TO_ML[from_unit]
        if not ingredient_name:
            return None
        density = DENSITY_TABLE.get(ingredient_name)
        if density is None:
            return None
        value_g = value_ml * density
        return value_g / WEIGHT_TO_G[to_unit]
    
    # weight to volume
    elif from_unit in WEIGHT_TO_G and to_unit in VOLUME_TO_ML:
        value_g = value * WEIGHT_TO_G[from_unit]
        if not ingredient_name:
            return None
        density = DENSITY_TABLE.get(ingredient_name)
        if density is None:
            return None
        value_ml = value_g / density
        return value_ml / VOLUME_TO_ML[to_unit]
    
    return None