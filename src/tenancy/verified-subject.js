// RELAY-OWNER-2: a tenant database's provider-verified numeric GitHub id (RELAY-OWNER-1) lives on the database object
// as an unlisted (non-enumerable) property, so it never lands in stored scope or serialized output. Object spread drops
// unlisted properties, so every wrapper that rebuilds the database with `{ ...db }` must carry it across with
// `keepVerifiedSubject`. It is only ever read from the identity row with the membership, never from a request.
const GITHUB_ID = /^[1-9][0-9]{0,18}$/;

/** Marks `db` with the verified numeric GitHub id (unlisted, read-only). A missing or non-numeric value marks nothing. */
export function setVerifiedSubject(db, subject) {
  if (db && typeof subject === 'string' && GITHUB_ID.test(subject) && db.verifiedGithubSubject === undefined)
    Object.defineProperty(db, 'verifiedGithubSubject', { value: subject, enumerable: false, writable: false, configurable: false });
  return db;
}

/** Copies the verified id from the database `from` onto its wrapper `to` (which spread dropped it from). */
export const keepVerifiedSubject = (to, from) => setVerifiedSubject(to, from?.verifiedGithubSubject);
