from app.database import Base

from datetime import datetime
from typing import Optional
from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func


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
