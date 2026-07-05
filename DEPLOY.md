# Deploy Cosmic RAG (with Ollama on Render)

Ollama does **not** run on Vercel. For a deployed app you need:

1. **Vercel** — Next.js frontend (`notebooklm-ui`)
2. **Render `cosmic-rag-api`** — FastAPI backend
3. **Render `cosmic-rag-ollama`** — Ollama server (separate Web Service)

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

In Vercel → Project → **Environment Variables**:

```
NEXT_PUBLIC_API_URL=https://cosmic-rag-api.onrender.com
```

Redeploy the frontend.

## Step 3 — Verify

```bash
curl https://cosmic-rag-api.onrender.com/models
```

Expect:

- `ollama-llama3.2-1b` → `"available": true` (after Ollama service is warm)
- NIM models → `"available": true` if `NVIDIA_API_KEY` is set

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
