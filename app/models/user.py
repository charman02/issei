from datetime import datetime
from sqlalchemy import DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database import Base


class User(Base):
    __tablename__ = "users"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(nullable=False)
    # server_default lets the database generate the timestamp, more reliable
    # than app-side defaults in distributed environments
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )
