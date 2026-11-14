# Second Shift Setup.psm1 admin-probe SID fix — 2026-11-12

State: IN PROGRESS — branch `ai/vivienne/second-shift-setup-sid`, PR pending at
note time; head and CI recorded in the PR.

What changed: the 2026-11-12 Second Shift review's #602 finding on
`tools/playground-device/setup/Setup.psm1` verified REAL. `Get-ProbeFacts`'
isAdmin test compared account SHORT NAMES (text after the last backslash)
between the current identity and the local Administrators group's members; a
same-named account from another scope (local `chris` vs `DOMAIN\chris`) made a
non-admin session report isAdmin = true, steering the owner down the wrong
install path (the OS itself never granted anything — the probe only advises).
The test now compares SIDs: the current identity's `.User` SID against each
Administrators member's `.SID`. The token-based `IsInRole(Administrator)`
fallback is unchanged and still runs whenever the membership test is false.

Proof: the fleet has no PowerShell test suite for this module; the change is
verified by a Windows PowerShell parser pass over the file on the PC bench
(recorded in the PR) plus `ci` + `release-policy` at the exact head. No release
is performed by this pass.
