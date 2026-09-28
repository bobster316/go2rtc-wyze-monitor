param(
    [ValidateSet('pi', 'pi4')]
    [string]$Device = 'pi',
    # Empty: use the device's default address from src/pi-viewer.js.
    [string]$Url = ''
)
$ErrorActionPreference = 'Stop'
$wyzeProject = Split-Path -Parent $PSScriptRoot
$wyzeElectron = Join-Path $wyzeProject 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $wyzeElectron)) { throw 'Run npm install in the Wyze Monitor project first.' }
# Electron refuses to start with --use-system-ca in NODE_OPTIONS.
$env:NODE_OPTIONS = $null
$viewer = Join-Path $wyzeProject 'src\pi-viewer.js'
$viewerArgs = @("`"$viewer`"", "--device=$Device")
if ($Url) { $viewerArgs += "--url=$Url" }
Start-Process -FilePath $wyzeElectron -ArgumentList $viewerArgs -WorkingDirectory $wyzeProject
