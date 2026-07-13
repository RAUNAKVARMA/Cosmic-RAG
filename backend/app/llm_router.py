"""Multi-provider LLM router via LiteLLM."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional

import yaml

try:
    import httpx

    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False

try:
    import litellm
    from litellm import Router, completion

    LITELLM_AVAILABLE = True
except ImportError:
    LITELLM_AVAILABLE = False
    litellm = None  # type: ignore
    Router = None  # type: ignore
    completion = None  # type: ignore

CONFIG_PATH = Path(__file__).resolve().parent.parent / "litellm_config.yaml"

AUTO_PROVIDER_ORDER = (
    "ollama",
    "meta",
    "mistral",
    "qwen",
    "deepseek",
)

SYSTEM_PROMPT = (
    "You are Cosmic RAG, a helpful assistant. Answer using the provided context when relevant. "
    "If the context does not contain enough information, say so clearly."
)

PROVIDER_LABELS = {
    "ollama": "Ollama",
    "meta": "Meta",
    "mistral": "Mistral",
    "qwen": "Qwen",
    "deepseek": "DeepSeek",
    "groq": "Groq",
    "openai": "OpenAI",
    "anthropic": "Anthropic",
    "google": "Google",
    "other": "Other",
}

MODEL_LABEL_OVERRIDES = {
    "llama-4-maverick": "Llama 4 Maverick 17B",
    "mistral-medium-3.5": "Mistral Medium 3.5 128B",
    "qwen3.5-122b": "Qwen 3.5 122B",
    "nemotron-ultra": "Nemotron Ultra",
    "deepseek-v4-pro": "DeepSeek v4 Pro",
    "diffusiongemma-26b": "DiffusionGemma 26B",
    "ollama-llama3.2-1b": "Ollama llama3.2:1b",
}

_ENV_KEY_MARKERS = {
    "NVIDIA_API_KEY": "NVIDIA_API_KEY",
    "GROQ_API_KEY": "GROQ_API_KEY",
    "DEEPSEEK_API_KEY": "DEEPSEEK_API_KEY",
    "OPENAI_API_KEY": "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY": "ANTHROPIC_API_KEY",
}

_NIM_VENDOR_PROVIDERS = {
    "meta": "meta",
    "mistralai": "mistral",
    "qwen": "qwen",
    "deepseek-ai": "deepseek",
    "google": "google",
    "nvidia": "nvidia",
}


def _ollama_base() -> str:
    return (os.getenv("OLLAMA_BASE_URL") or "http://localhost:11434").rstrip("/")


def _is_valid_key(key: str) -> bool:
    if not key or len(key) < 8:
        return False
    lowered = key.lower()
    if lowered.endswith("_here") or "your_key" in lowered:
        return False
    return True


def _litellm_model_path(model_name: str, deployments: Dict[str, dict]) -> str:
    if model_name in deployments:
        return str(deployments[model_name].get("litellm_params", {}).get("model", ""))
    return ""


def _provider_from_litellm_model(model_str: str) -> str:
    if model_str.startswith("ollama/"):
        return "ollama"
    if model_str.startswith("nvidia_nim/"):
        parts = model_str.split("/", 2)
        if len(parts) >= 2:
            return _NIM_VENDOR_PROVIDERS.get(parts[1], parts[1])
    if model_str.startswith("groq/"):
        return "groq"
    if model_str.startswith("deepseek/"):
        return "deepseek"
    if model_str.startswith("openai/"):
        return "openai"
    if model_str.startswith("anthropic/"):
        return "anthropic"
    return "other"


def _provider_for_model(model_name: str, deployments: Dict[str, dict]) -> str:
    model_str = _litellm_model_path(model_name, deployments)
    if model_str:
        provider = _provider_from_litellm_model(model_str)
        if provider != "other":
            return provider
    if model_name.startswith("ollama"):
        return "ollama"
    if model_name.startswith("groq"):
        return "groq"
    if model_name.startswith("deepseek"):
        return "deepseek"
    if model_name.startswith("gpt"):
        return "openai"
    if model_name.startswith("claude"):
        return "anthropic"
    return "other"


@lru_cache(maxsize=1)
def _config_deployments() -> Dict[str, dict]:
    deployments: Dict[str, dict] = {}
    for item in _load_config().get("model_list", []):
        name = item.get("model_name")
        if name:
            deployments[name] = item
    return deployments


def _env_key_from_deployment(model_name: str, deployments: Dict[str, dict]) -> Optional[str]:
    api_key_ref = _config_deployments().get(model_name, {}).get("litellm_params", {}).get("api_key", "")
    ref_str = str(api_key_ref)
    for marker, env_name in _ENV_KEY_MARKERS.items():
        if marker in ref_str:
            return env_name

    model_str = _litellm_model_path(model_name, deployments)
    if model_str.startswith("nvidia_nim/"):
        return "NVIDIA_API_KEY"
    if model_str.startswith("groq/"):
        return "GROQ_API_KEY"
    if model_str.startswith("deepseek/"):
        return "DEEPSEEK_API_KEY"
    if model_str.startswith("openai/"):
        return "OPENAI_API_KEY"
    if model_str.startswith("anthropic/"):
        return "ANTHROPIC_API_KEY"
    return None


def _label_from_model_name(
    model_name: str,
    deployments: Optional[Dict[str, dict]] = None,
    ollama_tag: Optional[str] = None,
) -> str:
    if model_name in MODEL_LABEL_OVERRIDES:
        return MODEL_LABEL_OVERRIDES[model_name]
    if ollama_tag:
        return f"Ollama {ollama_tag}"
    if deployments is not None:
        provider = _provider_for_model(model_name, deployments)
        display = model_name.replace("-", " ")
        label_prefix = PROVIDER_LABELS.get(provider)
        if label_prefix and provider not in ("meta", "mistral", "qwen"):
            return f"{label_prefix} {display}"
    return model_name.replace("-", " ").title()


def _fetch_ollama_installed_models() -> List[str]:
    if not HTTPX_AVAILABLE:
        return []
    try:
        with httpx.Client(timeout=2.0) as client:
            response = client.get(f"{_ollama_base()}/api/tags")
            response.raise_for_status()
            payload = response.json()
            return [entry.get("name", "") for entry in payload.get("models", []) if entry.get("name")]
    except Exception:
        return []


def _check_ollama_reachable() -> bool:
    if not HTTPX_AVAILABLE:
        return False
    timeout = float(os.getenv("OLLAMA_HEALTH_TIMEOUT", "15"))
    try:
        with httpx.Client(timeout=timeout) as client:
            return client.get(f"{_ollama_base()}/api/tags").status_code == 200
    except Exception:
        return False


@lru_cache(maxsize=1)
def _load_config() -> dict:
    with open(CONFIG_PATH, encoding="utf-8") as config_file:
        return yaml.safe_load(config_file) or {}


@lru_cache(maxsize=1)
def _get_router() -> Router:
    if not LITELLM_AVAILABLE:
        raise RuntimeError("litellm is not installed. Run: pip install litellm")
    config = _load_config()
    router_settings = config.get("router_settings", {})
    litellm_settings = config.get("litellm_settings", {})
    if litellm is not None:
        litellm.drop_params = litellm_settings.get("drop_params", True)
        litellm.set_verbose = litellm_settings.get("set_verbose", False)
    return Router(
        model_list=config.get("model_list", []),
        routing_strategy=router_settings.get("routing_strategy", "simple-shuffle"),
        num_retries=router_settings.get("num_retries", 1),
        timeout=router_settings.get("timeout", 120),
    )


def _deployment_map(router: Router) -> Dict[str, dict]:
    deployments: Dict[str, dict] = {}
    try:
        for item in router.get_model_list():
            name = item.get("model_name")
            if name:
                deployments[name] = item
    except Exception:
        pass
    return deployments


def _ollama_tag_for_alias(model_name: str, deployments: Dict[str, dict]) -> Optional[str]:
    if model_name in deployments:
        model_str = deployments[model_name].get("litellm_params", {}).get("model", "")
        if isinstance(model_str, str) and model_str.startswith("ollama/"):
            return model_str[len("ollama/") :]
    if model_name.startswith("ollama-"):
        return model_name[len("ollama-") :].replace("-", ":")
    return None


def _is_model_available(
    model_name: str,
    deployments: Dict[str, dict],
    installed_ollama: set[str],
) -> bool:
    provider = _provider_for_model(model_name, deployments)
    if provider == "ollama":
        if not _check_ollama_reachable():
            return False
        tag = _ollama_tag_for_alias(model_name, deployments)
        return bool(tag and tag in installed_ollama)
    env_key = _env_key_from_deployment(model_name, deployments)
    if env_key:
        return _is_valid_key((os.getenv(env_key) or "").strip())
    return False


def _all_model_names(router: Router, installed_ollama: List[str]) -> List[str]:
    configured = list(_deployment_map(router).keys())
    configured_set = set(configured)
    extras = [f"ollama-{tag.replace(':', '-')}" for tag in installed_ollama if f"ollama-{tag.replace(':', '-')}" not in configured_set]
    return configured + extras


def list_models() -> List[dict]:
    if not LITELLM_AVAILABLE:
        return [{"id": "auto", "label": "Auto Router", "provider": "router", "available": False}]

    try:
        router = _get_router()
    except Exception:
        return [{"id": "auto", "label": "Auto Router", "provider": "router", "available": False}]

    installed_ollama = _fetch_ollama_installed_models()
    installed_set = set(installed_ollama)
    deployments = _deployment_map(router)

    out: List[dict] = [{"id": "auto", "label": "Auto Router", "provider": "router", "available": True}]
    for name in _all_model_names(router, installed_ollama):
        ollama_tag = _ollama_tag_for_alias(name, deployments) if _provider_for_model(name, deployments) == "ollama" else None
        out.append(
            {
                "id": name,
                "label": _label_from_model_name(name, deployments=deployments, ollama_tag=ollama_tag),
                "provider": _provider_for_model(name, deployments),
                "available": _is_model_available(name, deployments, installed_set),
            }
        )
    return out


def _auto_candidates() -> List[str]:
    return [
        m["id"]
        for m in list_models()
        if m["id"] != "auto" and m["available"]
    ]


def _sort_auto_candidates(names: List[str], deployments: Dict[str, dict]) -> List[str]:
    def sort_key(name: str) -> tuple:
        provider = _provider_for_model(name, deployments)
        try:
            priority = AUTO_PROVIDER_ORDER.index(provider)
        except ValueError:
            priority = 99
        return (priority, name)

    return sorted(names, key=sort_key)


def _chat_messages(
    context: str,
    query: str,
    history: Optional[List[dict]] = None,
) -> List[dict]:
    user_content = f"Context from documents:\n{context}\n\nQuestion: {query}" if context.strip() else query
    messages: List[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    if history:
        for turn in history[-20:]:
            role = turn.get("role")
            content = turn.get("content")
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": str(content)})
    messages.append({"role": "user", "content": user_content})
    return messages


def _extract_content(response: object) -> str:
    choices = getattr(response, "choices", None)
    if not choices:
        return ""
    message = choices[0].message
    content = getattr(message, "content", None) or ""
    return str(content).strip()


def _completion_kwargs(model_name: str, deployments: Dict[str, dict], messages: List[dict]) -> dict:
    kwargs: dict = {
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": 512,
    }
    if model_name in deployments:
        params = deployments[model_name].get("litellm_params", {})
        for key in ("temperature", "top_p", "max_tokens", "frequency_penalty", "presence_penalty", "extra_body"):
            if key in params:
                kwargs[key] = params[key]
    return kwargs


def _invoke_model(model_name: str, messages: List[dict]) -> str:
    if not LITELLM_AVAILABLE or completion is None:
        raise RuntimeError("litellm is not installed. Run: pip install litellm")

    router = _get_router()
    deployments = _deployment_map(router)
    call_kwargs = _completion_kwargs(model_name, deployments, messages)
    ollama_tag = _ollama_tag_for_alias(model_name, deployments)

    try:
        if model_name in deployments:
            response = router.completion(model=model_name, **call_kwargs)
        elif model_name.startswith("ollama-"):
            tag = ollama_tag
            if not tag:
                raise RuntimeError(f"Could not resolve Ollama model for '{model_name}'.")
            response = completion(
                model=f"ollama/{tag}",
                api_base=_ollama_base(),
                **call_kwargs,
            )
        else:
            raise RuntimeError(f"Unknown model '{model_name}'.")
    except Exception as exc:
        err = f"{type(exc).__name__}: {exc}".lower()
        label = _label_from_model_name(model_name, deployments=deployments, ollama_tag=ollama_tag)
        if "401" in err or ("invalid" in err and "key" in err) or "authentication" in err:
            env_key = _env_key_from_deployment(model_name, deployments) or "API key"
            raise RuntimeError(
                f"{label} rejected the API key (invalid or expired).\n\n"
                f"Update {env_key} in backend/.env and restart the server.\n\n"
                "Your documents were retrieved; only the LLM call failed."
            ) from exc
        if "connection" in err or "connect" in err:
            if _provider_for_model(model_name, deployments) == "ollama":
                tag = ollama_tag or "llama3.2:1b"
                raise RuntimeError(
                    "Ollama is not running. Start it with `ollama serve`, then pull a model "
                    f"(e.g. `ollama pull {tag}`)."
                ) from exc
        raise RuntimeError(f"{label} error: {type(exc).__name__}: {exc}") from exc

    content = _extract_content(response)
    if content:
        return content
    raise RuntimeError("The model returned an empty response.")


def _resolve_candidates(model_id: Optional[str]) -> List[str]:
    if model_id and model_id != "auto":
        return [model_id]

    default = (os.getenv("LLM_DEFAULT_MODEL") or "auto").strip()
    if default != "auto":
        return [default]

    deployments = _deployment_map(_get_router())
    return _sort_auto_candidates(_auto_candidates(), deployments)


def generate_answer(
    context: str,
    query: str,
    model_id: Optional[str] = None,
    history: Optional[List[dict]] = None,
) -> str:
    """Generate an answer using LiteLLM Router or auto fallbacks."""
    messages = _chat_messages(context, query, history=history)
    candidates = _resolve_candidates(model_id)

    if not candidates:
        return (
            "No LLM provider is configured.\n\n"
            "Options:\n"
            "• Start Ollama locally (`ollama serve`) and pull a model\n"
            "• Add API keys to backend/.env (NVIDIA, Groq, DeepSeek, OpenAI, Anthropic)\n\n"
            "Your documents were retrieved; only the LLM call failed."
        )

    errors: List[str] = []
    for name in candidates:
        deployments = _deployment_map(_get_router())
        installed = set(_fetch_ollama_installed_models())
        ollama_tag = _ollama_tag_for_alias(name, deployments)
        if not _is_model_available(name, deployments, installed):
            provider = _provider_for_model(name, deployments)
            if provider == "ollama":
                tag = ollama_tag or "llama3.2:1b"
                errors.append(f"{_label_from_model_name(name, deployments=deployments, ollama_tag=tag)}: Run: ollama pull {tag}")
            else:
                env_key = _env_key_from_deployment(name, deployments) or "API key"
                errors.append(f"{_label_from_model_name(name, deployments=deployments)}: Set {env_key} in backend/.env")
            if model_id and model_id != "auto":
                break
            continue
        try:
            return _invoke_model(name, messages)
        except Exception as exc:
            errors.append(f"{_label_from_model_name(name, deployments=deployments, ollama_tag=ollama_tag)}: {exc}")
            if model_id and model_id != "auto":
                break

    if len(errors) == 1:
        msg = errors[0]
        return msg.split(": ", 1)[-1] if ": " in msg else msg
    return (
        "All configured LLM providers failed:\n\n"
        + "\n".join(f"• {e}" for e in errors)
        + "\n\nYour documents were retrieved; only the LLM call failed."
    )
