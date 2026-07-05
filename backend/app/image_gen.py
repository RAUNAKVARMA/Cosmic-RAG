"""Image (and 3D) generation via NVIDIA NIM `/v1/infer` endpoints.

Each model is served by a NIM container that exposes a common inference contract:

    POST {invoke_url}
    { "prompt": "...", "seed": 0, "steps": 30, "mode": "base" }
    -> { "artifacts": [ { "base64": "<...>" } ] }

The invoke URL for every model is configurable through environment variables so
the same code works whether you run the NIM locally (Docker) or point it at the
NVIDIA-hosted API. See ``backend/IMAGE_MODELS.md`` for setup.
"""

from __future__ import annotations

import base64
import os
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from urllib.parse import quote

try:
    import httpx

    HTTPX_AVAILABLE = True
except ImportError:  # pragma: no cover - httpx is a hard dependency in requirements
    HTTPX_AVAILABLE = False


@dataclass(frozen=True)
class ImageModel:
    """Metadata describing a NIM image/3D generation model."""

    id: str
    label: str
    vendor: str
    url_env: str
    default_url: str
    provider: str = "nim"  # "nim" | "google" | "cloudflare" | "replicate" | "pollinations"
    hosted_url: str = ""  # NVIDIA-hosted build.nvidia.com endpoint (Bearer auth)
    cf_model: str = ""  # Cloudflare Workers AI model slug (e.g. @cf/black-forest-labs/flux-1-schnell)
    replicate_model: str = ""  # Replicate owner/name (e.g. black-forest-labs/flux-schnell)
    pollinations_model: str = ""  # Pollinations model slug (e.g. flux, zimage)
    supports_seed: bool = True
    output: str = "image"  # "image" | "model3d"
    mime: str = "image/jpeg"
    default_steps: Optional[int] = None
    supports_steps: bool = False
    supports_negative_prompt: bool = False
    supports_mode: bool = False
    modes: Tuple[str, ...] = field(default_factory=tuple)
    description: str = ""


def _pollinations_entry(
    slug: str,
    label: str,
    *,
    supports_seed: bool = True,
    description: str = "",
) -> ImageModel:
    """Build a Pollinations image-model registry entry."""
    return ImageModel(
        id=f"pollinations-{slug}",
        label=f"{label} (Pollinations)",
        vendor="pollinations",
        provider="pollinations",
        pollinations_model=slug,
        url_env="",
        default_url="",
        hosted_url="",
        output="image",
        mime="image/jpeg",
        supports_seed=supports_seed,
        description=description
        or f"Text-to-image via Pollinations ({slug}).",
    )


