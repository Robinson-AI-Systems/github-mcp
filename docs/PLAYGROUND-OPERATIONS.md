# Playground project-scoped operation

Keep Vercel for MCP, Neon for metadata and Dokploy for execution. The control plane accepts no caller runtime URL/provider credential. Never give the executor a Docker socket, host PID/filesystem mount or orchestration credential. Containers are not hypervisor VMs.

## Protected deployment configuration

Configure PLAYGROUND_DOKPLOY_ORIGIN (HTTPS root), PLAYGROUND_DOKPLOY_API_KEY (the account credential), PLAYGROUND_DOKPLOY_PROJECT_ID, PLAYGROUND_DOKPLOY_ENVIRONMENT_ID, PUBLIC_BASE_URL and PLAYGROUND_INGRESS_IPV4. Dokploy does not issue a separate project-scoped key: the application pins and verifies project/environment/source/resource ownership before mutations. Generated domains must target107.90.116.157. Use an immutable PLAYGROUND_IMAGE digest or full40-character PLAYGROUND_BUILD_SOURCE_SHA; otherwise the deployed Vercel source SHA pins the public Git build context. Do not publish project IDs/keys or enter credentials into tool arguments/chat.

Automatic clone enqueue records a bound intent. A trusted project manager advances provisioning/attachment and sweeps revoked/expired allocations. It holds only a cleanup-recheck capability; it cannot bypass current authorization or access command volumes. Provisioning and cleanup use exact Compose source/project/binding ownership and durable CAS state. An ambiguous create is recovered by exact inventory, never duplicate allocation. A lost delete response is recovered by absence readback. Unknown/denied inventory is not proof of cleanup.

The new native attachment protocol must be deployed to the primary worker without replacing its persistent volume, verifier, credentials or unrelated workspaces. Preserve legacy host pins and all tenant schemas. Do not retire Render as part of this deployment.

## Operator-supported storage and networking contract

### Optional best-effort resource mode

Owner decision2026-10-30 permits implementation before specific resource controls/monitoring become available. Set protected PLAYGROUND_RESOURCE_MODE=best_effort to provision without a capacity feed and enable the managed private allocation baseline. The default remains verified for existing deployments. Without fresh measurements, the provider may refuse the configured allocation; do not invent headroom, reservations or an automatic paid upgrade. Valid measured pressure still queues work. A configured telemetry feed still fails closed; remove/reconfigure it deliberately through protected setup rather than silently substituting stale data.

Best effort is accepted only for an exact automatically managed attached allocation using the generated dedicated internal-network profile. It requires persisted immutable plan hash, matching provider project/environment/origin, runtime identity, verified shared repository/read-only Git mounts and a current signed grant heartbeat. URL-only attachments and custom network drivers require the existing verified path. No caller can select resource mode or supply enforcement assertions.

Availability reports mode best_effort, unknown storageQuotaBytes:null, configured CPU/memory separately from any measured runtime cgroup limits, resourceGuarantees:false and no reserved capacity. Unknown runtime resource measurements are not invented. Normal runtime pressure admission, replay, log scanning, grant revocation, inactivity, process termination and strict cleanup readback remain active. Missing host-volume readback leaves cleanup unconfirmed and recoverable; delete acknowledgement is never proof of disposal.

The default internal network deliberately has no external dependency-download egress. Offline/preinstalled builds, tests, PostgreSQL, Chromium and private ingress are supported by the image; do not claim arbitrary online dependency installation in this profile. The existing100MiB/no-symlink source transfer bound also remains. A verified isolated egress driver can provide external downloads through the verified profile. No broad host access, Docker socket or paid resource is introduced.

### Verified resource mode

Default ordinary named volumes and internal bridge network do not establish a quota or dependency egress. Arbitrary commands remain unavailable until independently protected enforcement evidence exists. Safe Git/GitHub operations remain available.

An operator can supply a project-supported quota volume driver using PLAYGROUND_STORAGE_DRIVER and nonsecret JSON PLAYGROUND_STORAGE_OPTIONS, and an isolated egress network driver using PLAYGROUND_NETWORK_DRIVER and nonsecret JSON PLAYGROUND_NETWORK_OPTIONS. Driver option values can use {binding} and {volume}. All four volumes must share the binding's aggregate quota group; separate150GB quotas on each volume would violate the workspace total. Network policy must prevent access to other tenants, host/admin endpoints, metadata addresses and control networks while permitting development dependency downloads. Driver credentials belong in the operator's driver configuration, never these options or command containers. Do not install host plugins or request broad administration from the agent.

A custom driver name/configuration is not enforcement proof. The operator must provide supported driver semantics and independently observed quota/network/termination readback. Built-in local/bridge/host/overlay drivers are not accepted as substitutes for this contract. Missing support keeps safe fallback active; do not pretend150GB has been reserved or purchased. Protected PLAYGROUND_CPU_CPUS and PLAYGROUND_MEMORY_BYTES can select a smaller aggregate allocation (defaults8CPU/8GiB, never above those targets). CPU8 and memory8GiB are aggregate ceilings; actual smaller enforced allocations may operate in constrained mode. Workload builds, browser, PostgreSQL and commands share that allowance.

## Continuous signed telemetry

PLAYGROUND_TELEMETRY_URL is a fixed protected HTTPS URL without query/credentials; PLAYGROUND_TELEMETRY_PUBLIC_KEY is the Ed25519 public verifier. The operator's sensor retains its private signing key outside this service and all execution containers. A GET returns bounded16KiB JSON, signed byte-for-byte in x-robinson-telemetry-signature as ed25519: plus base64url signature. No redirect or stale fallback is accepted after a configured feed fails.

