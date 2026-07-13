from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.auth import get_current_user
from app.models.user import User
from app.models.recipe import Recipe
from app.models.ingredient_section import IngredientSection
from app.schemas.shopping_list import ShoppingListRequest, ShoppingListResponse
from app.services.shopping_list import consolidate_ingredients

router = APIRouter(prefix="/shopping-list", tags=["shopping-list"])


@router.post("", response_model=ShoppingListResponse)
def create_shopping_list(
    request: ShoppingListRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    recipes = (
        db.query(Recipe)
        .filter(
            Recipe.id.in_(request.recipe_ids),
            Recipe.user_id == current_user.id,
            Recipe.deleted_at == None,
        )
        .options(
            selectinload(Recipe.ingredients),
            selectinload(Recipe.ingredient_sections).selectinload(IngredientSection.ingredients),
        )
        .all()
    )

    if len(recipes) != len(request.recipe_ids):
        raise HTTPException(status_code=404, detail="One or more recipes not found")

    recipes_with_names = []
    for recipe in recipes:
        for section in recipe.ingredient_sections:
            for ing in section.ingredients:
                recipes_with_names.append({"recipe_name": recipe.name, "ingredient": ing})
        for ing in recipe.ingredients:
            recipes_with_names.append({"recipe_name": recipe.name, "ingredient": ing})

    shopping_list = consolidate_ingredients(recipes_with_names)
    return ShoppingListResponse(items=shopping_list)