# Registry — Pollinations first (simple hosted GET, no GPU).
IMAGE_MODELS: Dict[str, ImageModel] = {
    "pollinations-flux": _pollinations_entry(
        "flux", "FLUX", description="Fast FLUX text-to-image on Pollinations."
    ),
    "pollinations-zimage": _pollinations_entry(
        "zimage", "Z-Image", description="Default Pollinations image model."
    ),
    "pollinations-nanobanana": _pollinations_entry(
        "nanobanana", "Nano Banana", supports_seed=False
    ),
    "pollinations-nanobanana-pro": _pollinations_entry(
        "nanobanana-pro", "Nano Banana Pro", supports_seed=False
    ),
    "pollinations-seedream": _pollinations_entry("seedream", "Seedream"),
    "pollinations-seedream-pro": _pollinations_entry(
        "seedream-pro", "Seedream Pro"
    ),
    "pollinations-qwen-image": _pollinations_entry(
        "qwen-image", "Qwen-Image", supports_seed=False
    ),
    "pollinations-gptimage": _pollinations_entry(
        "gptimage", "GPT Image", supports_seed=False
    ),
    "pollinations-ideogram-v4-turbo": _pollinations_entry(
        "ideogram-v4-turbo", "Ideogram v4 Turbo", supports_seed=False
    ),
    "pollinations-grok-imagine": _pollinations_entry(
        "grok-imagine", "Grok Imagine", supports_seed=False
    ),
    "pollinations-kontext": _pollinations_entry(
        "kontext", "Kontext", supports_seed=False
    ),
    "pollinations-klein": _pollinations_entry("klein", "Klein"),
    "replicate-flux-schnell": ImageModel(
        id="replicate-flux-schnell",
        label="FLUX.1 [schnell] (Replicate)",
        vendor="black-forest-labs",
        provider="replicate",
        replicate_model="black-forest-labs/flux-schnell",
        url_env="",
        default_url="",
        hosted_url="",
        output="image",
        mime="image/webp",
        default_steps=4,
        supports_steps=True,
        supports_negative_prompt=False,
        supports_mode=False,
        description="Fast text-to-image on Replicate (hosted, no GPU).",
    ),
    "replicate-flux-dev": ImageModel(
        id="replicate-flux-dev",
        label="FLUX.1 [dev] (Replicate)",
        vendor="black-forest-labs",
        provider="replicate",
        replicate_model="black-forest-labs/flux-dev",
        url_env="",
        default_url="",
        hosted_url="",
        output="image",
        mime="image/webp",
        default_steps=28,
        supports_steps=True,
        supports_negative_prompt=False,
        supports_mode=False,
        description="Higher-quality FLUX on Replicate (hosted, no GPU).",
    ),
    "replicate-sdxl": ImageModel(
        id="replicate-sdxl",
        label="SDXL (Replicate)",
        vendor="stability-ai",
        provider="replicate",
        replicate_model="stability-ai/sdxl",
        url_env="",
        default_url="",
        hosted_url="",
        output="image",
        mime="image/png",
        default_steps=25,
        supports_steps=True,
        supports_negative_prompt=True,
        supports_mode=False,
        description="Stable Diffusion XL on Replicate (hosted, no GPU).",
    ),
    "cf-flux-schnell": ImageModel(
        id="cf-flux-schnell",
        label="FLUX.1 [schnell] (Cloudflare)",
        vendor="black-forest-labs",
        provider="cloudflare",
        cf_model="@cf/black-forest-labs/flux-1-schnell",
        url_env="",
        default_url="",
        hosted_url="",
        output="image",
        mime="image/jpeg",
        default_steps=4,
        supports_steps=True,
        supports_negative_prompt=False,
        supports_mode=False,
        description="Fast text-to-image on Cloudflare Workers AI (free tier, no GPU).",
    ),
    "cf-sdxl-lightning": ImageModel(
        id="cf-sdxl-lightning",
        label="SDXL Lightning (Cloudflare)",
        vendor="bytedance",
        provider="cloudflare",
        cf_model="@cf/bytedance/stable-diffusion-xl-lightning",
        url_env="",
        default_url="",
        hosted_url="",
        output="image",
        mime="image/png",
        default_steps=None,
        supports_steps=False,
        supports_negative_prompt=True,
        supports_mode=False,
        description="Fast SDXL Lightning on Cloudflare Workers AI (free tier).",
    ),
}

DEFAULT_TIMEOUT_SECONDS = float(os.getenv("IMAGE_GEN_TIMEOUT", "300"))


class ImageGenError(RuntimeError):
    """Raised when image generation fails for a reportable reason."""


def _nvidia_api_key() -> str:
    return (os.getenv("NVIDIA_API_KEY") or "").strip()


def _gemini_api_key() -> str:
    return (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or "").strip()


def _cloudflare_account() -> str:
    return (os.getenv("CLOUDFLARE_ACCOUNT_ID") or "").strip()


def _cloudflare_token() -> str:
    return (os.getenv("CLOUDFLARE_API_TOKEN") or "").strip()


def _replicate_api_key() -> str:
    return (os.getenv("REPLICATE_API_KEY") or os.getenv("REPLICATE_API_TOKEN") or "").strip()


def _pollinations_api_key() -> str:
    return (os.getenv("POLLINATIONS_API_KEY") or "").strip()


