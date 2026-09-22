[CmdletBinding()]
param(
    [string]$Destination = 'output/wyze-monitor-rpi-installer.zip'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stagingRoot = Join-Path $root 'tmp/pi-installer-package'
$payloadRoot = Join-Path $stagingRoot 'wyze-monitor-rpi'
$resolvedRoot = [IO.Path]::GetFullPath($root)
$resolvedStaging = [IO.Path]::GetFullPath($stagingRoot)

if (-not $resolvedStaging.StartsWith($resolvedRoot + [IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to use a staging directory outside the project.'
}

if (Test-Path -LiteralPath $stagingRoot) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $payloadRoot -Force | Out-Null

$files = @(
    'README.md',
    'LICENSE',
    'SECURITY.md',
    'CONTRIBUTING.md',
    'CHANGELOG.md',
    '.dockerignore',
    '.gitattributes',
    '.gitignore',
    'cameras.example.yaml',
    'docs/QUICKSTART.md',
    'docs/CONFIGURATION.md',
    'docs/WINDOWS.md',
    'docs/OPERATIONS.md',
    'docs/TROUBLESHOOTING.md',
    'docs/ARCHITECTURE.md',
    'docs/PERFORMANCE.md',
    'docs/PLATFORM-FEATURES.md',
    'research/30fps/report-source.md',
    'research/30fps/claim-source-ledger.md',
    'package.json',
    'package-lock.json',
    'scripts/generate-go2rtc-config.js',
    'scripts/setup.ps1',
    'scripts/build-pi-installer.ps1',
    'tests/config.test.js',
    'tests/server.test.js',
    'tests/playback.test.js',
    'tests/recordings.test.js',
    'src/main.js',
    'src/preload.js',
    'src/renderer.html',
    'src/renderer.js',
    'src/smooth30.js',
    'src/styles.css',
    'src/vendor/video-rtc.js',
    'raspberry-pi/.env.example',
    'raspberry-pi/COMPATIBILITY.md',
    'raspberry-pi/Dockerfile',
    'raspberry-pi/README.md',
    'raspberry-pi/compose.yaml',
    'raspberry-pi/compose.pi4.yaml',
    'raspberry-pi/compose.pi5.yaml',
    'raspberry-pi/configure.sh',
    'raspberry-pi/generate-go2rtc-config.js',
    'raspberry-pi/install.sh',
    'raspberry-pi/publish-friendly-url.sh',
    'raspberry-pi/server.js',
    'raspberry-pi/recordings.js',
    'raspberry-pi/setup.sh',
    'raspberry-pi/wyze-monitor',
    'raspberry-pi/wyze-monitor.desktop',
    'raspberry-pi/wyze-monitor.svg',
    'raspberry-pi/wyze-monitor-url.service'
)

foreach ($relativePath in $files) {
    $source = Join-Path $root $relativePath
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Required installer file is missing: $relativePath"
    }
    $target = Join-Path $payloadRoot $relativePath
    $targetDirectory = Split-Path -Parent $target
    New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target
}

$archive = if ([IO.Path]::IsPathRooted($Destination)) {
    [IO.Path]::GetFullPath($Destination)
} else {
    [IO.Path]::GetFullPath((Join-Path $root $Destination))
}
$archiveDirectory = Split-Path -Parent $archive
New-Item -ItemType Directory -Path $archiveDirectory -Force | Out-Null
Compress-Archive -LiteralPath $payloadRoot -DestinationPath $archive -Force

$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $archive
$checksumFile = $archive + '.sha256'
$checksumLine = $hash.Hash.ToLowerInvariant() + '  ' + [IO.Path]::GetFileName($archive)
[IO.File]::WriteAllText($checksumFile, $checksumLine + "`n", [Text.UTF8Encoding]::new($false))
Write-Host "Created: $archive"
Write-Host "SHA256: $($hash.Hash)"
Write-Host "Checksum file: $checksumFile"
