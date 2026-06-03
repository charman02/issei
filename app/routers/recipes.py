from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.auth import get_current_user
from app.models.user import User
from app.models.recipe import Recipe
from app.models.ingredient_section import IngredientSection
from app.models.ingredient import Ingredient
from app.models.step import Step
from app.schemas.recipe import RecipeCreate, RecipeResponse
from app.services.scaling import scale_ingredient

router = APIRouter(prefix="/recipes", tags=["recipes"])


@router.post("", response_model=RecipeResponse, status_code=status.HTTP_201_CREATED)
def create_recipe(
    recipe_in: RecipeCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    new_recipe = Recipe(
        user_id=current_user.id,
        name=recipe_in.name,
        description=recipe_in.description,
        servings=recipe_in.servings,
        prep_time_minutes=recipe_in.prep_time_minutes,
        cuisine=recipe_in.cuisine,
        diet=recipe_in.diet,
        source=recipe_in.source,
        notes=recipe_in.notes,
        language=recipe_in.language,
    )
    db.add(new_recipe)
    # flush to get new_recipe.id before committing
    db.flush()

    for section_in in recipe_in.ingredient_sections:
        new_section = IngredientSection(
            recipe_id=new_recipe.id,
            name=section_in.name,
            position=section_in.position,
        )
        db.add(new_section)
        db.flush()

        for ing_in in recipe_in.ingredients:
            db.add(Ingredient(
                recipe_id=new_recipe.id,
                section_id=new_section.id,
                name=ing_in.name,
                quantity_text=ing_in.quantity_text,
                quantity_value=ing_in.quantity_value,
                unit=ing_in.unit,
                quantity_type=ing_in.quantity_type,
                notes=ing_in.notes,
                position=ing_in.position,
            ))
    
    for ing_in in recipe_in.ingredients:
        db.add(Ingredient(
            recipe_id=new_recipe.id,
            section_id=None,
            name=ing_in.name,
            quantity_text=ing_in.quantity_text,
            quantity_value=ing_in.quantity_value,
            unit=ing_in.unit,
            quantity_type=ing_in.quantity_type,
            notes=ing_in.notes,
            position=ing_in.position,
        ))

    for step_in in recipe_in.steps:
        db.add(Step(
            recipe_id=new_recipe.id,
            position=step_in.position,
            content=step_in.content,
            section_header=step_in.section_header,
        ))

    db.commit()
    db.refresh(new_recipe)
    return new_recipe

@router.get("", response_model=list[RecipeResponse])
def list_recipes(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return db.query(Recipe).filter(
        Recipe.user_id == current_user.id,
        Recipe.deleted_at == None
    ).options(
        selectinload(Recipe.ingredient_sections).selectinload(IngredientSection.ingredients),
        selectinload(Recipe.ingredients),
        selectinload(Recipe.steps)
    ).all()

@router.get("/{recipe_id}", response_model=RecipeResponse)
def get_recipe(
    recipe_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    recipe = db.query(Recipe).filter(
        Recipe.id == recipe_id,
        Recipe.user_id == current_user.id,
        Recipe.deleted_at == None
    ).options(
        selectinload(Recipe.ingredient_sections).selectinload(IngredientSection.ingredients),
        selectinload(Recipe.ingredients),
        selectinload(Recipe.steps)
    ).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return recipe