def _resolve_target(model: ImageModel) -> Tuple[str, bool]:
    """Return ``(invoke_url, is_hosted)``.

    Priority:
      1. Explicit ``{MODEL}_NIM_URL`` env override -> self-hosted ``/v1/infer`` schema.
      2. ``NVIDIA_API_KEY`` set + a hosted endpoint exists -> hosted build.nvidia.com.
      3. Fall back to the localhost default (self-hosted schema).
    """
    override = (os.getenv(model.url_env) or "").strip()
    if override:
        return override, False
    if _nvidia_api_key() and model.hosted_url:
        return model.hosted_url, True
    return model.default_url, False


def _is_configured(model: ImageModel) -> bool:
    """Available if a URL override is set, or a hosted endpoint + key are present."""
    if model.provider == "google":
        return bool(_gemini_api_key())
    if model.provider == "cloudflare":
        return bool(_cloudflare_account()) and bool(_cloudflare_token())
    if model.provider == "replicate":
        return bool(_replicate_api_key())
    if model.provider == "pollinations":
        return bool(_pollinations_api_key())
    if (os.getenv(model.url_env) or "").strip():
        return True
    return bool(_nvidia_api_key()) and bool(model.hosted_url)


def _sniff_mime(raw: bytes, fallback: str) -> str:
    """Detect the real content type from magic bytes so data URIs render correctly."""
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if raw.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    if raw[:4] == b"glTF":
        return "model/gltf-binary"
    return fallback


def list_image_models() -> List[dict]:
    """Return serializable metadata for every registered image model."""
    return [
        {
            "id": m.id,
            "label": m.label,
            "vendor": m.vendor,
            "output": m.output,
            "available": _is_configured(m),
            "supports_steps": m.supports_steps,
            "supports_negative_prompt": m.supports_negative_prompt,
            "supports_mode": m.supports_mode,
            "modes": list(m.modes),
            "default_steps": m.default_steps,
            "description": m.description,
        }
        for m in IMAGE_MODELS.values()
    ]


def _build_local_payload(
    model: ImageModel,
    prompt: str,
    seed: int,
    steps: Optional[int],
    negative_prompt: Optional[str],
    mode: Optional[str],
) -> dict:
    """Self-hosted NIM ``/v1/infer`` schema."""
    payload: dict = {"prompt": prompt, "seed": seed}
    if model.supports_steps:
        payload["steps"] = steps if steps is not None else (model.default_steps or 30)
    if model.supports_mode:
        payload["mode"] = mode if mode in model.modes else "base"
    if model.supports_negative_prompt and negative_prompt:
        payload["negative_prompt"] = negative_prompt
    return payload


def _build_hosted_payload(
    model: ImageModel,
    prompt: str,
    seed: int,
    steps: Optional[int],
    negative_prompt: Optional[str],
) -> dict:
    """build.nvidia.com hosted schema (differs per model; extra fields -> HTTP 422)."""
    if model.id == "flux.1-schnell":
        # Hosted FLUX schnell only accepts these fields.
        return {"prompt": prompt, "width": 1024, "height": 1024, "seed": seed}
    if model.id == "sd3.5-large":
        payload: dict = {
            "prompt": prompt,
            "cfg_scale": 4.5,
            "aspect_ratio": "1:1",
            "seed": seed,
            "steps": steps if steps is not None else (model.default_steps or 50),
        }
        if negative_prompt:
            payload["negative_prompt"] = negative_prompt
        return payload
    # Qwen-Image and any other hosted model: keep it minimal.
    return {"prompt": prompt, "seed": seed}


def _build_payload(
    model: ImageModel,
    prompt: str,
    seed: int,
    steps: Optional[int],
    negative_prompt: Optional[str],
    mode: Optional[str],
    hosted: bool,
) -> dict:
    if hosted:
        return _build_hosted_payload(model, prompt, seed, steps, negative_prompt)
    return _build_local_payload(model, prompt, seed, steps, negative_prompt, mode)


