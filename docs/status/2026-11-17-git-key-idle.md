# 2026-11-17: git session keys last through a pause, and a lapsed one says how to renew

- Owner feedback (relayed from another agent): the git sign-in lapsed after a few idle hours and had to be renewed
  by hand each time.
- Cause: a key renewed itself on use, but always for 8 hours, even when it was asked for 24.
- Now: a key may sit unused as long as the lifetime it was asked for (8 to 24 hours), still capped at 7 days. A
  lapsed key's git refusal names the exact `github_git_remote_setup` call to make, ready to copy.
- PR card: `docs/pr-cards/GIT-KEY-IDLE-1.md`.
