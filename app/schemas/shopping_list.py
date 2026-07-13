from typing import Optional
from pydantic import BaseModel


# Shopping list schemas


class ShoppingListRequest(BaseModel):
    recipe_ids: list[int]


class ShoppingListItem(BaseModel):
    name: str
    quantity_text: str
    quantity_value: Optional[float] = None
    unit: Optional[str] = None
    quantity_type: str
    breakdown: str


class ShoppingListResponse(BaseModel):
    items: list[ShoppingListItem]
