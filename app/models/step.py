from app.database import Base

from typing import Optional, TYPE_CHECKING
from sqlalchemy import ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from app.models.recipe import Recipe

class Step(Base):
    __tablename__ = "steps"

    id: Mapped[int] = mapped_column(primary_key=True)
    recipe_id: Mapped[int] = mapped_column(ForeignKey("recipes.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column()
    content: Mapped[str] = mapped_column(Text)
    section_header: Mapped[Optional[str]] = mapped_column(nullable=True)
    voice_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    recipe: Mapped["Recipe"] = relationship("Recipe", back_populates="steps")
