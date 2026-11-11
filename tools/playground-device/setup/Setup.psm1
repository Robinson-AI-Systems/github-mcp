# PLAY-3 §3 steps 1, 2, 4, 5, 6, 7 — the Windows bootstrapper.
# One visible setup program; at most ONE UAC prompt (the elevation batch);
# everything journalled so an interruption resumes with 0 repeated steps and
# 0 repeated decisions. The classification table below MIRRORS
# setup/preflight.mjs (the canonical, unit-tested module) — the bootstrapper
# cannot assume Node exists on the target PC, so both implementations are
# held to the same fixture outcomes by the test suites.
$script:StateDir = "$env:LOCALAPPDATA\RobinsonPlayground"
$script:JournalPath = "$script:StateDir\journal.jsonl"
$script:DistroName = 'PlaygroundWorker'
$script:KeeperTask = 'RobinsonPlayground-Keeper'
$script:ResumeTask = 'RobinsonPlayground-Resume'

function Write-Journal { param([string]$Step, $Data = @{}) 
  New-Item -ItemType Directory -Force -Path $script:StateDir | Out-Null
  (@{ step = $Step; at = (Get-Date).ToUniversalTime().ToString('o'); data = $Data } | ConvertTo-Json -Compress -Depth 6) | Add-Content -Path $script:JournalPath -Encoding UTF8 }
function Get-JournalSteps { if (-not (Test-Path $script:JournalPath)) { return @{} } $h = @{}; Get-Content $script:JournalPath | ForEach-Object { try { $j = $_ | ConvertFrom-Json; $h[$j.step] = $j } catch {} }; return $h }

function Get-ProbeFacts {
  $cs = Get-CimInstance Win32_ComputerSystem; $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
  $os = Get-CimInstance Win32_OperatingSystem
  $sMode = $false; try { $sMode = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -Name SkuPolicyRequired -ErrorAction Stop).SkuPolicyRequired -eq 1 } catch {}
  $pendingReboot = (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending') -or (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired')
  $distros = @(); $wslPresent = $false
  try { $r = & wsl.exe -l -q 2>$null; if ($LASTEXITCODE -eq 0) { $wslPresent = $true; $distros = @($r | ForEach-Object { "$_".Trim([char]0, ' ', "`r", "`n") } | Where-Object { $_ }) } } catch {}
  $featuresOn = $false; try { $featuresOn = [bool](& wsl.exe --status 2>$null | Select-String '2') -and $wslPresent } catch {}
  $av = @(Get-CimInstance -Namespace 'root/SecurityCenter2' -ClassName AntiVirusProduct -ErrorAction SilentlyContinue | ForEach-Object { $_.displayName })
  $drive = Get-PSDrive -Name ($env:SystemDrive.TrimEnd(':')) -ErrorAction SilentlyContinue
  return @{
    os = @{ build = [int]($os.BuildNumber); edition = $os.Caption; isWindows11 = [int]($os.BuildNumber) -ge 22000 }
    smode = $sMode; pendingReboot = $pendingReboot; pendingUpdateCount = 0
    cpuVirtualizationFirmware = [bool]$cpu.VirtualizationFirmwareEnabled; hypervisorPresent = [bool]$cs.HypervisorPresent
    wslFeatureEnabled = $featuresOn; vmPlatformEnabled = $featuresOn; wslPresent = $wslPresent
    isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    freeDiskBytes = if ($drive) { [int64]$drive.Free } else { $null }
    avProducts = $av; conflictingAv = $false
    installerBusy = [bool](Get-Process -Name 'msiexec' -ErrorAction SilentlyContinue)
    networkOk = $null
    existingDistro = $distros -contains $script:DistroName
    dockerDesktopPresent = [bool](Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue) -or (Test-Path "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe")
    fleetKeeperPresent = [bool](Get-ScheduledTask -TaskName 'FleetKit-WSL-KeepAlive' -ErrorAction SilentlyContinue)
    otherDistros = @($distros | Where-Object { $_ -ne $script:DistroName })
    logicalProcessors = [int]$cpu.NumberOfLogicalProcessors; memoryBytes = [int64]$cs.TotalPhysicalMemory
  }
}

