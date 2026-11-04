# 2026-11-03 PC kit defaults the GitHub leg to HTTP/1.1 

Live measurements through Chris's PC worker (robinson-ai-scratch/upload-probe, build b38fc67c, PC worker 6debdc88):
- 150 MB push: 79 s end to end; "Sent to GitHub over HTTPS in 5.3 s" (before, with git's default HTTP/2: 444 s, of which
  the GitHub leg was about 6 minutes).
- About 1 GB of text (about 700 MB packed): 487 s end to end; "Sent to GitHub over HTTPS in 17 s".

So `deploy/pc/compose.yaml` now defaults `NATIVE_GIT_GITHUB_HTTP_VERSION` to `HTTP/1.1` (an empty value in an existing
`.env` also gets HTTP/1.1), `.env.example` shows it, and `docs/PC-WORKER.md` records the numbers. SSH (GIT-SSH-LEG-1) stays
off as a tested spare. Other hosts (Dokploy) are unchanged. Remaining limit: the upload into the PC through the Tailscale
Funnel (about 1.5-2 MB/s), a separate follow-up.
