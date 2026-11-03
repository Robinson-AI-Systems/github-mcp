// GIT-REMOTE-1: /git-remote/exchange (setup code → session key, once) and the worker's broker steps.
// GIT-DIRECT-1: op=authorize, the worker's direct git host checking one request (worker-signed).
import { exchange, broker, directAuthorize } from '../src/git-remote/api.js';

export default async function handler(req, res) {
  try {
    return await (req.query?.op === 'exchange' ? exchange(req, res) : req.query?.op === 'authorize' ? directAuthorize(req, res) : broker(req, res));
  } catch {
    // No request, key, claim or credential detail leaves an unexpected failure.
    if (!res.headersSent) { res.statusCode = 500; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); }
    return res.end('The git remote could not finish this step. Run the git command again in a minute.\n');
  }
}
