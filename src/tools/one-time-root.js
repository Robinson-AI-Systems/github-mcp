// ONE-TIME-ROOT-1 (2026-11-15): a one-time secret is revealed exactly once, on the owner's private setup page, and that page
// consumes it from the ROOT database. A tenant-routed connection (the owner connecting from claude.ai is one, RELAY-OWNER-1)
// carries a tenant-schema `ctx.db`, so a secret issued through it landed in the tenant's own one_time_secrets table, where the
// page never looked: every reveal answered "used, expired, or does not exist". Secrets are issued where the page reads them,
// through the same root handle the Playground and git-remote index already use. The reveal still needs the administrator
// passphrase; nothing here widens who can see a secret, and the issuing tools remain owner-audience.
import { createOneTimeStore } from '../core/one-time-secrets.js';
import { readEncryptionKey } from '../core/crypto.js';
import { rootAllocationDb } from '../playground/index.js';

export const SETUP_PATH = '/api/github/setup';

/** The one-time store the owner's setup page can actually consume from, whatever database the calling connection is scoped to. */
export const ownerOneTimeStore = (ctx, { encryptionKey = readEncryptionKey(ctx.env ?? process.env) } = {}) =>
  createOneTimeStore({ db: rootAllocationDb(ctx), service: 'github', setupPath: SETUP_PATH, encryptionKey });
