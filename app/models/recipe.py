from app.database import Base

from datetime import datetime
from typing import Optional, TYPE_CHECKING
from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

if TYPE_CHECKING:
    from app.models.ingredient_section import IngredientSection
    from app.models.ingredient import Ingredient
    from app.models.step import Step


class Recipe(Base):
    __tablename__ = "recipes"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column()
    description: Mapped[Optional[str]] = mapped_column(nullable=True)
    servings: Mapped[Optional[int]] = mapped_column(nullable=True)
    prep_time_minutes: Mapped[Optional[int]] = mapped_column(nullable=True)
    cuisine: Mapped[Optional[str]] = mapped_column(nullable=True)
    diet: Mapped[Optional[str]] = mapped_column(nullable=True)
    source: Mapped[Optional[str]] = mapped_column(nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(nullable=True)
    language: Mapped[str] = mapped_column(server_default="en")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, nullable=True, index=True
    )
    ingredient_sections: Mapped[list["IngredientSection"]] = relationship(
        "IngredientSection", back_populates="recipe", cascade="all, delete-orphan"
    )
    ingredients: Mapped[list["Ingredient"]] = relationship(
        "Ingredient",
        primaryjoin="and_(Ingredient.recipe_id==Recipe.id, Ingredient.section_id==None)",
        cascade="all, delete-orphan",
        foreign_keys="[Ingredient.recipe_id]"
    )
    steps: Mapped[list["Step"]] = relationship(
        "Step", back_populates="recipe", cascade="all, delete-orphan"
    )
