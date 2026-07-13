"""SQLAlchemy database setup — PostgreSQL on Render, SQLite locally."""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Generator, Optional

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

Base = declarative_base()

_engine: Optional[Engine] = None
_SessionLocal: Optional[sessionmaker[Session]] = None


def database_url() -> str:
    """Resolve DB URL: DATABASE_URL (Render Postgres) or SQLite on disk."""
    url = (os.getenv("DATABASE_URL") or "").strip()
    if url:
        if url.startswith("postgres://"):
            return url.replace("postgres://", "postgresql://", 1)
        return url
    index_path = (os.getenv("VECTOR_INDEX_PATH") or "").strip()
    if index_path.startswith("/data"):
        return "sqlite:////data/cosmic_rag.db"
    return "sqlite:///./cosmic_rag.db"


def get_engine() -> Engine:
    global _engine, _SessionLocal
    if _engine is None:
        url = database_url()
        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        _engine = create_engine(url, pool_pre_ping=True, connect_args=connect_args)
        _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)
    return _engine


def init_db() -> None:
    """Create tables if they do not exist."""
    from app.db_models import ChunkRow, DocumentRow  # noqa: F401

    engine = get_engine()
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
        conn.commit()


def session_factory() -> sessionmaker[Session]:
    get_engine()
    assert _SessionLocal is not None
    return _SessionLocal


@contextmanager
def db_session() -> Generator[Session, None, None]:
    factory = session_factory()
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def is_connected() -> bool:
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
