from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.auth import get_current_user
from app.models.user import User
from app.models.recipe import Recipe
from app.models.ingredient_section import IngredientSection
from app.models.ingredient import Ingredient
from app.models.step import Step
from app.models.ghost_ancestor import GhostAncestor
from app.models.cook_event import CookEvent
from app.models.handoff import Handoff
from app.schemas.recipe import RecipeCreate, RecipeResponse, RecipeUpdate, IngredientResponse, StepResponse, RemixIn, CookIn, HandoffIn, HandoffResponse, LineageView
from app.services.scaling import scale_ingredient
from app.services.lineage import diff_recipes, build_lineage_view, effective_visibility

from datetime import datetime, timezone

router = APIRouter(prefix="/recipes", tags=["recipes"])


def _attach_growth_fields(recipe, db):
    """Compute the growth-state counts the frontend reads. Small N per request."""
    cooks = db.query(CookEvent).filter(CookEvent.recipe_id == recipe.id).all()
    recipe.cook_count = len(cooks)
    recipe.owner_cook_count = sum(1 for c in cooks if c.user_id == recipe.user_id)
    recipe.last_cooked_at = max((c.cooked_at for c in cooks), default=None)
    child_ids = [r.id for r in db.query(Recipe.id).filter(
        Recipe.parent_recipe_id == recipe.id, Recipe.deleted_at == None
    ).all()]
    recipe.child_count = len(child_ids)
    recipe.has_grandchildren = bool(child_ids) and db.query(Recipe.id).filter(
        Recipe.parent_recipe_id.in_(child_ids), Recipe.deleted_at == None
    ).first() is not None
    return recipe


