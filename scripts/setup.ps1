<#
    Setup for go2rtc-wyze-monitor.

    Downloads the go2rtc binary, installs npm dependencies, and generates
    go2rtc/go2rtc.yaml from your cameras.yaml.

        powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
#>

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$go2rtcDir = Join-Path $root 'go2rtc'
$go2rtcExe = Join-Path $go2rtcDir 'go2rtc.exe'

Write-Host "go2rtc-wyze-monitor setup" -ForegroundColor Cyan
Write-Host "Project root: $root`n"

# --- 1. Prerequisites -------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw "Node.js not found on PATH. Install it from https://nodejs.org/" }
Write-Host "[ok] node $(node --version)"

$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($ffmpeg) {
    Write-Host "[ok] ffmpeg found at $($ffmpeg.Source)"
} else {
    Write-Warning "ffmpeg is not on PATH. Install it (winget install Gyan.FFmpeg) or set an absolute path in cameras.yaml."
}

# --- 2. cameras.yaml --------------------------------------------------------
$config = Join-Path $root 'cameras.yaml'
$example = Join-Path $root 'cameras.example.yaml'
if (-not (Test-Path $config)) {
    Copy-Item $example $config
    Write-Host "`n[created] cameras.yaml" -ForegroundColor Yellow
    Write-Host "Edit it with your camera IPs, usernames, and RTSP passwords, then run this script again."
    Write-Host "  notepad `"$config`""
    exit 0
}
Write-Host "[ok] cameras.yaml present"

# --- 3. go2rtc binary -------------------------------------------------------
if (Test-Path $go2rtcExe) {
    Write-Host "[ok] go2rtc.exe already present"
} else {
    New-Item -ItemType Directory -Force -Path $go2rtcDir | Out-Null
    Write-Host "`nDownloading latest go2rtc..."
    $release = Invoke-RestMethod 'https://api.github.com/repos/AlexxIT/go2rtc/releases/latest' -Headers @{ 'User-Agent' = 'go2rtc-wyze-monitor' }
    $asset = $release.assets | Where-Object { $_.name -eq 'go2rtc_win64.zip' } | Select-Object -First 1
    if (-not $asset) { throw "Could not find go2rtc_win64.zip in release $($release.tag_name)" }

    $zip = Join-Path $env:TEMP 'go2rtc_win64.zip'
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $go2rtcDir -Force
    Remove-Item $zip -Force
    Write-Host "[ok] go2rtc $($release.tag_name) installed"
}

# --- 4. npm install ---------------------------------------------------------
Write-Host "`nInstalling npm dependencies (this pulls Electron, ~200MB)..."
Push-Location $root
try { & npm install --no-fund --no-audit } finally { Pop-Location }
Write-Host "[ok] dependencies installed"

# --- 5. Generate go2rtc config ---------------------------------------------
Write-Host "`nGenerating go2rtc config..."
Push-Location $root
try { & node scripts/generate-go2rtc-config.js } finally { Pop-Location }

Write-Host "`nSetup complete. Start the monitor with:" -ForegroundColor Green
Write-Host "  npm start`n"
