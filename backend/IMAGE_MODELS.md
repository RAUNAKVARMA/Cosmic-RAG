# Image Generation Models (NVIDIA Visual GenAI NIMs)

The Image Studio (`/image-studio`) generates images through NVIDIA NIM
microservices. Each model is a self-hosted container that exposes a common
inference contract:

```
POST {invoke_url}
{ "prompt": "...", "seed": 0, "steps": 30, "mode": "base" }
->
{ "artifacts": [ { "base64": "<encoded image>" } ] }
```

The backend (`app/image_gen.py`) calls these endpoints, decodes the base64
artifact, and returns a `data:` URI to the frontend.

## Two ways to run

| Mode | Requirement | How to enable |
| ---- | ----------- | ------------- |
| **Hosted** (build.nvidia.com) | `NVIDIA_API_KEY` only, no GPU | Set `NVIDIA_API_KEY` in `backend/.env` |
| **Self-hosted** (Docker NIM) | NVIDIA GPU (48–80 GB VRAM) | Run the container + set `*_NIM_URL` |

**Resolution order per model** (`_resolve_target`):

1. If `{MODEL}_NIM_URL` is set → use that self-hosted `/v1/infer` endpoint.
2. Else if `NVIDIA_API_KEY` is set → call the hosted build.nvidia.com endpoint.
3. Else → fall back to `http://localhost:8000/v1/infer` (and report a clear error).

> ⚠️ Hosted image generation may be **restricted on the free developer tier**
> (returns `404 Function not found for account`). If that happens, either use a
> paid/enterprise NVIDIA tier or self-host the NIM. The UI surfaces this message.

### Hosted endpoints & payloads

| Model | Hosted URL | Fields sent |
| ----- | ---------- | ----------- |
| `sd3.5-large` | `.../v1/genai/stabilityai/stable-diffusion-3.5-large` | `prompt, cfg_scale, aspect_ratio, seed, steps, negative_prompt?` |
| `flux.1-schnell` | `.../v1/genai/black-forest-labs/flux.1-schnell` | `prompt, width, height, seed` (extras → 422) |
| `qwen-image` | `.../v1/genai/qwen/qwen-image` | `prompt, seed` |

Base host: `https://ai.api.nvidia.com`. Auth: `Authorization: Bearer $NVIDIA_API_KEY`.

## Registered models

| ID              | Model                        | Container image                                           | Output |
| --------------- | ---------------------------- | -------------------------------------------------------- | ------ |
| `sd3.5-large`   | Stable Diffusion 3.5 Large   | `nvcr.io/nim/stabilityai/stable-diffusion-3.5-large`     | image  |
| `flux.1-schnell`| FLUX.1 [schnell]             | `nvcr.io/nim/black-forest-labs/flux.1-schnell`           | image  |
| `qwen-image`    | Qwen-Image                   | `nvcr.io/nim/qwen/qwen-image`                            | image  |
| `gemini-image`  | Gemini (Nano Banana)         | Google Generative Language API (hosted)                  | image  |
| `trellis`       | TRELLIS (3D)                 | `nvcr.io/nim/microsoft/trellis`                         | GLB    |

### Google Gemini (easiest — no GPU, no Docker)

Set `GEMINI_API_KEY` in `backend/.env` (get one at https://aistudio.google.com/apikey).
The `gemini-image` model then calls
`https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_IMAGE_MODEL}:generateContent`
(default model `gemini-2.5-flash-image`) and returns an inline base64 image.

> `trellis` returns a `.glb` 3D asset, so it is not shown in the image picker UI.
> It is still reachable via `POST /generate-image` for future 3D support.

## 1. Credentials

Accept the model license agreements on build.nvidia.com, then:

```bash
export NGC_API_KEY=<your NGC key>
export HF_TOKEN=<your Hugging Face read token>   # required by SD3.5 / FLUX
echo "$NGC_API_KEY" | docker login nvcr.io --username '$oauthtoken' --password-stdin
```

## 2. Run a NIM

> **Port note:** the Cosmic RAG API already uses port `8000`. Map each NIM to a
> different host port so they don't collide.

```bash
export LOCAL_NIM_CACHE=~/.cache/nim
mkdir -p "$LOCAL_NIM_CACHE" && chmod 777 "$LOCAL_NIM_CACHE"

# Example: Stable Diffusion 3.5 Large on host port 8100
docker run -it --rm --name=sd35 \
  --runtime=nvidia --gpus='"device=0"' \
  -e NGC_API_KEY=$NGC_API_KEY -e HF_TOKEN=$HF_TOKEN \
  -p 8100:8000 \
  -v "$LOCAL_NIM_CACHE:/opt/nim/.cache/" \
  nvcr.io/nim/stabilityai/stable-diffusion-3.5-large:latest
```

Wait for `Pipeline warmup: start/done` in the logs before the first request.

Repeat for the other models on their own ports (`8101`, `8102`, `8103`).

## 3. Point the API at the NIMs

In `backend/.env`:

```bash
SD35_NIM_URL=http://localhost:8100/v1/infer
FLUX_NIM_URL=http://localhost:8101/v1/infer
QWEN_IMAGE_NIM_URL=http://localhost:8102/v1/infer
TRELLIS_NIM_URL=http://localhost:8103/v1/infer
IMAGE_GEN_TIMEOUT=300
```

Restart the API. The Image Studio model picker shows a green dot for any model
whose URL is configured (or when `NVIDIA_API_KEY` is set).

## 4. API surface

- `GET /image-models` — list models + availability + capabilities.
- `POST /generate-image` — `{ prompt, model_id, seed?, steps?, negative_prompt?, mode? }`
  returns `{ image: "data:image/...;base64,...", model_id, seed, mime, output }`.

## Notes

- `Authorization: Bearer $NVIDIA_API_KEY` is sent when the key is present, so the
  same code path works if you later point the URLs at the NVIDIA-hosted API.
- Only `sd3.5-large` accepts `mode` (base / base+canny / base+depth / base+canny+depth).
- `sd3.5-large` and `flux.1-schnell` accept `steps`; `qwen-image` does not.
