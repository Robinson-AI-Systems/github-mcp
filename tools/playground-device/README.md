# Add your own computer or server to Robinson's Playground

Anyone who signs in to Robinson GitHub MCP can let their AI run builds and tests on machines **they** own or administer —
a desktop PC, a laptop, a VPS, a home server, a Dokploy or any other Docker host, machines on a private network or
tailnet. Each machine only ever runs **your own** work, under your own connection. It only makes **outbound** HTTPS
check-ins to the server, so it needs no tunnel, no public IP and no open port.

**You need:** Docker with Compose v2 (Docker Desktop on Windows with WSL2, or Docker Engine on Linux/macOS), Node.js 22
or newer, and enough room for the runtime (at least 1 CPU, 1.5 GB free memory and 10 GB free disk; more is better).

1. Get the agent: `curl -fsSLO https://raw.githubusercontent.com/Robinson-AI-Systems/github-mcp/main/tools/playground-device/agent.mjs`
   and `curl -fsSLO https://raw.githubusercontent.com/Robinson-AI-Systems/github-mcp/main/tools/playground-device/pair.mjs`
   into one folder (or clone the repository). Read them first — they are short.
2. Open **My connection** (`https://github.robinsonaisystems.com/connection`), sign in with GitHub and press
   **Add a computer or server for &lt;app&gt;**. It shows a command with a one-time code (valid ten minutes).
3. Run that command on the machine: `node agent.mjs join --device DEVICE_ID --code CODE`. It prints a fingerprint.
4. Reload My connection, check the fingerprint matches, press **Approve**.
5. Start the agent: `node agent.mjs run`. Keep it running (see below). On its first check-in it runs a short readiness
   check (Docker works, a private network really is private, containers run as an unprivileged user) and then shows
   **Ready** on My connection. From then on, new workspaces you open are placed on your ready machines first.

**Keep it running:** on Linux use a user service (`systemd-run --user --unit ras-playground node $PWD/agent.mjs run`),
on Windows/WSL2 or macOS leave a terminal open or use your usual "run at login" tool. If the machine sleeps, work waits
and resumes when it checks in again; a runtime that cannot reach the server stops new commands and, after five minutes,
stops itself.

**On a server you administer** (a VPS, a home server, a Dokploy or Coolify host, any Linux box with Docker): install
Node.js 22+ next to Docker, then do the same steps over SSH and keep it running with
`systemd-run --user --unit ras-playground node $PWD/agent.mjs run` (run `loginctl enable-linger $USER` once so it survives
logout). The agent uses the server's Docker directly; it does not need to be deployed as an app inside Dokploy, and it does
not touch anything else on the server — only containers, volumes and networks it creates, all labelled
`com.robinson.playground.*`. Several machines can be added; each shows on My connection with its last check-in and free
capacity, and work goes to the ready one with the most free memory.

**Remove a machine:** press **Revoke** on My connection (its runtimes are stopped and deleted at its next check-in), then
run `node agent.mjs leave` on it. `node agent.mjs status` shows what it is doing.

**What it will and will not do:** it only accepts orders signed by the server key it pinned when you joined: start or stop
one Playground runtime from a signed plan (a private network, unprivileged containers, no Docker socket, the gateway on
127.0.0.1 only), forward an already-signed request to that runtime, run the readiness check, or stop everything. It never
receives your GitHub token. You, as the machine's owner, can always see and stop its containers; it is not a sandbox
against you, and other people's work never runs on it.

Interactive browser previews are not available on your own machine yet (text previews are); very large repositories
still transfer at up to 100 MiB.

---

## Older tunnel-based pairing (PLAY-2)

This helper runs on **your own** WSL2/Linux machine, not in an AI tool or on the operator's behalf. It is the **device identity/pairing leg** only: it does not install the Docker supervisor, enable arbitrary commands, bind repository storage, configure a tunnel, or pass the enrollment canary. Those are separate PLAY-2 implementation/acceptance requirements. The owner must confirm the exact fingerprint after the device proves it owns its locally generated Ed25519 key.

1. In `https://github.robinsonaisystems.com/connection`, sign in with **your own GitHub login**, choose one connected Full app, and choose **Pair my computer for <app>** (shown for each Full connection; not shown for Marketplace accounts). This generates a device ID and a ten-minute one-use code.
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

