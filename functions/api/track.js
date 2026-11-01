/**
 * Placeholder tracking endpoint.
 *
 * Returns 204 No Content so old frontend beacons do not 405. It stores and
 * forwards nothing, and its CORS headers now come from the shared allowlist
 * instead of a wildcard.
 */
import { corsHeaders } from './_lib/cors.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...corsHeaders(request, env), 'Access-Control-Max-Age': '86400' },
    });
  }

  return new Response(null, {
    status: 204,
    headers: { ...corsHeaders(request, env), 'Cache-Control': 'no-store' },
  });
}
