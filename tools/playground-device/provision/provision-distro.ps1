# PLAY-3 §3 step 3 — create/remove the installer-owned PlaygroundWorker
# distro. Every wsl.exe call runs under a hard timeout (the 2026-11-01 lab
# rule: a wedged wsl is F14, never a hang). The distro comes from the
# OFFICIAL Ubuntu WSL rootfs via `wsl --import` — a custom distro name is
# impossible with `wsl --install`, which is why this is import, not install
# (recorded deviation from the design's shorthand). The image is verified
# against the release-pinned SHA-256 before import; an unpinned build
# refuses to import anything.
$script:PlaygroundDistroName = 'PlaygroundWorker'
# RELEASE INPUTS — pinned by the release that ships the installer (URL is
# the official Ubuntu WSL image; the hash is filled in by the release after
# the step-3 battery downloads and hashes the exact image).
$script:UbuntuWslRootfsUrl = 'https://cloud-images.ubuntu.com/wsl/releases/noble/current/ubuntu-noble-wsl-amd64-rootfs.tar.gz'
$script:UbuntuWslRootfsSha256 = ''

function Invoke-WslTimeout {
  param([string[]]$Arguments, [int]$TimeoutSec = 120)
  $out = [System.IO.Path]::GetTempFileName(); $err = [System.IO.Path]::GetTempFileName()
  try {
    $p = Start-Process -FilePath 'wsl.exe' -ArgumentList $Arguments -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    if (-not $p.WaitForExit($TimeoutSec * 1000)) { try { $p.Kill() } catch {}; throw "wsl $($Arguments -join ' ') timed out after ${TimeoutSec}s (F14)" }
    return [pscustomobject]@{ ExitCode = $p.ExitCode; StdOut = (Get-Content $out -Raw -ErrorAction SilentlyContinue); StdErr = (Get-Content $err -Raw -ErrorAction SilentlyContinue) }
  } finally { Remove-Item $out, $err -Force -ErrorAction SilentlyContinue }
}

function Test-PlaygroundDistro {
  try { $r = Invoke-WslTimeout @('-l', '-q') 30; return ($r.StdOut -split "`n" | ForEach-Object { $_.Trim([char]0, ' ', "`r") }) -contains $script:PlaygroundDistroName } catch { return $false }
}

function Install-PlaygroundDistro {
  param([string]$InstallDir = "$env:LOCALAPPDATA\RobinsonPlayground\PlaygroundWorker", [string]$PayloadDir)
  if (-not $script:UbuntuWslRootfsSha256) { throw 'This build has no pinned Ubuntu image hash; refusing to import an unverified image (release input missing).' }
  if (Test-PlaygroundDistro) { return [pscustomobject]@{ Distro = $script:PlaygroundDistroName; AlreadyPresent = $true } }
  New-Item -ItemType Directory -Force -Path $InstallDir, "$env:LOCALAPPDATA\RobinsonPlayground" | Out-Null
  $tar = "$env:LOCALAPPDATA\RobinsonPlayground\ubuntu-wsl-rootfs.tar.gz"
  if (-not (Test-Path $tar) -or (Get-FileHash $tar -Algorithm SHA256).Hash.ToLower() -ne $script:UbuntuWslRootfsSha256.ToLower()) {
    Invoke-WebRequest -Uri $script:UbuntuWslRootfsUrl -OutFile $tar -TimeoutSec 1200
    if ((Get-FileHash $tar -Algorithm SHA256).Hash.ToLower() -ne $script:UbuntuWslRootfsSha256.ToLower()) { throw 'Downloaded Ubuntu image does not match the pinned hash (F12).' }
  }
  # cloud-init user data must exist before the distro's FIRST boot.
  $cloudInitDir = "$env:USERPROFILE\.cloud-init"; New-Item -ItemType Directory -Force -Path $cloudInitDir | Out-Null
  Copy-Item (Join-Path $PayloadDir 'user-data.yaml') (Join-Path $cloudInitDir "$($script:PlaygroundDistroName).user-data") -Force
  $imp = Invoke-WslTimeout @('--import', $script:PlaygroundDistroName, $InstallDir, $tar, '--version', '2') 600
  if ($imp.ExitCode -ne 0) { throw "wsl --import failed ($($imp.ExitCode)): $($imp.StdErr) (F14)" }
  # First boot: cloud-init provisions; the idempotent script converges any gap.
  $boot = Invoke-WslTimeout @('-d', $script:PlaygroundDistroName, '-u', 'root', '--', 'bash', '-lc', 'mkdir -p /usr/local/lib/ras-playground') 300
  if ($boot.ExitCode -ne 0) { throw "PlaygroundWorker first boot failed ($($boot.ExitCode)) (F14)" }
  return [pscustomobject]@{ Distro = $script:PlaygroundDistroName; AlreadyPresent = $false }
}

function Remove-PlaygroundDistro {
  if (Test-PlaygroundDistro) { $r = Invoke-WslTimeout @('--unregister', $script:PlaygroundDistroName) 300; if ($r.ExitCode -ne 0) { throw "wsl --unregister failed ($($r.ExitCode))" } }
  Remove-Item "$env:USERPROFILE\.cloud-init\$($script:PlaygroundDistroName).user-data" -Force -ErrorAction SilentlyContinue
}
