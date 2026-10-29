# Durable native clone intents — 2026-10-29

Outcome: retrying the same native clone intent after ten minutes returns the original receipt, including a closed workspace, while a fresh key creates a separate workspace. Recover legacy bucketed receipts within the original connection and verify workspace ownership before reuse; unavailable historical mappings fail without cloning.

Acceptance: real dispatcher/Git tests span multiple clock buckets, legacy migration, closed and active receipts, fresh intents, missing metadata and foreign connections/passes. The database lookup runs against fake and isolated PostgreSQL; assembled checks use base 454f6d4d6168c6608e1a3ddcbbd1ea3f19bb93c3. Exact-head CI, policy, image and review precede merge/release and actual cross-bucket live proof. Other write tools retain their current request-key contract.

Local dispatcher/native suites passed 89 tests, including real local Git and one-hour clock advances. Local PostgreSQL binaries are absent; the isolated database contract must pass in exact-head CI, not be inferred from the fake. No runtime deployment or new live durability proof yet.

The initial local check ran before the implementation commit and therefore did not assess the final committed docs diff. Exact-head CI correctly rejected missing PR-card/catalog reconciliation; both are now updated, and the assembled committed-tree check is rerun. Shared write-core, fake journal and owner-authority suites passed 37 additional tests. The historical lookup filters exact account/repository/client/tool and literal controlled digest prefix, then checks the job's full client/pass binding; missing/expired legacy metadata refuses before a clone.
