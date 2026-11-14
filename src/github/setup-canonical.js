// Canonicalize public setup GETs before issuing host-bound CSRF cookies.
// The trusted destination comes exclusively from configured PUBLIC_BASE_URL;
// never interpret an incoming Host as an authorized login origin.
//
// The host the BROWSER used is what matters here. Behind a reverse proxy
// (Vercel, or the Development Rack gateway, which forwards to the instance
// at its internal address and passes the public name as X-Forwarded-Host)
// the immediate Host header is the internal one, which never equals the
// configured origin; comparing it caused a redirect to the very URL the
// browser had just requested, forever, and the CSRF cookie was never set.
// The forwarded host is only ever COMPARED with the configured origin, never
// used as a destination, so a forged value can at most skip a redirect.
function requestedHost(req) {
  const forwarded = req.headers?.['x-forwarded-host'];
  const first = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '';
  return first || req.headers?.host;
}

export function canonicalSetupUrl(req, configuredOrigin) {
  const host = requestedHost(req);
  if (typeof host !== 'string' || !host ||
      host.toLowerCase() === new URL(configuredOrigin).host.toLowerCase()) return null;
  const query = new URLSearchParams();
  const installationId = req.query?.installation_id;
  if (typeof installationId === 'string' && /^[1-9][0-9]{0,19}$/.test(installationId))
    query.set('installation_id', installationId);
  for (const key of ['show', 'secret']) {
    const value = req.query?.[key];
    if (typeof value === 'string' && /^[A-Za-z0-9_-]{20,128}$/.test(value))
      query.set(key, value);
  }
  const suffix = query.toString();
  return `${configuredOrigin}/api/github/setup${suffix ? `?${suffix}` : ''}`;
}