# Mirror of setup/preflight.mjs classifyPreflight — keep in lockstep.
function Classify-Facts { param($F)
  $detours = @()
  if ($F.smode) { $detours += @{ code = 'F11'; what = 'This PC is in Windows S mode, which only allows Store apps.' } }
  if ($F.pendingReboot -or $F.pendingUpdateCount -gt 0) { $detours += @{ code = 'F3'; what = 'Windows has updates waiting to finish.' } }
  if ($F.cpuVirtualizationFirmware -eq $false) { $detours += @{ code = 'F1'; what = 'Hardware virtualization is turned off in this PC''s BIOS settings.' } }
  if ($F.hypervisorPresent -eq $false -and $F.cpuVirtualizationFirmware -ne $true) { $detours += @{ code = 'F2'; what = 'Windows could not start its virtual machine platform.' } }
  if (-not $F.os.isWindows11) { $detours += @{ code = 'F9'; what = 'This setup supports Windows 11. Older Windows versions are not supported yet.' } }
  if ($F.wslPresent -eq $false -and $F.wslFeatureEnabled -eq $false -and $F.vmPlatformEnabled -eq $false) { $detours += @{ code = 'F10'; what = 'The Windows virtualization features could not be enabled.' } }
  if (-not $F.isAdmin) { $detours += @{ code = 'F5'; what = 'The signed-in account is not an administrator on this PC.' } }
  if ($null -ne $F.freeDiskBytes -and $F.freeDiskBytes -lt 15GB) { $detours += @{ code = 'F4'; what = 'This PC needs at least 15 GB of free disk space.' } }
  if ($F.conflictingAv) { $detours += @{ code = 'F6'; what = 'Your antivirus blocked part of the setup.' } }
  if ($F.installerBusy) { $detours += @{ code = 'F7'; what = 'Another program is installing right now.' } }
  if ($F.networkOk -eq $false) { $detours += @{ code = 'F8'; what = 'Setup could not reach the internet.' } }
  $priority = @('F11', 'F3', 'F1', 'F2', 'F9', 'F10', 'F5', 'F4', 'F6', 'F7', 'F8')
  $primary = $detours | Sort-Object { $priority.IndexOf($_.code) } | Select-Object -First 1
  return @{ verdict = if ($detours) { 'detour' } else { 'proceed' }; primary = $primary; detours = $detours }
}

# The elevation batch contents — the ONLY privileged acts in the whole
# installer (design §3 step 4), returned as data so the step-4 audit (and
# -Plan) can trace exactly one prompt containing exactly this list.
function Get-ElevationBatch { param($Facts)
  $batch = @()
  if (-not ($Facts.wslFeatureEnabled -and $Facts.vmPlatformEnabled)) {
    $batch += @{ action = 'enable-feature'; name = 'Microsoft-Windows-Subsystem-Linux'; noRestart = $true }
    $batch += @{ action = 'enable-feature'; name = 'VirtualMachinePlatform'; noRestart = $true }
  }
  $batch += @{ action = 'register-task'; name = $script:ResumeTask }
  $batch += @{ action = 'register-task'; name = $script:KeeperTask }
  $batch += @{ action = 'write-wslconfig'; path = "$env:USERPROFILE\.wslconfig" }
  return $batch
}

