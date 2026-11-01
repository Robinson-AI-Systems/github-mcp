# PLAY-2: first-device pairing (experimental, not runtime activation)

This helper runs on **your own** WSL2/Linux machine, not in an AI tool or on the operator's behalf. It is the **device identity/pairing leg** only: it does not install the Docker supervisor, enable arbitrary commands, bind repository storage, configure a tunnel, or pass the enrollment canary. Those are separate PLAY-2 implementation/acceptance requirements. The owner must confirm the exact fingerprint after the device proves it owns its locally generated Ed25519 key.

1. In `https://github.robinsonaisystems.com/connection`, sign in with **your own GitHub login**, choose one connected Full app, and choose **Start pairing my computer**. This generates a device ID and a ten-minute one-use code.
2. On the computer you own, ensure Node 24 and your own outbound **HTTPS tunnel** are configured. The public Vercel controller cannot resolve a private tailnet-only hostname by itself. Verify the tunnel belongs to you; do not paste its credentials into the helper or chat.
3. From the checked repository source run `node tools/playground-device/pair.mjs` in WSL2/Linux. It prompts locally for the device ID, the one-use pairing code and the HTTPS tunnel origin. No GitHub key/token is required. Prefer a pinned reviewed Git revision; the installer/update signing mechanism and operational verification are a later PLAY-2 unit.
4. The tool creates an Ed25519 device private key under `~/.config/ras-playground/device-ed25519.pk8`, with owner-only permissions, and posts **only the public key, signed pairing statement and one-time code**. It does not read, upload or alter your existing bench GitHub key.
5. Return to **My connection** and compare the complete device fingerprint displayed on both sides and the exact tunnel origin before pressing **Approve**. The enrollment remains `pending_canary` and cannot receive arbitrary code until the signed runtime image, isolation and canary are verified.

If a device is lost or not yours, revoke the enrollment from My connection. For pending-only enrollment, revocation is immediate; once a real runtime is available, disconnected-host revocation must remain pending until bounded local fail-closed expiry and independent signed cleanup evidence. This helper does not claim that live shutdown has been tested.

**Fences:** User-owned machine and connection only. Never run another customer's work here, put a GitHub/private signing key into a chat, pass an agent-chosen runtime origin, expose host Docker privileges to user code, or claim that a tailnet hostname is accessible from Vercel. This pairing helper does not buy hosting and is not a fallback for PLAY-1.

## Disposable local coding-image baseline (Phase 2)

`install.mjs` adds an **owner-run, non-network-exposed Docker baseline**. Use the reviewed exact image `repository@sha256:<digest>` and obtain the workspace's current 64-hex allocation binding and Ed25519 control **public** key from the already-authorized MCP's workspace setup response. The public verifier is not a credential. The private signing key remains only on the control plane; the device signing key from pairing remains local. This does not enroll a device on your behalf or enable live execution.

From the installed, reviewed repository in your own WSL2, with local Docker available, run these actions (substitute only your real pairing/workspace/public-key values):

```sh
node tools/playground-device/install.mjs --action plan --device DEVICE_ID --binding BINDING_64_HEX --image 'IMAGE_REPOSITORY@sha256:REVIEWED_DIGEST' --control-key 'ed25519:PUBLIC_CONTROL_VERIFIER'
node tools/playground-device/install.mjs --action install --device DEVICE_ID --binding BINDING_64_HEX --image 'IMAGE_REPOSITORY@sha256:REVIEWED_DIGEST' --control-key 'ed25519:PUBLIC_CONTROL_VERIFIER'
node tools/playground-device/install.mjs --action canary --device DEVICE_ID --binding BINDING_64_HEX --image 'IMAGE_REPOSITORY@sha256:REVIEWED_DIGEST' --control-key 'ed25519:PUBLIC_CONTROL_VERIFIER'
node tools/playground-device/install.mjs --action remove --device DEVICE_ID --binding BINDING_64_HEX --image 'IMAGE_REPOSITORY@sha256:REVIEWED_DIGEST' --control-key 'ed25519:PUBLIC_CONTROL_VERIFIER'
```

The installer requires the exact immutable image already pulled and verified by the device owner (no automatic pull or silent upgrade). It creates a uniquely named `--internal` network, one Docker volume and a single UID-separated runtime container with no published ports, Docker socket or host-file mount. It limits CPU/memory to 2 CPU / 2 GiB by default and does **not** invent a 150-GB disk reservation. The `plan` action prints the intended resource names and exact image without calling Docker or admitting any workload. The fixed canary runs Node 24 under UID 1000, starts and independently verifies shutdown of a disposable PostgreSQL 15 test database, exercises a real Chromium page, and rechecks the exact runtime ownership. Removal stops and verifies the container, then deletes only its independently label-matched volume and network and rechecks their absence. A mismatched name/label, uncertain provider response, unsupported network or partial deletion fails closed.