def _extract_base64(data: dict) -> Optional[str]:
    """Pull the base64 payload from the various shapes NIMs return."""
    artifacts = data.get("artifacts")
    if isinstance(artifacts, list) and artifacts:
        first = artifacts[0]
        if isinstance(first, dict):
            b64 = first.get("base64") or first.get("b64_json")
            if b64:
                return str(b64)
    for key in ("image", "b64_json", "base64"):
        value = data.get(key)
        if isinstance(value, str) and value:
            return value
    data_list = data.get("data")
    if isinstance(data_list, list) and data_list:
        first = data_list[0]
        if isinstance(first, dict):
            b64 = first.get("b64_json") or first.get("base64")
            if b64:
                return str(b64)
    return None


def _extract_gemini_image(data: dict) -> Optional[Tuple[str, str]]:
    """Return ``(base64, mime)`` from a Gemini generateContent response."""
    candidates = data.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return None
    content = candidates[0].get("content") if isinstance(candidates[0], dict) else None
    parts = content.get("parts") if isinstance(content, dict) else None
    if not isinstance(parts, list):
        return None
    for part in parts:
        if not isinstance(part, dict):
            continue
        inline = part.get("inlineData") or part.get("inline_data")
        if isinstance(inline, dict) and inline.get("data"):
            return str(inline["data"]), str(inline.get("mimeType") or inline.get("mime_type") or "image/png")
    return None


def _generate_gemini(model: ImageModel, prompt: str, seed: int) -> Tuple[bytes, str, dict]:
    key = _gemini_api_key()
    if not key:
        raise ImageGenError(
            f"{model.label} needs GEMINI_API_KEY. Add it to backend/.env and restart."
        )

    gemini_model = (os.getenv("GEMINI_IMAGE_MODEL") or "gemini-2.5-flash-image").strip()
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent"
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["IMAGE"]},
    }
    headers = {"Content-Type": "application/json", "x-goog-api-key": key}

    try:
        with httpx.Client(timeout=DEFAULT_TIMEOUT_SECONDS) as client:
            response = client.post(url, json=payload, headers=headers)
    except httpx.TimeoutException as exc:
        raise ImageGenError(f"{model.label} timed out. Try again shortly.") from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise ImageGenError(f"{model.label} request failed: {exc}") from exc

    if response.status_code in (401, 403):
        raise ImageGenError(
            f"{model.label} rejected the credentials (HTTP {response.status_code}). "
            "Check GEMINI_API_KEY (it may be invalid, expired, or lack image access)."
        )
    if response.status_code == 404:
        raise ImageGenError(
            f"Gemini model '{gemini_model}' was not found (HTTP 404). "
            "Set GEMINI_IMAGE_MODEL to an image-capable model."
        )
    if response.status_code == 429:
        raise ImageGenError(
            f"{model.label} hit its free-tier quota (HTTP 429). The key is valid, but "
            "image quota is used up — wait for the daily reset, enable billing at "
            "https://ai.google.dev, or self-host a NIM via *_NIM_URL."
        )
    if response.status_code >= 400:
        snippet = response.text.replace("\n", " ").strip()[:240]
        raise ImageGenError(f"{model.label} error (HTTP {response.status_code}): {snippet}")

    try:
        data = response.json()
    except ValueError as exc:
        raise ImageGenError(f"{model.label} returned a non-JSON response.") from exc

    found = _extract_gemini_image(data)
    if not found:
        raise ImageGenError(
            f"{model.label} did not return an image (the prompt may have been refused)."
        )
    b64, mime = found
    try:
        raw = base64.b64decode(b64)
    except Exception as exc:
        raise ImageGenError(f"Could not decode the {model.label} image.") from exc

    meta = {
        "model_id": model.id,
        "label": model.label,
        "seed": seed,
        "steps": None,
        "mode": None,
        "output": model.output,
        "hosted": True,
    }
    return raw, _sniff_mime(raw, mime), meta


