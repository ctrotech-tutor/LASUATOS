import { handleApiRequest } from '@lasuatos/api/embedded';

/**
 * Serves the LASUATOS API from the web deployment itself (API_MODE=embedded),
 * so a single free Vercel project runs both the pages and /api/v1.
 * In the default "proxy" mode next.config.ts rewrites /api/v1 to the standalone
 * API process before this route is consulted, so local development is unchanged.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function unavailable(path: string): Response {
  return Response.json(
    {
      type: 'about:blank',
      title: 'Service Unavailable',
      status: 503,
      instance: path,
    },
    {
      status: 503,
      headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' },
    },
  );
}

async function handle(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (process.env.API_MODE !== 'embedded') return unavailable(path);
  try {
    return await handleApiRequest(request);
  } catch (error) {
    // Startup failures (usually a missing or invalid environment variable) are logged
    // with their reason in the function logs and never echoed to the client.
    console.error('LASUATOS API could not start:', error instanceof Error ? error.message : error);
    return unavailable(path);
  }
}

export { handle as DELETE, handle as GET, handle as HEAD, handle as OPTIONS, handle as PATCH, handle as POST, handle as PUT };
