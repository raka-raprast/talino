# talino installer for Windows — bootstraps omp itself (if it isn't already
# on this machine), then downloads and runs the latest Talino installer
# from GitHub Releases.
#
#   irm https://talino.raprast.asia/install.ps1 | iex
#
$ErrorActionPreference = "Stop"

$Repo = "raka-raprast/talino"
$OmpInstallUrl = "https://omp.sh/install.ps1"

function Write-Banner {
    Write-Host ""
    Write-Host "+-----------------------------------------------------------+" -ForegroundColor Cyan
    Write-Host "|                    talino installer                       |" -ForegroundColor Cyan
    Write-Host "|      a desktop IDE with an AI coding agent built in        |" -ForegroundColor Cyan
    Write-Host "+-----------------------------------------------------------+" -ForegroundColor Cyan
    Write-Host ""
}

function Write-InfoLine    { param($Message) Write-Host "-> $Message" -ForegroundColor Cyan }
function Write-SuccessLine { param($Message) Write-Host "OK $Message" -ForegroundColor Green }
function Write-WarnLine    { param($Message) Write-Host "!  $Message" -ForegroundColor Yellow }
function Write-ErrLine     { param($Message) Write-Host "X  $Message" -ForegroundColor Red }

Write-Banner

# ── 1. omp itself ─────────────────────────────────────────────────────────────
# Talino's chat panel drives the omp CLI agent; without it the app has
# nothing to run a conversation through, so it comes first.

$ompCmd = Get-Command omp -ErrorAction SilentlyContinue
if ($ompCmd) {
    Write-SuccessLine "omp found: $($ompCmd.Source)"
} else {
    Write-InfoLine "omp not found - installing it (irm $OmpInstallUrl | iex)"
    try {
        Invoke-RestMethod $OmpInstallUrl | Invoke-Expression
    } catch {
        Write-ErrLine "omp install failed: $_"
        Write-ErrLine "Install it manually from https://omp.sh, then re-run this script."
        exit 1
    }
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $ompCmd = Get-Command omp -ErrorAction SilentlyContinue
    if ($ompCmd) {
        Write-SuccessLine "omp installed: $($ompCmd.Source)"
    } else {
        Write-WarnLine "omp installed but not on PATH in this session - restart your terminal, or Talino's settings tab will let you point at a custom path."
    }
}

# ── 2. Latest Talino build ────────────────────────────────────────────────────

$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
    "ARM64" { "arm64" }
    "AMD64" { "x64" }
    default {
        Write-ErrLine "Unsupported architecture: $($env:PROCESSOR_ARCHITECTURE). Talino needs 64-bit Windows."
        exit 1
    }
}

Write-InfoLine "looking up the latest Talino release..."
$release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
$asset = $release.assets | Where-Object { $_.name -like "*win-$arch.exe" } | Select-Object -First 1
if (-not $asset) {
    Write-ErrLine "Could not find a Windows ($arch) build in the latest release."
    Write-ErrLine "Browse https://github.com/$Repo/releases and download it by hand."
    exit 1
}
Write-SuccessLine "found $($release.tag_name): $($asset.name)"

# ── 3. Download and run the installer ─────────────────────────────────────────

$tmpDir = Join-Path $env:TEMP "talino-install-$([guid]::NewGuid())"
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$installerPath = Join-Path $tmpDir $asset.name

try {
    Write-InfoLine "downloading..."
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $installerPath

    Write-InfoLine "launching installer..."
    Start-Process -FilePath $installerPath -Wait

    Write-Host ""
    Write-SuccessLine "done - launch Talino from the Start Menu."
} finally {
    Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
}
