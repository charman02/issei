from app.database import Base

from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

class IngredientSection(Base):
    __tablename__ = "ingredient_sections"

    id: Mapped[int] = mapped_column(primary_key=True)
    recipe_id: Mapped[int] = mapped_column(ForeignKey("recipes.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column()
    position: Mapped[int] = mapped_column()
