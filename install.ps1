# talino installer for Windows — bootstraps omp itself (if it isn't already
# on this machine), then downloads and runs the latest Talino installer,
# self-hosted at talino.raprast.asia (built via an electron-builder Windows
# cross-build; see raka-raprast/talino's GitHub Releases for the point where
# this moves to a real CI-built artifact instead).
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

if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64") {
    Write-ErrLine "Only 64-bit x64 Windows builds are available right now (you're on $($env:PROCESSOR_ARCHITECTURE))."
    Write-ErrLine "Browse https://github.com/$Repo/releases or ask for an arm64 build."
    exit 1
}

$DownloadUrl = "https://talino.raprast.asia/downloads/talino-win-x64.exe"
Write-InfoLine "downloading the latest Talino build for win-x64..."

# ── 3. Download and run the installer ─────────────────────────────────────────

$tmpDir = Join-Path $env:TEMP "talino-install-$([guid]::NewGuid())"
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$installerPath = Join-Path $tmpDir "talino-win-x64.exe"

try {
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $installerPath

    Write-InfoLine "launching installer..."
    Start-Process -FilePath $installerPath -Wait

    Write-Host ""
    Write-SuccessLine "done - launch Talino from the Start Menu."
} finally {
    Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
}
