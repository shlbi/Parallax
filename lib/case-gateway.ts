/** Same-origin, fixed-destination gateway. No arbitrary paths, headers, or URLs. */
export type GatewaySettings = { backend: string; origin: string; secret: string; runtime: string };
const ID = '[a-f0-9]{32}';
const routes: [RegExp, string[]][] = [
  [/^session$/, ['GET', 'POST', 'DELETE']],
  [/^session\/revoke-all$/, ['POST']],
  [/^cases$/, ['GET', 'POST']],
  [new RegExp(`^cases/${ID}$`), ['GET', 'PATCH', 'DELETE']],
  [new RegExp(`^cases/${ID}/members$`), ['GET', 'PUT']],
  [new RegExp(`^cases/${ID}/members/${ID}$`), ['DELETE']],
  [new RegExp(`^cases/${ID}/authorizations$`), ['GET', 'POST']],
  [new RegExp(`^cases/${ID}/authorizations/${ID}/revoke$`), ['POST']],
  [new RegExp(`^cases/${ID}/audit$`), ['GET']],
];
const safeHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
function error(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status, headers: safeHeaders });
}
async function boundedBody(body: ReadableStream<Uint8Array> | null, maximum: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maximum) { await reader.cancel(); throw new RangeError('Body too large'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
export async function caseGateway(request: Request, segments: string[], settings: GatewaySettings,
  upstreamFetch: typeof fetch = fetch): Promise<Response> {
  let base: URL;
  let origin: URL;
  try {
    base = new URL(settings.backend);
    origin = new URL(settings.origin);
    if (!['local', 'cloud'].includes(settings.runtime) || !['http:', 'https:'].includes(base.protocol)
      || !['http:', 'https:'].includes(origin.protocol) || base.username || base.password
      || base.pathname !== '/' || base.search || base.hash || origin.origin !== settings.origin
      || (base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
      || (origin.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))
      || (settings.runtime === 'cloud' && (base.protocol !== 'https:' || origin.protocol !== 'https:' || settings.secret.length < 32))) {
      throw new Error('Invalid configuration');
    }
  } catch {
    return error(503, 'SERVICE_NOT_CONFIGURED', 'Case storage is not configured. Set the backend connection on the server.');
  }
  const path = segments.join('/');
  const route = routes.find(([pattern]) => pattern.test(path));
  if (!route || segments.some(s => s.includes('/') || s.includes('%'))) return error(404, 'NOT_FOUND', 'Unknown case-service route.');
  if (!route[1].includes(request.method)) return error(405, 'METHOD_NOT_ALLOWED', 'Method not supported.');
  const write = request.method !== 'GET';
  if (write && request.headers.get('origin') !== settings.origin) return error(403, 'ORIGIN_REJECTED', 'Request origin is not permitted.');
  if (write && request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return error(415, 'JSON_REQUIRED', 'Use an application/json request.');
  }
  const target = new URL(`/v1/${path}`, base);
  const query = new URL(request.url).searchParams;
  for (const [key, value] of query) {
    if (!['offset', 'limit', 'after'].includes(key) || !/^\d{1,6}$/.test(value) || query.getAll(key).length !== 1) {
      return error(422, 'INVALID_QUERY', 'Invalid pagination query.');
    }
    target.searchParams.set(key, value);
  }
  const forwarded = new Headers({ Accept: 'application/json' });
  const cookieName = origin.protocol === 'https:' ? '__Host-parallax_session' : 'parallax_session';
  // Never forward unrelated application cookies, Authorization, forwarding headers or host.
  const sessionCookies = (request.headers.get('cookie') || '').split(';').map(s => s.trim())
    .filter(s => s.startsWith(`${cookieName}=`));
  if (sessionCookies.length === 1 && new RegExp(`^${cookieName}=[A-Za-z0-9_-]{43}$`).test(sessionCookies[0])) {
    forwarded.set('Cookie', sessionCookies[0]);
  }
  for (const name of ['X-Parallax-CSRF', 'If-Match']) {
    const value = request.headers.get(name);
    if (value) forwarded.set(name, value);
  }
  if (settings.secret) forwarded.set('X-Parallax-Gateway', settings.secret);
  if (write) { forwarded.set('Origin', settings.origin); forwarded.set('Content-Type', 'application/json'); }
  let body: Uint8Array | undefined;
  try { if (write) body = await boundedBody(request.body, 32768); }
  catch { return error(413, 'BODY_TOO_LARGE', 'Request exceeds 32 KiB.'); }
  try {
    const upstream = await upstreamFetch(target, { method: request.method, headers: forwarded,
      body: body ? new TextDecoder().decode(body) : undefined, cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(20000) });
    if (upstream.status >= 500) { await upstream.body?.cancel(); return error(502, 'SERVICE_UNAVAILABLE', 'The case service is unavailable.'); }
    if (upstream.status !== 204 && !upstream.headers.get('content-type')?.includes('application/json')) {
      await upstream.body?.cancel(); return error(502, 'INVALID_RESPONSE', 'The case service returned an unexpected response.');
    }
    const bytes = await boundedBody(upstream.body, 2 * 1024 * 1024);
    const resultHeaders = new Headers(safeHeaders);
    if (upstream.status !== 204) resultHeaders.set('Content-Type', 'application/json');
    const etag = upstream.headers.get('etag');
    if (etag) resultHeaders.set('ETag', etag);
    for (const cookie of upstream.headers.getSetCookie()) {
      if (cookie.startsWith(`${cookieName}=`)) resultHeaders.append('Set-Cookie', cookie);
    }
    return new Response(upstream.status === 204 ? null : new TextDecoder().decode(bytes), { status: upstream.status, headers: resultHeaders });
  } catch { return error(502, 'SERVICE_UNAVAILABLE', 'The case service could not be reached.'); }
}
