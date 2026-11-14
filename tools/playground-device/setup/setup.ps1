# PLAY-3 — Robinson Playground host setup (the one program a person runs).
#   setup.ps1                full setup (or resume, if a journal exists)
#   setup.ps1 -Plan          print the plan as JSON; change nothing
#   setup.ps1 -JoinFile F    finish setup with a saved pairing file
#   setup.ps1 -Pause         stop the host service and its keeper task
#   setup.ps1 -Remove [-RestoreFeatures]   clean uninstall
param([switch]$Plan, [switch]$Resume, [switch]$Pause, [switch]$Remove, [switch]$RestoreFeatures, [string]$JoinFile)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Setup.psm1') -Force
$payload = Split-Path $PSScriptRoot -Parent
if ($Pause) { Pause-Playground; @{ status = 'paused' } | ConvertTo-Json; return }
if ($Remove) { Remove-Playground -RestoreFeatures:$RestoreFeatures; @{ status = 'removed' } | ConvertTo-Json; return }
# The resume task re-enters here after the one allowed reboot: mark the
# journal so the flow continues past the reboot gate.
if ($Resume) {
  $stateDir = "$env:LOCALAPPDATA\RobinsonPlayground"
  (@{ step = 'post-reboot'; at = (Get-Date).ToUniversalTime().ToString('o'); data = @{} } | ConvertTo-Json -Compress) | Add-Content -Path "$stateDir\journal.jsonl" -Encoding UTF8
  & schtasks.exe /Delete /TN 'RobinsonPlayground-Resume' /F 2>$null | Out-Null
}
$result = Invoke-PlaygroundSetup -PayloadDir $payload -JoinFile $JoinFile -Plan:$Plan -Resume:$Resume
$result | ConvertTo-Json -Depth 8