def _generate_cloudflare(
    model: ImageModel, prompt: str, seed: int, steps: Optional[int], negative_prompt: Optional[str]
) -> Tuple[bytes, str, dict]:
    account = _cloudflare_account()
    token = _cloudflare_token()
    if not account or not token:
        raise ImageGenError(
            f"{model.label} needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN. "
            "Add them to backend/.env and restart."
        )

    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{model.cf_model}"
    payload: dict = {"prompt": prompt}
    if seed:
        payload["seed"] = seed
    if model.supports_steps and steps:
        payload["steps"] = max(1, min(int(steps), 8))
    if model.supports_negative_prompt and negative_prompt:
        payload["negative_prompt"] = negative_prompt
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    try:
        with httpx.Client(timeout=DEFAULT_TIMEOUT_SECONDS) as client:
            response = client.post(url, json=payload, headers=headers)
    except httpx.TimeoutException as exc:
        raise ImageGenError(f"{model.label} timed out. Try again shortly.") from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise ImageGenError(f"{model.label} request failed: {exc}") from exc

    if response.status_code in (401, 403):
        raise ImageGenError(
            f"{model.label} rejected the credentials (HTTP {response.status_code}). "
            "Check CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN "
            "(the token needs the 'Workers AI' permission)."
        )
    if response.status_code == 429:
        raise ImageGenError(
            f"{model.label} hit its rate/quota limit (HTTP 429). "
            "Wait a moment or check your Cloudflare Workers AI plan."
        )
    if response.status_code >= 400:
        snippet = response.text.replace("\n", " ").strip()[:240]
        raise ImageGenError(f"{model.label} error (HTTP {response.status_code}): {snippet}")

    content_type = response.headers.get("content-type", "")
    raw: Optional[bytes] = None

    if "application/json" in content_type:
        try:
            data = response.json()
        except ValueError as exc:
            raise ImageGenError(f"{model.label} returned a malformed response.") from exc
        result = data.get("result") if isinstance(data, dict) else None
        b64 = None
        if isinstance(result, dict):
            b64 = result.get("image") or result.get("images")
            if isinstance(b64, list) and b64:
                b64 = b64[0]
        if not b64:
            errors = (data.get("errors") if isinstance(data, dict) else None) or []
            detail = "; ".join(str(e.get("message", e)) for e in errors) if errors else ""
            raise ImageGenError(
                f"{model.label} did not return an image."
                + (f" ({detail})" if detail else "")
            )
        try:
            raw = base64.b64decode(b64)
        except Exception as exc:
            raise ImageGenError(f"Could not decode the {model.label} image.") from exc
    else:
        raw = response.content

    if not raw:
        raise ImageGenError(f"{model.label} returned an empty image.")

    meta = {
        "model_id": model.id,
        "label": model.label,
        "seed": seed,
        "steps": payload.get("steps"),
        "mode": None,
        "output": model.output,
        "hosted": True,
    }
    return raw, _sniff_mime(raw, model.mime), meta


def _replicate_output_url(output: object) -> Optional[str]:
    """Pull the first image URL from a Replicate prediction output."""
    if isinstance(output, str) and output.startswith("http"):
        return output
    if isinstance(output, list):
        for item in output:
            if isinstance(item, str) and item.startswith("http"):
                return item
    return None


