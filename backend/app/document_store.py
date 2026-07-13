"""Persist documents and chunks; rebuild in-memory state from the database."""

from __future__ import annotations

from typing import List, Optional, Tuple

from app.database import db_session
from app.db_models import ChunkRow, DocumentRow
from app.knowledge_graph import KnowledgeGraphBuilder


def save_document(
    doc_id: str,
    name: str,
    file_type: str,
    content: str,
    chunks: List[str],
) -> None:
    with db_session() as session:
        row = DocumentRow(
            id=doc_id,
            name=name,
            file_type=file_type,
            content=content,
            chunk_count=len(chunks),
        )
        session.add(row)
        for index, text in enumerate(chunks):
            session.add(
                ChunkRow(
                    doc_id=doc_id,
                    chunk_index=index,
                    text=text,
                    document_name=name,
                )
            )


def list_documents_summary() -> List[dict]:
    with db_session() as session:
        rows = session.query(DocumentRow).order_by(DocumentRow.created_at.desc()).all()
        return [
            {
                "id": row.id,
                "name": row.name,
                "type": row.file_type,
                "chunks": row.chunk_count,
            }
            for row in rows
        ]


def load_all_chunks() -> Tuple[List[str], List[dict]]:
    """Return chunk texts and metadata for FAISS rebuild."""
    texts: List[str] = []
    metadata: List[dict] = []
    with db_session() as session:
        rows = (
            session.query(ChunkRow)
            .order_by(ChunkRow.doc_id, ChunkRow.chunk_index)
            .all()
        )
        for row in rows:
            texts.append(row.text)
            metadata.append(
                {
                    "doc_id": row.doc_id,
                    "chunk_index": row.chunk_index,
                    "document": row.document_name,
                }
            )
    return texts, metadata


def load_documents_for_knowledge_graph() -> List[dict]:
    with db_session() as session:
        rows = session.query(DocumentRow).all()
        out: List[dict] = []
        for row in rows:
            chunk_texts = [c.text for c in sorted(row.chunks, key=lambda c: c.chunk_index)]
            out.append(
                {
                    "id": row.id,
                    "name": row.name,
                    "file_type": row.file_type,
                    "content": row.content,
                    "chunks": chunk_texts,
                }
            )
        return out


def document_count() -> int:
    with db_session() as session:
        return session.query(DocumentRow).count()


def chunk_count() -> int:
    with db_session() as session:
        return session.query(ChunkRow).count()


def hydrate_knowledge_graph(kg: KnowledgeGraphBuilder) -> None:
    for doc in load_documents_for_knowledge_graph():
        kg.add_document(
            doc["id"],
            doc["content"],
            doc["chunks"],
            name=doc["name"],
            file_type=doc["file_type"],
        )
