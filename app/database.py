from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

is_sqlite = "sqlite" in settings.database_url

# Postgres (Neon) closes idle connections server-side, so a pooled connection
# can be dead by the time it's reused — causing an intermittent 500 on the first
# request after an idle period. pool_pre_ping tests each connection with a cheap
# query before handing it out (replacing it transparently if dead), and
# pool_recycle proactively retires connections before Neon's idle timeout.
# SQLite is a local file with no pooling concerns, so these don't apply.
engine = create_engine(
    settings.database_url,
    # SQLite requires this to allow usage across threads in FastAPI's async
    # context
    connect_args={"check_same_thread": False} if is_sqlite else {},
    pool_pre_ping=not is_sqlite,
    pool_recycle=300 if not is_sqlite else -1,
)

if is_sqlite:

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
