from app.database import Base

from typing import Optional, TYPE_CHECKING
from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from app.models.recipe import Recipe
    from app.models.ingredient_section import IngredientSection

class Ingredient(Base):
    __tablename__ = "ingredients"

    id: Mapped[int] = mapped_column(primary_key=True)
    recipe_id: Mapped[int] = mapped_column(ForeignKey("recipes.id", ondelete="CASCADE"), index=True)
    section_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ingredient_sections.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column()
    quantity_text: Mapped[Optional[str]] = mapped_column(nullable=True)
    quantity_value: Mapped[Optional[float]] = mapped_column(nullable=True)
    unit: Mapped[Optional[str]] = mapped_column(nullable=True)
    quantity_type: Mapped[str] = mapped_column()
    notes: Mapped[Optional[str]] = mapped_column(nullable=True)
    position: Mapped[int] = mapped_column()
    recipe: Mapped["Recipe"] = relationship("Recipe", back_populates="ingredients",
        foreign_keys="[Ingredient.recipe_id]")
    section: Mapped[Optional["IngredientSection"]] = relationship(
        "IngredientSection", back_populates="ingredients"
    )
