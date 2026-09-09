from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database import Base


class Handoff(Base):
    """Passing a recipe to a named person (in-app user or an email invite).
    state: 'pending' | 'accepted'. The optional growth act — never a gate."""

    __tablename__ = "handoffs"
    __table_args__ = (
        # Declared HERE as well as in migration a1b2c3d4e5f6, and that is the point: an index
        # that exists only in a migration is invisible to `MetaData`, so autogenerate diffs it
        # as a stray index in the database and emits a DROP for it. `alembic check` was
        # reporting exactly that — and `main` runs migrations against Neon on push, so the
        # next routine --autogenerate would have quietly dropped the index that makes
        # can_view's grant lookup fast. Every index belongs on the model, not just in a file.
        Index("ix_handoffs_grant_lookup", "recipe_id", "to_user_id", "state"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    recipe_id: Mapped[int] = mapped_column(ForeignKey("recipes.id", ondelete="CASCADE"), index=True)
    from_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    to_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    to_email: Mapped[Optional[str]] = mapped_column(nullable=True)
    state: Mapped[str] = mapped_column(server_default="pending")
    note: Mapped[Optional[str]] = mapped_column(nullable=True)
    token: Mapped[Optional[str]] = mapped_column(nullable=True, unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