def _generate_replicate(
    model: ImageModel,
    prompt: str,
    seed: int,
    steps: Optional[int],
    negative_prompt: Optional[str],
) -> Tuple[bytes, str, dict]:
    key = _replicate_api_key()
    if not key:
        raise ImageGenError(
            f"{model.label} needs REPLICATE_API_KEY. Add it to backend/.env and restart."
        )
    if not model.replicate_model:
        raise ImageGenError(f"{model.label} is missing a Replicate model slug.")

    input_payload: dict = {"prompt": prompt}
    if seed:
        input_payload["seed"] = seed
    if model.supports_steps:
        step_count = steps if steps is not None else model.default_steps
        if step_count is not None:
            input_payload["num_inference_steps"] = max(1, int(step_count))
    if model.supports_negative_prompt and negative_prompt:
        input_payload["negative_prompt"] = negative_prompt

    url = f"https://api.replicate.com/v1/models/{model.replicate_model}/predictions"
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "wait",
    }

    try:
        with httpx.Client(timeout=DEFAULT_TIMEOUT_SECONDS) as client:
            response = client.post(url, json={"input": input_payload}, headers=headers)
            if response.status_code in (401, 403):
                raise ImageGenError(
                    f"{model.label} rejected the credentials (HTTP {response.status_code}). "
                    "Check REPLICATE_API_KEY."
                )
            if response.status_code == 402:
                raise ImageGenError(
                    f"{model.label} needs billing credit on Replicate (HTTP 402). "
                    "Add credit at https://replicate.com/account/billing."
                )
            if response.status_code == 429:
                raise ImageGenError(
                    f"{model.label} hit a rate limit (HTTP 429). Wait a moment and try again."
                )
            if response.status_code >= 400:
                snippet = response.text.replace("\n", " ").strip()[:240]
                raise ImageGenError(
                    f"{model.label} error (HTTP {response.status_code}): {snippet}"
                )

            try:
                data = response.json()
            except ValueError as exc:
                raise ImageGenError(f"{model.label} returned a non-JSON response.") from exc

            # Prefer: wait may still return processing — poll until done.
            prediction_id = data.get("id")
            status = data.get("status")
            polls = 0
            while status in ("starting", "processing") and prediction_id and polls < 60:
                polls += 1
                poll = client.get(
                    f"https://api.replicate.com/v1/predictions/{prediction_id}",
                    headers={"Authorization": f"Bearer {key}"},
                )
                if poll.status_code >= 400:
                    snippet = poll.text.replace("\n", " ").strip()[:200]
                    raise ImageGenError(
                        f"{model.label} poll failed (HTTP {poll.status_code}): {snippet}"
                    )
                data = poll.json()
                status = data.get("status")

            if status == "failed":
                err = data.get("error") or "unknown error"
                raise ImageGenError(f"{model.label} failed: {err}")
            if status != "succeeded":
                raise ImageGenError(
                    f"{model.label} did not finish (status={status or 'unknown'})."
                )

            image_url = _replicate_output_url(data.get("output"))
            if not image_url:
                raise ImageGenError(f"{model.label} did not return an image URL.")

            image_resp = client.get(image_url)
            if image_resp.status_code >= 400:
                raise ImageGenError(
                    f"{model.label} could not download the result image "
                    f"(HTTP {image_resp.status_code})."
                )
            raw = image_resp.content
    except ImageGenError:
        raise
    except httpx.TimeoutException as exc:
        raise ImageGenError(f"{model.label} timed out. Try again shortly.") from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise ImageGenError(f"{model.label} request failed: {exc}") from exc

    if not raw:
        raise ImageGenError(f"{model.label} returned an empty image.")

    meta = {
        "model_id": model.id,
        "label": model.label,
        "seed": seed,
        "steps": input_payload.get("num_inference_steps"),
        "mode": None,
        "output": model.output,
        "hosted": True,
    }
    return raw, _sniff_mime(raw, model.mime), meta


def _pollinations_error_message(model: ImageModel, status: int, body: str) -> str:
    """Map Pollinations HTTP status codes to actionable messages."""
    if status in (401, 403):
        return (
            f"{model.label} rejected the credentials (HTTP {status}). "
            "Set POLLINATIONS_API_KEY in backend/.env (get a key at "
            "https://enter.pollinations.ai) and restart."
        )
    if status == 402:
        return (
            f"{model.label} needs more Pollen balance (HTTP 402). "
            "Top up at https://enter.pollinations.ai or use another model."
        )
    if status == 429:
        return f"{model.label} rate-limited (HTTP 429). Wait a moment and try again."
    snippet = body.replace("\n", " ").strip()[:240]
    return f"{model.label} error (HTTP {status}): {snippet}"


