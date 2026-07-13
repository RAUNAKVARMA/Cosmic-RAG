import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side proxy to the FastAPI backend on Render.
 * On Vercel, the browser calls same-origin /api/rag/* — no CORS, no public API URL required.
 */
function backendBaseUrl(): string {
  return (
    process.env.BACKEND_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    process.env.NEXT_PUBLIC_BACKEND_URL?.trim() ||
    'https://cosmic-rag-api.onrender.com'
  ).replace(/\/$/, '');
}

function backendSecret(): string | undefined {
  const secret =
    process.env.BACKEND_API_SECRET?.trim() ||
    process.env.API_SECRET?.trim() ||
    process.env.NEXT_PUBLIC_API_SECRET?.trim();
  return secret || undefined;
}

async function proxyRequest(req: NextRequest, pathSegments: string[]): Promise<NextResponse> {
  const path = pathSegments.join('/');
  const target = `${backendBaseUrl()}/${path}${req.nextUrl.search}`;

  const headers = new Headers();
  const contentType = req.headers.get('content-type');
  if (contentType) {
    headers.set('content-type', contentType);
  }

  const incomingAuth = req.headers.get('authorization');
  if (incomingAuth) {
    headers.set('authorization', incomingAuth);
  } else {
    const secret = backendSecret();
    if (secret) {
      headers.set('authorization', `Bearer ${secret}`);
    }
  }

  const init: RequestInit = {
    method: req.method,
    headers,
    cache: 'no-store',
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    return NextResponse.json(
      {
        detail:
          'Cannot reach the Cosmic RAG API. Check BACKEND_URL on Vercel or redeploy the Render service.',
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  const upstreamType = upstream.headers.get('content-type');
  if (upstreamType) {
    responseHeaders.set('content-type', upstreamType);
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxyRequest(req, path);
}

export async function POST(req: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxyRequest(req, path);
}

export async function PUT(req: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxyRequest(req, path);
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxyRequest(req, path);
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxyRequest(req, path);
}