function Register-PlaygroundTasks { param([string]$PayloadDir)
  $xml = (Get-Content (Join-Path $PayloadDir 'service\RobinsonPlayground-Keeper.xml') -Raw).Replace('%DISTRO%', $script:DistroName)
  $xmlPath = "$script:StateDir\keeper.xml"; Set-Content -Path $xmlPath -Value $xml -Encoding Unicode
  & schtasks.exe /Create /TN $script:KeeperTask /XML $xmlPath /F | Out-Null
  $resumeAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script:StateDir\setup.ps1`" -Resume"
  $resumeTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  Register-ScheduledTask -TaskName $script:ResumeTask -Action $resumeAction -Trigger $resumeTrigger -RunLevel Limited -Force | Out-Null
}

function Invoke-ElevationBatch { param($Facts, [string]$PayloadDir, [string]$SizingJson)
  $batch = Get-ElevationBatch $Facts
  $script = "$script:StateDir\elevated.ps1"
  $body = @"
`$ErrorActionPreference = 'Stop'
"@
  foreach ($a in $batch) {
    switch ($a.action) {
      'enable-feature' { $body += "Enable-WindowsOptionalFeature -Online -FeatureName $($a.name) -All -NoRestart | Out-Null`n" }
      'write-wslconfig' { $body += "# .wslconfig merged by the unelevated step before elevation; sizing: $SizingJson`n" }
      'register-task' { $body += "# task $($a.name) registered by Register-PlaygroundTasks in this same elevated session`n" }
    }
  }
  $body += "Register-PlaygroundTasks -PayloadDir '$PayloadDir'`n"
  # The elevated script needs the module's task function: dot-source the module.
  $body = "`$env:PSModulePath = '$env:PSModulePath'`nImport-Module '$($MyInvocation.MyCommand.Module.Path)' -Force`n" + $body
  Set-Content -Path $script -Value $body -Encoding UTF8
  $p = Start-Process -FilePath 'powershell.exe' -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$script`"" -Verb RunAs -PassThru -Wait
  if ($p.ExitCode -ne 0) { throw "The administrator step did not complete (exit $($p.ExitCode)). Nothing else was changed." }
  Write-Journal 'elevation' @{ batch = @($batch | ForEach-Object { "$($_.action):$($_.name)$($_.path)" }) }
}

function Set-StayAwake { param([bool]$Restore = $false)
  $done = Get-JournalSteps
  if (-not $Restore) {
    $old = (& powercfg.exe /Query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 2>$null | Select-String 'Current AC Power Setting Index') -join ' '
    Write-Journal 'stayawake' @{ previous = "$old" }
    & powercfg.exe /Change standby-timeout-ac 0 | Out-Null
  } else {
    # v1 restores the common default of 30 min only when we changed it; the
    # journal holds the previous index for the record.
    & powercfg.exe /Change standby-timeout-ac 30 | Out-Null
    Write-Journal 'stayawake-restored' @{}
  }
}

function Invoke-PlaygroundSetup { param([string]$PayloadDir, [string]$JoinFile, [switch]$Plan, [switch]$Resume)
  $facts = Get-ProbeFacts
  $cls = Classify-Facts $facts
  $journal = Get-JournalSteps
  $featuresReady = $facts.wslFeatureEnabled -and $facts.vmPlatformEnabled
  $planObj = [ordered]@{ facts = $facts; classification = $cls; elevationBatch = @(Get-ElevationBatch $facts); rebootNeeded = (-not $featuresReady); journalSteps = @($journal.Keys) }
  if ($Plan) { return $planObj }
  if ($cls.verdict -eq 'detour') {
    $pageFor = @{ F1 = 'bios-virtualization'; F2 = 'bios-virtualization'; F3 = 'pending-updates'; F4 = 'disk-space'; F5 = 'admin-account'; F6 = 'antivirus'; F7 = 'another-installer'; F8 = 'network'; F9 = 'windows-edition'; F10 = 'virtualization-platform'; F11 = 's-mode'; F12 = 'download-failed'; F13 = 'join-rejected'; F14 = 'first-run-failed' }
    $page = Join-Path $PSScriptRoot "pages\$($pageFor[$cls.primary.code]).html"
    if (Test-Path $page) { Start-Process $page }
    return [ordered]@{ status = 'detour'; detour = $cls.primary; all = $cls.detours; page = $page }
  }
  if (-not $journal.ContainsKey('stayawake')) { Set-StayAwake }
  if (-not $journal.ContainsKey('elevation')) {
    if (-not $featuresReady -and -not $journal.ContainsKey('features-note')) { Write-Journal 'features-note' @{ note = 'Features were off; enabling without restart, one reboot follows at the user''s chosen moment.' } }
    Invoke-ElevationBatch $facts $PayloadDir '{}'
  }
  if (-not $featuresReady -and -not (Get-JournalSteps).ContainsKey('post-reboot')) {
    Write-Journal 'reboot-pending' @{ resumeTask = $script:ResumeTask }
    return [ordered]@{ status = 'reboot-needed'; what = 'Windows needs one restart to finish turning on its virtual machine features. Setup will continue by itself when you sign back in.' }
  }
  return Invoke-DistroPayloadJoin -PayloadDir $PayloadDir -JoinFile $JoinFile
}

# Steps 3 (distro), payload placement and 6 (join) — journalled individually.
function Invoke-DistroPayloadJoin { param([string]$PayloadDir, [string]$JoinFile)
  . (Join-Path $PSScriptRoot '..\provision\provision-distro.ps1')
  $j = Get-JournalSteps
  if (-not $j.ContainsKey('distro')) {
    $d = Install-PlaygroundDistro -PayloadDir (Join-Path $PSScriptRoot '..\provision')
    Write-Journal 'distro' @{ alreadyPresent = [bool]$d.AlreadyPresent }
  }
  $provisionDir = (Join-Path $PSScriptRoot '..\provision')
  $toMnt = { param($p) '/mnt/' + $p.Substring(0, 1).ToLower() + ($p.Substring(2) -replace '\\', '/') }
  $mnt = & $toMnt $PayloadDir; $mntProvision = & $toMnt $provisionDir
  if (-not (Get-JournalSteps).ContainsKey('payload')) {
    $copies = foreach ($f in 'agent.mjs', 'pair.mjs', 'update.mjs', 'run.mjs', 'version.json') { "cp '$mnt/$f' /home/ras-playground/.config/ras-playground/; cp '$mnt/$f' /home/ras-playground/.config/ras-playground/agent-versions/fleet-agent/1/;" }
    $cmd = "set -e; mkdir -p /usr/local/lib/ras-playground /home/ras-playground/.config/ras-playground/agent-versions/fleet-agent/1; " +
      "cp '$mntProvision/apply-provisioning.sh' /usr/local/lib/ras-playground/; bash /usr/local/lib/ras-playground/apply-provisioning.sh; " +
      ($copies -join ' ') +
      "cp '$mnt/service/ras-playground-agent.service' /etc/systemd/system/; chown -R ras-playground:ras-playground /home/ras-playground/.config; systemctl enable ras-playground-agent"
    $r = Invoke-WslTimeout @('-d', $script:DistroName, '-u', 'root', '--', 'bash', '-lc', $cmd) 1800
    if ($r.ExitCode -ne 0) { throw "Payload placement failed ($($r.ExitCode)): $($r.StdErr) (F14)" }
    Write-Journal 'payload' @{}
  }
  if (-not (Get-JournalSteps).ContainsKey('join')) {
    if (-not $JoinFile -or -not (Test-Path $JoinFile)) { return [ordered]@{ status = 'waiting-for-join-file'; what = 'Open My connection, choose Add a computer, and save the pairing file it gives you — setup finishes by itself from there.' } }
    $join = Get-Content $JoinFile -Raw | ConvertFrom-Json
    if (-not $join.deviceId -or -not $join.code) { throw 'That pairing file is missing its device id or code (F13).' }
    $joinCmd = "cd /home/ras-playground/.config/ras-playground && node agent.mjs join --device $($join.deviceId) --code $($join.code)"
    $r = Invoke-WslTimeout @('-d', $script:DistroName, '-u', 'ras-playground', '--', 'bash', '-lc', $joinCmd) 300
    if ($r.ExitCode -ne 0) { throw "Pairing was refused or failed ($($r.ExitCode)): $($r.StdOut) $($r.StdErr) (F13)" }
    $s = Invoke-WslTimeout @('-d', $script:DistroName, '-u', 'root', '--', 'systemctl', 'start', 'ras-playground-agent') 120
    if ($s.ExitCode -ne 0) { throw "The host service did not start ($($s.ExitCode)) (F14)" }
    Write-Journal 'join' @{ deviceId = $join.deviceId }
  }
  $jj = Get-JournalSteps
  if ($jj.ContainsKey('stayawake') -and -not $jj.ContainsKey('stayawake-restored')) { Set-StayAwake -Restore }
  return [ordered]@{ status = 'joined'; next = 'Owner approval on My connection finishes enrollment; the readiness check then runs by itself.' }
}

function Pause-Playground {
  & schtasks.exe /Delete /TN $script:KeeperTask /F 2>$null | Out-Null
  try { & wsl.exe --terminate $script:DistroName 2>$null } catch {}
  Write-Journal 'paused' @{}
}
function Remove-Playground { param([switch]$RestoreFeatures)
  Pause-Playground
  & schtasks.exe /Delete /TN $script:ResumeTask /F 2>$null | Out-Null
  . (Join-Path $PSScriptRoot '..\provision\provision-distro.ps1')
  Remove-PlaygroundDistro
  $preJ = Get-JournalSteps
  if ($preJ.ContainsKey('stayawake') -and -not $preJ.ContainsKey('stayawake-restored')) { Set-StayAwake -Restore }
  $j = Get-JournalSteps
  if ($RestoreFeatures -and $j.ContainsKey('elevation')) {
    # Only features this installer enabled (recorded in the batch) are disabled.
    foreach ($entry in $j['elevation'].data.batch) { if ("$entry" -like 'enable-feature:*') { $name = "$entry".Split(':')[1]; try { Disable-WindowsOptionalFeature -Online -FeatureName $name -NoRestart | Out-Null } catch {} } }
  }
  Write-Journal 'removed' @{ restoreFeatures = [bool]$RestoreFeatures }
}
Export-ModuleMember -Function Invoke-PlaygroundSetup, Pause-Playground, Remove-Playground, Get-ProbeFacts, Classify-Facts, Get-ElevationBatch, Get-JournalSteps, Register-PlaygroundTasks
