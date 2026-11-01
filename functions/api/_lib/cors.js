/**
 * Origin allowlist for the public API surface.
 *
 * Previously every endpoint answered `Access-Control-Allow-Origin: *`. That
 * lets any website read non-credentialed responses and is flagged by scanners
 * even where the data is public. These helpers echo an origin back only when
 * its host is on the allowlist; otherwise no CORS headers are emitted at all.
 *
 * CORS is not authentication: every route still validates its own input, and
 * cookie-authenticated routes rely on HttpOnly + SameSite=Lax sessions.
 */
const BASE_HOSTS = [
  'avnideepayurveda.in',
  'www.avnideepayurveda.in',
  'avnideep-shilajit-new.pages.dev',
];

const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

export function allowedHosts(env) {
  const hosts = BASE_HOSTS.concat(LOCAL_HOSTS);
  const configured = String((env && (env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN)) || '');
  for (const part of configured.split(',')) {
    const value = part.trim();
    if (!value) continue;
    try {
      hosts.push(new URL(value).hostname.toLowerCase());
    } catch (e) {
      if (/^[a-z0-9.-]+$/i.test(value)) hosts.push(value.toLowerCase());
    }
  }
  return hosts;
}

export function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  let url;
  try {
    url = new URL(origin);
  } catch (e) {
    return false;
  }
  if (url.protocol !== 'https:' && LOCAL_HOSTS.indexOf(url.hostname) === -1) return false;
  const host = url.hostname.toLowerCase();
  return allowedHosts(env).some((allowed) => host === allowed || host.endsWith('.' + allowed));
}

export function corsHeaders(request, env, methods = 'GET, POST, OPTIONS') {
  const origin = (request && request.headers && request.headers.get('Origin')) || '';
  const headers = { Vary: 'Origin' };
  if (isAllowedOrigin(origin, env)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = methods;
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '600';
  }
  return headers;
}

export default corsHeaders;
