from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database import Base


class GhostAncestor(Base):
    """A named non-user origin for a root recipe — the person who taught it,
    captured at creation so recipe #1 is a two-generation lineage. Editable only
    by its creator until 'woken' (claimed_by_user_id set) — see the signature spec."""

    __tablename__ = "ghost_ancestors"

    id: Mapped[int] = mapped_column(primary_key=True)
    recipe_id: Mapped[int] = mapped_column(ForeignKey("recipes.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column()
    place: Mapped[Optional[str]] = mapped_column(nullable=True)
    year: Mapped[Optional[str]] = mapped_column(nullable=True)
    memory: Mapped[Optional[str]] = mapped_column(nullable=True)
    claimed_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
