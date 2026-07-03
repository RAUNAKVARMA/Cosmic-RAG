"""Multi-provider LLM router: Ollama (local) + OpenAI-compatible APIs (NVIDIA, DeepSeek, Groq)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import List, Optional

try:
    import httpx

    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False

try:
    from openai import OpenAI

    OPENAI_SDK_AVAILABLE = True
except ImportError:
    OPENAI_SDK_AVAILABLE = False
    OpenAI = None  # type: ignore

SYSTEM_PROMPT = (
    "You are Cosmic RAG, a helpful assistant. Answer using the provided context when relevant. "
    "If the context does not contain enough information, say so clearly."
)


@dataclass(frozen=True)
class LLMModel:
    id: str
    label: str
    provider: str
    model: str
    base_url: Optional[str] = None
    api_key_env: Optional[str] = None
    local: bool = False
    priority: int = 100

    def is_available(self) -> bool:
        if self.local:
            return True
        if not self.api_key_env:
            return False
        key = (os.getenv(self.api_key_env) or "").strip()
        if not key or key.endswith("_here") or "your_key" in key.lower():
            return False
        if self.provider in ("openai_compat", "nvidia", "deepseek", "groq"):
            return OPENAI_SDK_AVAILABLE
        return False


def _ollama_base() -> str:
    return (os.getenv("OLLAMA_BASE_URL") or "http://localhost:11434").rstrip("/")


def _ollama_model_name() -> str:
    return (os.getenv("OLLAMA_MODEL") or "llama3.1").strip()


def _build_catalog() -> List[LLMModel]:
    ollama_model = _ollama_model_name()
    nvidia_model = (os.getenv("NVIDIA_MODEL") or "nvidia/nemotron-3-ultra-550b-a55b").strip()
    deepseek_model = (os.getenv("DEEPSEEK_MODEL") or "deepseek-chat").strip()
    groq_model = (os.getenv("GROQ_MODEL") or "llama-3.3-70b-versatile").strip()

    return [
        LLMModel("auto", "Auto Router", "router", "auto", priority=0),
        LLMModel(
            f"ollama:{ollama_model}",
            f"Ollama {ollama_model}",
            "ollama",
            ollama_model,
            base_url=_ollama_base(),
            local=True,
            priority=10,
        ),
        LLMModel(
            "nvidia:nemotron",
            "NVIDIA Nemotron",
            "nvidia",
            nvidia_model,
            base_url=(os.getenv("NVIDIA_BASE_URL") or "https://integrate.api.nvidia.com/v1").rstrip("/"),
            api_key_env="NVIDIA_API_KEY",
            priority=20,
        ),
        LLMModel(
            "deepseek:chat",
            "DeepSeek Chat",
            "deepseek",
            deepseek_model,
            base_url=(os.getenv("DEEPSEEK_BASE_URL") or "https://api.deepseek.com/v1").rstrip("/"),
            api_key_env="DEEPSEEK_API_KEY",
            priority=30,
        ),
        LLMModel(
            "groq:llama",
            "Groq Llama 3.3",
            "groq",
            groq_model,
            base_url="https://api.groq.com/openai/v1",
            api_key_env="GROQ_API_KEY",
            priority=40,
        ),
    ]


def list_models() -> List[dict]:
    out: List[dict] = []
    for m in _build_catalog():
        available = m.id == "auto" or m.is_available()
        if m.provider == "ollama" and HTTPX_AVAILABLE:
            available = _check_ollama_reachable()
        out.append(
            {
                "id": m.id,
                "label": m.label,
                "provider": m.provider,
                "available": available,
            }
        )
    return out


def _check_ollama_reachable() -> bool:
    if not HTTPX_AVAILABLE:
        return False
    try:
        with httpx.Client(timeout=2.0) as client:
            r = client.get(f"{_ollama_base()}/api/tags")
            return r.status_code == 200
    except Exception:
        return False


def _resolve_model(model_id: Optional[str]) -> Optional[LLMModel]:
    catalog = {m.id: m for m in _build_catalog()}
    if model_id and model_id in catalog and model_id != "auto":
        return catalog[model_id]
    default = (os.getenv("LLM_DEFAULT_MODEL") or "auto").strip()
    if default != "auto" and default in catalog:
        return catalog[default]
    return None


def _auto_candidates() -> List[LLMModel]:
    models = [m for m in _build_catalog() if m.id != "auto"]
    models.sort(key=lambda x: x.priority)
    return [m for m in models if m.is_available() or (m.provider == "ollama" and _check_ollama_reachable())]


def _chat_messages(context: str, query: str) -> List[dict]:
    user_content = f"Context from documents:\n{context}\n\nQuestion: {query}" if context.strip() else query
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]


def _call_ollama(model: LLMModel, messages: List[dict]) -> str:
    if not HTTPX_AVAILABLE:
        raise RuntimeError("httpx is not installed. Run: pip install httpx")
    base = model.base_url or _ollama_base()
    payload = {
        "model": model.model,
        "messages": messages,
        "stream": False,
        "options": {"temperature": 0.7},
    }
    try:
        with httpx.Client(timeout=120.0) as client:
            r = client.post(f"{base}/api/chat", json=payload)
            r.raise_for_status()
            data = r.json()
            msg = data.get("message") or {}
            content = msg.get("content") or ""
            if content:
                return content
            raise RuntimeError("Ollama returned an empty response.")
    except httpx.ConnectError:
        raise RuntimeError(
            "Ollama is not running. Start it with `ollama serve`, then pull a model "
            f"(e.g. `ollama pull {model.model}`)."
        ) from None


def _call_openai_compat(model: LLMModel, messages: List[dict]) -> str:
    if not OPENAI_SDK_AVAILABLE:
        raise RuntimeError("openai package is not installed. Run: pip install openai")
    env_name = model.api_key_env or ""
    api_key = (os.getenv(env_name) or "").strip()
    if not api_key:
        raise RuntimeError(
            f"{env_name} is missing. Add it to backend/.env and restart the FastAPI server."
        )
    base_url = model.base_url
    if not base_url:
        raise RuntimeError(f"No base URL configured for model {model.id}.")
    client = OpenAI(api_key=api_key, base_url=base_url)
    try:
        completion = client.chat.completions.create(
            model=model.model,
            messages=messages,
            temperature=0.7,
            max_tokens=512,
        )
        return completion.choices[0].message.content or ""
    except Exception as exc:
        err = f"{type(exc).__name__}: {exc}".lower()
        provider = model.label
        if "401" in err or "invalid" in err and "key" in err or "authentication" in err:
            raise RuntimeError(
                f"{provider} rejected the API key (invalid or expired).\n\n"
                f"Update {env_name} in backend/.env and restart the server.\n\n"
                "Your documents were retrieved; only the LLM call failed."
            ) from exc
        raise RuntimeError(f"{provider} error: {type(exc).__name__}: {exc}") from exc


def _invoke(model: LLMModel, context: str, query: str) -> str:
    messages = _chat_messages(context, query)
    if model.provider == "ollama":
        return _call_ollama(model, messages)
    if model.provider in ("nvidia", "deepseek", "groq", "openai_compat"):
        return _call_openai_compat(model, messages)
    raise RuntimeError(f"Unsupported provider: {model.provider}")


def generate_answer(context: str, query: str, model_id: Optional[str] = None) -> str:
    """Generate an answer using the selected model or auto-router fallbacks."""
    selected = _resolve_model(model_id)
    candidates: List[LLMModel] = []

    if model_id == "auto" or (not model_id and (os.getenv("LLM_DEFAULT_MODEL") or "auto").strip() == "auto"):
        candidates = _auto_candidates()
    elif selected:
        candidates = [selected]
    else:
        candidates = _auto_candidates()

    if not candidates:
        return (
            "No LLM provider is configured.\n\n"
            "Options:\n"
            "• Start Ollama locally (`ollama serve`) and pull a model\n"
            "• Add NVIDIA_API_KEY, DEEPSEEK_API_KEY, or GROQ_API_KEY to backend/.env\n\n"
            "Your documents were retrieved; only the LLM call failed."
        )

    errors: List[str] = []
    for model in candidates:
        try:
            if model.provider == "ollama" and not _check_ollama_reachable():
                raise RuntimeError(
                    "Ollama is not running. Start it with `ollama serve` and pull a model."
                )
            if not model.local and not model.is_available():
                raise RuntimeError(
                    f"{model.label} is not configured. Set {model.api_key_env} in backend/.env."
                )
            return _invoke(model, context, query)
        except Exception as exc:
            errors.append(f"{model.label}: {exc}")
            if model_id and model_id != "auto":
                break

    if len(errors) == 1:
        return str(errors[0]).split(": ", 1)[-1] if ": " in errors[0] else errors[0]
    return (
        "All configured LLM providers failed:\n\n"
        + "\n".join(f"• {e}" for e in errors)
        + "\n\nYour documents were retrieved; only the LLM call failed."
    )
