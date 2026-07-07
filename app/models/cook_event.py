from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database import Base


class CookEvent(Base):
    """One person cooking a recipe. Powers the cook COUNT on a node; deliberately
    does NOT create a lineage node (only a remix does)."""
    __tablename__ = "cook_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    recipe_id: Mapped[int] = mapped_column(
        ForeignKey("recipes.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    cooked_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    photo_url: Mapped[Optional[str]] = mapped_column(nullable=True)
    note: Mapped[Optional[str]] = mapped_column(nullable=True)
