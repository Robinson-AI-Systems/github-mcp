// V-4/V-1 shared forwarder primitives: the key, the encryption context, a safe view, and registration with a one-time secret.
import { randomBytes } from 'node:crypto';
import { ownerOneTimeStore } from '../tools/one-time-root.js';
import { decryptSecret, encryptSecret, readEncryptionKey } from '../core/crypto.js';
import { forwarderUrl } from './forward-sender.js';
import { MAX_FORWARDERS } from './ledger.js';
import { refusal } from '../tools/github-write.js';

export const forwarderKey = (ctx) => {
  try { return readEncryptionKey(ctx.env ?? process.env); } catch { throw refusal('The server encryption key is not configured, so signing secrets cannot be kept.', 500); }
};
export const secretAad = ({ id, account, connection }) => `github-forwarder/${id}/${account}/${connection}`;
export const oneTimeStore = (ctx) => ownerOneTimeStore(ctx, { encryptionKey: forwarderKey(ctx) }); // ONE-TIME-ROOT-1
/** Safe view of a stored forwarder: never the URL path/query, never the ciphertext. */
export const forwarderView = (row) => ({ id: row.id, host: forwarderUrl(row.url).hostname, events: [...(row.events ?? [])], run_id: row.run_id ?? null, repo: row.repo ?? null });
export const forwarderSecret = (ctx, row) => decryptSecret(row.secret_enc, { aad: secretAad({ id: row.id, account: row.account, connection: row.connection }), key: forwarderKey(ctx) });

/** Create a forwarder with a new server-generated secret, revealed once. Returns { id, reveal }. */
export async function registerForwarder(ctx, { account, connection, url, events = [], runId = null, repo = null, id = `fwd_${randomBytes(12).toString('base64url')}` }) {
  const secret = randomBytes(32).toString('hex');
  const made = await ctx.db.createDevForwarder({ id, account, connection, url: forwarderUrl(url).toString(), events, runId, repo,
    secretEnc: encryptSecret(secret, { aad: secretAad({ id, account, connection }), key: forwarderKey(ctx) }) });
  if (!made) throw refusal(`This connection already has ${MAX_FORWARDERS} forwarders; delete one first.`);
  try {
    return { id, reveal: (await oneTimeStore(ctx).issue({ account, kind: 'github-forwarder-signing-secret', secret })).setupPath };
  } catch (error) {
    await ctx.db.deleteDevForwarder({ id, account, connection }).catch(() => {});
    throw error;
  }
}