Envelope:

```json
{
  "purpose":"robinson-playground-capacity/v1",
  "project":"OPERATOR_PROJECT",
  "observedAt":1793318400000,
  "availableCpuCpus":8,
  "availableMemoryBytes":8589934592,
  "availableDiskBytes":10737418240,
  "pressure":0.1,
  "allocations":[
    {
      "workspace_id":"job_0123456789abcdef",
      "binding":"EXACT_64_HEX_BINDING",
      "observedAt":1793318400000,
      "expiresAt":1793318460000,
      "isolation":true,
      "termination":true,
      "repositoryAttached":true,
      "cpuCpus":8,
      "memoryBytes":8589934592,
      "storageQuotaBytes":150000000000
    }
  ]
}
```

Examples are shapes, not real observations. Capacity observations expire after60seconds. Before provider creation, fresh availableCpuCpus (when supplied) and availableMemoryBytes select smaller ceilings below the protected targets; queued never-created plans can adapt without touching an existing allocation or lease. Workspace evidence is exact-bound and expiry-checked, with independent runtime cgroup readback before admission; use short evidence leases. The sensor must measure the actual per-workspace aggregate resource/quota/network/termination controls, not infer them from YAML. No daily job quota or arbitrary request-count admission is added. Protected static PLAYGROUND_ADMISSION / PLAYGROUND_ENFORCEMENT remain compatibility inputs when no continuous feed is configured; they are not perpetual observations.

## Repository, preview and expiry

Attachment seals the exact original workspace state and copies bounded encrypted pages between trusted Git brokers. Final routing switches only after generation, ancestry, uncommitted state and actual shared mount/read-only Git metadata checks. The original mutation lease spans finalization and can only be released by its exact transfer. The command container never receives broker credentials. Source file scans/advanced Git limitations remain applicable. The current sealed snapshot transfer is bounded100MiB of raw files and rejects symlinks; larger/symlink-bearing repositories retain their original Git workspace and report attachment unavailable rather than losing data. This remains a product limitation to remove before claiming arbitrary repository support.

Interactive previews use short-lived one-use private entry pages and signed, port-bound browser sessions. No public application ports or provider credentials are returned. HttpOnly Secure Strict cookies and HTTP/WebSocket expiry enforce the session. App assets and HMR do not renew inactivity; actual authorized Git/command activity does, through signed current-grant heartbeats. Preview entry URLs are private capabilities and must not be published.

Revoked/expired authority stops the runtime container namespace; process-group cancellation alone is not whole-allocation cleanup. The manager verifies stopped state, deletes only the exact allocation and all four owned volumes, reads back absence, then closes the exact preserved source workspace. Transient telemetry/authorization transport failure stops execution while preserving recoverable data. Under the2026-10-30 owner decision, independent encrypted off-host backup/restore is optional future operational work, not a prerequisite for production. No verified backup currently exists; retain source/volume preservation safeguards.

The nonsecret deployment manifest selects best_effort and pins the already checked029a53a1 execution build source. Worker source/Dockerfiles are unchanged by the provider-identity repair; controller-only releases must not silently change a queued allocation or existing manager image. Dokploy appName may add its own suffix: bootstrap verifies exact requested name, source, description and project/environment, then records the independently read-back assigned appName. All later operations and container inventory require that exact pinned name. Never adopt a different suffix after pinning or use a wildcard for deletion.

## Verification boundaries

Unit/transport tests, exact-head images/CI, merged source, deployed matching worker/MCP revisions and authenticated disposable client/provider acceptance are separate evidence. The multi-container image scenario includes actual Chromium private entry, secure HttpOnly cookies, application/API/WebSocket traffic and anonymous denial, alongside shared edits, read-only Git metadata, UID1000 execution, a deliberately daemonized child, container termination and exact volume absence. Its heartbeat-free fixture isolates mount/namespace proof and does not count as live revocation proof. Full current-grant/browser/lifecycle and real quota/network acceptance remain required before declaring PLAY-1 complete.

### Scoped cleanup proof when host volume reads are forbidden

Project-scoped keys may read their Compose/container inventory while Docker volume/health endpoints return401. Do not widen the agent to unrestricted Docker/server administration. An operator sensor can instead include one replacement record for the exact workspace in the signed envelope's allocations array:

```json
{
  "workspace_id":"job_0123456789abcdef",
  "binding":"EXACT_64_HEX_BINDING",
  "observedAt":1793318400000,
  "expiresAt":1793318460000,
  "cleanup":{
    "composeId":"EXACT_OWNED_COMPOSE",
    "composeAbsent":true,
    "containersAbsent":true,
    "volumesAbsent":["EXACT_FILES_VOLUME","EXACT_GIT_VOLUME","EXACT_BROKER_VOLUME","EXACT_EXECUTION_VOLUME"]
  }
}
```

This shape is not a real observation. The operator must independently inspect actual absence before signing it. Do not send both active and cleanup records for the same workspace. The service verifies the signature/project, exact binding/Compose, all four distinct expected volume names and a maximum60second evidence lease. It also independently requires its project-visible Compose to be absent and container inventory empty. A delete acknowledgement, static environment assertion, missing volume, foreign name, stale proof or failed telemetry cannot confirm cleanup. This fallback applies only to401/403 inspection denial; ownership/other errors are not bypassed.
