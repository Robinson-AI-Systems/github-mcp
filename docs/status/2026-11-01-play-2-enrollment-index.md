# 2026-11-01 — PLAY-2 enrollment index bound fix

Merged-to-be source fix (see the dated section in [PLAY-2](../pr-cards/PLAY-2.md)): pairing attempts no longer grow the
tenant's enrolled-device index without limit, lapsed codes stop counting toward the eight-device cap, and an index that
already overflowed heals on the next pairing. Unit and real-PostgreSQL tests pass locally; exact-head CI decides merge.
No live device, tunnel or grant was touched; no release or live acceptance is claimed.
