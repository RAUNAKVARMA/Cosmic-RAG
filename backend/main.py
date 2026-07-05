from datetime import datetime, timezone
import os
import uuid
from typing import List, Literal, Optional

from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Always load .env next to this file (works even if uvicorn cwd is elsewhere).
load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

from app.document_parser import extract_text_from_bytes
from app.image_gen import ImageGenError, generate_image, list_image_models
from app.knowledge_graph import KnowledgeGraphBuilder
from app.llm_router import list_models
from app.rag_engine import RAGEngine
from app.vector_store import VectorStore

app = FastAPI(title="Cosmic RAG API")

ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003,"
        "http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:3002,http://127.0.0.1:3003,"
        "https://et-t-project.vercel.app,https://et-t-project-doqi.vercel.app",
    ).split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

#deployment for fastapi
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt", ".md", ".csv"}

vector_store = VectorStore()
knowledge_graph = KnowledgeGraphBuilder()
rag_engine = RAGEngine(vector_store, knowledge_graph)


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    model_id: Optional[str] = None
    history: Optional[List[ChatTurn]] = None


class ModelInfo(BaseModel):
    id: str
    label: str
    provider: str
    available: bool


class ChatResponse(BaseModel):
    answer: str
    sources: Optional[List[dict]] = None
    timestamp: str


class ImageModelInfo(BaseModel):
    id: str
    label: str
    vendor: str
    output: str
    available: bool
    supports_steps: bool
    supports_negative_prompt: bool
    supports_mode: bool
    modes: List[str]
    default_steps: Optional[int] = None
    description: str = ""


class GenerateImageRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    model_id: str = Field(..., min_length=1)
    seed: int = 0
    steps: Optional[int] = Field(default=None, ge=1, le=100)
    negative_prompt: Optional[str] = None
    mode: Optional[str] = None


class GenerateImageResponse(BaseModel):
    image: str
    mime: str
    model_id: str
    seed: int
    output: str
    timestamp: str


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok"}


@app.get("/models", response_model=List[ModelInfo])
def get_models() -> List[ModelInfo]:
    return [ModelInfo(**m) for m in list_models()]


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    try:
        history_payload = (
            [{"role": t.role, "content": t.content} for t in request.history]
            if request.history
            else None
        )
        answer, sources = rag_engine.answer_query(
            request.message,
            model_id=request.model_id,
            history=history_payload,
        )
        return ChatResponse(answer=answer, sources=sources, timestamp=_utc_iso())
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Unable to complete chat request.") from exc


@app.get("/image-models", response_model=List[ImageModelInfo])
def get_image_models() -> List[ImageModelInfo]:
    return [ImageModelInfo(**m) for m in list_image_models()]


@app.post("/generate-image", response_model=GenerateImageResponse)
def generate_image_endpoint(request: GenerateImageRequest) -> GenerateImageResponse:
    import base64 as _b64

    try:
        raw, mime, meta = generate_image(
            model_id=request.model_id,
            prompt=request.prompt,
            seed=request.seed,
            steps=request.steps,
            negative_prompt=request.negative_prompt,
            mode=request.mode,
        )
    except ImageGenError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Unable to generate image.") from exc

    data_uri = f"data:{mime};base64,{_b64.b64encode(raw).decode('ascii')}"
    return GenerateImageResponse(
        image=data_uri,
        mime=mime,
        model_id=str(meta.get("model_id", request.model_id)),
        seed=int(meta.get("seed", request.seed)),
        output=str(meta.get("output", "image")),
        timestamp=_utc_iso(),
    )


@app.get("/documents")
def list_documents() -> List[dict]:
    """Return metadata for documents currently in the knowledge graph."""
    out: List[dict] = []
    for doc_id, meta in knowledge_graph.documents.items():
        chunks = meta.get("chunks") or []
        out.append(
            {
                "id": doc_id,
                "name": meta.get("name", doc_id),
                "type": meta.get("file_type", "unknown"),
                "chunks": len(chunks),
            }
        )
    return out


@app.post("/upload")
async def upload_document(file: UploadFile = File(...)) -> dict:
    filename = file.filename or "unnamed"
    ext = ""
    if "." in filename:
        ext = "." + filename.rsplit(".", 1)[-1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Allowed: PDF, DOCX, TXT, MD, CSV.",
        )
    try:
        raw = await file.read()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Could not read uploaded file.") from exc

    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="File is empty.")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
        )

    try:
        content = extract_text_from_bytes(filename, raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail="Could not parse document. Check format and encoding.",
        ) from exc

    if not content.strip():
        raise HTTPException(status_code=422, detail="No text could be extracted from this file.")

    doc_id = str(uuid.uuid4())
    chunks = rag_engine.chunk_document(content)
    file_type = ext.lstrip(".")
    meta_rows = [
        {
            "doc_id": doc_id,
            "chunk_index": i,
            "document": filename,
        }
        for i in range(len(chunks))
    ]
    try:
        vector_store.add_vectors(
            rag_engine.embed_chunks(chunks),
            meta_rows,
            chunks,
        )
        knowledge_graph.add_document(doc_id, content, chunks, name=filename, file_type=file_type)
    except Exception as exc:
        msg = str(exc).strip() or type(exc).__name__
        raise HTTPException(
            status_code=500,
            detail=f"Failed to index document: {msg}",
        ) from exc

    return {
        "status": "success",
        "doc_id": doc_id,
        "chunks": len(chunks),
        "name": filename,
        "type": file_type,
    }


@app.get("/knowledge-graph")
def knowledge_graph_snapshot() -> dict:
    """Lightweight summary for debugging or UI."""
    return {
        "document_count": len(knowledge_graph.documents),
        "entity_count": len(knowledge_graph.entities),
    }
