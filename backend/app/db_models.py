"""ORM models for persistent document and chunk storage."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class DocumentRow(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(512), nullable=False)
    file_type: Mapped[str] = mapped_column(String(32), nullable=False, default="txt")
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now)

    chunks: Mapped[list["ChunkRow"]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="ChunkRow.chunk_index",
    )


class ChunkRow(Base):
    __tablename__ = "chunks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    doc_id: Mapped[str] = mapped_column(String(36), ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    document_name: Mapped[str] = mapped_column(String(512), nullable=False, default="")

    document: Mapped["DocumentRow"] = relationship(back_populates="chunks")
