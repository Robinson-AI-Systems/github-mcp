// RELAY-BODY-1: a stand-in for the Go net/http reverse proxy in front of the PC worker (Tailscale Funnel), used
// by the git remote test world (`startGitRemote(w, { front: 'go' })`).
//
// It forwards the request body in network-sized slices at a network-like pace and, when the worker's response
// header arrives while the body is still uploading, does what Go's HTTP/1.x server does in
// `(*chunkWriter).writeHeader`: with less than `maxPostHandlerReadBytes` (256 KiB) of the request unread it reads
// and drops the rest itself (so the proxied copy comes up short and the backend connection is cut); with more,
// it only marks the connection to close after the reply and the copy carries on. That is the mid-size window
// (about 16 KiB to 256 KiB) in which pushes through the service domain were corrupted or cut off on 2026-11-03.
//
// Every forwarded request records the SHA-256 and length of the bytes the client sent and of the bytes the
// worker was given, so a test can check byte-exact delivery.
import { createHash } from 'node:crypto';

export const GO_MAX_POST_HANDLER_READ_BYTES = 256 << 10;
const SLICE = 16 << 10;

/**
 * Proxies `req` to `upstream` (an http.ClientRequest already created) and the reply to `res`.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {import('node:http').ClientRequest} upstream
 * @param {{ paceMs?: number, record?: object }} [options]
 */
export function goFrontForward(req, res, upstream, { paceMs = 10, record = {} } = {}) {
 const declared = Number(req.headers['content-length'] ?? NaN);
 const client = createHash('sha256'), delivered = createHash('sha256');
 Object.assign(record, { clientBytes: 0, deliveredBytes: 0, discarded: false, ended: false });
 let discarding = false;
 const finish = () => { record.ended = true; record.clientSha = client.digest('hex'); record.deliveredSha = delivered.digest('hex'); };
 upstream.on('response', reply => {
  const unread = Number.isSafeInteger(declared) ? declared - record.clientBytes : 0;
  if (unread > 0 && unread < GO_MAX_POST_HANDLER_READ_BYTES) {
   // Go: `discard = true` → io.CopyN(io.Discard, reqBody, 256 KiB + 1); the proxy's own copy then sees EOF early,
   // the transport's ContentLength check fails and the backend connection is closed.
   discarding = true; record.discarded = true;
   req.once('end', () => { upstream.destroy(); res.destroy(); });
   return;
  }
  res.writeHead(reply.statusCode, reply.headers); reply.pipe(res);
 });
 upstream.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end(); } else res.destroy(); });
 req.on('close', () => { if (!req.complete) upstream.destroy(); });
 req.on('data', chunk => {
  req.pause();
  (async () => {
   for (let at = 0; at < chunk.length; at += SLICE) {
    const slice = chunk.subarray(at, at + SLICE);
    record.clientBytes += slice.length; client.update(slice);
    if (!discarding) { record.deliveredBytes += slice.length; delivered.update(slice); upstream.write(slice); }
    if (paceMs) await new Promise(resolve => setTimeout(resolve, paceMs));
   }
   req.resume();
  })();
 });
 req.on('end', () => { finish(); if (!discarding) upstream.end(); });
}
