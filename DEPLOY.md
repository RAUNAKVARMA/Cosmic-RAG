# Deploy Cosmic RAG (with Ollama + PostgreSQL on Render)

Ollama does **not** run on Vercel. For a deployed app you need:

1. **Vercel** — Next.js frontend (`notebooklm-ui`) with server-side API proxy
2. **Render `cosmic-rag-api`** — FastAPI backend + PostgreSQL
3. **Render `cosmic-rag-ollama`** — Ollama server (separate Web Service)
4. **Render `cosmic-rag-db`** — PostgreSQL (documents & chunks metadata)

## Why models were not visible on Vercel

On Vercel, `/api/rag` did **not** proxy to Render unless `NEXT_PUBLIC_API_URL` was set at build time. The frontend now uses a **Next.js server route** (`/api/rag/*`) that forwards to your Render API automatically.

You still need API keys on Render for models to be **usable** (not just listed).

## Why Ollama needs its own service

Ollama is a local LLM server, not an API key. On Render it runs as a second Docker service. Your API talks to it via `OLLAMA_BASE_URL`.

## Requirements

| Service | Render plan | Why |
|---------|-------------|-----|
| `cosmic-rag-ollama` | **Standard ($25/mo)** or higher | `llama3.2:1b` needs ~2 GB RAM; Free/Starter (512 MB) is not enough |
| `cosmic-rag-api` | Free | Fine for the API |
| Vercel | Free | Frontend |

**Alternative without paying for Ollama:** skip the Ollama service and only set `NVIDIA_API_KEY` on `cosmic-rag-api`. Auto Router will use NIM cloud models.

## Step 1 — Deploy backend + Ollama on Render

### New project (Blueprint)

1. [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**
2. Connect repo `RAUNAKVARMA/Cosmic-RAG`
3. Render reads [`render.yaml`](render.yaml) and creates both services
4. When prompted, set **`NVIDIA_API_KEY`** for `cosmic-rag-api`

### Existing `cosmic-rag-api` only

1. **New Web Service** → Docker → root dir `backend/ollama` → Dockerfile `./Dockerfile`
2. Name: `cosmic-rag-ollama`, plan **Standard**, region Oregon
3. Add **disk**: mount `/root/.ollama`, 1 GB (keeps downloaded models)
4. Health check path: `/api/tags`
5. First deploy takes 5–10 min (pulls `llama3.2:1b`)

On **`cosmic-rag-api`** → Environment, add:

```
OLLAMA_BASE_URL=https://cosmic-rag-ollama.onrender.com
```

(use your actual Ollama service URL from Render)

Redeploy `cosmic-rag-api`.

## Step 2 — Vercel frontend

In Vercel → Project → **Environment Variables** (Production):

```
BACKEND_URL=https://cosmic-rag-api.onrender.com
BACKEND_API_SECRET=<same value as API_SECRET on Render>
```

`BACKEND_API_SECRET` is server-only (not exposed in the browser). The proxy adds the Bearer token for `/chat`, `/upload`, and `/generate-image`.

`NEXT_PUBLIC_API_URL` is **optional** now — the app uses same-origin `/api/rag` on Vercel.

Redeploy the frontend after saving env vars.

## Production security (recommended)

On **`cosmic-rag-api`** → Environment:

| Variable | Purpose |
|----------|---------|
| `API_SECRET` | Random string; required on `POST /chat`, `/upload`, `/generate-image` |
| `IMAGE_GEN_RATE_LIMIT` | Max generations per IP per window (default `10`) |
| `IMAGE_GEN_RATE_WINDOW_SECONDS` | Window in seconds (default `3600` = 1 hour) |
| `VECTOR_INDEX_PATH` | `/data/vector_index` (with persistent disk — see below) |

Generate a secret:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Set the **same value** on Vercel as `NEXT_PUBLIC_API_SECRET` so the browser sends `Authorization: Bearer …`.

> **Note:** `NEXT_PUBLIC_*` is visible in the client bundle. This stops casual abuse and bots, not determined attackers. For stronger security, proxy through Next.js server routes later.

## Persistent data (PostgreSQL + Render disk)

| Data | Storage |
|------|---------|
| Document text & chunk metadata | **PostgreSQL** (`cosmic-rag-db`) |
| FAISS vector embeddings | **Render disk** at `/data/vector_index` |

On startup the API syncs FAISS from PostgreSQL if the index is missing or out of date.

Blueprint sets `DATABASE_URL` automatically. For manual setup, add a Render PostgreSQL instance and set `DATABASE_URL` on `cosmic-rag-api`.

Without PostgreSQL, the API falls back to SQLite on the `/data` disk.

## Step 3 — Verify

```bash
curl https://cosmic-rag-api.onrender.com/health
curl https://cosmic-rag-api.onrender.com/models
curl https://cosmic-rag-api.onrender.com/image-models
```

`/health` now includes `database.connected`, `chat_models_available`, and `ollama_base_url`.

From the Vercel site (after redeploy):

```bash
curl https://YOUR-VERCEL-APP.vercel.app/api/rag/health
curl https://YOUR-VERCEL-APP.vercel.app/api/rag/models
```

Expect `/health` to include `"auth_required": true` when `API_SECRET` is set.

Protected endpoints (require `Authorization: Bearer $API_SECRET`):

```bash
curl -X POST https://cosmic-rag-api.onrender.com/chat \
  -H "Authorization: Bearer YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"message":"hello"}'
```

Expect:

- `ollama-llama3.2-1b` → `"available": true` (after Ollama service is warm)
- NIM models → `"available": true` if `NVIDIA_API_KEY` is set
- Image Studio models → `"available": true` when the matching keys are set (see below)

## Image Studio on Render

On **`cosmic-rag-api`** → Environment, add the keys you use locally (same names as `backend/.env.example`):

| Variable | Used for |
|----------|----------|
| `POLLINATIONS_API_KEY` | Pollinations FLUX, Z-Image, Nano Banana, etc. |
| `REPLICATE_API_KEY` or `Replicate_API_KEY` | Replicate FLUX / SDXL |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (**both required**) |

Redeploy after saving. Models without keys still appear in the UI but show **(setup needed)** until configured.

Vercel must have:

```
BACKEND_URL=https://cosmic-rag-api.onrender.com
BACKEND_API_SECRET=<same as Render API_SECRET>
```

## Cold starts (free / spin-down)

Render free services sleep after inactivity. First request may take 30–60s while Ollama wakes and loads the model. Upgrade to a paid plan without spin-down for faster responses.

## Local dev (unchanged)

```powershell
ollama serve
ollama pull llama3.2:1b
cd backend
.\run-dev.ps1
```

`OLLAMA_BASE_URL=http://localhost:11434` in `backend/.env`.
