/**
 * Base path/URL for the FastAPI backend.
 * - Default: same-origin proxy `/api/rag` (see next.config.ts rewrites → http://127.0.0.1:8000).
 * - Override with NEXT_PUBLIC_API_URL or NEXT_PUBLIC_BACKEND_URL for production or direct calls.
 */
export function getApiBaseUrl(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    process.env.NEXT_PUBLIC_BACKEND_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }
  // Local dev: Next rewrites /api/rag → http://127.0.0.1:8000 (see next.config.ts).
  // Vercel: set NEXT_PUBLIC_API_URL in Project → Environment Variables to your Render API URL.
  return '/api/rag';
}

export interface ImageModel {
  id: string;
  label: string;
  vendor: string;
  output: 'image' | 'model3d';
  available: boolean;
  supports_steps: boolean;
  supports_negative_prompt: boolean;
  supports_mode: boolean;
  modes: string[];
  default_steps: number | null;
  description: string;
}

export interface GenerateImageResult {
  image: string;
  mime: string;
  model_id: string;
  seed: number;
  output: string;
  timestamp: string;
}

/** Fetch the catalog of image-generation models from the backend. */
export async function fetchImageModels(): Promise<ImageModel[]> {
  const res = await fetch(`${getApiBaseUrl()}/image-models`);
  if (!res.ok) {
    throw new Error(await parseApiErrorResponse(res));
  }
  return (await res.json()) as ImageModel[];
}

/** Request a generated image from the backend NIM pipeline. */
export async function generateImage(params: {
  prompt: string;
  modelId: string;
  seed?: number;
  steps?: number;
  negativePrompt?: string;
  mode?: string;
}): Promise<GenerateImageResult> {
  const res = await fetch(`${getApiBaseUrl()}/generate-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: params.prompt,
      model_id: params.modelId,
      seed: params.seed ?? 0,
      steps: params.steps,
      negative_prompt: params.negativePrompt,
      mode: params.mode,
    }),
  });
  if (!res.ok) {
    throw new Error(await parseApiErrorResponse(res));
  }
  return (await res.json()) as GenerateImageResult;
}

/** Readable message from a failed FastAPI / Next proxy response. */
export async function parseApiErrorResponse(res: Response): Promise<string> {
  const text = await res.text();
  if (!text) {
    return `Request failed (${res.status} ${res.statusText}). Is the API running on port 8000?`;
  }
  try {
    const j = JSON.parse(text) as { detail?: unknown; message?: string };
    if (j.detail !== undefined) {
      const d = j.detail;
      if (Array.isArray(d)) {
        return d
          .map((item: unknown) => {
            if (item && typeof item === 'object' && 'msg' in item) {
              return String((item as { msg: string }).msg);
            }
            return JSON.stringify(item);
          })
          .join(' ');
      }
      return String(d);
    }
    if (j.message) return String(j.message);
  } catch {
    /* not JSON — often HTML from 502 when backend is down */
  }
  const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (snippet.startsWith('<!') || snippet.includes('<html')) {
    return `Cannot reach API (${res.status}). Start the backend: npm run dev:api`;
  }
  return snippet || `Request failed (${res.status}).`;
}