**This is not the completed Playground enrollment.** It does not attach native Git files, configure the owner's outbound HTTPS tunnel, proxy public dependency downloads, produce a signed controller-side canary or allow `github_playground_execute` to place work. An enrolled host remains `pending_canary` until those later contracts and the actual remote/owner-PC acceptance pass. Never expose the internal coding container's port to the internet or claim that local Docker labels are protection against a malicious host administrator. The image can be upgraded only by an explicit new digest and independent drain/cleanup/cutover procedure; there is no silent update in this unit.

## Appliance Desk attachment preflight — read-only, no file bodies

The actual transfer limit is **100 MiB of raw files, 100,000 path entries and no symlinks**. A clean repository clone is not enough: the native-Git source snapshot also carries `workspace.json`, `control`, Git metadata and worktrees. Before offering an enrolled host real work, measure the **authorized disposable native workspace root** where it exists. The owner does not need to share file contents or a GitHub key.

For a *plain Git checkout* (preliminary proxy only):

```sh
node tools/playground-device/measure-workspace.mjs --root /your/local/appliance-desk --kind repository
```

For the *true native Git worker workspace root*, only where an authorized operator can read it:

```sh
node tools/playground-device/measure-workspace.mjs --root /authorized/native-git/job-workspace-root --kind native --expected-binding EXACT_64_HEX_BINDING
```

The JSON output contains Git HEAD, dirty-worktree status, worker generation, file count, total bytes, category totals, largest-file size, symlink count, a metadata digest and elapsed time. It **never prints filenames, file contents or Git credentials**. It does not acquire the worker's mutation lock, copy bytes, or prove an encrypted transfer; a true source snapshot may change immediately after this scan. `sealedTransferCandidate` is only a preflight decision for a recognized, stable native workspace with the expected binding, not an attachment success flag. A plain clone always says false.

If the native workspace exceeds the bound or contains symlinks, the next engineering step is device-local native-Git clone plus safe, generation-bound reconciliation of uncommitted changes, **not** truncation or silently dropping work. Do not raise the transfer limit or claim Appliance Desk acceptance based on synthetic files.

## Signed outbound-tunnel identity check — still no command admission

When your **own** pending-canary enrollment exists, you may run the device's read-only probe receiver. It **does not** run a coding workload, open Docker, install an image, or change your GitHub credentials.

1. On your personally enrolled PC, review the release's source. Keep the private Ed25519 device key at `~/.config/ras-playground/device-ed25519.pk8` (the key created by `pair.mjs`), never share it with the controller or a chat.
2. Obtain the *public* control-plane signing key from an authorized Playground setup response. In WSL2, run the receiver on an unused loopback port (example 4143):

```sh
node tools/playground-device/probe-server.mjs --device DEVICE_ID --origin 'https://your-owned-public-tunnel.example' --generation ENROLLED_GENERATION --control-key 'ed25519:PINNED_CONTROLLER_PUBLIC_KEY' --port 4143
```

3. Configure an outbound **HTTPS** tunnel in **your own account** that forwards the exact enrolled public hostname's `/v1/enrollment/probe` path to local `127.0.0.1:4143`. The enrolled origin must already be set through your earlier signed pairing; the MCP never accepts an arbitrary request-time hostname. Tailnet-only names or private addresses are not directly reachable from Vercel. Do not expose Docker, PostgreSQL, the coding container or any additional path through this tunnel.
4. Sign in to `/connection` with the enrolling GitHub account, find the exact fingerprint and origin, and click **Check my signed device tunnel**. The control plane verifies your current Full client grant, pins a public DNS address for TLS, sends a 60-second Ed25519 claim, verifies the device's signed reply and records the observation.
5. The enrollment **remains `pending_canary`**. A successful probe is only a signed tunnel/key reachability check. Actual Node 24/PostgreSQL/Chromium source attachment, current-grant runtime heartbeat, permissions, isolation, command/handle recovery and revocation still require separate proof. Stop the receiver when finished; to revoke, use your own My connection page.

The receiver requires a live signature, matching device ID, generation, pinned origin and previously unseen nonce. It durably records used nonce hashes under `~/.config/ras-playground/probe-replay/` with owner-only permissions, so a receiver restart does not restore an old claim; this directory contains no GitHub keys or file contents. If the PC sleeps or loses the tunnel, the probe fails closed and does not create another host or rerun an uncertain command. No hosted fallback or paid tunnel is automatically started.