def _pollinations_parse_image_response(
    model: ImageModel, data: dict, seed: int, client: httpx.Client
) -> Tuple[bytes, str, dict]:
    """Extract image bytes from OpenAI-compatible or error JSON."""
    items = (data.get("data") if isinstance(data, dict) else None) or []
    b64 = None
    image_url = None
    if items and isinstance(items[0], dict):
        b64 = items[0].get("b64_json")
        image_url = items[0].get("url")

    raw: Optional[bytes] = None
    if b64:
        try:
            raw = base64.b64decode(b64)
        except Exception as exc:
            raise ImageGenError(f"Could not decode the {model.label} image.") from exc
    elif image_url:
        img = client.get(image_url)
        if img.status_code >= 400:
            raise ImageGenError(f"{model.label} could not download the result image.")
        raw = img.content

    if not raw or len(raw) < 32:
        raise ImageGenError(f"{model.label} did not return an image.")

    meta = {
        "model_id": model.id,
        "label": model.label,
        "seed": seed if model.supports_seed else None,
        "steps": None,
        "mode": None,
        "output": model.output,
        "hosted": True,
    }
    return raw, _sniff_mime(raw, model.mime), meta


def _generate_pollinations(
    model: ImageModel, prompt: str, seed: int
) -> Tuple[bytes, str, dict]:
    """Generate via Pollinations (OpenAI-compatible POST, GET fallback)."""
    if not model.pollinations_model:
        raise ImageGenError(f"{model.label} is missing a Pollinations model slug.")

    key = _pollinations_api_key()
    if not key:
        raise ImageGenError(
            f"{model.label} needs POLLINATIONS_API_KEY. "
            "Get a key at https://enter.pollinations.ai, add it to backend/.env, "
            "and restart."
        )

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "application/json,image/*",
    }
    post_payload: dict = {
        "prompt": prompt,
        "model": model.pollinations_model,
        "n": 1,
        "size": "1024x1024",
        "response_format": "b64_json",
    }

    try:
        with httpx.Client(timeout=DEFAULT_TIMEOUT_SECONDS, follow_redirects=True) as client:
            response = client.post(
                "https://gen.pollinations.ai/v1/images/generations",
                json=post_payload,
                headers=headers,
            )

            if response.status_code < 400:
                try:
                    data = response.json()
                except ValueError as exc:
                    raise ImageGenError(
                        f"{model.label} returned a non-JSON response."
                    ) from exc
                return _pollinations_parse_image_response(model, data, seed, client)

            # Fall back to GET /image/{prompt} (documented simple path).
            if response.status_code not in (400, 404, 405, 422):
                raise ImageGenError(
                    _pollinations_error_message(model, response.status_code, response.text)
                )

            encoded = quote(prompt, safe="")
            params: List[str] = [f"model={quote(model.pollinations_model, safe='')}"]
            if model.supports_seed and seed >= 0:
                params.append(f"seed={int(seed)}")
            get_url = f"https://gen.pollinations.ai/image/{encoded}?{'&'.join(params)}"
            get_resp = client.get(get_url, headers={"Authorization": f"Bearer {key}", "Accept": "image/*"})

            if get_resp.status_code >= 400:
                if "application/json" in (get_resp.headers.get("content-type") or "").lower():
                    try:
                        err_data = get_resp.json()
                        err_msg = (
                            (err_data.get("error") or {}).get("message")
                            if isinstance(err_data, dict)
                            else None
                        )
                        if err_msg:
                            raise ImageGenError(
                                _pollinations_error_message(
                                    model, get_resp.status_code, str(err_msg)
                                )
                            )
                    except (ValueError, TypeError):
                        pass
                raise ImageGenError(
                    _pollinations_error_message(model, get_resp.status_code, get_resp.text)
                )

            content_type = (get_resp.headers.get("content-type") or "").lower()
            if "application/json" in content_type:
                try:
                    data = get_resp.json()
                except ValueError as exc:
                    raise ImageGenError(
                        f"{model.label} returned a malformed response."
                    ) from exc
                return _pollinations_parse_image_response(model, data, seed, client)

            raw = get_resp.content
            if not raw or len(raw) < 32:
                raise ImageGenError(f"{model.label} returned an empty image.")

            meta = {
                "model_id": model.id,
                "label": model.label,
                "seed": seed if model.supports_seed else None,
                "steps": None,
                "mode": None,
                "output": model.output,
                "hosted": True,
            }
            return raw, _sniff_mime(raw, model.mime), meta

    except ImageGenError:
        raise
    except httpx.TimeoutException as exc:
        raise ImageGenError(f"{model.label} timed out. Try again shortly.") from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise ImageGenError(f"{model.label} request failed: {exc}") from exc


