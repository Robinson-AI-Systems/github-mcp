// KEY-ROTATION: replacing one of the GitHub App's three secrets (private key, client secret, webhook secret) without
// downtime. The new value is typed on the owner's protected setup page (private key, client secret) or made by the server
// and shown once there (webhook secret); it never passes through a tool. Before anything is saved, a typed value is proved
// with GitHub itself, so a typo can never replace a working secret. The replaced value is kept, sealed, for
// ROTATION_WINDOW_MS only: webhook deliveries signed with it are still believed during that window (GitHub signs with the
// old secret until the owner saves the new one there), and Undo puts it back. Nothing here weakens a check: every
// signature must still match one of at most two secrets the owner stored, and the window cannot be extended.
import crypto from 'node:crypto';
import { signAppJwt } from './credentials.js';
import { bareOctokit } from './client.js';

/** How long a replaced App secret is still accepted (webhook) or can be put back (Undo). Fixed: 24 hours. */
export const ROTATION_WINDOW_MS = 24 * 60 * 60 * 1000;
export const ROTATION_WINDOW_WORDS = '24 hours';
const OAUTH_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const MAX_PEM_BYTES = 16 * 1024;

/** Plain names, for the page and the change log (never a value). */
export const APP_SECRET_NAMES = Object.freeze({
  private_key: 'private key',
  client_secret: 'client secret',
  webhook_secret: 'webhook secret'
});

/** Checks a pasted private key is one RSA private key (as GitHub issues them). Returns the trimmed PEM or throws a plain TypeError. */
export function checkPrivateKeyPem(text) {
  const pem = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!pem || Buffer.byteLength(pem) > MAX_PEM_BYTES || !/^-----BEGIN (RSA )?PRIVATE KEY-----\n[\s\S]+\n-----END (RSA )?PRIVATE KEY-----$/.test(pem))
    throw new TypeError('Paste the whole private key file from GitHub, from the BEGIN line to the END line.');
  let key;
  try { key = crypto.createPrivateKey(pem); } catch { throw new TypeError('That private key could not be read. Paste the whole .pem file GitHub downloaded.'); }
  if (key.asymmetricKeyType !== 'rsa') throw new TypeError('GitHub App private keys are RSA keys; that is a different kind of key.');
  return pem + '\n';
}

/** Checks a pasted client secret's shape (GitHub's are 40 hexadecimal characters; a little room is left). */
export function checkClientSecret(text) {
  const secret = String(text ?? '').trim();
  if (!/^[A-Za-z0-9_]{20,100}$/.test(secret)) throw new TypeError('Paste the client secret exactly as GitHub showed it (letters and numbers only).');
  return secret;
}

/** A fresh webhook secret made by the server (32 random bytes). The owner copies it into GitHub once. */
export function newWebhookSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Proves GitHub accepts this private key for this App: signs an App JWT with it and reads GET /app.
 * @returns true only when GitHub answered 200 with the same App id; false when GitHub refused the key.
 */
export async function privateKeyWorks({ appId, pem, fetch, now = Date.now }) {
  const jwt = signAppJwt({ appId, privateKey: pem, now });
  try {
    const { data } = await bareOctokit({ token: jwt, fetch }).request('GET /app');
    return Number(data?.id) === Number(appId);
  } catch (error) {
    if ([401, 403, 404].includes(error?.status)) return false;
    throw error;
  }
}

/**
 * Proves GitHub accepts this client id and secret: an OAuth code exchange with a random, unusable code. GitHub answers
 * `bad_verification_code` when the id and secret are right and `incorrect_client_credentials` when they are not. Nothing is
 * granted either way (the code does not exist).
 * @returns true (accepted) | false (refused); throws when GitHub's answer says neither.
 */
export async function clientSecretWorks({ clientId, clientSecret, fetch }) {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code: 'key-check-' + crypto.randomBytes(16).toString('hex') })
  });
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (data?.error === 'bad_verification_code') return true;
  if (data?.error === 'incorrect_client_credentials') return false;
  throw new Error('GitHub did not say whether the client secret is right.');
}
