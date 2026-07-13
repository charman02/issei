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
    from app.models.user import User


class Recipe(Base):
    __tablename__ = "recipes"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column()
    cover_photo_url: Mapped[Optional[str]] = mapped_column(nullable=True)
    description: Mapped[Optional[str]] = mapped_column(nullable=True)
    story: Mapped[Optional[str]] = mapped_column(nullable=True)
    servings: Mapped[Optional[int]] = mapped_column(nullable=True)
    prep_time_minutes: Mapped[Optional[int]] = mapped_column(nullable=True)
    cuisine: Mapped[Optional[str]] = mapped_column(nullable=True)
    diet: Mapped[Optional[str]] = mapped_column(nullable=True)
    source: Mapped[Optional[str]] = mapped_column(nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(nullable=True)
    language: Mapped[str] = mapped_column(server_default="en")
    # --- Lineage (see 2026-07-06 signature-feature spec) ---
    parent_recipe_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("recipes.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # "root" | "kept" | "remixed" — app-validated string (portable across SQLite/Postgres)
    lineage_relation: Mapped[str] = mapped_column(server_default="root")
    origin_attribution: Mapped[Optional[str]] = mapped_column(nullable=True)
    # "private" | "public" — effective visibility is the ROOT's (see services/lineage.py)
    visibility: Mapped[str] = mapped_column(server_default="private")
    prompt_key: Mapped[Optional[str]] = mapped_column(nullable=True)
    prompt_answer: Mapped[Optional[str]] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)
    ingredient_sections: Mapped[list["IngredientSection"]] = relationship(
        "IngredientSection", back_populates="recipe", cascade="all, delete-orphan"
    )
    ingredients: Mapped[list["Ingredient"]] = relationship(
        "Ingredient",
        primaryjoin="and_(Ingredient.recipe_id==Recipe.id, Ingredient.section_id==None)",
        cascade="all, delete-orphan",
        foreign_keys="[Ingredient.recipe_id]",
    )
    steps: Mapped[list["Step"]] = relationship(
        "Step", back_populates="recipe", cascade="all, delete-orphan"
    )
    user: Mapped["User"] = relationship("User")
    parent: Mapped[Optional["Recipe"]] = relationship(
        "Recipe", remote_side="Recipe.id", back_populates="children"
    )
    children: Mapped[list["Recipe"]] = relationship(
        "Recipe",
        back_populates="parent",
        primaryjoin="Recipe.id==Recipe.parent_recipe_id",
    )

    @property
    def author_full_name(self) -> str:
        return f"{self.user.first_name} {self.user.last_name}"