3. Configure an outbound **HTTPS** tunnel in **your own account** that forwards the exact enrolled public hostname's `/v1/enrollment/probe` and `/v1/enrollment/canary` paths to local `127.0.0.1:4143`. The enrolled origin must already be set through your earlier signed pairing; the MCP never accepts an arbitrary request-time hostname. Tailnet-only names or private addresses are not directly reachable from Vercel. Do not expose Docker, PostgreSQL, the coding container or any additional path through this tunnel.
4. Sign in to `/connection` with the enrolling GitHub account, find the exact fingerprint and origin, and click **Check my signed device tunnel**. The control plane verifies your current Full client grant, pins a public DNS address for TLS, sends a 60-second Ed25519 claim, verifies the device's signed reply and records the observation.
5. The enrollment **remains `pending_canary`**. A successful probe is only a signed tunnel/key reachability check. Actual Node 24/PostgreSQL/Chromium source attachment, current-grant runtime heartbeat, permissions, isolation, command/handle recovery and revocation still require separate proof. Stop the receiver when finished; to revoke, use your own My connection page.

The receiver requires a live signature, matching device ID, generation, pinned origin and previously unseen nonce. It durably records used nonce hashes under `~/.config/ras-playground/probe-replay/` with owner-only permissions, so a receiver restart does not restore an old claim; this directory contains no GitHub keys or file contents. If the PC sleeps or loses the tunnel, the probe fails closed and does not create another host or rerun an uncertain command. No hosted fallback or paid tunnel is automatically started.

## Practical notes (added 2026-11-01)

- **Generation:** My connection does not show the enrollment generation yet. A fresh pairing always starts at generation `1`, and only an unrevoked record can be probed, so use `1`.
- **Timing:** the local canary receipt is valid for five minutes, and the canary button needs a probe under five minutes old. Run `install.mjs --action canary`, then click **Check my signed device tunnel**, then **Verify my fixed local runtime test receipt**, all within five minutes.
- **Pairing endpoint:** `/api/playground/enroll` answers only on the production deployment with the public-connect tenant pilot enabled; elsewhere it returns 404 even though My connection may show a code.
- **Tailscale:** a tailnet-only name (`*.ts.net` via Serve, `100.x` addresses) is refused — the control plane runs on Vercel and must reach a public IPv4 HTTPS origin. Tailscale **Funnel** gives a public `*.ts.net` HTTPS name and should pass the checks (unverified). The proposed outbound host agent ([RUNTIME-FLEET](../../docs/designs/RUNTIME-FLEET-2026-11-01.md) §2.1) would remove the tunnel requirement entirely.
- **Keys:** every enrollment from the same OS user shares `~/.config/ras-playground/device-ed25519.pk8`; each `probe-server` process serves one device ID. The receiver is started by hand (no service), so restart it after a reboot.

## Device-signed local runtime proof — separate from host admission

After you have **personally paired** the PC and already installed the reviewed immutable coding image, you can record that the fixed local Node/PostgreSQL/Chromium canary actually passed. This is user-initiated local work only; the MCP does not remotely run a Docker command.

Use the same reviewed `deviceId`, generation, origin, workspace binding, image digest and control **public key** from your actual connection. In WSL2:

```sh
node tools/playground-device/install.mjs --action canary --device DEVICE_ID --binding EXACT_WORKSPACE_BINDING --image 'REVIEWED_IMAGE@sha256:DIGEST' --control-key 'ed25519:PUBLIC_CONTROL_KEY' --origin 'https://your-own-registered-tunnel.example' --generation YOUR_ENROLLMENT_GENERATION
```

This first runs the existing fixed image canary, then reads the **already paired, local Ed25519 signing key** and writes an owner-only, short-lived signed receipt under `~/.config/ras-playground/canary-receipts/`. No key or repo file body is in the receipt. If the local canary fails, no successful receipt is written. The receipt claims **no 150 GB guaranteed quota, no shared Git attachment and no execution authorization**.

Run the same loopback probe receiver as above but add the exact local workspace binding and immutable image:

```sh
node tools/playground-device/probe-server.mjs --device DEVICE_ID --origin 'https://your-own-registered-tunnel.example' --generation YOUR_ENROLLMENT_GENERATION --control-key 'ed25519:PUBLIC_CONTROL_KEY' --port 4143 --binding EXACT_WORKSPACE_BINDING --image 'REVIEWED_IMAGE@sha256:DIGEST'
```

With your own HTTPS tunnel still forwarding only the two fixed enrollment paths to loopback, open **My connection**: first click **Check my signed device tunnel**, then within five minutes click **Verify my fixed local runtime test receipt**. The controller verifies that the receipt and fresh signed nonce are from your original paired device and records the precise immutable image and binding in your tenant. Any stale/missing/wrong-device report fails closed.

**Do not treat this as completed enrollment.** The source/native-Git worktree must still be attached with exact generation and uncommitted data; the continuous current-grant lease, true network/egress boundaries and signed whole-allocation cleanup still need independent proof. Until that full admission, `github_playground_execute/read/cancel` never chooses this enrolled device and the status remains `pending_canary`. You can revoke the enrollment at any time.
