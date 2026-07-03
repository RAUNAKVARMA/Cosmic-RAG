import hashlib
from typing import List, Optional, Tuple

import numpy as np

from app.llm_router import generate_answer

try:
    from fastembed import TextEmbedding

    USE_FASTEMBED = True
except ImportError:
    USE_FASTEMBED = False
    TextEmbedding = None  # type: ignore
    print(
        "Warning: fastembed not installed — using stable pseudo-embeddings. "
        "Install fastembed (may need Rust on Windows) for semantic search."
    )


def _stable_embed(texts: List[str], dim: int = 384) -> np.ndarray:
    """Deterministic vectors when fastembed is unavailable (same text → same vector)."""
    out = np.zeros((len(texts), dim), dtype=np.float32)
    for i, t in enumerate(texts):
        seed = int.from_bytes(hashlib.sha256(t.encode("utf-8", errors="replace")).digest()[:8], "little")
        rng = np.random.default_rng(seed)
        v = rng.standard_normal(dim).astype(np.float32)
        n = float(np.linalg.norm(v)) + 1e-9
        out[i] = v / n
    return out


class RAGEngine:
    def __init__(
        self,
        vector_store,
        knowledge_graph,
        model_name: str = "BAAI/bge-small-en-v1.5",
    ):
        self._embedding_dim = 384
        self.embedding_model = TextEmbedding(model_name=model_name) if USE_FASTEMBED else None
        self.chunk_size = 500
        self.chunk_overlap = 50
        self.vector_store = vector_store
        self.knowledge_graph = knowledge_graph

    def chunk_document(self, text: str) -> List[str]:
        chunks: List[str] = []
        start = 0
        while start < len(text):
            end = min(start + self.chunk_size, len(text))
            chunks.append(text[start:end])
            start += self.chunk_size - self.chunk_overlap
        return chunks

    def embed_chunks(self, chunks: List[str]) -> np.ndarray:
        if self.embedding_model is not None:
            return np.array(list(self.embedding_model.embed(chunks)))
        return _stable_embed(chunks, self._embedding_dim)

    def answer_query(self, query: str, model_id: Optional[str] = None) -> Tuple[str, list]:
        if self.embedding_model is not None:
            query_vec = np.array(list(self.embedding_model.embed([query])))
        else:
            query_vec = _stable_embed([query], self._embedding_dim)
        results = self.vector_store.search(query_vec, top_k=5)
        context = "\n".join([r["text"] for r in results])
        sources = [r["metadata"] for r in results]
        answer = generate_answer(context, query, model_id=model_id)
        if not answer.strip():
            answer = f"[Template] Answer for: {query}\nContext: {context[:200]}..."
        return answer, sources