def generate_image(
    model_id: str,
    prompt: str,
    seed: int = 0,
    steps: Optional[int] = None,
    negative_prompt: Optional[str] = None,
    mode: Optional[str] = None,
) -> Tuple[bytes, str, dict]:
    """Generate an asset with the requested model.

    Returns ``(raw_bytes, mime_type, metadata)``. Raises :class:`ImageGenError`
    with a human-readable message on failure.
    """
    if not HTTPX_AVAILABLE:
        raise ImageGenError("httpx is not installed. Run: pip install httpx")

    model = IMAGE_MODELS.get(model_id)
    if model is None:
        raise ImageGenError(f"Unknown image model '{model_id}'.")

    prompt = (prompt or "").strip()
    if not prompt:
        raise ImageGenError("A prompt is required to generate an image.")

    if model.provider == "google":
        return _generate_gemini(model, prompt, seed)

    if model.provider == "cloudflare":
        return _generate_cloudflare(model, prompt, seed, steps, negative_prompt)

    if model.provider == "replicate":
        return _generate_replicate(model, prompt, seed, steps, negative_prompt)

    if model.provider == "pollinations":
        return _generate_pollinations(model, prompt, seed)

    url, hosted = _resolve_target(model)
    payload = _build_payload(model, prompt, seed, steps, negative_prompt, mode, hosted)

    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    api_key = _nvidia_api_key()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    elif hosted:
        raise ImageGenError(
            f"{model.label} needs NVIDIA_API_KEY to use the hosted API. "
            "Set it in backend/.env or run the NIM locally and set "
            f"{model.url_env}."
        )

    try:
        with httpx.Client(timeout=DEFAULT_TIMEOUT_SECONDS) as client:
            response = client.post(url, json=payload, headers=headers)
    except httpx.ConnectError as exc:
        if hosted:
            raise ImageGenError(
                f"Could not reach the hosted {model.label} API at {url}."
            ) from exc
        raise ImageGenError(
            f"Could not reach the {model.label} NIM at {url}. "
            "Start the NIM container or set "
            f"{model.url_env} to a reachable endpoint."
        ) from exc
    except httpx.TimeoutException as exc:
        raise ImageGenError(
            f"{model.label} timed out after {int(DEFAULT_TIMEOUT_SECONDS)}s. "
            "The model may still be warming up — try again shortly."
        ) from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise ImageGenError(f"{model.label} request failed: {exc}") from exc

    if response.status_code in (401, 403):
        raise ImageGenError(
            f"{model.label} rejected the credentials (HTTP {response.status_code}). "
            "Check NVIDIA_API_KEY / NGC_API_KEY."
        )
    if response.status_code == 404 and hosted:
        raise ImageGenError(
            f"The hosted {model.label} endpoint returned 404 (not enabled for this "
            "account/tier). Try another model or run the NIM locally via "
            f"{model.url_env}."
        )
    if response.status_code >= 400:
        snippet = response.text.replace("\n", " ").strip()[:200]
        raise ImageGenError(f"{model.label} error (HTTP {response.status_code}): {snippet}")

    try:
        data = response.json()
    except ValueError as exc:
        raise ImageGenError(f"{model.label} returned a non-JSON response.") from exc

    b64 = _extract_base64(data)
    if not b64:
        raise ImageGenError(f"{model.label} response did not contain an image artifact.")

    try:
        raw = base64.b64decode(b64)
    except Exception as exc:
        raise ImageGenError(f"Could not decode the {model.label} image artifact.") from exc

    meta = {
        "model_id": model.id,
        "label": model.label,
        "seed": seed,
        "steps": payload.get("steps"),
        "mode": payload.get("mode"),
        "output": model.output,
        "hosted": hosted,
    }
    return raw, _sniff_mime(raw, model.mime), meta
