from typing import Optional
from datetime import datetime
from pydantic import BaseModel, ConfigDict

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


class RecipeResponse(BaseModel):
    id: int
    user_id: int
    name: str
    author_full_name: Optional[str] = None
    cover_photo_url: Optional[str] = None
    description: Optional[str] = None
    servings: Optional[int] = None
    prep_time_minutes: Optional[int] = None
    cuisine: Optional[str] = None
    diet: Optional[str] = None
    source: Optional[str] = None
    notes: Optional[str] = None
    language: str
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
    servings: Optional[int] = None
    prep_time_minutes: Optional[int] = None
    cuisine: Optional[str] = None
    diet: Optional[str] = None
    source: Optional[str] = None
    notes: Optional[str] = None
    language: Optional[str] = None
