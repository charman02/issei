from typing import Optional
from datetime import datetime
from pydantic import BaseModel, ConfigDict


class OriginIn(BaseModel):
    name: str
    place: Optional[str] = None
    year: Optional[str] = None
    memory: Optional[str] = None


# Step schemas

class StepCreate(BaseModel):
    position: int
    content: str
    section_header: Optional[str] = None


class StepResponse(BaseModel):
    id: int
    position: int
    content: str
    section_header: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# Ingredient schemas

class IngredientCreate(BaseModel):
    name: str
    quantity_text: Optional[str] = None
    quantity_value: Optional[float] = None
    unit: Optional[str] = None
    quantity_type: str = "precise"
    notes: Optional[str] = None
    position: int


class IngredientResponse(BaseModel):
    id: int
    name: str
    quantity_text: Optional[str] = None
    quantity_value: Optional[float] = None
    unit: Optional[str] = None
    quantity_type: str
    notes: Optional[str] = None
    position: int

    model_config = ConfigDict(from_attributes=True)


# IngredientSection schemas

class IngredientSectionCreate(BaseModel):
    name: str
    position: int
    ingredients: list[IngredientCreate] = []


class IngredientSectionResponse(BaseModel):
    id: int
    name: str
    position: int
    ingredients: list[IngredientResponse] = []


    model_config = ConfigDict(from_attributes=True)


# Recipe schemas

class RecipeCreate(BaseModel):
    name: str
    cover_photo_url: Optional[str] = None
    description: Optional[str] = None
    story: Optional[str] = None
    servings: Optional[int] = None
    prep_time_minutes: Optional[int] = None
    cuisine: Optional[str] = None
    diet: Optional[str] = None
    source: Optional[str] = None
    notes: Optional[str] = None
    language: str = "en"
    ingredient_sections: list[IngredientSectionCreate] = []
    ingredients: list[IngredientCreate] = []
    steps: list[StepCreate] = []
    origin: Optional[OriginIn] = None


class RecipeResponse(BaseModel):
    id: int
    user_id: int
    name: str
    author_full_name: Optional[str] = None
    cover_photo_url: Optional[str] = None
    description: Optional[str] = None
    story: Optional[str] = None
    servings: Optional[int] = None
    prep_time_minutes: Optional[int] = None
    cuisine: Optional[str] = None
    diet: Optional[str] = None
    source: Optional[str] = None
    notes: Optional[str] = None
    language: str
    parent_recipe_id: Optional[int] = None
    lineage_relation: str = "root"
    visibility: str = "private"
    origin_attribution: Optional[str] = None
    created_at: datetime
    deleted_at: Optional[datetime] = None
    ingredient_sections: list[IngredientSectionResponse] = []
    ingredients: list[IngredientResponse] = []
    steps: list[StepResponse] = []

    model_config = ConfigDict(from_attributes=True)


class RecipeUpdate(BaseModel):
    name: Optional[str] = None
    cover_photo_url: Optional[str] = None
    description: Optional[str] = None
    story: Optional[str] = None
    servings: Optional[int] = None
    prep_time_minutes: Optional[int] = None
    cuisine: Optional[str] = None
    diet: Optional[str] = None
    source: Optional[str] = None
    notes: Optional[str] = None
    language: Optional[str] = None
    # When provided, these fully replace the recipe's existing children.
    # Omit them to leave the collections untouched (scalar-only update).
    ingredient_sections: Optional[list[IngredientSectionCreate]] = None
    ingredients: Optional[list[IngredientCreate]] = None
    steps: Optional[list[StepCreate]] = None
