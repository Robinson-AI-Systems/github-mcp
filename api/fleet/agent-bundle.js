// AGENT-AUTO-RELEASE-1: the Playground host agent bundle this server advertises. Public
// on purpose: it is the same code as tools/playground-device in this repository, and an
// agent installs it only after checking the control plane's signature over its sha256.
import {currentRelease} from '../../src/fleet/agent-release.js';
import {send} from '../../src/core/http.js';
export function createAgentBundleHandler({release = () => currentRelease()} = {}) {
  return async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return send(res, 405, {error: 'method_not_allowed'}); }
    const rel = release();
    const want = new URL(req.url ?? '/', 'http://local').searchParams.get('sha');
    if (!rel || !want || want !== rel.sha256) { res.setHeader('Cache-Control', 'no-store'); return send(res, 404, {error: 'not_found', description: 'No agent bundle with that sha256 is published here.'}); }
    res.status(200);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Length', String(rel.bytes.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.end(req.method === 'HEAD' ? undefined : rel.bytes);
  };
}
export default createAgentBundleHandler();
