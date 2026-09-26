param(
    [string]$Url = 'http://192.168.1.155:18765'
)
$ErrorActionPreference = 'Stop'
$wyzeProject = Split-Path -Parent $PSScriptRoot
$wyzeElectron = Join-Path $wyzeProject 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $wyzeElectron)) { throw 'Run npm install in the Wyze Monitor project first.' }
# Electron refuses to start with --use-system-ca in NODE_OPTIONS.
$env:NODE_OPTIONS = $null
$viewer = Join-Path $wyzeProject 'src\pi-viewer.js'
Start-Process -FilePath $wyzeElectron -ArgumentList @("`"$viewer`"", "--url=$Url") -WorkingDirectory $wyzeProject