@router.post("", response_model=RecipeResponse, status_code=status.HTTP_201_CREATED)
def create_recipe(
    recipe_in: RecipeCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    new_recipe = Recipe(
        user_id=current_user.id,
        name=recipe_in.name,
        cover_photo_url=recipe_in.cover_photo_url,
        description=recipe_in.description,
        story=recipe_in.story,
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

    # Plant the origin: a ghost ancestor makes recipe #1 a two-generation lineage.
    if recipe_in.origin is not None:
        o = recipe_in.origin
        db.add(GhostAncestor(
            recipe_id=new_recipe.id,
            name=o.name, place=o.place, year=o.year, memory=o.memory,
        ))
        parts = [o.name] + [p for p in (o.place, o.year) if p]
        new_recipe.origin_attribution = " · ".join(parts)

    for section_in in recipe_in.ingredient_sections:
        new_section = IngredientSection(
            recipe_id=new_recipe.id,
            name=section_in.name,
            position=section_in.position,
        )
        db.add(new_section)
        db.flush()

        for ing_in in section_in.ingredients:
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

@router.post("/{recipe_id}/remix", response_model=RecipeResponse,
             status_code=status.HTTP_201_CREATED)
def remix_recipe(
    recipe_id: int,
    remix_in: RemixIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    parent = db.query(Recipe).filter(
        Recipe.id == recipe_id, Recipe.deleted_at == None
    ).options(
        selectinload(Recipe.ingredients), selectinload(Recipe.steps)
    ).first()
    if not parent:
        raise HTTPException(status_code=404, detail="Recipe not found")

    # Only a change branches; describe it to pre-fill the prompt.
    diff = diff_recipes(parent.ingredients, parent.steps,
                        remix_in.ingredients, remix_in.steps)

    # Edited scalars override the inherited parent value; omitted ones inherit.
    def _inherit(edited, parent_value):
        return edited if edited is not None else parent_value

    child = Recipe(
        user_id=current_user.id,
        name=_inherit(remix_in.name, parent.name),
        cover_photo_url=parent.cover_photo_url,
        description=_inherit(remix_in.description, parent.description),
        notes=_inherit(remix_in.notes, parent.notes),
        servings=_inherit(remix_in.servings, parent.servings),
        prep_time_minutes=parent.prep_time_minutes,
        cuisine=_inherit(remix_in.cuisine, parent.cuisine),
        diet=parent.diet,
        source=parent.source,  # source carried from parent; story NOT carried
        language=parent.language,
        parent_recipe_id=parent.id,
        lineage_relation="remixed",
        prompt_key=diff["prompt_key"],
        prompt_answer=remix_in.prompt_answer,
    )
    db.add(child)
    db.flush()

    for ing_in in remix_in.ingredients:
        db.add(Ingredient(
            recipe_id=child.id, section_id=None,
            name=ing_in.name, quantity_text=ing_in.quantity_text,
            quantity_value=ing_in.quantity_value, unit=ing_in.unit,
            quantity_type=ing_in.quantity_type, notes=ing_in.notes,
            position=ing_in.position,
        ))
    for step_in in remix_in.steps:
        db.add(Step(
            recipe_id=child.id, position=step_in.position,
            content=step_in.content, section_header=step_in.section_header,
        ))

    db.commit()
    db.refresh(child)
    return child

@router.post("/{recipe_id}/handoff", response_model=HandoffResponse,
             status_code=status.HTTP_201_CREATED)
def handoff_recipe(
    recipe_id: int,
    handoff_in: HandoffIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    recipe = db.query(Recipe).filter(
        Recipe.id == recipe_id,
        Recipe.user_id == current_user.id,
        Recipe.deleted_at == None,
    ).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    handoff = Handoff(
        recipe_id=recipe_id, from_user_id=current_user.id,
        to_user_id=handoff_in.to_user_id, to_email=handoff_in.to_email,
        state="pending", note=handoff_in.note,
    )
    db.add(handoff)
    db.commit()
    db.refresh(handoff)
    return handoff

@router.post("/{recipe_id}/cook")
def cook_recipe(
    recipe_id: int,
    cook_in: CookIn | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    recipe = db.query(Recipe).filter(
        Recipe.id == recipe_id, Recipe.deleted_at == None
    ).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    db.add(CookEvent(
        recipe_id=recipe_id, user_id=current_user.id,
        photo_url=(cook_in.photo_url if cook_in else None),
        note=(cook_in.note if cook_in else None),
    ))
    db.commit()
    count = db.query(CookEvent).filter(CookEvent.recipe_id == recipe_id).count()
    return {"cook_count": count}

@router.get("", response_model=list[RecipeResponse])
def list_recipes(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    recipes = db.query(Recipe).filter(
        Recipe.user_id == current_user.id,
        Recipe.deleted_at == None
    ).options(
        selectinload(Recipe.ingredient_sections).selectinload(IngredientSection.ingredients),
        selectinload(Recipe.ingredients),
        selectinload(Recipe.steps),
        selectinload(Recipe.user)
    ).all()
    for r in recipes:
        _attach_growth_fields(r, db)
    return recipes

@router.get("/browse", response_model=list[RecipeResponse])
def browse_recipes(db: Session = Depends(get_db)):
    recipes = db.query(Recipe).filter(
        Recipe.deleted_at == None
    ).options(
        selectinload(Recipe.ingredient_sections).selectinload(IngredientSection.ingredients),
        selectinload(Recipe.ingredients),
        selectinload(Recipe.steps),
        selectinload(Recipe.user)
    ).order_by(Recipe.created_at.desc()).all()
    recipes = [r for r in recipes if effective_visibility(r, db) == "public"]
    for r in recipes:
        _attach_growth_fields(r, db)
        # Browse is unauthenticated — don't leak per-owner activity on the public
        # feed. The growth badge only needs cook_count/child_count/has_grandchildren.
        r.owner_cook_count = 0
        r.last_cooked_at = None
    return recipes

@router.get("/{recipe_id}", response_model=RecipeResponse)
def get_recipe(
    recipe_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Viewable by the owner, or by anyone if the recipe's effective visibility
    # (its root's visibility) is public; otherwise 404. Editing/deleting remains
    # owner-only — see patch_recipe.
    recipe = db.query(Recipe).filter(
        Recipe.id == recipe_id,
        Recipe.deleted_at == None
    ).options(
        selectinload(Recipe.ingredient_sections).selectinload(IngredientSection.ingredients),
        selectinload(Recipe.ingredients),
        selectinload(Recipe.steps),
        selectinload(Recipe.user)
    ).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if recipe.user_id != current_user.id and effective_visibility(recipe, db) != "public":
        raise HTTPException(status_code=404, detail="Recipe not found")
    _attach_growth_fields(recipe, db)
    return recipe

@router.get("/{recipe_id}/lineage", response_model=LineageView)
def get_lineage(
    recipe_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    recipe = db.query(Recipe).filter(
        Recipe.id == recipe_id, Recipe.deleted_at == None
    ).options(selectinload(Recipe.user)).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if recipe.user_id != current_user.id and effective_visibility(recipe, db) != "public":
        raise HTTPException(status_code=404, detail="Recipe not found")
    return build_lineage_view(recipe, db)

@router.get("/{recipe_id}/scale", response_model=RecipeResponse)
def get_scaled_recipe(
    recipe_id: int,
    servings: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Viewable by any logged-in user, like get_recipe.
    recipe = db.query(Recipe).filter(
        Recipe.id == recipe_id,
        Recipe.deleted_at == None
    ).options(
        selectinload(Recipe.ingredient_sections).selectinload(IngredientSection.ingredients),
        selectinload(Recipe.ingredients),
        selectinload(Recipe.steps),
        selectinload(Recipe.user)
    ).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    if recipe.servings is None:
        raise HTTPException(
            status_code=400,
            detail="Recipe does not have servings set - cannot scale"
        )
    
    multiplier = servings / recipe.servings

    # scale ingredients within sections
    scaled_sections = []
    for section in recipe.ingredient_sections:
        scaled_section_ings = [
            IngredientResponse.model_validate(scale_ingredient(ing, multiplier))
            for ing in section.ingredients
        ]
        scaled_sections.append({
            "id": section.id,
            "name": section.name,
            "position": section.position,
            "ingredients": scaled_section_ings
        })

    scaled_ingredients = [
        IngredientResponse.model_validate(scale_ingredient(ing, multiplier))
        for ing in recipe.ingredients
    ]
    
    response_dict = {
        "id": recipe.id,
        "user_id": recipe.user_id,
        "name": recipe.name,
        "author_full_name": recipe.author_full_name,
        "cover_photo_url": recipe.cover_photo_url,
        "description": recipe.description,
        "story": recipe.story,
        "servings": servings,  # return TARGET servings, not original
        "prep_time_minutes": recipe.prep_time_minutes,
        "cuisine": recipe.cuisine,
        "diet": recipe.diet,
        "source": recipe.source,
        "notes": recipe.notes,
        "language": recipe.language,
        "created_at": recipe.created_at,
        "deleted_at": recipe.deleted_at,
        "ingredient_sections": scaled_sections,
        "ingredients": scaled_ingredients,
        "steps": [StepResponse.model_validate(s) for s in recipe.steps]
    }

    return RecipeResponse.model_validate(response_dict)

@router.patch("/{recipe_id}", response_model=RecipeResponse)
def patch_recipe(
    recipe_in: RecipeUpdate,
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
        selectinload(Recipe.steps),
        selectinload(Recipe.user)
    ).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    # Which child collections did the client actually send? Use the dumped
    # set to detect presence, but read the values off the Pydantic model so
    # they stay as typed objects (IngredientCreate/StepCreate), not dicts.
    sent_fields = recipe_in.model_dump(exclude_unset=True)
    sections_sent = "ingredient_sections" in sent_fields
    ingredients_sent = "ingredients" in sent_fields
    steps_sent = "steps" in sent_fields

    new_sections = recipe_in.ingredient_sections if sections_sent else None
    new_ingredients = recipe_in.ingredients if ingredients_sent else None
    new_steps = recipe_in.steps if steps_sent else None

    # Apply scalar fields only (skip the child collections handled below).
    scalar_fields = {
        k: v for k, v in sent_fields.items()
        if k not in ("ingredient_sections", "ingredients", "steps")
    }
    for field, value in scalar_fields.items():
        setattr(recipe, field, value)

    # Replace children only when the client provided that collection. We bulk-
    # delete existing rows by recipe_id (synchronize_session=False bypasses ORM
    # instance tracking, avoiding stale-instance conflicts with the delete-orphan
    # cascade) and re-insert fresh. IDs aren't referenced externally, so
    # reassigning them is harmless. A fresh re-query happens after commit.
    recipe_id_val = recipe.id

    if sections_sent or ingredients_sent:
        db.query(Ingredient).filter(
            Ingredient.recipe_id == recipe_id_val
        ).delete(synchronize_session=False)
        db.query(IngredientSection).filter(
            IngredientSection.recipe_id == recipe_id_val
        ).delete(synchronize_session=False)
        db.flush()

        for section_in in (new_sections or []):
            new_section = IngredientSection(
                recipe_id=recipe_id_val,
                name=section_in.name,
                position=section_in.position,
            )
            db.add(new_section)
            db.flush()
            for ing_in in section_in.ingredients:
                db.add(Ingredient(
                    recipe_id=recipe_id_val,
                    section_id=new_section.id,
                    name=ing_in.name,
                    quantity_text=ing_in.quantity_text,
                    quantity_value=ing_in.quantity_value,
                    unit=ing_in.unit,
                    quantity_type=ing_in.quantity_type,
                    notes=ing_in.notes,
                    position=ing_in.position,
                ))

        for ing_in in (new_ingredients or []):
            db.add(Ingredient(
                recipe_id=recipe_id_val,
                section_id=None,
                name=ing_in.name,
                quantity_text=ing_in.quantity_text,
                quantity_value=ing_in.quantity_value,
                unit=ing_in.unit,
                quantity_type=ing_in.quantity_type,
                notes=ing_in.notes,
                position=ing_in.position,
            ))

    if steps_sent:
        db.query(Step).filter(
            Step.recipe_id == recipe_id_val
        ).delete(synchronize_session=False)
        db.flush()
        for step_in in new_steps:
            db.add(Step(
                recipe_id=recipe_id_val,
                position=step_in.position,
                content=step_in.content,
                section_header=step_in.section_header,
            ))

    db.commit()

    # Re-fetch a clean instance with children eagerly loaded (don't refresh the
    # working instance, whose relationship collections may hold deleted rows).
    db.expire_all()
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id_val).options(
        selectinload(Recipe.ingredient_sections).selectinload(IngredientSection.ingredients),
        selectinload(Recipe.ingredients),
        selectinload(Recipe.steps),
        selectinload(Recipe.user)
    ).first()
    return recipe

@router.delete("/{recipe_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recipe(
    recipe_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    recipe = db.query(Recipe).filter(
        Recipe.id == recipe_id,
        Recipe.user_id == current_user.id,
        Recipe.deleted_at == None
    ).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    
    recipe.deleted_at = datetime.now(timezone.utc)

    db.add(recipe)
    db.commit()
