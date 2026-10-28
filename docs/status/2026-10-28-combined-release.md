# Combined audit, authority and native Git release

Current serving source: **53df99ef8b10d8c7351aa5eae4ee7cc867c8f228**, independently verified Vercel READY on the production domain and matching /api/contract. Contract reports 491 tools. Checked manual release [40743480147](https://github.com/Robinson-AI-Systems/github-mcp/actions/runs/40743480147) succeeded after main's required checks. This followed implementation, not an intermediate feature release.

## Merged and checked

- #449: remaining owner typed-target confirmation cleanup and CI-FAST-1 reconciliation.
- #450: eight enterprise administrative policy contracts, provider readback and corrected setup wording.
- #451: portable real native Git worker plus five MCP tools. Source ci 40738014517, release-policy 40738014224 and actual image build/non-root smoke 40738014620 passed. Local real Git/protocol/store selection passed 117 tests.
- #452: organization/enterprise IP entry list/save/delete; organization notification restriction and web-commit signoff. Exact source 2dcf3a1483464f2a30d2bc961235e0cd5c573143 passed ci 40742015618 and release-policy 40742015588. Focused 555 tests and committed-tree npm run check passed. Merged 71c303f1ce310e76ac42fe79d64775992625489e, no review threads.
- #453: obsolete developer lifecycle production-mode veto removed for full ordinary owners across create/seed/test/forwarders/cleanup; explicit passes, scratch verification and run provenance retained. Exact source 713e4f365c6acfc5c2ffb375159311baa38a55be passed ci 40742974813 and release-policy 40742974145, no review threads. Focused 407 tests and committed-tree npm run check passed. Merge is the serving source above.

## Actual live acceptance

All observations below were through this custom service or independently observed public/deployment endpoints on the serving revision, 2026-10-28 UTC. Unit/DB/container tests are separate proof.

- Large immutable file: src/db.js at 4ea56dee, blob 75bafde9d8b812fc9d1c2e520114ebdfa53cd523. Full text returned all 98,401 characters. Four byte windows at 0/32768/65536/98304 reconstructed exactly 98,404 bytes, equal to Git source. SHA-256 68269a9f450c70294cef467f51c491d3176c7f2577b06c3177ad05e6f8efa131. Last window 100 bytes, complete=true. One canonical text payload, compact structured pointer. Value-free diagnostic: zero findings, byte_exact_available=true, detector revision 2026-10-28.1.
- github_ip_allowlist_list independently verified the scratch organization's actual GraphQL identity and returned a complete empty inventory. No IP policy changed.
- Notification restriction and web-commit signoff dry runs read actual current settings and produced previews with no second owner confirmation or provider mutation. Journals 2768/2767. No security policy changed.
- Ordinary private scratch repository creation succeeded as the owner (journal 2762), then exact cleanup succeeded (2772). Subsequent independent repository GET returned 404. No fixture or native workspace remains from this test.
- GET /, /privacy, /connection with Accept:text/html: 200, CSP, nosniff, same-origin referrer policy. Unauthenticated MCP initialize: 401 with WWW-Authenticate.
- Registered a disposable public client using token_endpoint_auth_method=none; no secret or token issued and no GitHub sign-in completed. Same valid client/request: plain PKCE refused 403 with no provider redirect; S256 accepted 302 to GitHub. Unused client registration is covered by existing 30-day stale-client cleanup. Refresh-family replay and fresh human sign-in remain unverified.
- Native workspace list returned empty, complete=true. Signed capabilities honestly returned ready=false/setup_required=true because external worker ingress is unavailable. This is not a native clone/push acceptance pass.

## Native worker deployment: healthy internally, ingress blocked

The existing GitHub MCP Dokploy project now contains the worker built from exact source 53df99ef. Auto-deploy is disabled. Its initial deployment completed; Docker reports running/healthy. Build output independently shows native Git 2.39.5, a persistent named data volume, project network and generated Traefik routers for service native-git on port 3000. The converted compose includes dokploy-network and the expected HTTPS routing. Worker public verifier is pinned from the serving /api/native-git-key endpoint; no private signing key was transferred. MCP production worker origin is configured.

The generated public HTTPS origin times out externally (curl proxy returned upstream connection timeout; MCP signed capabilities also unavailable). This is a network/ingress observation, not proof of a specific firewall/NAT cause. Server inventory and container configuration administration are denied by Dokploy (UPSTREAM_UNAUTHORIZED for server/docker). Scoped project/container status and build logs work. Cloudflare tools rejected calls without an unavailable link_id; plugin discovery supplied no usable account selector. Do not guess one or change the friend's server-wide controls.

**Re-entry:** an authorized network operator must make an HTTPS hostname reach this existing project's native-git:3000, via the host's reachable TLS proxy or an owned outbound tunnel. Verify external /health, then signed MCP capabilities ready=true. If the origin changes, update NATIVE_GIT_WORKER_URL and use a checked configuration release. Then recreate one exact disposable scratch fixture and perform clone/edit/commit/push, GitHub readback, stale-generation denial, immutable replay, conflict/recovery and disposal. Keep the worker public key pin and storage; no need to redo source implementation or buy capacity. Configure backing-volume free-space/quota monitoring before ongoing active use. No live native network operation or provider credential was sent to this unreachable worker.

The dedicated developer scratch helper now gets past the removed mode veto but refuses its separate owner-verified scratch prerequisite. The list-scenarios diagnostic also reports the owner-verification requirement. Ordinary owner repo create/delete proved the underlying provider authority; no scratch flag or existing connection setting was changed to bypass the verification. Check protected scratch enrollment before using the developer scenario lane. The native acceptance fixture can use ordinary journaled repository tools as above.

## Remaining scope and acceptance

The core reported read/wire/alias/search/false-positive defects, owner-authority work, administrative additions and native worker source are implemented and released. Native Git is **not externally usable yet**. Proprietary fresh GitHub secret-scanner parity remains unavailable through a verified public API; Robinson scanning plus exact repository/Gitleaks/provider setup guidance is implemented and the difference disclosed. LFS/submodules/hooks/signing/custom shell remain explicit local Git alternatives, not invented hosted support.

The 15 historical standalone acceptance obligations plus the new native-worker ingress/lifecycle row are individually tracked in STATUS (16 outstanding rows, not 16 code defects or new demands on the owner); this release does not manufacture passes for paid/destructive fixtures, separate narrowed/revocation grants, RTC pass issuance, fresh human OAuth or UI-only provider readback. PUB-5 now has live PKCE refusal/acceptance evidence in addition to headers, while refresh-family/per-person usage remain. The native ingress prerequisite is recorded on OWNER-CHECKLIST and NATIVE-GIT-OPERATIONS. The existing 2026-10-23 decision requesting no further budget testing is retained; that historical row is not a new approval request. No paid plan, server-wide permission, useful OAuth grant or real security policy was changed for testing.
